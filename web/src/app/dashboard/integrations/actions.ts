"use server";

import { revalidatePath } from "next/cache";
import { applySupport } from "@/lib/agent-roles";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAgentForBusiness, getAgentVariables, verifyDograhKey } from "@/lib/dograh";
import { withBusinessDograh, withDograhKey } from "@/lib/dograh-key";
import { generateApiKey, revokeApiKey } from "@/lib/api-keys";

export type IntegrationState = { error?: string; ok?: string; newKey?: string };

async function loadBusiness() {
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("id, name, city, brands, showroom_hours, service_hours, agent_name, dograh_workflow_id")
    .maybeSingle();
  return business;
}

// Connects the dealership's own Dograh account: checks the key, builds the receptionist there
// (same prompt, tools and Voice Studio edits), then switches DealerVoice over to it.
export async function connectDograhAction(_prev: IntegrationState, form: FormData): Promise<IntegrationState> {
  const business = await loadBusiness();
  if (!business) return { error: "Please finish setting up your dealership first." };
  const key = String(form.get("dograh_api_key") ?? "").trim();
  if (key.length < 20) return { error: "Paste your Dograh API key (Dograh → Developers → API keys)." };

  if (!(await withDograhKey(key, verifyDograhKey))) return { error: "That key didn't work with Dograh. Check you copied all of it." };

  // Carry over the current details and Voice Studio edits from the existing receptionist.
  const current = business.dograh_workflow_id
    ? await withBusinessDograh(business.id, () => getAgentVariables(Number(business.dograh_workflow_id))).catch(() => null)
    : null;
  const vars = {
    ...current,
    business_id: business.id,
    dealership_name: business.name,
    city: business.city ?? "",
    brands: business.brands ?? "",
    showroom_hours: business.showroom_hours ?? "",
    service_hours: business.service_hours ?? "",
    agent_name: business.agent_name,
  };

  let workflowId: number;
  try {
    workflowId = await withDograhKey(key, () => createAgentForBusiness(vars));
  } catch (err) {
    console.error("Connect Dograh failed:", err);
    return { error: "Your key works, but we couldn't create the receptionist in that account. Please try again." };
  }

  const admin = createAdminClient();
  const saved = await admin.from("business_secrets").upsert({ business_id: business.id, dograh_api_key: key, updated_at: new Date().toISOString() });
  if (saved.error) return { error: `The receptionist was created in your account (agent ${workflowId}), but saving failed. Please try again.` };
  const moved = await admin.from("businesses").update({ dograh_workflow_id: String(workflowId) }).eq("id", business.id);
  if (moved.error) return { error: `The receptionist was created in your account (agent ${workflowId}), but saving failed. Please try again.` };
  // Extra agents and the support ticket tool lived in the old account: forget them so they're rebuilt in the new one.
  await admin.from("business_agents").delete().eq("business_id", business.id);
  await admin.from("business_features").update({ ticket_tool_uuid: null }).eq("business_id", business.id);
  await withDograhKey(key, () => applySupport({ id: business.id, dograh_workflow_id: String(workflowId) })).catch((err) =>
    console.error("Re-applying support after connect failed:", err),
  );
  revalidatePath("/dashboard", "layout");
  return { ok: `Connected. ${business.agent_name} now runs in your Dograh account (agent ${workflowId}). Attach your phone number to it in Dograh.` };
}

export async function generateApiKeyAction(): Promise<IntegrationState> {
  const business = await loadBusiness();
  if (!business) return { error: "Please finish setting up your dealership first." };
  const newKey = await generateApiKey(business.id);
  revalidatePath("/dashboard/integrations");
  return { newKey };
}

export async function revokeApiKeyAction(): Promise<IntegrationState> {
  const business = await loadBusiness();
  if (!business) return { error: "Please finish setting up your dealership first." };
  await revokeApiKey(business.id);
  revalidatePath("/dashboard/integrations");
  return { ok: "API key revoked. Anything using it will stop working." };
}
