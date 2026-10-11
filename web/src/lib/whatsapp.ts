import "server-only";

const API_URL = "https://api.vobiz.ai/api/v1/messaging";

export type BookingConfirmation = {
  to: string;
  name: string;
  dealershipName: string;
  startTime: string;
  timeZone: string;
};

// Formats "2026-10-09T12:00:00Z" as "Fri, 9 Oct, 5:30 PM" in the dealership's time zone.
export function formatWhen(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

// Sends an approved WhatsApp template through Vobiz; `params` fill the body's {{1}}, {{2}}… in order.
// Returns false (and never throws) when WhatsApp isn't set up or the send fails,
// so a WhatsApp problem can never undo the booking or ticket that triggered it.
export async function sendTemplate(to: string, template: string, params: string[], label = template): Promise<boolean> {
  const { VOBIZ_AUTH_ID, VOBIZ_AUTH_TOKEN, VOBIZ_WA_CHANNEL_ID, VOBIZ_WA_WABA_ID } = process.env;
  if (!VOBIZ_AUTH_ID || !VOBIZ_AUTH_TOKEN || !VOBIZ_WA_CHANNEL_ID || !VOBIZ_WA_WABA_ID) return false;

  try {
    const res = await fetch(`${API_URL}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-ID": VOBIZ_AUTH_ID,
        "X-Auth-Token": VOBIZ_AUTH_TOKEN,
      },
      body: JSON.stringify({
        channel_id: VOBIZ_WA_CHANNEL_ID,
        waba_id: VOBIZ_WA_WABA_ID,
        to,
        type: "template",
        template: {
          name: template,
          language: { code: process.env.VOBIZ_WA_TEMPLATE_LANG ?? "en" },
          // Meta rejects empty parameters, so blanks become a dash.
          components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: text.trim() || "-" })) }],
        },
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`WhatsApp ${label} failed: ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`WhatsApp ${label} failed:`, err);
    return false;
  }
}

// Template body (must match what Meta approved):
//   Hi {{1}}, your appointment at {{2}} is confirmed for {{3}}. See you there!
export function sendBookingConfirmation(input: BookingConfirmation): Promise<boolean> {
  return sendTemplate(
    input.to,
    process.env.VOBIZ_WA_TEMPLATE ?? "booking_confirmation",
    [input.name, input.dealershipName, formatWhen(input.startTime, input.timeZone)],
    "confirmation",
  );
}
