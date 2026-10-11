"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { PLANS, requireAdmin } from "@/lib/admin-auth";
import { pauseRunningCampaigns, setExtraAgents } from "@/lib/agent-roles";
import { withBusinessDograh } from "@/lib/dograh-key";

export async function setPlanAction(businessId: string, plan: string) {
  await requireAdmin();
  if (!PLANS.some((p) => p.id === plan)) return;
  await createAdminClient().from("businesses").update({ plan }).eq("id", businessId);
  // Pausing also stops anything already dialling (campaigns and website-form retries).
  if (plan === "paused") await pauseRunningCampaigns(businessId).catch((err) => console.error("Pausing campaigns failed:", err));
  revalidatePath("/admin");
}

// Client requirements (marketing agent etc.). Off = the dealership sees the original dashboard.
export async function setExtraAgentsAction(businessId: string, enabled: boolean): Promise<{ error?: string }> {
  await requireAdmin();
  const { data: business } = await createAdminClient().from("businesses").select("id, dograh_workflow_id").eq("id", businessId).maybeSingle();
  if (!business) return { error: "Dealership not found." };
  try {
    await withBusinessDograh(business.id, () => setExtraAgents(business, enabled));
  } catch (err) {
    console.error("Extra agents switch: receptionist update failed:", err);
    revalidatePath("/admin");
    return { error: "Couldn't update the receptionist. Please try again." };
  }
  revalidatePath("/admin");
  return {};
}
