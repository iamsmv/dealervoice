// DEV ONLY: creates a one-time DealerVoice sign-in link without sending an email
// (avoids Supabase's email rate limit while testing). Usage:
//   node scripts/dev_login_link.mjs you@example.com [https://app.example.com]
import { readFileSync } from "node:fs";
import { createClient } from "../web/node_modules/@supabase/supabase-js/dist/index.mjs";

const env = Object.fromEntries(
  readFileSync(new URL("../web/.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);

const [email, site = "https://app.example.com"] = process.argv.slice(2);
if (!email) throw new Error("Usage: node scripts/dev_login_link.mjs you@example.com");

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});
const { data, error } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email,
  options: { redirectTo: `${site}/auth/callback` },
});
if (error) throw error;
// Goes straight to our own /auth/callback with the token hash, so it also works on localhost.
console.log(`${site}/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink`);
