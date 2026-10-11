import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalisePhone } from "@/lib/phone";
import type { Call } from "@/lib/dograh";

export const STAGES = [
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "test_drive_booked", label: "Test drive booked" },
  { id: "negotiating", label: "Negotiating" },
  { id: "sold", label: "Sold" },
  { id: "lost", label: "Lost" },
] as const;

export const SOURCES = [
  { id: "phone_call", label: "Phone call" },
  { id: "booking", label: "Booking" },
  { id: "web_form", label: "Website form" },
  { id: "manual", label: "Manual" },
  { id: "import", label: "Imported list" },
  { id: "api", label: "API" },
] as const;

// Makes sure everyone we've spoken to by phone (inbound or outbound) exists as a lead, and keeps "last contact" current.
// Existing leads keep their name, stage and notes; only last_contact_at moves forward.
export async function syncLeadsFromCalls(businessId: string, calls: Call[]) {
  const latestByPhone = new Map<string, string>();
  for (const c of calls) {
    // Payment-reminder calls are to existing customers, not sales leads.
    if (c.channel !== "phone" || !c.customerNumber || c.role === "payments") continue;
    const prev = latestByPhone.get(c.customerNumber);
    if (!prev || c.startedAt > prev) latestByPhone.set(c.customerNumber, c.startedAt);
  }
  if (latestByPhone.size === 0) return;

  const db = createAdminClient();
  const phones = [...latestByPhone.keys()];
  const { data: existing } = await db
    .from("leads")
    .select("id, phone, last_contact_at")
    .eq("business_id", businessId)
    .in("phone", phones);
  const known = new Map((existing ?? []).map((l) => [l.phone as string, l]));

  const newLeads = phones
    .filter((p) => !known.has(p))
    .map((phone) => ({ business_id: businessId, phone, source: "phone_call", last_contact_at: latestByPhone.get(phone) }));
  if (newLeads.length) await db.from("leads").upsert(newLeads, { onConflict: "business_id,phone", ignoreDuplicates: true });

  for (const [phone, lead] of known) {
    const latest = latestByPhone.get(phone)!;
    if (!lead.last_contact_at || latest > lead.last_contact_at) {
      await db.from("leads").update({ last_contact_at: latest }).eq("id", lead.id);
    }
  }
}

// Called after a successful booking: creates or updates the caller's lead with their
// name/email and moves it to "Test drive booked" (unless it's already further along).
export async function recordBookingLead(input: { businessId: string; name: string; email: string; phone?: string; carModel?: string }) {
  // The agent may send "9876543210" or "+91 98765 43210": match the stored +91… form so we don't duplicate the lead.
  const phone = normalisePhone(input.phone ?? "");
  if (!phone) return;
  const db = createAdminClient();
  const { data: lead } = await db
    .from("leads")
    .select("id, stage")
    .eq("business_id", input.businessId)
    .eq("phone", phone)
    .maybeSingle();

  const now = new Date().toISOString();
  if (!lead) {
    await db.from("leads").upsert({
      business_id: input.businessId,
      phone,
      name: input.name,
      email: input.email,
      source: "booking",
      stage: "test_drive_booked",
      car_interest: input.carModel || null,
      last_contact_at: now,
    }, { onConflict: "business_id,phone" });
    return;
  }
  const earlyStage = lead.stage === "new" || lead.stage === "contacted";
  await db
    .from("leads")
    .update({
      name: input.name,
      email: input.email,
      last_contact_at: now,
      ...(input.carModel ? { car_interest: input.carModel } : {}),
      ...(earlyStage ? { stage: "test_drive_booked" } : {}),
    })
    .eq("id", lead.id);
}
