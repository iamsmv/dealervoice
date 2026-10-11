import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

// New key for a dealership (replaces any old one). The full key is returned once and never stored.
export async function generateApiKey(businessId: string): Promise<string> {
  const key = `dv_live_${randomBytes(24).toString("base64url")}`;
  const { error } = await createAdminClient()
    .from("business_secrets")
    .upsert({ business_id: businessId, api_key_hash: hash(key), api_key_hint: key.slice(-4), api_key_created_at: new Date().toISOString() });
  if (error) throw error;
  return key;
}

export async function revokeApiKey(businessId: string) {
  await createAdminClient().from("business_secrets").update({ api_key_hash: null, api_key_hint: null, api_key_created_at: null }).eq("business_id", businessId);
}

// "Authorization: Bearer dv_live_…" (or "X-API-Key: dv_live_…") → the dealership it belongs to.
export async function businessFromRequest(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const key = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : (request.headers.get("x-api-key") ?? "").trim();
  if (!key.startsWith("dv_live_")) return null;
  const { data } = await createAdminClient().from("business_secrets").select("business_id").eq("api_key_hash", hash(key)).maybeSingle();
  return data?.business_id ?? null;
}
