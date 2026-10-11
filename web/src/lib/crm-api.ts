import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { listCampaigns as dograhCampaigns } from "@/lib/dograh";
import { businessWorkflowIds, getSupportSettings, listBusinessCalls } from "@/lib/agent-roles";
import { listTicketsFor, TICKET_STATUSES } from "@/lib/tickets";
import { withBusinessDograh } from "@/lib/dograh-key";
import { STAGES } from "@/lib/leads";
import { normalisePhone } from "@/lib/phone";
import { sendWebhook } from "@/lib/webhooks";

// Everything the public API and the MCP server can do, always limited to one dealership.
// Read and write leads, read bookings / calls / campaigns. Deliberately no calling and no deleting.

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const LEAD_FIELDS = "id, name, phone, email, car_interest, source, stage, last_contact_at, created_at";
const stageIds = STAGES.map((s) => s.id) as string[];

export async function listLeads(businessId: string, opts: { search?: string; stage?: string; limit?: number } = {}) {
  let q = createAdminClient()
    .from("leads")
    .select(LEAD_FIELDS)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  if (opts.stage) {
    if (!stageIds.includes(opts.stage)) throw new ApiError(400, `stage must be one of: ${stageIds.join(", ")}`);
    q = q.eq("stage", opts.stage);
  }
  if (opts.search) {
    const term = opts.search.replace(/[%,()]/g, " ").trim();
    if (term) q = q.or(`name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
  }
  const { data, error } = await q;
  if (error) throw new ApiError(500, error.message);
  return data;
}

export async function createLead(businessId: string, input: { name?: unknown; phone?: unknown; email?: unknown; car_interest?: unknown }) {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const name = str(input.name, 80);
  const phone = normalisePhone(str(input.phone, 30));
  if (!name) throw new ApiError(400, "name is required");
  if (!phone) throw new ApiError(400, "phone is required, e.g. +919876543210");
  const lead = { business_id: businessId, name, phone, email: str(input.email, 120) || null, car_interest: str(input.car_interest, 60) || null, source: "api" };
  const { data, error } = await createAdminClient().from("leads").insert(lead).select(LEAD_FIELDS).single();
  if (error) throw new ApiError(error.code === "23505" ? 409 : 500, error.code === "23505" ? "A lead with this phone number already exists" : error.message);
  await sendWebhook(businessId, "lead.created", { ...data });
  return data;
}

export async function updateLeadStage(businessId: string, leadId: string, stage: unknown) {
  if (typeof stage !== "string" || !stageIds.includes(stage)) throw new ApiError(400, `stage must be one of: ${stageIds.join(", ")}`);
  const { data, error } = await createAdminClient()
    .from("leads")
    .update({ stage })
    .eq("business_id", businessId)
    .eq("id", leadId)
    .select(LEAD_FIELDS)
    .maybeSingle();
  if (error) throw new ApiError(400, error.message);
  if (!data) throw new ApiError(404, "Lead not found");
  await sendWebhook(businessId, "lead.stage_changed", { ...data });
  return data;
}

export async function listBookings(businessId: string, opts: { upcoming?: boolean; limit?: number } = {}) {
  let q = createAdminClient()
    .from("bookings")
    .select("id, attendee_name, attendee_email, attendee_phone, start_time, status, created_at")
    .eq("business_id", businessId)
    .order("start_time", { ascending: !!opts.upcoming })
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  if (opts.upcoming) q = q.gte("start_time", new Date().toISOString()).eq("status", "booked");
  const { data, error } = await q;
  if (error) throw new ApiError(500, error.message);
  return data;
}

// The dealership, with its receptionist set up (calls and campaigns also include any extra agents).
async function agentBusiness(businessId: string) {
  const { data } = await createAdminClient().from("businesses").select("id, dograh_workflow_id").eq("id", businessId).maybeSingle();
  if (!data?.dograh_workflow_id) throw new ApiError(409, "This dealership's receptionist isn't set up yet");
  return data;
}

export async function listRecentCalls(businessId: string, limit = 20) {
  const business = await agentBusiness(businessId);
  const calls = await withBusinessDograh(businessId, () => listBusinessCalls(business, Math.min(Math.max(limit, 1), 100)));
  return calls.map((c) => ({
    id: c.id,
    channel: c.channel,
    direction: c.direction,
    customer_number: c.customerNumber,
    started_at: c.startedAt,
    duration_seconds: c.durationSeconds,
    outcome: c.outcome,
    agent: c.role ?? "receptionist",
  }));
}

export async function listCampaignSummaries(businessId: string) {
  const business = await agentBusiness(businessId);
  const campaigns = await withBusinessDograh(businessId, async () => dograhCampaigns(await businessWorkflowIds(business)));
  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    state: c.state,
    total: c.total_rows,
    called: Math.min(c.processed_rows, c.total_rows ?? c.processed_rows),
    created_at: c.created_at,
  }));
}

// Support tickets (only when the dealership has support switched on).
export async function listTickets(businessId: string, opts: { status?: string; limit?: number }) {
  if (!(await getSupportSettings(businessId)).enabled) throw new ApiError(409, "Support tickets aren't switched on for this dealership");
  if (opts.status && !TICKET_STATUSES.some((s) => s.id === opts.status)) {
    throw new ApiError(400, `status must be one of: ${TICKET_STATUSES.map((s) => s.id).join(", ")}`);
  }
  return listTicketsFor(businessId, { status: opts.status, limit: Math.min(Math.max(opts.limit ?? 50, 1), 200) });
}
