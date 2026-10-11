import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Which Dograh account a request talks to. A dealership can connect its own Dograh account
// (API & Integrations page); until then everything runs on the platform account from DOGRAH_API_KEY.
const keyStore = new AsyncLocalStorage<string>();

export const platformDograhKey = () => process.env.DOGRAH_API_KEY!;

// Runs `fn` against a specific Dograh account (used where nobody is signed in: public forms, admin, API).
export function withDograhKey<T>(key: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  return key ? keyStore.run(key, fn) : fn();
}

export async function dograhKeyForBusiness(businessId: string): Promise<string | null> {
  const { data } = await createAdminClient().from("business_secrets").select("dograh_api_key").eq("business_id", businessId).maybeSingle();
  return data?.dograh_api_key ?? null;
}

// Always explicit: the dealership's own key, else the platform key (never the signed-in user's).
export async function withBusinessDograh<T>(businessId: string, fn: () => Promise<T>): Promise<T> {
  return withDograhKey((await dograhKeyForBusiness(businessId)) ?? platformDograhKey(), fn);
}

// The signed-in dealership's own key, looked up once per request.
const signedInKey = cache(async (): Promise<string | null> => {
  try {
    const supabase = await createClient();
    const { data: business } = await supabase.from("businesses").select("id").maybeSingle();
    return business ? await dograhKeyForBusiness(business.id) : null;
  } catch {
    return null; // outside a request (no cookies) → platform key
  }
});

export async function currentDograhKey(): Promise<string> {
  return keyStore.getStore() ?? (await signedInKey()) ?? platformDograhKey();
}
