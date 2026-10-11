"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSupportSettings, saveSupportKnowledge } from "@/lib/agent-roles";
import { setTicketStatus } from "@/lib/tickets";
import { sendWebhook } from "@/lib/webhooks";

export type KnowledgeState = { error?: string; ok?: string };

const MAX_KB = 6000;

async function loadBusiness() {
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id, dograh_workflow_id").maybeSingle();
  return business;
}

export async function setTicketStatusAction(ticketId: string, status: string) {
  const business = await loadBusiness();
  if (!business) return;
  const ticket = await setTicketStatus(business.id, ticketId, status).catch(() => null);
  if (ticket) after(() => sendWebhook(business.id, "ticket.status_changed", { ticket }));
  revalidatePath("/dashboard/support");
}

// Saves the FAQ text the receptionist answers support questions from, and re-publishes the receptionist.
export async function saveKnowledgeAction(_prev: KnowledgeState, form: FormData): Promise<KnowledgeState> {
  const business = await loadBusiness();
  if (!business) return { error: "Please finish setting up your dealership first." };
  if (!(await getSupportSettings(business.id)).enabled) return { error: "Support isn't switched on for your account." };
  const text = String(form.get("knowledge") ?? "").trim().slice(0, MAX_KB);
  try {
    await saveSupportKnowledge(business, text);
  } catch (err) {
    console.error("Save support knowledge failed:", err);
    return { error: "Couldn't save. Please try again." };
  }
  revalidatePath("/dashboard/support");
  return { ok: "Changes saved" };
}
