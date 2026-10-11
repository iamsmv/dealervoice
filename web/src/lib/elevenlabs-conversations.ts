import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { elevenlabs } from "@/lib/elevenlabs";
import type { Call } from "@/lib/dograh";
import type { AgentRole } from "@/lib/role-prompts";

// ElevenLabs conversations shown as Calls, in the same shape as Dograh calls, so the Calls, Leads and
// Pipeline pages (and the CRM API) work unchanged. Ids start with "conv_", which never clashes with Dograh's numbers.

type ListItem = { conversation_id: string; agent_id: string; start_time_unix_secs: number; call_duration_secs: number; status: string; direction?: string | null; conversation_initiation_source?: string | null };

type Detail = {
  conversation_id: string;
  agent_id: string;
  status: string; // initiated | in-progress | processing | done | failed
  has_audio?: boolean;
  transcript: { role: "agent" | "user"; message: string | null; time_in_call_secs: number; tool_calls?: { tool_name: string; params_as_json: string }[] }[];
  metadata: {
    start_time_unix_secs: number;
    call_duration_secs: number;
    termination_reason?: string | null;
    phone_call?: { direction: "inbound" | "outbound"; agent_number: string; external_number: string } | null;
  };
};

export type TranscriptLine = { at: string; speaker: "agent" | "caller"; text: string };

// The dealership's ElevenLabs agents: the receptionist plus any marketing / payments agents.
export async function businessElevenLabsAgents(businessId: string): Promise<{ agentId: string; role?: AgentRole }[]> {
  const db = createAdminClient();
  const [{ data: features }, { data: roles }] = await Promise.all([
    db.from("business_features").select("elevenlabs_agent_id").eq("business_id", businessId).maybeSingle(),
    db.from("elevenlabs_agents").select("agent_id, role").eq("business_id", businessId),
  ]);
  return [
    ...(features?.elevenlabs_agent_id ? [{ agentId: features.elevenlabs_agent_id as string }] : []),
    ...(roles ?? []).map((r) => ({ agentId: r.agent_id as string, role: r.role as AgentRole })),
  ];
}

// Finished calls never change, so their details are fetched once per server.
const finishedDetails = new Map<string, Detail>();

async function detail(conversationId: string): Promise<Detail> {
  const cached = finishedDetails.get(conversationId);
  if (cached) return cached;
  const d = await elevenlabs<Detail>(`/convai/conversations/${conversationId}`);
  if (d.status === "done" || d.status === "failed") finishedDetails.set(conversationId, d);
  return d;
}

// The outcome label: the reason the agent gave when it ended the call, otherwise how the call ended.
function outcomeOf(d: Detail): string {
  if (d.status === "initiated" || d.status === "in-progress" || d.status === "processing") return "in_progress";
  // The model sometimes writes a tool call as words instead of running it (nothing is booked, but the
  // caller may hear "confirmed"). Flag it so the team checks the booking.
  if (d.transcript.some((l) => l.role === "agent" && /default_api:|\b(book_appointment|end_call)\s*\{/.test(l.message ?? ""))) return "agent_glitch";
  for (const line of [...d.transcript].reverse()) {
    const end = line.tool_calls?.find((t) => t.tool_name === "end_call");
    if (end) {
      try {
        const reason = (JSON.parse(end.params_as_json) as { reason?: string }).reason?.trim();
        if (reason) return normaliseReason(reason);
      } catch {
        // no reason given
      }
    }
  }
  if (d.transcript.some((l) => l.tool_calls?.some((t) => t.tool_name === "book_appointment"))) return "booking_done";
  if (d.status === "failed") return d.metadata.call_duration_secs > 0 ? "failed" : "no_answer";
  const ended = d.metadata.termination_reason ?? "";
  if (/client disconnected/i.test(ended)) return "user_hangup";
  if (/silence|inactiv/i.test(ended)) return "user_idle_max_duration_exceeded";
  return "completed";
}

// Job agents give a reason code ("promised_to_pay"); the receptionist sometimes writes a sentence instead.
// Sentences are mapped to the nearest standard outcome so the Calls page shows a short label.
function normaliseReason(reason: string): string {
  if (/^[a-z_]+$/.test(reason)) return reason;
  const r = reason.toLowerCase();
  if (/not interested|declin|no longer/.test(r) && !/book/.test(r)) return "caller_not_interested";
  if (/book|appointment|test drive/.test(r)) return "booking_done";
  if (/call ?back|busy|later/.test(r)) return "callback_requested";
  if (/do not call|don't call|stop calling/.test(r)) return "do_not_call";
  if (/wrong number/.test(r)) return "wrong_number";
  return "enquiry_answered";
}

function toCall(d: Detail, role?: AgentRole): Call {
  const phone = d.metadata.phone_call;
  return {
    id: d.conversation_id,
    channel: phone ? "phone" : "web",
    direction: phone?.direction ?? "inbound",
    callerNumber: phone ? (phone.direction === "inbound" ? phone.external_number : phone.agent_number) : null,
    calledNumber: phone ? (phone.direction === "inbound" ? phone.agent_number : phone.external_number) : null,
    customerNumber: phone?.external_number ?? null,
    startedAt: new Date(d.metadata.start_time_unix_secs * 1000).toISOString(),
    durationSeconds: d.metadata.call_duration_secs,
    outcome: outcomeOf(d),
    completed: d.status === "done" || d.status === "failed",
    ...(role ? { role } : {}),
  };
}

// Recent calls across the dealership's ElevenLabs agents, newest first.
export async function listElevenLabsCalls(businessId: string, limit = 100): Promise<Call[]> {
  const agents = await businessElevenLabsAgents(businessId);
  const lists = await Promise.all(
    agents.map(async (a) => {
      const res = await elevenlabs<{ conversations: ListItem[] }>(`/convai/conversations?agent_id=${a.agentId}&page_size=${Math.min(limit, 100)}`);
      return res.conversations.map((c) => ({ ...c, role: a.role }));
    }),
  );
  const items = lists.flat().sort((a, b) => b.start_time_unix_secs - a.start_time_unix_secs).slice(0, limit);
  // A few at a time, to stay well inside ElevenLabs' rate limits on the first (uncached) load.
  const calls: Call[] = [];
  for (let i = 0; i < items.length; i += 10) {
    const batch = await Promise.all(items.slice(i, i + 10).map((c) => detail(c.conversation_id).then((d) => toCall(d, c.role)).catch(() => null)));
    calls.push(...batch.filter((c): c is Call => c !== null));
  }
  return calls;
}

// One call with its transcript, only if it belongs to one of this dealership's agents.
export async function getElevenLabsCall(businessId: string, conversationId: string) {
  if (!/^conv_[A-Za-z0-9]+$/.test(conversationId)) return null;
  const agents = await businessElevenLabsAgents(businessId);
  const d = await detail(conversationId).catch(() => null);
  const agent = d && agents.find((a) => a.agentId === d.agent_id);
  if (!d || !agent) return null;
  const transcript: TranscriptLine[] = d.transcript
    .filter((l) => l.message)
    .map((l) => ({ at: String(l.time_in_call_secs), speaker: l.role === "agent" ? "agent" : "caller", text: l.message! }));
  return {
    call: toCall(d, agent.role),
    // Played through our own server, which checks the dealership and adds the ElevenLabs key.
    recordingUrl: d.has_audio ? `/api/calls/${d.conversation_id}/audio` : null,
    transcript,
  };
}

// The recording itself, for the audio route (after it has checked the dealership).
export async function elevenLabsCallAudio(conversationId: string): Promise<Response> {
  return fetch(`https://api.elevenlabs.io/v1/convai/conversations/${conversationId}/audio`, {
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
    cache: "no-store",
  });
}
