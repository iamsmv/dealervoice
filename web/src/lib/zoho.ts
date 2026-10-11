import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// Zoho Desk as the dealership's ticket system. Each dealership connects its own Zoho Desk (OAuth, India data
// centre). Priya's tickets are created there during the call so the customer hears Zoho's number; our
// dashboard keeps a copy and follows Zoho's status (see syncZohoTickets).

const ACCOUNTS = "https://accounts.zoho.in";
const DESK = "https://desk.zoho.in/api/v1";
const SCOPES = "Desk.tickets.ALL,Desk.contacts.ALL,Desk.basic.READ";

export const zohoConfigured = () => Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET);
const redirectUri = () => `${process.env.APP_URL}/api/zoho/callback`;

// ---------- connecting ----------

// The state names the dealership and is signed, so a callback can't be pointed at someone else's account.
function sign(value: string) {
  return createHmac("sha256", process.env.BOOKING_WEBHOOK_SECRET!).update(`zoho:${value}`).digest("hex");
}

export function zohoAuthUrl(businessId: string): string {
  const value = `${businessId}.${randomBytes(8).toString("hex")}`;
  const params = new URLSearchParams({
    client_id: process.env.ZOHO_CLIENT_ID!,
    response_type: "code",
    scope: SCOPES,
    redirect_uri: redirectUri(),
    access_type: "offline",
    prompt: "consent",
    state: `${value}.${sign(value)}`,
  });
  return `${ACCOUNTS}/oauth/v2/auth?${params}`;
}

// The dealership a callback's state belongs to, or null if the state was tampered with.
export function businessFromState(state: string): string | null {
  const i = state.lastIndexOf(".");
  if (i < 0) return null;
  const value = state.slice(0, i);
  const a = Buffer.from(state.slice(i + 1));
  const b = Buffer.from(sign(value));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return value.split(".")[0];
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${ACCOUNTS}/oauth/v2/token`, {
    method: "POST",
    body: new URLSearchParams({ client_id: process.env.ZOHO_CLIENT_ID!, client_secret: process.env.ZOHO_CLIENT_SECRET!, ...params }),
    cache: "no-store",
  });
  return res.json();
}

// Finishes connecting: saves the refresh token and picks the dealership's organisation and first department.
export async function connectZoho(businessId: string, code: string) {
  const token = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
  if (!token.refresh_token || !token.access_token) throw new Error(`Zoho didn't return a token: ${token.error ?? "unknown error"}`);
  const db = createAdminClient();
  const { error } = await db.from("business_secrets").upsert({ business_id: businessId, zoho_refresh_token: token.refresh_token });
  if (error) throw new Error(error.message);
  accessTokens.set(businessId, { token: token.access_token, expires: Date.now() + (token.expires_in ?? 3600) * 1000 - 60_000 });

  const orgs = await desk<{ data: { id: string; portalName?: string }[] }>(businessId, "/organizations", { org: false });
  const org = orgs.data[0];
  if (!org) throw new Error("This Zoho account has no Zoho Desk organisation.");
  const depts = await desk<{ data: { id: string; name: string; isEnabled?: boolean }[] }>(businessId, "/departments", { orgId: org.id });
  const dept = depts.data.find((d) => d.isEnabled !== false) ?? depts.data[0];
  await db.from("business_features").upsert({
    business_id: businessId,
    zoho_org_id: org.id,
    zoho_department_id: dept?.id ?? null,
    zoho_portal_url: org.portalName ? `https://desk.zoho.in/agent/${org.portalName}` : null,
  });
}

export async function disconnectZoho(businessId: string) {
  const db = createAdminClient();
  await db.from("business_secrets").update({ zoho_refresh_token: null }).eq("business_id", businessId);
  await db.from("business_features").update({ zoho_org_id: null, zoho_department_id: null, zoho_portal_url: null }).eq("business_id", businessId);
  accessTokens.delete(businessId);
}

export type ZohoConnection = { orgId: string; departmentId: string | null; portalUrl: string | null };

export async function zohoConnection(businessId: string): Promise<ZohoConnection | null> {
  if (!zohoConfigured()) return null;
  const db = createAdminClient();
  const [{ data: f }, { data: s }] = await Promise.all([
    db.from("business_features").select("zoho_org_id, zoho_department_id, zoho_portal_url").eq("business_id", businessId).maybeSingle(),
    db.from("business_secrets").select("zoho_refresh_token").eq("business_id", businessId).maybeSingle(),
  ]);
  if (!f?.zoho_org_id || !s?.zoho_refresh_token) return null;
  return { orgId: f.zoho_org_id, departmentId: f.zoho_department_id, portalUrl: f.zoho_portal_url };
}

// ---------- calling the API ----------

const accessTokens = new Map<string, { token: string; expires: number }>();

async function accessToken(businessId: string): Promise<string> {
  const cached = accessTokens.get(businessId);
  if (cached && cached.expires > Date.now()) return cached.token;
  const { data } = await createAdminClient().from("business_secrets").select("zoho_refresh_token").eq("business_id", businessId).maybeSingle();
  if (!data?.zoho_refresh_token) throw new Error("Zoho Desk isn't connected.");
  const token = await tokenRequest({ grant_type: "refresh_token", refresh_token: data.zoho_refresh_token });
  if (!token.access_token) throw new Error(`Zoho token refresh failed: ${token.error ?? "unknown error"}`);
  accessTokens.set(businessId, { token: token.access_token, expires: Date.now() + (token.expires_in ?? 3600) * 1000 - 60_000 });
  return token.access_token;
}

async function desk<T>(businessId: string, path: string, opts: { method?: string; body?: unknown; orgId?: string; org?: false; timeoutMs?: number } = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Zoho-oauthtoken ${await accessToken(businessId)}`, "Content-Type": "application/json" };
  if (opts.org !== false) headers.orgId = opts.orgId ?? (await zohoConnection(businessId))?.orgId ?? "";
  const res = await fetch(`${DESK}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
  });
  if (!res.ok) throw new Error(`Zoho Desk ${opts.method ?? "GET"} ${path} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

// ---------- tickets ----------

const CATEGORY_LABELS: Record<string, string> = {
  service: "Service / repair", warranty: "Warranty", breakdown: "Breakdown", billing: "Billing",
  product_question: "Car question", complaint: "Complaint", other: "Other",
};
const ZOHO_PRIORITY: Record<string, string> = { urgent: "High", high: "High", normal: "Medium", low: "Low" };
const SLA_HOURS: Record<string, number> = { urgent: 1, high: 4, normal: 24, low: 72 };

export type ZohoTicketInput = { customer_name: string | null; phone: string | null; vehicle: string | null; category: string; priority: string; description: string };
export type ZohoTicketRef = { id: string; number: string; webUrl: string | null };

// Creates the ticket in the dealership's Zoho Desk. Kept short (default 5 s) because the caller is waiting.
export async function createZohoTicket(businessId: string, conn: ZohoConnection, t: ZohoTicketInput, timeoutMs = 5000): Promise<ZohoTicketRef> {
  const category = CATEGORY_LABELS[t.category] ?? "Other";
  const problem = t.description.replace(/\s+/g, " ").trim();
  const subject = `${t.priority === "urgent" ? "[URGENT] " : ""}${category}${t.vehicle ? ` – ${t.vehicle}` : ""}: ${problem.slice(0, 70)}${problem.length > 70 ? "…" : ""}`;
  const lines = [
    `<b>Problem:</b> ${escapeHtml(problem)}`,
    `<b>Category:</b> ${category}`,
    `<b>Priority:</b> ${t.priority}`,
    `<b>Vehicle:</b> ${escapeHtml(t.vehicle ?? "not given")}`,
    `<b>Customer:</b> ${escapeHtml(t.customer_name ?? "not given")} (${escapeHtml(t.phone ?? "no number")})`,
    "",
    "<i>Opened by the AI receptionist (DealerVoice) during a phone call.</i>",
  ];
  const ticket = await desk<{ id: string; ticketNumber: string; webUrl?: string }>(businessId, "/tickets", {
    method: "POST",
    orgId: conn.orgId,
    timeoutMs,
    body: {
      subject,
      ...(conn.departmentId ? { departmentId: conn.departmentId } : {}),
      contact: { lastName: t.customer_name || "Caller", ...(t.phone ? { phone: t.phone } : {}) },
      ...(t.phone ? { phone: t.phone } : {}),
      channel: "Phone",
      priority: ZOHO_PRIORITY[t.priority] ?? "Medium",
      dueDate: new Date(Date.now() + (SLA_HOURS[t.priority] ?? 24) * 3_600_000).toISOString().replace(/\.\d{3}Z$/, ".000Z"),
      description: lines.join("<br>"),
    },
  });
  return { id: ticket.id, number: String(ticket.ticketNumber), webUrl: ticket.webUrl ?? null };
}

// Zoho's default statuses ↔ ours.
const FROM_ZOHO: Record<string, string> = { open: "open", "on hold": "waiting_customer", escalated: "in_progress", closed: "closed" };
const TO_ZOHO: Record<string, string> = { open: "Open", in_progress: "Open", waiting_customer: "On Hold", resolved: "Closed", closed: "Closed" };

export const ourStatusFromZoho = (zohoStatus: string) => FROM_ZOHO[zohoStatus.toLowerCase()] ?? "in_progress";

// Our status for a Zoho ticket. A ticket deleted (or moved to trash) in Zoho counts as closed: we never delete.
export async function getZohoTicketStatus(businessId: string, zohoTicketId: string): Promise<string> {
  try {
    const t = await desk<{ status: string; isTrashed?: boolean }>(businessId, `/tickets/${zohoTicketId}`);
    return t.isTrashed ? "closed" : ourStatusFromZoho(t.status);
  } catch (err) {
    if (err instanceof Error && / failed: (404|422) /.test(err.message)) return "closed";
    throw err;
  }
}

// A status change made on our dashboard, passed on to Zoho.
export async function setZohoTicketStatus(businessId: string, zohoTicketId: string, ourStatus: string) {
  await desk(businessId, `/tickets/${zohoTicketId}`, { method: "PATCH", body: { status: TO_ZOHO[ourStatus] ?? "Open" } });
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
