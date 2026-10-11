import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { elevenlabs } from "@/lib/elevenlabs";
import type { Campaign } from "@/lib/dograh";

// Call lists on ElevenLabs: campaigns, Quick calls and website-form callbacks. ElevenLabs batch calling only
// dials a list, so our server adds what Dograh did for us: calling hours (a batch is stopped when hours end and
// the rest are called next morning), pause/resume (stop the batch, later send the rest) and one retry for
// people who didn't answer. `tickElevenLabsCalls` runs every minute (see src/instrumentation.ts).

export type CallKind = "campaign" | "quick" | "form";
export type CallRole = "follow_up" | "marketing" | "payments";

type ContactStatus = "waiting" | "in_batch" | "answered" | "missed" | "cancelled";
export type ElevenLabsContact = {
  id: string;
  phone: string;
  label: string; // name shown in the dashboard
  variables: Record<string, string>;
  greeting: string;
  attempts: number;
  status: ContactStatus;
  conversation_id?: string | null;
  finished_at?: string | null;
};

export type ElevenLabsCampaign = {
  id: number;
  business_id: string;
  kind: CallKind;
  role: CallRole;
  name: string;
  agent_id: string;
  contacts: ElevenLabsContact[];
  timezone: string;
  end_time: string;
  retry_minutes: number;
  state: "draft" | "running" | "paused" | "completed" | "cancelled";
  batch_id: string | null;
  parent_id: number | null;
  redialed: boolean;
  removed: boolean;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

const MAX_ATTEMPTS = 2; // the first ring plus one retry
const START_TIME = "09:00";
// Vobiz allows 3 calls at once: campaigns use 2, a single call 1, leaving room for inbound callers.
const CONCURRENCY: Record<CallKind, number> = { campaign: 2, quick: 1, form: 1 };
// A batch row "claimed" by one tick, so two ticks never send the same people twice.
const CLAIMED = "claiming";

type BatchRecipient = { phone_number: string | null; status: string; conversation_id: string | null };
type Batch = { id: string; status: string; recipients?: BatchRecipient[] };

const db = () => createAdminClient();

// ---------- calling hours ----------

function minutesNow(timeZone: string, now = new Date()) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now).split(":").map(Number);
  return h * 60 + m;
}
const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

export function inCallingHours(c: Pick<ElevenLabsCampaign, "timezone" | "end_time">, now = new Date()) {
  const m = minutesNow(c.timezone, now);
  return m >= toMinutes(START_TIME) && m < toMinutes(c.end_time);
}

// ---------- creating and controlling lists ----------

export async function createElevenLabsCampaign(input: {
  businessId: string;
  kind: CallKind;
  role: CallRole;
  name: string;
  agentId: string;
  contacts: { phone: string; label: string; variables: Record<string, string>; greeting: string }[];
  timeZone: string;
  endTime?: string;
  retryMinutes?: number;
  start?: boolean; // Quick calls and form callbacks start straight away; campaigns wait for Start
  parentId?: number;
}): Promise<ElevenLabsCampaign> {
  const { data, error } = await db()
    .from("elevenlabs_campaigns")
    .insert({
      business_id: input.businessId,
      kind: input.kind,
      role: input.role,
      name: input.name,
      agent_id: input.agentId,
      contacts: input.contacts.map((c, i) => ({ ...c, id: `c${i}`, attempts: 0, status: "waiting" })),
      timezone: input.timeZone,
      end_time: input.endTime ?? "20:00",
      retry_minutes: input.retryMinutes ?? 30,
      state: input.start ? "running" : "draft",
      started_at: input.start ? new Date().toISOString() : null,
      parent_id: input.parentId ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(`Saving the call list failed: ${error.message}`);
  const row = data as ElevenLabsCampaign;
  if (input.start) {
    // Rings now if it's calling hours. If ElevenLabs refuses, cancel the list so it never rings later by surprise.
    try {
      await tickOne(row);
    } catch (err) {
      await save(row.id, { state: "cancelled", batch_id: null, completed_at: new Date().toISOString() });
      throw err;
    }
  }
  return row;
}

export async function getElevenLabsCampaign(businessId: string, id: number): Promise<ElevenLabsCampaign | null> {
  const { data } = await db().from("elevenlabs_campaigns").select("*").eq("business_id", businessId).eq("id", id).maybeSingle();
  return (data as ElevenLabsCampaign) ?? null;
}

export async function listElevenLabsCampaigns(businessId: string, kinds: CallKind[]): Promise<ElevenLabsCampaign[]> {
  const { data, error } = await db()
    .from("elevenlabs_campaigns")
    .select("*")
    .eq("business_id", businessId)
    .in("kind", kinds)
    .eq("removed", false)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as ElevenLabsCampaign[];
}

async function save(id: number, fields: Partial<ElevenLabsCampaign>) {
  const { error } = await db().from("elevenlabs_campaigns").update(fields).eq("id", id);
  if (error) throw new Error(`Updating call list ${id} failed: ${error.message}`);
}

// Stops the batch dialling now (people not yet rung go back to waiting on the next tick).
async function stopBatch(row: ElevenLabsCampaign) {
  if (!row.batch_id || row.batch_id === CLAIMED) return;
  await elevenlabs(`/convai/batch-calling/${row.batch_id}/cancel`, { method: "POST" }).catch((err) => console.error(`Cancel batch ${row.batch_id}:`, err));
}

export async function controlElevenLabsCampaign(row: ElevenLabsCampaign, action: "start" | "pause" | "resume") {
  if (action === "start" && row.state === "draft") {
    const started = { ...row, state: "running" as const, started_at: new Date().toISOString() };
    await save(row.id, { state: "running", started_at: started.started_at });
    await tickOne(started);
  } else if (action === "pause" && row.state === "running") {
    await save(row.id, { state: "paused" });
    await stopBatch(row);
  } else if (action === "resume" && row.state === "paused") {
    await save(row.id, { state: "running" });
    await tickOne({ ...row, state: "running" });
  }
}

// Cancels a list for good: nobody else on it is rung.
export async function cancelElevenLabsCampaign(row: ElevenLabsCampaign) {
  await save(row.id, { state: "cancelled", completed_at: new Date().toISOString() });
  await stopBatch(row);
}

export async function removeElevenLabsCampaign(row: ElevenLabsCampaign) {
  if (row.state === "running") throw new Error("Pause the campaign before removing it.");
  await save(row.id, { removed: true });
}

// "Call back people who didn't answer": a new, not-started list with just them. Null if everyone answered.
export async function redialElevenLabsCampaign(row: ElevenLabsCampaign): Promise<number | null> {
  const missed = row.contacts.filter((c) => c.status === "missed");
  if (!missed.length || row.redialed) return null;
  const copy = await createElevenLabsCampaign({
    businessId: row.business_id,
    kind: row.kind,
    role: row.role,
    name: `${row.name} – call back`.slice(0, 120),
    agentId: row.agent_id,
    contacts: missed.map(({ phone, label, variables, greeting }) => ({ phone, label, variables, greeting })),
    timeZone: row.timezone,
    endTime: row.end_time,
    retryMinutes: row.retry_minutes,
    parentId: row.id,
  });
  await save(row.id, { redialed: true });
  return copy.id;
}

// Pausing an account stops all of its lists.
export async function pauseAllElevenLabsCampaigns(businessId: string) {
  const { data } = await db().from("elevenlabs_campaigns").select("*").eq("business_id", businessId).eq("state", "running");
  for (const row of (data ?? []) as ElevenLabsCampaign[]) await controlElevenLabsCampaign(row, "pause");
}

// ---------- the scheduler ----------

let ticking = false;

// Every minute: brings each running (or just paused) list up to date with ElevenLabs and dials whoever is due.
export async function tickElevenLabsCalls() {
  if (ticking) return;
  ticking = true;
  try {
    const { data, error } = await db()
      .from("elevenlabs_campaigns")
      .select("*")
      .or("state.eq.running,batch_id.not.is.null");
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as ElevenLabsCampaign[]) {
      await tickOne(row).catch((err) => console.error(`ElevenLabs call list ${row.id}:`, err));
    }
  } finally {
    ticking = false;
  }
}

async function tickOne(row: ElevenLabsCampaign) {
  let { contacts, batch_id } = row;

  // 1. Take in the results of the batch that was dialling.
  if (batch_id && batch_id !== CLAIMED) {
    const batch = await elevenlabs<Batch>(`/convai/batch-calling/${batch_id}`);
    contacts = mergeResults(contacts, batch.recipients ?? []);
    const finished = ["completed", "failed", "cancelled"].includes(batch.status);
    if (finished) {
      // Anyone the finished batch didn't report counts as a missed attempt, never as "not rung yet",
      // so a mismatch can't make us ring the same person again and again.
      contacts = contacts.map((c) =>
        c.status === "in_batch" ? { ...c, status: "missed" as const, attempts: c.attempts + 1, finished_at: new Date().toISOString() } : c,
      );
      batch_id = null;
    }
    await save(row.id, { contacts, batch_id });
    if (!finished) {
      // Still dialling: stop it if calling hours ended or it was paused or cancelled.
      if (row.state !== "running" || !inCallingHours(row)) await stopBatch({ ...row, batch_id });
      return;
    }
  }
  if (row.state !== "running" || batch_id) return;

  // 2. Who is due a call: never rung, or missed long enough ago to retry.
  const now = Date.now();
  const due = contacts.filter(
    (c) =>
      c.status === "waiting" ||
      (c.status === "missed" && c.attempts < MAX_ATTEMPTS && new Date(c.finished_at ?? 0).getTime() + row.retry_minutes * 60_000 <= now),
  );
  const retryLater = contacts.some((c) => c.status === "missed" && c.attempts < MAX_ATTEMPTS && !due.includes(c));
  if (!due.length) {
    if (!retryLater) await save(row.id, { state: "completed", completed_at: new Date().toISOString() });
    return;
  }
  if (!inCallingHours(row)) return;

  // 3. Claim the row (so a parallel tick can't send the same people), then send the batch.
  const { data: claimed } = await db().from("elevenlabs_campaigns").update({ batch_id: CLAIMED }).eq("id", row.id).is("batch_id", null).select("id");
  if (!claimed?.length) return;
  let batch: Batch;
  try {
    batch = await elevenlabs<Batch>("/convai/batch-calling/submit", {
      method: "POST",
      body: JSON.stringify({
        call_name: `${row.name} #${row.id}`.slice(0, 120),
        agent_id: row.agent_id,
        agent_phone_number_id: process.env.ELEVENLABS_PHONE_NUMBER_ID,
        target_concurrency_limit: CONCURRENCY[row.kind],
        telephony_call_config: { ringing_timeout_secs: 40 },
        recipients: due.map((c) => ({
          phone_number: c.phone,
          conversation_initiation_client_data: {
            dynamic_variables: c.variables,
            conversation_config_override: { agent: { first_message: c.greeting } },
          },
        })),
      }),
    });
  } catch (err) {
    // ElevenLabs refused the batch, so nobody was rung: release the claim and try again next tick.
    await save(row.id, { batch_id: null });
    throw err;
  }
  // The batch is out. Never clear its id after this point (even if a save looks failed), or the
  // people on it could be rung twice; retry the save instead.
  const sent = new Set(due.map((c) => c.id));
  const fields = { batch_id: batch.id, contacts: contacts.map((c) => (sent.has(c.id) ? { ...c, status: "in_batch" as const } : c)) };
  await save(row.id, fields).catch(() => save(row.id, fields));
}

// Maps each person's batch result: answered, missed (no answer, busy, voicemail, failed) or still in progress.
function mergeResults(contacts: ElevenLabsContact[], recipients: BatchRecipient[]): ElevenLabsContact[] {
  // ElevenLabs gives recipients its own ids, so results are matched by phone number (unique within a list).
  const byPhone = new Map(recipients.filter((r) => r.phone_number).map((r) => [r.phone_number!, r]));
  return contacts.map((c) => {
    const r = byPhone.get(c.phone);
    if (!r || c.status !== "in_batch") return c;
    const done = { attempts: c.attempts + 1, conversation_id: r.conversation_id, finished_at: new Date().toISOString() };
    if (r.status === "completed") return { ...c, ...done, status: "answered" };
    if (r.status === "failed" || r.status === "voicemail") return { ...c, ...done, status: "missed" };
    if (r.status === "cancelled") return { ...c, status: "waiting" }; // never rung: not an attempt
    return c;
  });
}

// ---------- shown like a Dograh campaign, so the Campaigns page needs no second layout ----------

export function asCampaign(row: ElevenLabsCampaign): Campaign & { role: CallRole } {
  const rung = row.contacts.filter((c) => c.attempts > 0).length;
  return {
    id: row.id,
    name: row.name,
    workflow_id: 0,
    role: row.role,
    state: row.state === "draft" ? "created" : row.state === "cancelled" ? "completed" : row.state,
    total_rows: row.contacts.length,
    processed_rows: rung,
    failed_rows: 0,
    created_at: row.created_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    parent_campaign_id: row.parent_id,
    redialed_campaign_id: row.redialed ? -1 : null,
    schedule_config: { timezone: row.timezone, slots: [{ day_of_week: 0, start_time: START_TIME, end_time: row.end_time }] },
  };
}
