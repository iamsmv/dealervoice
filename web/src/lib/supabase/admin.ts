import "server-only";
import { createClient } from "@supabase/supabase-js";

// Full-access client for trusted server code only (onboarding, booking webhook).
// Bypasses row-level security, so never import this into a client component.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
