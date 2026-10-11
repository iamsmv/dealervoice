import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalisePhone } from "@/lib/phone";
import { notifyTicketResolved } from "@/lib/ticket-notifications";
import { createZohoTicket, getZohoTicketStatus, setZohoTicketStatus, zohoConnection } from "@/lib/zoho";

// L1 support tickets (client requirement #4).

export const TICKET_CATEGORIES = [
  { id: "service", label: "Service / repair" },
  { id: "warranty", label: "Warranty" },
  { id: "breakdown", label: "Breakdown" },
  { id: "billing", label: "Billing" },
  { id: "product_question", label: "Car question" },
  { id: "complaint", label: "Complaint" },
  { id: "other", label: "Other" },
] as const;

export const TICKET_PRIORITIES = [
  { id: "urgent", label: "Urgent", slaHours: 1 },
  { id: "high", label: "High", slaHours: 4 },
  { id: "normal", label: "Normal", slaHours: 24 },
  { id: "low", label: "Low", slaHours: 72 },
] as const;

export const TICKET_STATUSES = [
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In progress" },
  { id: "waiting_customer", label: "Waiting on customer" },
  { id: "resolved", label: "Resolved" },
  { id: "closed", label: "Closed" },
] as const;

export type Ticket = {
  id: string;
  number: number;
  customer_name: string | null;
  phone: string | null;
  vehicle: string | null;
  category: string;
  priority: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  zoho_ticket_id: string | null;
  zoho_ticket_number: string | null;
  zoho_web_url: string | null;
  zoho_sync: "synced" | "pending" | null;
};

export const TICKET_FIELDS =
  "id, number, customer_name, phone, vehicle, category, priority, description, status, created_at, updated_at, resolved_at, zoho_ticket_id, zoho_ticket_number, zoho_web_url, zoho_sync";

// The number the customer and staff use: Zoho's when the ticket is in Zoho Desk, otherwise ours.
export const ticketNumber = (t: Pick<Ticket, "number" | "zoho_ticket_number">) => t.zoho_ticket_number ?? String(t.number);

// Indian number plates in the standard written form: "ka01ab1234" / "KA-01-AB-1234" → "KA 01 AB 1234",
// "22bh1234aa" → "22 BH 1234 AA". Anything else (e.g. just a model name) is left as it is.
export function formatIndianPlates(text: string): string {
  return text
    .replace(/\b(\d{2})[\s-]*BH[\s-]*(\d{4})[\s-]*([A-Z]{1,2})\b/gi, (_, y, n, l) => `${y} BH ${n} ${l.toUpperCase()}`)
    // District: two digits, or a digit + letter only when letters follow (Delhi "3C AB"), or one digit.
    .replace(/\b([A-Z]{2})[\s-]*(\d{2}|\d[A-Z](?=[\s-]*[A-Z])|\d)[\s-]*([A-Z]{1,3})[\s-]*(\d{1,4})\b/gi, (_, st, rto, series, num) =>
      `${st.toUpperCase()} ${rto.length === 1 ? `0${rto}` : rto.toUpperCase()} ${series.toUpperCase()} ${num}`);
}

const pick = <T extends readonly { id: string }[]>(list: T, value: unknown, fallback: T[number]["id"]) =>
  list.some((x) => x.id === value) ? (value as string) : fallback;

// Past its response target and still not resolved.
export function isOverdue(t: Pick<Ticket, "priority" | "status" | "created_at">, now = Date.now()): boolean {
  if (t.status === "resolved" || t.status === "closed") return false;
  const hours = TICKET_PRIORITIES.find((p) => p.id === t.priority)?.slaHours ?? 24;
  return now - new Date(t.created_at).getTime() > hours * 3_600_000;
}

// Creates a ticket with the dealership's next number (1001, 1002…). Retries if two calls race for a number.
export async function createTicket(
  businessId: string,
  input: { customer_name?: unknown; phone?: unknown; vehicle?: unknown; category?: unknown; priority?: unknown; description?: unknown },
): Promise<Ticket> {
  const db = createAdminClient();
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "") || null;
  const description = text(input.description, 1000);
  if (!description) throw new Error("A description of the problem is required.");
  const row = {
    business_id: businessId,
    customer_name: text(input.customer_name, 80),
    phone: normalisePhone(String(input.phone ?? "")) ?? text(input.phone, 20),
    vehicle: (() => { const v = text(input.vehicle, 80); return v ? formatIndianPlates(v) : null; })(),
    category: pick(TICKET_CATEGORIES, input.category, "other"),
    priority: pick(TICKET_PRIORITIES, input.priority, "normal"),
    description,
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: last } = await db.from("support_tickets").select("number").eq("business_id", businessId).order("number", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await db.from("support_tickets").insert({ ...row, number: (last?.number ?? 1000) + 1 }).select(TICKET_FIELDS).single();
    if (!error) return data as Ticket;
    if (error.code !== "23505") throw new Error(error.message); // 23505 = number taken by a parallel call
  }
  throw new Error("Couldn't allocate a ticket number.");
}

export async function listTicketsFor(businessId: string, opts: { status?: string; limit?: number } = {}): Promise<Ticket[]> {
  let query = createAdminClient()
    .from("support_tickets")
    .select(TICKET_FIELDS)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(Math.min(opts.limit ?? 100, 500));
  if (opts.status) query = query.eq("status", opts.status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Ticket[];
}

const isDone = (status: string | null | undefined) => status === "resolved" || status === "closed";

// Moves a ticket to a new status; returns the updated ticket, or null if it isn't this dealership's.
export async function setTicketStatus(businessId: string, ticketId: string, status: string): Promise<Ticket | null> {
  if (!TICKET_STATUSES.some((s) => s.id === status)) throw new Error("Unknown status.");
  const done = status === "resolved" || status === "closed";
  const db = createAdminClient();
  const { data: before } = await db.from("support_tickets").select("status").eq("business_id", businessId).eq("id", ticketId).maybeSingle();
  const { data, error } = await db
    .from("support_tickets")
    .update({ status, updated_at: new Date().toISOString(), resolved_at: done ? new Date().toISOString() : null })
    .eq("business_id", businessId)
    .eq("id", ticketId)
    .select(TICKET_FIELDS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const ticket = (data as Ticket | null) ?? null;
  // Zoho Desk is the system of record: pass the change on (a failure here is picked up by the next sync).
  if (ticket?.zoho_ticket_id) await setZohoTicketStatus(businessId, ticket.zoho_ticket_id, status).catch((err) => console.error("Zoho status update failed:", err));
  if (ticket && done && !isDone(before?.status)) await notifyTicketResolved(businessId, ticket);
  return ticket;
}

// ---------- Zoho Desk ----------

// A ticket opened on a call. When the dealership has Zoho Desk, it is created there straight away so the
// customer is given Zoho's number. If Zoho is slow or down, the customer gets our number and the ticket is
// pushed to Zoho by the next sync (it then keeps our number in its subject so both can be found).
export async function createCallTicket(businessId: string, input: Parameters<typeof createTicket>[1]): Promise<Ticket> {
  const ticket = await createTicket(businessId, input);
  const conn = await zohoConnection(businessId).catch(() => null);
  if (!conn) return ticket;
  const db = createAdminClient();
  try {
    const zoho = await createZohoTicket(businessId, conn, ticket);
    const { data } = await db
      .from("support_tickets")
      .update({ zoho_ticket_id: zoho.id, zoho_ticket_number: zoho.number, zoho_web_url: zoho.webUrl, zoho_sync: "synced" })
      .eq("id", ticket.id)
      .select(TICKET_FIELDS)
      .single();
    return (data as Ticket) ?? ticket;
  } catch (err) {
    console.error("Zoho ticket during call failed, will retry:", err);
    await db.from("support_tickets").update({ zoho_sync: "pending" }).eq("id", ticket.id);
    return { ...ticket, zoho_sync: "pending" };
  }
}

let lastStatusPull = 0;

// Runs every minute (the call scheduler): pushes tickets Zoho missed, and every few minutes follows Zoho's
// status for open tickets, so the dashboard shows what the service team did in Zoho.
export async function syncZohoTickets() {
  const db = createAdminClient();
  const { data: pending } = await db.from("support_tickets").select(`business_id, ${TICKET_FIELDS}`).eq("zoho_sync", "pending").limit(20);
  for (const t of (pending ?? []) as (Ticket & { business_id: string })[]) {
    const conn = await zohoConnection(t.business_id).catch(() => null);
    if (!conn) continue;
    try {
      const zoho = await createZohoTicket(t.business_id, conn, { ...t, description: `${t.description} (DealerVoice ticket ${t.number})` }, 15_000);
      await db.from("support_tickets").update({ zoho_ticket_id: zoho.id, zoho_ticket_number: zoho.number, zoho_web_url: zoho.webUrl, zoho_sync: "synced" }).eq("id", t.id);
    } catch (err) {
      console.error(`Zoho push for ticket ${t.number} failed:`, err);
    }
  }

  if (Date.now() - lastStatusPull < 3 * 60_000) return;
  lastStatusPull = Date.now();
  const { data: open } = await db
    .from("support_tickets")
    .select("id, business_id, status, zoho_ticket_id, number, zoho_ticket_number, customer_name, phone")
    .not("zoho_ticket_id", "is", null)
    .not("status", "in", "(resolved,closed)")
    .limit(100);
  for (const t of open ?? []) {
    try {
      const status = await getZohoTicketStatus(t.business_id, t.zoho_ticket_id!);
      if (status === t.status) continue;
      const done = status === "resolved" || status === "closed";
      await db.from("support_tickets").update({ status, updated_at: new Date().toISOString(), resolved_at: done ? new Date().toISOString() : null }).eq("id", t.id);
      if (done) await notifyTicketResolved(t.business_id, t);
    } catch (err) {
      console.error(`Zoho status for ticket ${t.id} failed:`, err);
    }
  }
}
