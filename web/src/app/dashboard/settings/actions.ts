"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateAgentVariables } from "@/lib/dograh";
import { updateElevenLabsAgentsFor, updateRoleAgents } from "@/lib/agent-roles";
import { isAllowedWebhookUrl, sendWebhook } from "@/lib/webhooks";

export type SettingsState = { error?: string; ok?: string };

async function loadBusiness() {
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("id, name, city, brands, showroom_hours, service_hours, agent_name, dograh_workflow_id")
    .maybeSingle();
  return { supabase, business };
}

// Dealership details → our database, then re-publish the agent so it speaks the new details.
export async function saveDetailsAction(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const { supabase, business } = await loadBusiness();
  if (!business) return { error: "Please finish setting up your dealership first." };
  const field = (name: string, max = 120) => String(form.get(name) ?? "").trim().slice(0, max);
  const details = {
    name: field("name", 80),
    city: field("city", 60),
    brands: field("brands", 300),
    showroom_hours: field("showroom_hours"),
    service_hours: field("service_hours"),
  };
  if (!details.name || !details.city || !details.brands) return { error: "Name, city and brands are required." };

  const { error } = await supabase.from("businesses").update(details).eq("id", business.id);
  if (error) return { error: error.message };

  if (business.dograh_workflow_id) {
    try {
      await updateAgentVariables(Number(business.dograh_workflow_id), {
        business_id: business.id,
        dealership_name: details.name,
        city: details.city,
        brands: details.brands,
        showroom_hours: details.showroom_hours,
        service_hours: details.service_hours,
        agent_name: business.agent_name,
      });
      await updateRoleAgents(business.id, {
        dealership_name: details.name,
        city: details.city,
        brands: details.brands,
        showroom_hours: details.showroom_hours,
        service_hours: details.service_hours,
      });
      // Dealerships on ElevenLabs: Priya and her job agents speak the new details too.
      await updateElevenLabsAgentsFor(business.id, {
        dealership_name: details.name,
        city: details.city,
        brands: details.brands,
        showroom_hours: details.showroom_hours,
        service_hours: details.service_hours,
      });
    } catch (err) {
      console.error("Agent update failed:", err);
      return { error: "Saved, but your receptionist couldn't be updated. Please press Save again." };
    }
  }
  revalidatePath("/dashboard", "layout");
  return { ok: "Changes saved" };
}

// Cal.com: event ID is always editable; the API key only changes when a new one is typed.
export async function saveCalendarAction(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const { supabase, business } = await loadBusiness();
  if (!business) return { error: "Please finish setting up your dealership first." };
  const eventId = Number(String(form.get("cal_event_type_id") ?? "").trim());
  const apiKey = String(form.get("cal_api_key") ?? "").trim();
  if (!Number.isInteger(eventId) || eventId <= 0) return { error: "Please enter a valid event ID (a number)." };
  if (apiKey && !apiKey.startsWith("cal_")) return { error: "A Cal.com API key starts with cal_." };

  const { error } = await supabase.from("businesses").update({ cal_event_type_id: eventId }).eq("id", business.id);
  if (error) return { error: error.message };
  if (apiKey) {
    await createAdminClient()
      .from("business_secrets")
      .upsert({ business_id: business.id, cal_api_key: apiKey, updated_at: new Date().toISOString() });
  }
  revalidatePath("/dashboard/integrations");
  return { ok: "Changes saved" };
}

// Webhook URL; a signing secret is created the first time.
export async function saveWebhookAction(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const { supabase, business } = await loadBusiness();
  if (!business) return { error: "Please finish setting up your dealership first." };
  const url = String(form.get("webhook_url") ?? "").trim();
  if (url && !isAllowedWebhookUrl(url)) return { error: "Please enter a public https:// address." };

  const { error } = await supabase.from("businesses").update({ webhook_url: url || null }).eq("id", business.id);
  if (error) return { error: error.message };

  if (url) {
    const admin = createAdminClient();
    const { data: secrets } = await admin.from("business_secrets").select("webhook_secret").eq("business_id", business.id).maybeSingle();
    if (!secrets?.webhook_secret) {
      await admin
        .from("business_secrets")
        .upsert({ business_id: business.id, webhook_secret: `whsec_${randomBytes(24).toString("hex")}` });
    }
  }
  revalidatePath("/dashboard/integrations");
  return { ok: url ? "Changes saved" : "Webhook turned off" };
}

export async function testWebhookAction(): Promise<SettingsState> {
  const { business } = await loadBusiness();
  if (!business) return { error: "Please finish setting up your dealership first." };
  const status = await sendWebhook(business.id, "test", { message: "Test from DealerVoice", dealership: business.name });
  if (status === 0) return { error: "Couldn't reach the webhook. Check the address is saved and online." };
  if (status >= 200 && status < 300) return { ok: `Test sent — your system replied ${status} OK.` };
  return { error: `Your system replied with an error (${status}).` };
}
