import "server-only";
import { pauseAllElevenLabsCampaigns } from "@/lib/elevenlabs-calls";
import { getElevenLabsCall, listElevenLabsCalls } from "@/lib/elevenlabs-conversations";
import { createAdminClient } from "@/lib/supabase/admin";
import { controlCampaign, createAgentForBusiness, createTicketTool, listRunningCampaigns, getAgentVariables, getCall, listCalls, setReceptionistSupport, updateAgentVariables, type AgentVariables, type Call } from "@/lib/dograh";
import { ROLE_LABELS, roleGreeting, roleHead, type AgentRole } from "@/lib/role-prompts";
import { createElevenLabsRoleAgent, createElevenLabsTicketTool, ensureElevenLabsRoleAgent, refreshElevenLabsRoleAgent, updateElevenLabsReceptionist, voiceProvider } from "@/lib/elevenlabs";
import type { ReceptionistDetails } from "@/lib/elevenlabs-receptionist-prompt";
import { elevenLabsStudioExtras } from "@/lib/elevenlabs-studio";
import { withBusinessDograh } from "@/lib/dograh-key";

// Extra agents per dealership (client requirements). Everything here is additive: with the feature
// off, or no extra agents yet, a dealership behaves exactly like the original single receptionist.

export type RoleAgent = { role: AgentRole; workflowId: number };

// Switched on per dealership by the admin (Admin → "Extra agents").
export async function extraAgentsEnabled(businessId: string): Promise<boolean> {
  const { data } = await createAdminClient().from("business_features").select("extra_agents").eq("business_id", businessId).maybeSingle();
  return data?.extra_agents ?? false;
}

// Also turns L1 support on the receptionist on/off, so "Off" really is the original receptionist.
export async function setExtraAgents(business: { id: string; dograh_workflow_id: string | null }, enabled: boolean) {
  const { error } = await createAdminClient()
    .from("business_features")
    .upsert({ business_id: business.id, extra_agents: enabled, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Saving the switch failed: ${error.message}`);
  await applySupport(business);
}

export async function getSupportSettings(businessId: string) {
  const { data } = await createAdminClient().from("business_features").select("extra_agents, support_kb, ticket_tool_uuid").eq("business_id", businessId).maybeSingle();
  return { enabled: data?.extra_agents ?? false, knowledgeBase: data?.support_kb ?? "", ticketToolUuid: data?.ticket_tool_uuid ?? null };
}

// Brings the receptionist in line with the saved settings: support script + ticket tool when extra agents are on, none when off.
export async function applySupport(business: { id: string; dograh_workflow_id: string | null }) {
  await applyElevenLabsSupport(business.id);
  if (!business.dograh_workflow_id) return;
  const settings = await getSupportSettings(business.id);
  let toolUuid = settings.ticketToolUuid;
  if (!toolUuid) {
    if (!settings.enabled) return; // never had support: nothing to remove
    toolUuid = await createTicketTool(business.id);
    const { error } = await createAdminClient().from("business_features").update({ ticket_tool_uuid: toolUuid }).eq("business_id", business.id);
    if (error) throw new Error(`Saving the ticket tool failed: ${error.message}`);
  }
  await setReceptionistSupport(Number(business.dograh_workflow_id), settings.enabled, settings.knowledgeBase, toolUuid);
}

// Saves the support FAQ text and re-publishes the receptionist with it.
export async function saveSupportKnowledge(business: { id: string; dograh_workflow_id: string | null }, knowledgeBase: string) {
  const { error } = await createAdminClient()
    .from("business_features")
    .update({ support_kb: knowledgeBase, updated_at: new Date().toISOString() })
    .eq("business_id", business.id);
  if (error) throw new Error(error.message);
  await applySupport(business);
}

export async function listRoleAgents(businessId: string): Promise<RoleAgent[]> {
  const { data } = await createAdminClient().from("business_agents").select("role, dograh_workflow_id").eq("business_id", businessId);
  return (data ?? []).map((a) => ({ role: a.role as AgentRole, workflowId: Number(a.dograh_workflow_id) }));
}

// Returns the dealership's agent for a role, creating it in Dograh the first time.
// It starts from the receptionist's details (name, hours, Voice Studio instructions) but has its own script.
export async function ensureRoleAgent(business: { id: string; dograh_workflow_id: string | null }, role: AgentRole): Promise<number> {
  const existing = (await listRoleAgents(business.id)).find((a) => a.role === role);
  if (existing) return existing.workflowId;
  if (!business.dograh_workflow_id) throw new Error("The receptionist isn't set up yet.");

  const vars = await getAgentVariables(Number(business.dograh_workflow_id));
  delete vars.custom_greeting; // the role has its own opening line
  const workflowId = await createAgentForBusiness({ ...vars, agent_role: role });
  const { error } = await createAdminClient()
    .from("business_agents")
    .insert({ business_id: business.id, role, dograh_workflow_id: String(workflowId) });
  if (error?.code === "23505") {
    // Another request created this role at the same moment: use theirs (ours stays unused in Dograh).
    const winner = (await listRoleAgents(business.id)).find((a) => a.role === role);
    if (winner) return winner.workflowId;
  }
  if (error) throw new Error(`Saving the ${role} agent failed: ${error.message}`);
  return workflowId;
}

// The dealership's ElevenLabs agent for a role (dealerships on ElevenLabs), created the first time from its
// ElevenLabs receptionist plus the same job script the Dograh agent uses. Dealership details still come from
// the Dograh receptionist, which holds them until onboarding moves to ElevenLabs.
// After the dealership's details change: rewrite the ElevenLabs receptionist, then bring its job agents in line.
export async function updateElevenLabsAgentsFor(businessId: string, details: Omit<ReceptionistDetails, "agent_name">) {
  const voice = await voiceProvider(businessId);
  if (voice.provider !== "elevenlabs") return;
  const full = { ...details, agent_name: voice.agentName };
  await updateElevenLabsReceptionist(voice.agentId, full, await elevenLabsExtras(businessId));
  const { data: roles } = await createAdminClient().from("elevenlabs_agents").select("role, agent_id").eq("business_id", businessId);
  for (const r of roles ?? []) {
    const role = r.role as AgentRole;
    await refreshElevenLabsRoleAgent(r.agent_id, {
      receptionistAgentId: voice.agentId,
      label: ROLE_LABELS[role],
      head: roleHead(role),
      greeting: roleGreeting(role),
      details: { agent_name: voice.agentName, dealership_name: details.dealership_name, city: details.city, brands: details.brands },
      canBook: role === "marketing",
    });
  }
}

// The dealership's own additions to the ElevenLabs receptionist (Voice Studio).
export async function elevenLabsExtras(businessId: string) {
  const [studio, support, { data }] = await Promise.all([
    elevenLabsStudioExtras(businessId),
    getSupportSettings(businessId),
    createAdminClient().from("business_features").select("elevenlabs_ticket_tool_id").eq("business_id", businessId).maybeSingle(),
  ]);
  const ticketToolId = (data?.elevenlabs_ticket_tool_id as string | null) ?? null;
  return {
    ...studio,
    // Only with its tool: a script that mentions create_ticket without the tool makes the model improvise.
    support: support.enabled && ticketToolId ? { knowledgeBase: support.knowledgeBase } : null,
    ticketToolId,
  };
}

// Support switched on (or its FAQ edited) for an ElevenLabs dealership: make the ticket tool the first time,
// then rewrite Priya with the support section.
async function applyElevenLabsSupport(businessId: string) {
  const voice = await voiceProvider(businessId);
  if (voice.provider !== "elevenlabs") return;
  const db = createAdminClient();
  const [support, { data: features }, { data: b }] = await Promise.all([
    getSupportSettings(businessId),
    db.from("business_features").select("elevenlabs_ticket_tool_id").eq("business_id", businessId).maybeSingle(),
    db.from("businesses").select("name, city, brands, showroom_hours, service_hours").eq("id", businessId).single(),
  ]);
  if (support.enabled && !features?.elevenlabs_ticket_tool_id) {
    const toolId = await createElevenLabsTicketTool(voice.agentId, businessId);
    const { error } = await db.from("business_features").update({ elevenlabs_ticket_tool_id: toolId }).eq("business_id", businessId);
    if (error) throw new Error(`Saving the ticket tool failed: ${error.message}`);
  }
  if (!b) return;
  await updateElevenLabsAgentsFor(businessId, { dealership_name: b.name, city: b.city, brands: b.brands, showroom_hours: b.showroom_hours ?? "", service_hours: b.service_hours ?? "" });
}

export async function ensureElevenLabsRoleAgentFor(
  business: { id: string; dograh_workflow_id: string | null },
  role: AgentRole,
  receptionist: { agentId: string; agentName: string },
): Promise<string> {
  return ensureElevenLabsRoleAgent(business.id, role, async () => {
    if (!business.dograh_workflow_id) throw new Error("The receptionist isn't set up yet.");
    const vars = await getAgentVariables(Number(business.dograh_workflow_id));
    return createElevenLabsRoleAgent({
      receptionistAgentId: receptionist.agentId,
      label: ROLE_LABELS[role],
      head: roleHead(role),
      greeting: roleGreeting(role),
      details: { agent_name: receptionist.agentName, dealership_name: vars.dealership_name, city: vars.city, brands: vars.brands },
      canBook: role === "marketing",
    });
  });
}

// Keeps the extra agents' dealership details (name, hours, brands…) in step with the receptionist.
export async function updateRoleAgents(businessId: string, details: Partial<AgentVariables>) {
  for (const agent of await listRoleAgents(businessId)) {
    await updateAgentVariables(agent.workflowId, { ...(await getAgentVariables(agent.workflowId)), ...details, agent_role: agent.role });
  }
}

// Every workflow this dealership owns: the receptionist first, then any extra agents.
export async function businessWorkflowIds(business: { id: string; dograh_workflow_id: string | null }): Promise<number[]> {
  const main = business.dograh_workflow_id ? [Number(business.dograh_workflow_id)] : [];
  return [...main, ...(await listRoleAgents(business.id)).map((a) => a.workflowId)];
}

// Calls across all the dealership's agents, newest first. Same as listCalls when there are no extra agents.
// ElevenLabs calls are merged in (when the dealership has ElevenLabs agents), so earlier Dograh history stays visible.
export async function listBusinessCalls(business: { id: string; dograh_workflow_id: string | null }, limit = 100): Promise<Call[]> {
  const [dograhCalls, elevenLabsCalls] = await Promise.all([
    listDograhBusinessCalls(business, limit),
    listElevenLabsCalls(business.id, limit).catch((err) => {
      console.error("ElevenLabs calls failed:", err);
      return [] as Call[];
    }),
  ]);
  if (!elevenLabsCalls.length) return dograhCalls;
  return [...dograhCalls, ...elevenLabsCalls].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
}

async function listDograhBusinessCalls(business: { id: string; dograh_workflow_id: string | null }, limit: number): Promise<Call[]> {
  const main = business.dograh_workflow_id ? listCalls(Number(business.dograh_workflow_id), limit) : Promise.resolve([]);
  const roles = await listRoleAgents(business.id);
  if (!roles.length) return main;
  const tagged = roles.map((a) => listCalls(a.workflowId, limit).then((calls) => calls.map((c) => ({ ...c, role: a.role }))));
  const all = (await Promise.all([main, ...tagged])).flat();
  return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
}

// One call, looked up only among this dealership's own agents.
export async function getBusinessCall(business: { id: string; dograh_workflow_id: string | null }, runId: number | string) {
  if (typeof runId === "string") return getElevenLabsCall(business.id, runId);
  for (const id of await businessWorkflowIds(business)) {
    const detail = await getCall(id, runId).catch(() => null);
    if (detail) return detail;
  }
  return null;
}

// Stops every campaign this dealership has dialling (used when the admin pauses the account).
export async function pauseRunningCampaigns(businessId: string) {
  const { data: business } = await createAdminClient().from("businesses").select("id, dograh_workflow_id").eq("id", businessId).maybeSingle();
  if (!business) return;
  await pauseAllElevenLabsCampaigns(businessId);
  await withBusinessDograh(businessId, async () => {
    for (const c of await listRunningCampaigns(await businessWorkflowIds(business))) await controlCampaign(c.id, "pause");
  });
}
