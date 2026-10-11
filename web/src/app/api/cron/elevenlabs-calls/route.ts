import { createHmac, timingSafeEqual } from "node:crypto";
import { tickElevenLabsCalls } from "@/lib/elevenlabs-calls";
import { syncZohoTickets } from "@/lib/tickets";

// Called every minute by our own server (src/instrumentation.ts): runs ElevenLabs call lists and syncs Zoho Desk tickets.
// Only our server knows the signature, so nobody else can trigger it.
export async function POST(request: Request) {
  const expected = Buffer.from(createHmac("sha256", process.env.BOOKING_WEBHOOK_SECRET!).update("cron:elevenlabs-calls").digest("hex"));
  const given = Buffer.from(request.headers.get("x-cron-signature") ?? "");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response("Forbidden", { status: 403 });
  await Promise.all([
    tickElevenLabsCalls(),
    syncZohoTickets().catch((err) => console.error("Zoho ticket sync:", err)),
  ]);
  return Response.json({ ok: true });
}
