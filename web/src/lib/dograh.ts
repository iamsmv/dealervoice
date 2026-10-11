import "server-only";
import { currentDograhKey, platformDograhKey, withDograhKey } from "@/lib/dograh-key";
import { toolSignature } from "@/lib/tool-auth";
import { ROLE_LABELS, roleEndReasons, roleGreeting, rolePrompt, supportSection, type AgentRole } from "@/lib/role-prompts";

const API_URL = process.env.DOGRAH_API_URL ?? "https://app.dograh.com/api/v1";

async function dograh<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": await currentDograhKey(),
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Dograh ${init.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

// Dealership details written into its agent's greeting and prompt.
export type AgentVariables = {
  business_id: string;
  dealership_name: string;
  city: string;
  brands: string;
  showroom_hours: string;
  service_hours: string;
  agent_name: string;
  // Voice Studio edits, kept with the agent so re-applying the template doesn't lose them.
  custom_greeting?: string;
  custom_instructions?: string;
  // Set on the extra agents (client requirements); the receptionist has none.
  agent_role?: AgentRole;
  // L1 support on the receptionist (only while extra agents are switched on), with its FAQ text.
  support_enabled?: boolean;
  support_kb?: string;
};

type WorkflowNode = {
  id: string;
  type: string;
  position?: { x: number; y: number };
  data: Record<string, unknown> & { prompt?: string; greeting?: string; tool_uuids?: string[]; trigger_path?: string };
};
type Workflow = { workflow_definition: { nodes: WorkflowNode[] } & Record<string, unknown> };

// Replaces {{dealership_name}} etc. with real values. Dograh's built-in clock
// variables ({{current_time_…}}) are left alone so the agent still knows today's date.
function fillPlaceholders(text: string, vars: AgentVariables): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    String(vars[key as keyof AgentVariables] ?? match),
  );
}

const bookingParameters = [
  { name: "name", type: "string", description: "Full name of the caller.", required: true },
  { name: "email", type: "string", description: "Email address of the caller, e.g. ravi@gmail.com", required: true },
  { name: "phone", type: "string", description: "Caller's phone number with country code, no spaces, e.g. +919876543210", required: true },
  { name: "start_time", type: "string", description: "Appointment start in the dealership's local time, ISO format YYYY-MM-DDTHH:MM:00, e.g. 2026-10-10T11:00:00", required: true },
  { name: "car_model", type: "string", description: "Car model the caller is interested in, e.g. Nexon. Leave empty if not mentioned.", required: false },
];

type Tool = { tool_uuid: string; name: string; description: string; category: string; definition: { type: string; config: Record<string, unknown> } };

// Lets the agent hang up politely once the conversation is over. The reason becomes the call's outcome.
async function createEndCallTool(reasons = "booking_done, enquiry_answered, ticket_created, support_answered, caller_not_interested, wrong_number, other"): Promise<string> {
  const tool = await dograh<{ tool_uuid: string }>("/tools/", {
    method: "POST",
    body: JSON.stringify({
      name: "dv_end_call",
      description: "Ends the phone call. Use only after you have said goodbye and the caller has nothing else to ask.",
      category: "end_call",
      definition: {
        schema_version: 1,
        type: "end_call",
        config: {
          messageType: "none",
          endCallReason: true,
          endCallReasonDescription: `Short reason in snake_case, one of: ${reasons}.`,
        },
      },
    }),
  });
  return tool.tool_uuid;
}

// Returns the agent's tool list, bringing older agents up to date: booking tools get the
// latest parameters and an end-call tool is added if missing.
async function ensureAgentTools(current: Workflow): Promise<string[]> {
  const uuids = current.workflow_definition.nodes.find((n) => n.data.tool_uuids?.length)?.data.tool_uuids ?? [];
  let hasEndCall = false;
  for (const uuid of uuids) {
    const tool = await dograh<Tool>(`/tools/${uuid}`);
    if (tool.definition.type === "end_call") hasEndCall = true;
    if (tool.name === "dv_book_appointment") {
      await dograh(`/tools/${uuid}`, {
        method: "PUT",
        body: JSON.stringify({
          name: tool.name,
          description: tool.description,
          definition: { ...tool.definition, config: { ...tool.definition.config, parameters: bookingParameters } },
        }),
      });
    }
  }
  return hasEndCall ? uuids : [...uuids, await createEndCallTool()];
}

// Lets the receptionist open a support ticket (L1 support). business_id is fixed in, like the booking tool.
export async function createTicketTool(businessId: string): Promise<string> {
  const tool = await dograh<{ tool_uuid: string }>("/tools/", {
    method: "POST",
    body: JSON.stringify({
      name: "dv_create_ticket",
      description: "Opens a support ticket for an existing customer's problem that you can't solve on the call (service, warranty, breakdown, billing, complaint). Returns the ticket number to read back.",
      category: "http_api",
      definition: {
        schema_version: 1,
        type: "http_api",
        config: {
          method: "POST",
          url: `${process.env.APP_URL}/api/ticket`,
          headers: { "X-Tool-Signature": toolSignature(businessId) },
          parameters: [
            { name: "customer_name", type: "string", description: "Customer's name in English spelling.", required: true },
            { name: "phone", type: "string", description: "Customer's phone number with country code, e.g. +919876543210", required: true },
            { name: "vehicle", type: "string", description: "Car model and Indian registration number in capitals with spaces, e.g. Nexon KA 01 AB 1234 (or 22 BH 1234 AA). Model only if the number is unknown.", required: false },
            { name: "category", type: "string", description: "One of: service, warranty, breakdown, billing, product_question, complaint, other", required: true },
            { name: "priority", type: "string", description: "One of: urgent, high, normal, low", required: true },
            { name: "description", type: "string", description: "Short summary of the problem in the customer's words, 1-3 sentences.", required: true },
          ],
          preset_parameters: [{ name: "business_id", type: "string", value_template: businessId, required: true }],
          timeout_ms: 15000,
          customMessage: "Let me log that for our team. One moment please.",
          customMessageType: "text",
          body_format: "json",
        },
      },
    }),
  });
  return tool.tool_uuid;
}

// Turns L1 support on or off on the receptionist: adds/removes the support script and the ticket tool, then re-publishes.
export async function setReceptionistSupport(workflowId: number, enabled: boolean, knowledgeBase: string, ticketToolUuid: string) {
  const current = await dograh<Workflow & { template_context_variables: AgentVariables }>(`/workflow/fetch/${workflowId}`);
  const tools = (await ensureAgentTools(current)).filter((u) => u !== ticketToolUuid);
  const vars: AgentVariables = { ...current.template_context_variables, support_enabled: enabled, support_kb: knowledgeBase };
  await personaliseAgent(workflowId, vars, enabled ? [...tools, ticketToolUuid] : tools);
}

// One booking tool per dealership, with its business_id fixed in, so a call through
// any channel (web widget, phone, outbound) books into the right calendar.
async function createBookingTool(vars: AgentVariables): Promise<string> {
  const tool = await dograh<{ tool_uuid: string }>("/tools/", {
    method: "POST",
    body: JSON.stringify({
      name: "dv_book_appointment",
      description: `Books a test drive, showroom visit or service appointment at ${vars.dealership_name}, only after the caller has confirmed their name, phone number, email and preferred date and time.`,
      category: "http_api",
      definition: {
        schema_version: 1,
        type: "http_api",
        config: {
          method: "POST",
          url: `${process.env.APP_URL}/api/book`,
          headers: { "X-Tool-Signature": toolSignature(vars.business_id) },
          parameters: bookingParameters,
          preset_parameters: [{ name: "business_id", type: "string", value_template: vars.business_id, required: true }],
          timeout_ms: 15000,
          customMessage: "Sure, let me book that for you. One moment please.",
          customMessageType: "text",
          body_format: "json",
        },
      },
    }),
  });
  return tool.tool_uuid;
}

// Writes the dealership's details into the agent and publishes it (edits land in a
// draft; live calls only use the published version).
async function personaliseAgent(
  workflowId: number,
  vars: AgentVariables,
  toolUuids: string[] = [],
  callSettings?: Partial<CallSettings>,
) {
  const template = await fetchTemplate();
  const definition = structuredClone(template.workflow_definition);
  // Trigger URLs must be unique per agent, so never copy the template's; keep this agent's own (or make one).
  definition.nodes = definition.nodes.filter((n) => n.type !== "trigger");
  for (const node of definition.nodes) {
    // Extra agents swap the receptionist's script for their own, keeping the shared sections.
    if (vars.agent_role && node.type === "startCall" && typeof node.data.prompt === "string") {
      node.data.prompt = rolePrompt(vars.agent_role, node.data.prompt);
      node.data.greeting = roleGreeting(vars.agent_role);
    }
    if (typeof node.data.prompt === "string") node.data.prompt = fillPlaceholders(node.data.prompt, vars);
    if (typeof node.data.greeting === "string") node.data.greeting = fillPlaceholders(node.data.greeting, vars);
    if (toolUuids.length && typeof node.data.prompt === "string") node.data.tool_uuids = toolUuids;
    if (node.type === "startCall") {
      if (vars.custom_greeting) node.data.greeting = vars.custom_greeting;
      if (vars.custom_instructions && typeof node.data.prompt === "string") {
        node.data.prompt += `\n\n## Extra instructions from the dealership\n${vars.custom_instructions}`;
      }
      if (vars.support_enabled && !vars.agent_role && typeof node.data.prompt === "string") {
        node.data.prompt += supportSection(vars.support_kb ?? "");
      }
    }
  }
  const current = await dograh<Workflow & { workflow_configurations?: Record<string, unknown> }>(`/workflow/fetch/${workflowId}`);
  definition.nodes.push(current.workflow_definition.nodes.find((n) => n.type === "trigger") ?? newTriggerNode());

  await dograh(`/workflow/${workflowId}`, {
    method: "PUT",
    body: JSON.stringify({
      name: agentTitle(vars),
      workflow_definition: definition,
      template_context_variables: vars,
      ...(callSettings && { workflow_configurations: { ...current.workflow_configurations, ...callSettings } }),
    }),
  });
  await dograh(`/workflow/${workflowId}/publish`, { method: "POST" });
}

const agentTitle = (vars: AgentVariables) =>
  `${vars.agent_name}${vars.agent_role ? ` (${ROLE_LABELS[vars.agent_role]})` : ""} - ${vars.dealership_name}`;

// "API Trigger" node: gives the agent its own URL for starting outbound calls.
function newTriggerNode(): WorkflowNode {
  return {
    id: `trigger-${crypto.randomUUID().slice(0, 8)}`,
    type: "trigger",
    position: { x: -300, y: 50 },
    data: { name: "API Trigger", trigger_path: crypto.randomUUID() },
  };
}

// Returns the agent's trigger path, adding a trigger (and re-publishing) for agents created before outbound existed.
async function ensureTriggerPath(workflowId: number): Promise<string> {
  const wf = await dograh<Workflow & { name: string; template_context_variables?: unknown }>(`/workflow/fetch/${workflowId}`);
  const existing = wf.workflow_definition.nodes.find((n) => n.type === "trigger")?.data.trigger_path;
  if (existing) return existing;

  const trigger = newTriggerNode();
  const definition = { ...wf.workflow_definition, nodes: [...wf.workflow_definition.nodes, trigger] };
  await dograh(`/workflow/${workflowId}`, {
    method: "PUT",
    body: JSON.stringify({ name: wf.name, workflow_definition: definition, template_context_variables: wf.template_context_variables }),
  });
  await dograh(`/workflow/${workflowId}/publish`, { method: "POST" });
  return trigger.data.trigger_path!;
}

// Has the dealership's agent phone a customer. `context` becomes {{variables}} in the agent's prompt.
export async function startOutboundCall(
  workflowId: number,
  phoneNumber: string,
  context: Record<string, unknown>,
): Promise<number> {
  const triggerPath = await ensureTriggerPath(workflowId);
  const res = await dograh<{ workflow_run_id: number }>(`/public/agent/${triggerPath}`, {
    method: "POST",
    body: JSON.stringify({ phone_number: phoneNumber, initial_context: context }),
  });
  return res.workflow_run_id;
}

// The master receptionist always lives in the platform's Dograh account, whichever account we're writing to.
function fetchTemplate(): Promise<Workflow> {
  return withDograhKey(platformDograhKey(), () => dograh<Workflow>(`/workflow/fetch/${process.env.DOGRAH_TEMPLATE_WORKFLOW_ID}`));
}

// Creates a dealership's receptionist from the master template, in whichever Dograh account is active
// (the platform's, or the dealership's own once connected), and personalises it.
export async function createAgentForBusiness(vars: AgentVariables): Promise<number> {
  const template = await fetchTemplate();
  const definition = { ...template.workflow_definition, nodes: template.workflow_definition.nodes.filter((n) => n.type !== "trigger") };
  const copy = await dograh<{ id: number }>("/workflow/create/definition", {
    method: "POST",
    body: JSON.stringify({ name: agentTitle(vars), workflow_definition: definition }),
  });
  const endCall = vars.agent_role ? await createEndCallTool(roleEndReasons(vars.agent_role)) : await createEndCallTool();
  const toolUuids = [await createBookingTool(vars), endCall];
  await personaliseAgent(copy.id, vars, toolUuids);
  return copy.id;
}

// Re-applies the latest template and dealership details, keeping the agent's booking tool.
export async function updateAgentVariables(workflowId: number, vars: AgentVariables) {
  const current = await dograh<Workflow & { template_context_variables?: Partial<AgentVariables> }>(`/workflow/fetch/${workflowId}`);
  // Keep Voice Studio edits (custom greeting / instructions) unless new ones are given.
  const merged = { ...current.template_context_variables, ...vars };
  await personaliseAgent(workflowId, merged, await ensureAgentTools(current));
}

// One call ("run") of a dealership's agent, as returned by Dograh.
type DograhRun = {
  id: number;
  mode: string;
  call_type: string | null;
  created_at: string;
  is_completed: boolean;
  initial_context: { caller_number?: string; called_number?: string } | null;
  gathered_context: { call_disposition?: string } | null;
  cost_info: { call_duration_seconds?: number } | null;
  recording_public_url: string | null;
  transcript_public_url: string | null;
};

export type Call = {
  id: number | string; // Dograh run number, or an ElevenLabs "conv_…" id
  channel: "phone" | "web";
  direction: "inbound" | "outbound";
  callerNumber: string | null;
  calledNumber: string | null;
  /** The customer's number: who rang us (inbound) or who we rang (outbound). */
  customerNumber: string | null;
  startedAt: string;
  durationSeconds: number;
  outcome: string;
  completed: boolean;
  /** Which extra agent made the call (absent for the receptionist). */
  role?: AgentRole;
};

function toCall(run: DograhRun): Call {
  const direction = run.call_type === "outbound" ? "outbound" : "inbound";
  const callerNumber = run.initial_context?.caller_number ?? null;
  const calledNumber = run.initial_context?.called_number ?? null;
  return {
    id: run.id,
    // Browser test calls run over WebRTC; real phone calls run through the telephony provider.
    channel: run.mode === "smallwebrtc" ? "web" : "phone",
    direction,
    callerNumber,
    calledNumber,
    customerNumber: direction === "outbound" ? calledNumber : callerNumber,
    startedAt: run.created_at,
    durationSeconds: Math.round(run.cost_info?.call_duration_seconds ?? 0),
    outcome: run.gathered_context?.call_disposition ?? (run.is_completed ? "completed" : "in_progress"),
    completed: run.is_completed,
  };
}

// The dealership's most recent calls, newest first.
export async function listCalls(workflowId: number, limit = 100): Promise<Call[]> {
  const res = await dograh<{ runs: DograhRun[] }>(`/workflow/${workflowId}/runs?limit=${limit}`);
  return res.runs.map(toCall);
}

// One call with links to its recording, plus the transcript as text.
export async function getCall(workflowId: number, runId: number) {
  const run = await dograh<DograhRun>(`/workflow/${workflowId}/runs/${runId}`);
  let transcript: { at: string; speaker: "agent" | "caller"; text: string }[] = [];
  if (run.transcript_public_url) {
    const res = await fetch(run.transcript_public_url, { cache: "no-store" });
    if (res.ok) transcript = parseTranscript(await res.text());
  }
  return { call: toCall(run), recordingUrl: run.recording_public_url, transcript };
}

// Dograh transcripts are lines like "[2026-10-06T05:18:11.629+00:00] assistant: Hi, this is Priya…".
function parseTranscript(text: string) {
  return text.split("\n").flatMap((line) => {
    const m = line.match(/^\[([^\]]+)\]\s*(\w+):\s*(.*)$/);
    if (!m) return [];
    return [{ at: m[1], speaker: m[2] === "assistant" ? ("agent" as const) : ("caller" as const), text: m[3] }];
  });
}

// Returns the script URL for Dograh's "talk to this agent" web widget.
export async function getWidgetScriptUrl(workflowId: number): Promise<string | null> {
  const res = await dograh<{ embed_script: string }>(`/workflow/${workflowId}/embed-token`, {
    method: "POST",
    body: JSON.stringify({ expires_in_days: 365 }),
  });
  return res.embed_script.match(/js\.src = '([^']+)'/)?.[1] ?? null;
}

// ── Campaigns: Dograh dials a list of contacts with pacing, retries and calling hours ──

export type Campaign = {
  id: number;
  name: string;
  workflow_id: number;
  state: string; // draft | running | paused | completed | failed
  total_rows: number | null;
  processed_rows: number;
  failed_rows: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  parent_campaign_id?: number | null; // set on a "call back" campaign
  redialed_campaign_id?: number | null; // set once a call-back campaign was made from this one
  schedule_config?: { timezone?: string; slots?: { day_of_week: number; start_time: string; end_time: string }[] };
};

export type CampaignContact = { phone: string; context: Record<string, string> };

function toCsv(contacts: CampaignContact[]): string {
  const keys = [...new Set(contacts.flatMap((c) => Object.keys(c.context)))];
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [["phone_number", ...keys].join(","), ...contacts.map((c) => [c.phone, ...keys.map((k) => cell(c.context[k] ?? ""))].join(","))].join("\n");
}

// Uploads the contact list and creates a campaign (not started yet).
// Each contact's `context` becomes {{variables}} for that call, like initial_context on a single call.
export async function createCampaign(input: {
  workflowId: number;
  name: string;
  contacts: CampaignContact[];
  timeZone: string;
  retryDelaySeconds?: number; // default 30 minutes
  endTime?: string; // last dialling time of the day, default "20:00" (payment reminders: "19:00")
}): Promise<Campaign> {
  const csv = toCsv(input.contacts);
  const upload = await dograh<{ upload_url: string; file_key: string }>("/s3/presigned-upload-url", {
    method: "POST",
    body: JSON.stringify({ file_name: "contacts.csv", file_size: new TextEncoder().encode(csv).length, content_type: "text/csv" }),
  });
  const put = await fetch(upload.upload_url, { method: "PUT", headers: { "Content-Type": "text/csv" }, body: csv });
  if (!put.ok) throw new Error(`Contact list upload failed: ${put.status}`);

  return dograh<Campaign>("/campaign/create", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      workflow_id: input.workflowId,
      source_type: "csv",
      source_id: upload.file_key,
      max_concurrency: 2, // Vobiz allows 3 at once; keep one free for inbound callers
      // One retry (default 30 minutes later) if busy / no answer / voicemail.
      retry_config: { enabled: true, max_retries: 1, retry_delay_seconds: input.retryDelaySeconds ?? 1800, retry_on_busy: true, retry_on_no_answer: true, retry_on_voicemail: true },
      // Only dial 9 AM – 8 PM (or the given end time) local time, every day.
      schedule_config: {
        enabled: true,
        timezone: input.timeZone,
        slots: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_time: "09:00", end_time: input.endTime ?? "20:00" })),
      },
      circuit_breaker: { enabled: true },
    }),
  });
}

// Dograh can't delete campaigns, so "removing" one renames it with this prefix and we hide it.
const REMOVED_PREFIX = "[removed] ";
// Behind-the-scenes one-person campaigns for website forms (call now + one retry). Hidden from the Campaigns page.
export const FORM_CALL_PREFIX = "[form] ";
// One-person campaigns from the Quick call page. Hidden from the Campaigns page too.
export const QUICK_CALL_PREFIX = "[quick] ";

// Campaigns for one dealership's agent(s) (Dograh lists every campaign in our organisation).
export async function listCampaigns(workflowIds: number | number[]): Promise<Campaign[]> {
  const ids = new Set([workflowIds].flat());
  const res = await dograh<{ campaigns: Campaign[] }>("/campaign/");
  return res.campaigns
    .filter((c) => ids.has(c.workflow_id) && !c.name.startsWith(REMOVED_PREFIX) && !c.name.startsWith(FORM_CALL_PREFIX) && !c.name.startsWith(QUICK_CALL_PREFIX))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// One-person calls (Quick call and website-form callbacks) that haven't finished yet, newest first.
export async function listPendingOneOffCalls(workflowIds: number[]): Promise<Campaign[]> {
  const ids = new Set(workflowIds);
  const res = await dograh<{ campaigns: Campaign[] }>("/campaign/");
  return res.campaigns
    .filter((c) => ids.has(c.workflow_id) && (c.name.startsWith(QUICK_CALL_PREFIX) || c.name.startsWith(FORM_CALL_PREFIX)))
    .filter((c) => c.state === "running" || c.state === "created" || c.state === "draft" || c.state === "paused")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// Stops a one-person call for good: pause it (no first ring or retry) and hide it.
export async function cancelOneOffCall(campaign: Campaign) {
  if (campaign.state === "running") await controlCampaign(campaign.id, "pause");
  await removeCampaign({ ...campaign, state: "paused" });
}

// Every campaign of these agents still dialling, including hidden website-form ones (used when pausing an account).
export async function listRunningCampaigns(workflowIds: number[]): Promise<Campaign[]> {
  const ids = new Set(workflowIds);
  const res = await dograh<{ campaigns: Campaign[] }>("/campaign/");
  return res.campaigns.filter((c) => ids.has(c.workflow_id) && c.state === "running");
}

// Hides a campaign that isn't dialling. A paused campaign stays paused, so it never calls again.
export async function removeCampaign(campaign: Campaign) {
  if (campaign.state === "running") throw new Error("Pause the campaign before removing it.");
  await dograh(`/campaign/${campaign.id}`, {
    method: "PATCH",
    body: JSON.stringify({ name: `${REMOVED_PREFIX}${campaign.name}`.slice(0, 120) }),
  });
}

// Makes a new, not-started campaign with only the people whose last call was busy / unanswered / voicemail.
// Dograh allows this once per completed campaign. Returns null if everyone answered.
export async function redialCampaign(campaign: Campaign): Promise<number | null> {
  const res = await fetch(`${API_URL}/campaign/${campaign.id}/redial`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": await currentDograhKey() },
    body: JSON.stringify({ name: `${campaign.name} – call back`.slice(0, 120) }),
    cache: "no-store",
  });
  if (res.ok) return ((await res.json()) as { id: number }).id;
  const text = await res.text();
  // Nobody left to call back is a normal outcome, not an error.
  if (res.status === 400 || res.status === 404 || res.status === 422) {
    console.warn(`Redial ${campaign.id}: ${res.status} ${text}`);
    return null;
  }
  throw new Error(`Dograh redial ${campaign.id} failed: ${res.status} ${text}`);
}

export async function getCampaign(campaignId: number): Promise<Campaign> {
  return dograh<Campaign>(`/campaign/${campaignId}`);
}

export async function controlCampaign(campaignId: number, action: "start" | "pause" | "resume") {
  await dograh(`/campaign/${campaignId}/${action}`, { method: "POST" });
}

// ---------- Voice Studio ----------

// Per-agent call limits (Dograh "workflow configurations").
export type CallSettings = { max_call_duration: number; max_user_idle_timeout: number };

export type Voice = {
  voice_id: string;
  name: string; // e.g. "Priya - Trusted Operator"
  description: string;
  gender: string;
  language: string;
  accent: string;
  preview_url: string;
  recommended?: boolean;
};

// Best fits for a dealership front desk, shown first. The first one is the default.
const RECOMMENDED_VOICES = ["Priya", "Kavita", "Kavya", "Neha", "Simi", "Devansh", "Sameer", "Vikas", "Nikhil", "Ishan"];
// Characters that sound wrong on a sales call.
const UNSUITABLE = /storyteller|meditation|film actor|roommate|announcer|narrator|tour guide|soother/i;

export const voicePersonName = (voice: Pick<Voice, "name">) => voice.name.split(" - ")[0].trim();

// Voices that suit an Indian dealership: Indian accent, English or Hindi.
export async function listVoices(): Promise<Voice[]> {
  const res = await dograh<{ voices: Voice[] }>("/user/configurations/voices/dograh");
  return res.voices
    .filter((v) => v.accent === "in" && (v.language === "en" || v.language === "hi") && !UNSUITABLE.test(`${v.name} ${v.description}`))
    .map((v) => ({ ...v, recommended: RECOMMENDED_VOICES.includes(voicePersonName(v)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

type TtsSettings = { voice: string; speed: number } & Record<string, unknown>;

// The voice is shared by every agent on this Dograh account.
export async function getVoiceSettings(): Promise<{ voice: string; speed: number }> {
  const config = await dograh<{ tts: TtsSettings }>("/user/configurations/user");
  return { voice: config.tts.voice, speed: config.tts.speed ?? 1 };
}

// Dograh keeps the stored key when it receives the masked one back, so only voice and speed change.
export async function setVoiceSettings(voice: string, speed: number) {
  const config = await dograh<{ tts: TtsSettings }>("/user/configurations/user");
  await dograh("/user/configurations/user", {
    method: "PUT",
    body: JSON.stringify({ tts: { ...config.tts, voice, speed } }),
  });
}

export type AgentStudio = {
  greeting: string;
  customGreeting: string;
  customInstructions: string;
  settings: CallSettings;
};

export async function getAgentStudio(workflowId: number): Promise<AgentStudio> {
  const wf = await dograh<Workflow & { template_context_variables?: Partial<AgentVariables>; workflow_configurations?: Partial<CallSettings> }>(
    `/workflow/fetch/${workflowId}`,
  );
  const start = wf.workflow_definition.nodes.find((n) => n.type === "startCall");
  return {
    greeting: String(start?.data.greeting ?? ""),
    customGreeting: wf.template_context_variables?.custom_greeting ?? "",
    customInstructions: wf.template_context_variables?.custom_instructions ?? "",
    settings: {
      max_call_duration: wf.workflow_configurations?.max_call_duration ?? 300,
      max_user_idle_timeout: wf.workflow_configurations?.max_user_idle_timeout ?? 10,
    },
  };
}

// Changes the name the receptionist introduces herself/himself with, then re-publishes.
export async function renameAgent(workflowId: number, agentName: string) {
  const current = await dograh<Workflow & { template_context_variables: AgentVariables }>(`/workflow/fetch/${workflowId}`);
  await personaliseAgent(workflowId, { ...current.template_context_variables, agent_name: agentName }, await ensureAgentTools(current));
}

// Saves greeting, extra instructions and call limits, then re-publishes the agent.
export async function saveAgentStudio(
  workflowId: number,
  input: { customGreeting: string; customInstructions: string; settings: CallSettings },
) {
  const current = await dograh<Workflow & { template_context_variables: AgentVariables }>(`/workflow/fetch/${workflowId}`);
  const toolUuids = await ensureAgentTools(current);
  const vars: AgentVariables = {
    ...current.template_context_variables,
    custom_greeting: input.customGreeting,
    custom_instructions: input.customInstructions,
  };
  await personaliseAgent(workflowId, vars, toolUuids, input.settings);
}

// ---------- Bring your own Dograh account ----------

// True if the active key is a working Dograh API key.
export async function verifyDograhKey(): Promise<boolean> {
  try {
    await dograh("/user/auth/user");
    return true;
  } catch {
    return false;
  }
}

// Current dealership details + Voice Studio edits saved on an agent, to rebuild it elsewhere.
export async function getAgentVariables(workflowId: number): Promise<AgentVariables> {
  const wf = await dograh<{ template_context_variables: AgentVariables }>(`/workflow/fetch/${workflowId}`);
  return wf.template_context_variables;
}
