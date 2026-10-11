import "server-only";
import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createAdminClient } from "@/lib/supabase/admin";

export type WebhookEvent = "lead.created" | "lead.stage_changed" | "booking.created" | "ticket.created" | "ticket.status_changed" | "test";

// Only public https addresses — never our own server or a private network.
export function isAllowedWebhookUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return !(
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".internal") ||
      /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(host) ||
      host.startsWith("[")
    );
  } catch {
    return false;
  }
}

// True for loopback, private, link-local (cloud metadata), CGNAT, benchmark and other non-public addresses.
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
    return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

// The URL check above only sees the name; this checks where the name actually points
// (e.g. "169.254.169.254.nip.io" passes the name check but resolves to the metadata server).
async function resolvesToPublic(hostname: string): Promise<boolean> {
  try {
    const addresses = await lookup(hostname, { all: true });
    return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

// Posts the event to the dealership's webhook, signed with its secret. Never throws:
// a broken webhook must not break bookings or forms. Returns the HTTP status (0 = not sent).
export async function sendWebhook(businessId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<number> {
  try {
    const db = createAdminClient();
    const { data: business } = await db
      .from("businesses")
      .select("webhook_url, business_secrets(webhook_secret)")
      .eq("id", businessId)
      .maybeSingle();
    const url = business?.webhook_url;
    // One-to-one relation: Supabase returns an object (typed as an array).
    const secrets = business?.business_secrets as unknown as { webhook_secret: string | null } | null;
    const secret = secrets?.webhook_secret;
    if (!url || !secret || !isAllowedWebhookUrl(url) || !(await resolvesToPublic(new URL(url).hostname))) return 0;

    const body = JSON.stringify({ event, sent_at: new Date().toISOString(), data });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DealerVoice-Event": event,
        "X-DealerVoice-Signature": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    return res.status;
  } catch (err) {
    console.error(`Webhook ${event} failed:`, err);
    return 0;
  }
}
