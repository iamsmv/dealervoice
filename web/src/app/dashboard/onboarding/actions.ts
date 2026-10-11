"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAgentForBusiness } from "@/lib/dograh";
import { createElevenLabsReceptionist } from "@/lib/elevenlabs";
import { toolSignature } from "@/lib/tool-auth";

export type OnboardingState = { error?: string };

export async function createBusiness(
  _prev: OnboardingState,
  form: FormData,
): Promise<OnboardingState> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  const field = (name: string) => String(form.get(name) ?? "").trim();
  const details = {
    name: field("name"),
    city: field("city"),
    brands: field("brands"),
    showroom_hours: field("showroom_hours"),
    service_hours: field("service_hours"),
    agent_name: field("agent_name") || "Maya",
  };
  const calEventTypeId = Number(field("cal_event_type_id"));
  const calApiKey = field("cal_api_key");

  if (!details.name || !details.city || !details.brands) {
    return { error: "Please fill in the dealership name, city and brands." };
  }
  if (!Number.isInteger(calEventTypeId) || calEventTypeId <= 0 || !calApiKey.startsWith("cal_")) {
    return { error: "Please enter a valid Cal.com event ID and API key (it starts with cal_)." };
  }

  const { data: business, error } = await supabase
    .from("businesses")
    .insert({ ...details, owner_id: userId, cal_event_type_id: calEventTypeId })
    .select("id")
    .single();
  if (error || !business) return { error: error?.message ?? "Could not save your dealership." };

  const admin = createAdminClient();
  await admin.from("business_secrets").upsert({ business_id: business.id, cal_api_key: calApiKey });

  try {
    const workflowId = await createAgentForBusiness({
      business_id: business.id,
      dealership_name: details.name,
      city: details.city,
      brands: details.brands,
      showroom_hours: details.showroom_hours,
      service_hours: details.service_hours,
      agent_name: details.agent_name,
    });
    await admin.from("businesses").update({ dograh_workflow_id: String(workflowId) }).eq("id", business.id);
  } catch (err) {
    console.error(err);
    return { error: "Your details were saved, but we couldn't create your AI agent yet. Please try again shortly." };
  }

  // Also an ElevenLabs receptionist, copied from the template agent. The dealership stays on Dograh until the admin
  // connects its own phone number and switches it over (calls would otherwise show another dealership's number).
  const templateAgentId = process.env.ELEVENLABS_TEMPLATE_AGENT_ID;
  if (templateAgentId && process.env.ELEVENLABS_API_KEY) {
    try {
      const agentId = await createElevenLabsReceptionist({
        templateAgentId,
        businessId: business.id,
        signature: toolSignature(business.id),
        details: { agent_name: details.agent_name, dealership_name: details.name, city: details.city, brands: details.brands, showroom_hours: details.showroom_hours, service_hours: details.service_hours },
      });
      await admin.from("business_features").upsert({ business_id: business.id, elevenlabs_agent_id: agentId });
    } catch (err) {
      console.error("ElevenLabs receptionist for new dealership failed:", err);
    }
  }

  redirect("/dashboard");
}
