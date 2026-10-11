import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { dograhKeyForBusiness } from "@/lib/dograh-key";

// Authenticates calls from a dealership's voice-agent tools (/api/book, /api/ticket).
// New tools send X-Tool-Signature = HMAC(platform secret, business id), so the platform secret itself
// never sits in a dealer-owned Dograh account and a signature only works for its own dealership.
// Older tools send the raw secret; that is accepted only for dealerships still on the platform's Dograh account.

const SECRET = () => process.env.BOOKING_WEBHOOK_SECRET!;

export function toolSignature(businessId: string): string {
  return createHmac("sha256", SECRET()).update(`tool:${businessId}`).digest("hex");
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function isAuthorisedToolCall(headers: Headers, businessId: unknown): Promise<boolean> {
  if (typeof businessId !== "string" || !businessId) return false;
  const signature = headers.get("x-tool-signature");
  if (signature) return same(signature, toolSignature(businessId));
  const legacy = headers.get("x-booking-secret");
  if (!legacy || !same(legacy, SECRET())) return false;
  return (await dograhKeyForBusiness(businessId)) === null;
}
