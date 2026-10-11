import { after, NextResponse, type NextRequest } from "next/server";
import { createCallTicket, ticketNumber, TICKET_PRIORITIES } from "@/lib/tickets";
import { sendWebhook } from "@/lib/webhooks";
import { notifyTicketCreated } from "@/lib/ticket-notifications";
import { isAuthorisedToolCall } from "@/lib/tool-auth";
import { getSupportSettings } from "@/lib/agent-roles";

// Called by a dealership's receptionist (Dograh tool "dv_create_ticket") during a support call.
// business_id comes from the tool's preset, like /api/book.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!(await isAuthorisedToolCall(request.headers, body?.business_id))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await getSupportSettings(String(body.business_id))).enabled) {
    return NextResponse.json({ ok: false, message: "Support tickets are not available. Apologise and say the team will call back today." }, { status: 409 });
  }
  if (typeof body.description !== "string" || !body.description.trim()) {
    return NextResponse.json({ ok: false, message: "Missing description: ask the customer to describe the problem, then try again." }, { status: 400 });
  }

  try {
    // In the dealership's Zoho Desk when connected, so the number read out is Zoho's.
    const ticket = await createCallTicket(String(body.business_id), body);
    const number = ticketNumber(ticket);
    // After the reply, so Priya isn't kept waiting: the dealership's webhook, and WhatsApp to the customer and advisor.
    after(() => sendWebhook(String(body.business_id), "ticket.created", { ticket, urgent: ticket.priority === "urgent" }));
    after(() => notifyTicketCreated(String(body.business_id), ticket));
    const hours = TICKET_PRIORITIES.find((p) => p.id === ticket.priority)?.slaHours ?? 24;
    return NextResponse.json({
      ok: true,
      ticket_number: number,
      message: `Ticket ${number} created (${ticket.priority}). Tell the customer the number digit by digit; the team responds within ${hours === 1 ? "1 hour" : hours < 24 ? `${hours} hours` : hours === 24 ? "1 working day" : "3 working days"}.`,
    });
  } catch (err) {
    console.error("Create ticket failed:", err);
    return NextResponse.json({ ok: false, message: "The ticket could not be created. Apologise and say the team will call back today." }, { status: 500 });
  }
}
