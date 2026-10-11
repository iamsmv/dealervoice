import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { receptionistGreeting, receptionistPrompt, type ReceptionistDetails } from "@/lib/elevenlabs-receptionist-prompt";
import { supportSection } from "@/lib/role-prompts";

// ElevenLabs ElevenAgents: an alternative voice platform to Dograh, switched on per dealership
// (business_features.voice_provider). Calls go out through the Vobiz SIP trunk imported into ElevenLabs.

const API_URL = "https://api.elevenlabs.io/v1";

export async function elevenlabs<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "xi-api-key": process.env.ELEVENLABS_API_KEY!, ...init.headers },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ElevenLabs ${init.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export type VoiceProvider = { provider: "dograh" } | { provider: "elevenlabs"; agentId: string; agentName: string };

// Dograh unless the admin switched this dealership to ElevenLabs and gave it an agent.
export async function voiceProvider(businessId: string): Promise<VoiceProvider> {
  const { data } = await createAdminClient()
    .from("business_features")
    .select("voice_provider, elevenlabs_agent_id")
    .eq("business_id", businessId)
    .maybeSingle();
  if (data?.voice_provider !== "elevenlabs" || !data.elevenlabs_agent_id) return { provider: "dograh" };
  return { provider: "elevenlabs", agentId: data.elevenlabs_agent_id, agentName: await agentPersonName(data.elevenlabs_agent_id) };
}

// The receptionist name to show on the dashboard: the ElevenLabs agent's name when the dealer is on ElevenLabs.
export async function displayAgentName(business: { id: string; agent_name: string }): Promise<string> {
  return voiceProvider(business.id).then((v) => (v.provider === "elevenlabs" ? v.agentName : business.agent_name)).catch(() => business.agent_name);
}

// The name the agent introduces itself with: "Priya-EL (test)" → "Priya". The dashboard's receptionist
// name belongs to the Dograh voice, so ElevenLabs calls use the ElevenLabs agent's own name.
async function agentPersonName(agentId: string): Promise<string> {
  const agent = await elevenlabs<{ name: string }>(`/convai/agents/${agentId}`);
  return agent.name.split(/[-(]/)[0].trim() || agent.name;
}

// Has the agent phone someone now. `variables` fill {{placeholders}} in its prompt; `greeting` replaces its first message.
// Rings once, with no retry or calling-hours check (callers check calling hours themselves).
export async function startElevenLabsCall(agentId: string, toNumber: string, variables: Record<string, string>, greeting: string): Promise<string | null> {
  const res = await elevenlabs<{ success: boolean; message: string; conversation_id: string | null }>("/convai/sip-trunk/outbound-call", {
    method: "POST",
    body: JSON.stringify({
      agent_id: agentId,
      agent_phone_number_id: process.env.ELEVENLABS_PHONE_NUMBER_ID,
      to_number: toNumber,
      conversation_initiation_client_data: {
        dynamic_variables: variables,
        conversation_config_override: { agent: { first_message: greeting } },
      },
    }),
  });
  if (!res.success) throw new Error(`ElevenLabs outbound call failed: ${res.message}`);
  return res.conversation_id;
}

// ---------- Extra agents (marketing, payment reminders) ----------

type AgentConfig = { name: string; conversation_config: { agent: { prompt: { prompt: string } } } };

// The words a Dograh script uses for the dealership, filled in for good (ElevenLabs agents are per dealership).
export type DealershipDetails = { agent_name: string; dealership_name: string; city: string; brands: string };

// Turns a Dograh-style script into ElevenLabs syntax: Dograh's clock and call variables become ElevenLabs
// system variables, "{{x | fallback}}" becomes "{{x}}" with the fallback kept as its default value, and the
// dealership's own details are written in.
export function toElevenLabsScript(text: string, details: DealershipDetails) {
  const defaults: Record<string, string> = {};
  const script = text
    .replace(/\{\{\s*current_time_[^}]*\}\}/g, "{{system__time}}")
    .replace(/\{\{\s*current_weekday_[^}]*\}\}/g, "the weekday shown in that time")
    .replace(/\{\{\s*called_number\s*(\|[^}]*)?\}\}/g, "{{system__called_number}}")
    .replace(/\{\{\s*(\w+)\s*(?:\|\s*([^}]*?))?\s*\}\}/g, (match, key: string, fallback?: string) => {
      if (key in details) return details[key as keyof DealershipDetails];
      if (key.startsWith("system__")) return match;
      if (fallback !== undefined) defaults[key] = fallback;
      return `{{${key}}}`;
    });
  return { script, defaults };
}

// The "## Heading" sections of a prompt, in order.
function sections(prompt: string): { heading: string; text: string }[] {
  return prompt.split(/^(?=## )/m).map((text) => ({ heading: text.split("\n")[0].trim(), text: text.trimEnd() }));
}

type RoleAgentInput = {
  receptionistAgentId: string;
  label: string; // "Marketing" | "Payments"
  head: string; // the job's Dograh-style script top
  greeting: string; // the job's Dograh-style opening line
  details: DealershipDetails;
  canBook: boolean;
};

// The settings that make a copy of the receptionist into a job agent. The top of its script is the job's own;
// the shared rules (style, speech handling, email, names, ending) come from the receptionist. Payment
// reminders get no booking tool and no booking rules.
async function roleAgentPatch(input: RoleAgentInput) {
  const receptionist = await elevenlabs<AgentConfig>(`/convai/agents/${input.receptionistAgentId}`);
  const parts = sections(receptionist.conversation_config.agent.prompt.prompt);
  const language = parts.find((s) => s.heading === "## Language")?.text ?? "";
  const style = parts.find((s) => s.heading === "## Style")?.text ?? "";
  const sharedFrom = parts.findIndex((s) => s.heading === "## Speech handling");
  // Support (and its ticket tool) belongs to the receptionist only: a job agent must never see a tool it doesn't have.
  const skip = ["## Customer support (existing customers)", ...(input.canBook ? [] : ["## Booking", "## Getting the email right"])];
  const shared = (sharedFrom >= 0 ? parts.slice(sharedFrom) : []).filter((s) => !skip.includes(s.heading)).map((s) => s.text);

  const head = toElevenLabsScript(input.head, input.details);
  const greeting = toElevenLabsScript(input.greeting, input.details);
  const prompt = [head.script.trimEnd(), language, style, ...shared].filter(Boolean).join("\n\n");
  return {
    name: `${input.details.agent_name} (${input.label}) - ${input.details.dealership_name}`,
    conversation_config: {
      agent: {
        first_message: greeting.script,
        prompt: { prompt, ...(input.canBook ? {} : { tool_ids: [] }) },
        dynamic_variables: { dynamic_variable_placeholders: { call_direction: "outbound", ...head.defaults, ...greeting.defaults } },
      },
    },
  };
}

// Creates an ElevenLabs agent for one extra job, as a copy of the dealership's receptionist so it keeps the same
// voice, languages and calm style.
export async function createElevenLabsRoleAgent(input: RoleAgentInput): Promise<string> {
  const patch = await roleAgentPatch(input);
  const copy = await elevenlabs<{ agent_id: string }>(`/convai/agents/${input.receptionistAgentId}/duplicate`, { method: "POST", body: "{}" });
  await elevenlabs(`/convai/agents/${copy.agent_id}`, { method: "PATCH", body: JSON.stringify(patch) });
  return copy.agent_id;
}

// Brings an existing job agent up to date with the receptionist (after the dealership's details or rules change).
export async function refreshElevenLabsRoleAgent(agentId: string, input: RoleAgentInput) {
  await elevenlabs(`/convai/agents/${agentId}`, { method: "PATCH", body: JSON.stringify(await roleAgentPatch(input)) });
}

// Rewrites the receptionist's script and greeting from the dealership's details (Settings), keeping the
// dealership's own additions from Voice Studio and Support at the end.
// `support` (the FAQ text plus the ticket tool) is added only while the dealership has support switched on.
export async function updateElevenLabsReceptionist(
  agentId: string,
  details: ReceptionistDetails,
  // ticketToolId: the dealership's saved ticket tool, attached only while `support` is given.
  extras: { instructions?: string; greeting?: string; support?: { knowledgeBase: string } | null; ticketToolId?: string | null } = {},
) {
  const own = extras.instructions?.trim();
  const support = extras.support
    ? supportSection(extras.support.knowledgeBase)
        .replace(/dv_book_appointment/g, "book_appointment")
        .replace(/dv_create_ticket/g, "create_ticket")
        .replace("Use the customer's number for this call; don't ask for it.", "Use the customer's number for this call ({{system__caller_id}}); don't ask for it.")
        .trim()
    : null;
  const prompt = [receptionistPrompt(details).trimEnd(), support, own && `## Extra instructions from the dealership\n${own}`].filter(Boolean).join("\n\n");

  // Keep the agent's other tools (booking); add or remove the ticket tool.
  const current = await elevenlabs<{ conversation_config: { agent: { prompt: { tool_ids?: string[] } } } }>(`/convai/agents/${agentId}`);
  const ticketToolId = extras.ticketToolId;
  const others = (current.conversation_config.agent.prompt.tool_ids ?? []).filter((id) => id !== ticketToolId);
  await elevenlabs(`/convai/agents/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify({
      conversation_config: {
        agent: { first_message: extras.greeting?.trim() || receptionistGreeting(details), prompt: { prompt, tool_ids: ticketToolId && extras.support ? [...others, ticketToolId] : others } },
      },
    }),
  });
}

type ToolConfig = { tool_config: { name: string; api_schema?: { url: string; request_headers?: Record<string, { secret_id?: string } | string> } } };

// The support-ticket tool for one dealership: calls /api/ticket, signed like the booking tool (same secret).
export async function createElevenLabsTicketTool(receptionistAgentId: string, businessId: string): Promise<string> {
  const agent = await elevenlabs<{ conversation_config: { agent: { prompt: { tool_ids?: string[] } } } }>(`/convai/agents/${receptionistAgentId}`);
  let signature: { secret_id?: string } | string | undefined;
  for (const id of agent.conversation_config.agent.prompt.tool_ids ?? []) {
    const tool = await elevenlabs<ToolConfig>(`/convai/tools/${id}`);
    if (tool.tool_config.api_schema?.url.endsWith("/api/book")) signature = tool.tool_config.api_schema.request_headers?.["X-Tool-Signature"];
  }
  if (!signature) throw new Error("The receptionist's booking tool (with its signature) wasn't found.");
  const text = (description: string) => ({ type: "string", description });
  const tool = await elevenlabs<{ id: string }>("/convai/tools", {
    method: "POST",
    body: JSON.stringify({
      tool_config: {
        type: "webhook",
        name: "create_ticket",
        description: "Opens a support ticket for an existing customer's problem that you can't solve on the call (service, warranty, breakdown, billing, complaint). Returns the ticket number to read back.",
        response_timeout_secs: 20,
        api_schema: {
          url: `${process.env.APP_URL}/api/ticket`,
          method: "POST",
          request_headers: { "X-Tool-Signature": signature },
          request_body_schema: {
            type: "object",
            description: "The customer's problem, as collected on the call.",
            required: ["business_id", "customer_name", "phone", "category", "priority", "description"],
            properties: {
              business_id: { type: "string", description: "", constant_value: businessId },
              customer_name: text("Customer's name in English spelling."),
              phone: text("Customer's phone number with country code, e.g. +919876543210"),
              vehicle: text("Car model and Indian registration number in capitals with spaces, e.g. Nexon KA 01 AB 1234 (or 22 BH 1234 AA). Model only if the number is unknown."),
              category: text("One of: service, warranty, breakdown, billing, product_question, complaint, other"),
              priority: text("One of: urgent, high, normal, low"),
              description: text("Short summary of the problem in the customer's words, 1-3 sentences."),
            },
          },
        },
      },
    }),
  });
  return tool.id;
}

// The dealership's ElevenLabs agent for a job, created the first time it's needed.
export async function ensureElevenLabsRoleAgent(
  businessId: string,
  role: string,
  create: () => Promise<string>,
): Promise<string> {
  const db = createAdminClient();
  const { data } = await db.from("elevenlabs_agents").select("agent_id").eq("business_id", businessId).eq("role", role).maybeSingle();
  if (data) return data.agent_id;
  const agentId = await create();
  const { error } = await db.from("elevenlabs_agents").insert({ business_id: businessId, role, agent_id: agentId });
  if (error?.code === "23505") {
    // Another request created this role at the same moment: use theirs (ours stays unused in ElevenLabs).
    const { data: winner } = await db.from("elevenlabs_agents").select("agent_id").eq("business_id", businessId).eq("role", role).maybeSingle();
    if (winner) return winner.agent_id;
  }
  if (error) throw new Error(`Saving the ElevenLabs ${role} agent failed: ${error.message}`);
  return agentId;
}

// ---------- New dealerships ----------

type FullTool = { tool_config: { name: string; api_schema: { url: string; request_headers?: Record<string, unknown>; request_body_schema: { properties: Record<string, Record<string, unknown>> } } & Record<string, unknown> } & Record<string, unknown> };

// Creates a dealership's own ElevenLabs receptionist as a copy of the template agent (same voice, languages,
// model and style), with its own booking tool: the dealership's business_id and its own signature, stored as
// an ElevenLabs secret so it never appears in the agent's settings.
export async function createElevenLabsReceptionist(input: { templateAgentId: string; businessId: string; signature: string; details: ReceptionistDetails }): Promise<string> {
  const template = await elevenlabs<{ conversation_config: { agent: { prompt: { tool_ids?: string[] } } } }>(`/convai/agents/${input.templateAgentId}`);
  let booking: FullTool | null = null;
  for (const id of template.conversation_config.agent.prompt.tool_ids ?? []) {
    const tool = await elevenlabs<FullTool>(`/convai/tools/${id}`);
    if (tool.tool_config.api_schema?.url?.endsWith("/api/book")) booking = tool;
  }
  if (!booking) throw new Error("The template agent has no booking tool to copy.");

  const secret = await elevenlabs<{ secret_id: string }>("/convai/secrets", {
    method: "POST",
    body: JSON.stringify({ type: "new", name: `dealervoice-tool-${input.businessId}`, value: input.signature }),
  });
  const config = booking.tool_config;
  const body = config.api_schema.request_body_schema;
  const tool = await elevenlabs<{ id: string }>("/convai/tools", {
    method: "POST",
    body: JSON.stringify({
      tool_config: {
        ...config,
        api_schema: {
          ...config.api_schema,
          url: `${process.env.APP_URL}/api/book`,
          request_headers: { "X-Tool-Signature": { secret_id: secret.secret_id } },
          request_body_schema: { ...body, properties: { ...body.properties, business_id: { ...body.properties.business_id, constant_value: input.businessId } } },
        },
      },
    }),
  });

  const copy = await elevenlabs<{ agent_id: string }>(`/convai/agents/${input.templateAgentId}/duplicate`, { method: "POST", body: "{}" });
  await elevenlabs(`/convai/agents/${copy.agent_id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: `${input.details.agent_name} - ${input.details.dealership_name}`,
      conversation_config: {
        agent: {
          first_message: receptionistGreeting(input.details),
          prompt: { prompt: receptionistPrompt(input.details), tool_ids: [tool.id] },
        },
      },
    }),
  });
  return copy.agent_id;
}
