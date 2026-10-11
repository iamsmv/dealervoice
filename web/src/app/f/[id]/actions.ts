"use server";

import { after } from "next/server";
import { sendWebhook } from "@/lib/webhooks";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalisePhone } from "@/lib/phone";
import { callLeadNow, callLeadWithRetry, isCallingHours } from "@/lib/outbound";
import { withBusinessDograh } from "@/lib/dograh-key";

export type WebFormState = {
  error?: string;
  done?: "calling" | "later";
  values?: Record<string, string>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECALL_GAP_MS = 10 * 60 * 1000; // never ring the same number twice within 10 minutes

// Public "Book a test drive" form. Anyone on the internet can post this, so it uses the
// server-only admin client, validates everything, and only ever touches the one dealership in the URL.
export async function submitWebForm(_prev: WebFormState, form: FormData): Promise<WebFormState> {
  const field = (name: string) => String(form.get(name) ?? "").trim().slice(0, 200);
  const values = { name: field("name"), phone: field("phone"), email: field("email"), car_interest: field("car_interest") };

  // Bots fill every field, including this one, which is hidden from people.
  if (field("website")) return { done: "later" };

  const businessId = field("business_id");
  if (!UUID.test(businessId)) return { error: "This form link is not valid." };
  if (!values.name) return { error: "Please enter your name.", values };
  const phone = normalisePhone(values.phone);
  if (!phone) return { error: "Please enter a valid mobile number, e.g. 98765 43210.", values };
  if (form.get("consent") !== "on") return { error: "Please tick the box so we're allowed to call you.", values };

  const db = createAdminClient();
  const { data: business } = await db
    .from("businesses")
    .select("id, name, agent_name, timezone, dograh_workflow_id, plan")
    .eq("id", businessId)
    .maybeSingle();
  if (!business) return { error: "This form link is not valid." };

  const { data: existing } = await db
    .from("leads")
    .select("id, last_contact_at")
    .eq("business_id", business.id)
    .eq("phone", phone)
    .maybeSingle();

  const details = {
    name: values.name,
    ...(values.email ? { email: values.email } : {}),
    ...(values.car_interest ? { car_interest: values.car_interest } : {}),
  };
  const recentlyCalled =
    !!existing?.last_contact_at && Date.now() - new Date(existing.last_contact_at).getTime() < RECALL_GAP_MS;
  const callNow = !recentlyCalled && isCallingHours(business.timezone ?? "Asia/Kolkata") && !!business.dograh_workflow_id && business.plan !== "paused";
  const now = new Date().toISOString();

  if (existing) {
    await db.from("leads").update({ ...details, ...(callNow ? { last_contact_at: now } : {}) }).eq("id", existing.id);
  } else {
    after(() => sendWebhook(business.id, "lead.created", { name: values.name, phone, email: values.email || null, car_interest: values.car_interest || null, source: "web_form" }));
    await db.from("leads").insert({
      business_id: business.id,
      phone,
      source: "web_form",
      stage: callNow ? "contacted" : "new",
      ...details,
      ...(callNow ? { last_contact_at: now } : {}),
    });
  }

  if (!callNow) return { done: "later" };
  const lead = { name: values.name, phone, car_interest: values.car_interest || null };
  try {
    // Calls now, and once more 15 minutes later if they miss it.
    await withBusinessDograh(business.id, () => callLeadWithRetry(business, lead, "web_form"));
    return { done: "calling" };
  } catch (err) {
    console.error("Web form call with retry failed, falling back to a single call:", err);
  }
  try {
    await withBusinessDograh(business.id, () => callLeadNow(business, lead, "web_form"));
    return { done: "calling" };
  } catch (err) {
    console.error("Web form call failed:", err);
    return { done: "later" }; // the lead is saved; the team follows up
  }
}
