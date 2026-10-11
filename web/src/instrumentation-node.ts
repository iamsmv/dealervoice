import { createHmac } from "node:crypto";

// Starts the one-minute timer that runs ElevenLabs call lists (calling hours, pause/resume and retries;
// see src/lib/elevenlabs-calls.ts). Loaded only on the Node.js server, from src/instrumentation.ts.
if (process.env.ELEVENLABS_API_KEY && process.env.BOOKING_WEBHOOK_SECRET) {
  const signature = createHmac("sha256", process.env.BOOKING_WEBHOOK_SECRET).update("cron:elevenlabs-calls").digest("hex");
  const url = `http://127.0.0.1:${process.env.PORT ?? 3000}/api/cron/elevenlabs-calls`;
  setInterval(() => {
    fetch(url, { method: "POST", headers: { "x-cron-signature": signature } }).catch((err) => console.error("ElevenLabs call scheduler:", err));
  }, 60_000);
}
