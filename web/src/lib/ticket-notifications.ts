import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatWhen, sendTemplate } from "@/lib/whatsapp";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, ticketNumber, type Ticket } from "@/lib/tickets";

// WhatsApp messages for support tickets (docs/ticket-notifications.md). The template bodies are the ones
// submitted to Meta on 8 Oct 2026; the parameters below must stay in the same order.
// Until each dealer has its own settings, the showroom phone and the on-duty advisor come from env:
// TICKET_DEALER_PHONE (said in ticket_urgent_safety) and TICKET_ALERT_PHONE (gets ticket_staff_alert).

const RESPONSE_TIME: Record<string, string> = {
  urgent: "within 1 hour",
  high: "within 4 hours",
  normal: "within 1 working day",
  low: "within 3 working days",
};

const label = (list: readonly { id: string; label: string }[], id: string) => list.find((x) => x.id === id)?.label ?? id;

async function dealer(businessId: string) {
  const { data } = await createAdminClient().from("businesses").select("name, timezone").eq("id", businessId).maybeSingle();
  return { name: data?.name ?? "our dealership", timeZone: data?.timezone ?? "Asia/Kolkata" };
}

// After a ticket is opened on a call: the customer gets a confirmation (the safety version for urgent or
// breakdown tickets), and the on-duty advisor is alerted for urgent and high tickets. Never throws.
export async function notifyTicketCreated(businessId: string, t: Ticket): Promise<void> {
  try {
    const { name, timeZone } = await dealer(businessId);
    const number = ticketNumber(t);
    const customer = t.customer_name ?? "there";
    const dealerPhone = process.env.TICKET_DEALER_PHONE;
    const urgent = t.priority === "urgent" || t.category === "breakdown";

    if (t.phone) {
      if (urgent && dealerPhone) await sendTemplate(t.phone, "ticket_urgent_safety", [customer, number, dealerPhone, name]);
      else await sendTemplate(t.phone, "ticket_created", [
        customer, name, number, t.vehicle ?? "-", t.description.slice(0, 200), label(TICKET_PRIORITIES, t.priority), RESPONSE_TIME[t.priority] ?? "soon",
      ]);
    }

    const advisor = process.env.TICKET_ALERT_PHONE;
    if (advisor && (t.priority === "urgent" || t.priority === "high")) {
      const hours = TICKET_PRIORITIES.find((p) => p.id === t.priority)?.slaHours ?? 4;
      const deadline = formatWhen(new Date(new Date(t.created_at).getTime() + hours * 3_600_000).toISOString(), timeZone);
      await sendTemplate(advisor, "ticket_staff_alert", [
        label(TICKET_PRIORITIES, t.priority), number, t.customer_name ?? "Unknown", t.phone ?? "not given",
        t.vehicle ?? "-", label(TICKET_CATEGORIES, t.category), t.description.slice(0, 200), deadline,
      ]);
    }
  } catch (err) {
    console.error("Ticket WhatsApp (created) failed:", err);
  }
}

// When a ticket moves to resolved/closed for the first time: asks the customer if it was fixed. Never throws.
export async function notifyTicketResolved(businessId: string, t: Pick<Ticket, "number" | "zoho_ticket_number" | "customer_name" | "phone">): Promise<void> {
  if (!t.phone) return;
  try {
    const { name } = await dealer(businessId);
    await sendTemplate(t.phone, "ticket_resolved", [t.customer_name ?? "there", ticketNumber(t), "our service team has completed the work", name]);
  } catch (err) {
    console.error("Ticket WhatsApp (resolved) failed:", err);
  }
}
