import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// The SaaS owner(s): comma-separated emails in ADMIN_EMAILS.
const adminEmail = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = String(data?.claims?.email ?? "").toLowerCase();
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!email || !admins.includes(email) || !data?.claims?.sub) return null;
  // Only a confirmed address counts, so nobody can sign up with an admin email they don't own.
  // Checked on the server: the token's user_metadata can be edited by the user.
  const { data: user } = await createAdminClient().auth.admin.getUserById(String(data.claims.sub));
  return user?.user?.email_confirmed_at && user.user.email?.toLowerCase() === email ? email : null;
});

export async function isAdmin(): Promise<boolean> {
  return (await adminEmail()) !== null;
}

// Anyone who isn't an admin gets a plain 404, so the admin area isn't even revealed.
export async function requireAdmin(): Promise<string> {
  const email = await adminEmail();
  if (!email) notFound();
  return email;
}

export const PLANS = [
  { id: "trial", label: "Trial" },
  { id: "starter", label: "Starter" },
  { id: "pro", label: "Pro" },
  { id: "paused", label: "Paused" },
] as const;
