"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { sendWebhook } from "@/lib/webhooks";
import { createClient } from "@/lib/supabase/server";
import { STAGES } from "@/lib/leads";
import { normalisePhone } from "@/lib/phone";
import { callLeadNow } from "@/lib/outbound";

export type AddLeadState = { error?: string; ok?: boolean; values?: Record<string, string> };

export async function addLead(_prev: AddLeadState, form: FormData): Promise<AddLeadState> {
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id").maybeSingle();
  if (!business) return { error: "Please finish setting up your dealership first." };

  const field = (name: string) => String(form.get(name) ?? "").trim();
  // Sent back on errors so the form keeps what was typed.
  const values = { name: field("name"), phone: field("phone"), email: field("email"), car_interest: field("car_interest") };
  const phone = normalisePhone(values.phone);
  if (!values.name) return { error: "Please enter the customer's name.", values };
  if (!phone) return { error: "Please enter a valid phone number, e.g. 98765 43210.", values };

  const { error } = await supabase.from("leads").insert({
    business_id: business.id,
    name: field("name"),
    phone,
    email: field("email") || null,
    car_interest: field("car_interest") || null,
    source: "manual",
  });
  if (error) {
    return { error: error.code === "23505" ? "A lead with this phone number already exists." : error.message, values };
  }
  after(() => sendWebhook(business.id, "lead.created", { name: values.name, phone, email: values.email || null, car_interest: values.car_interest || null, source: "manual" }));
  revalidatePath("/dashboard/leads");
  return { ok: true };
}

export async function updateLeadStage(leadId: string, stage: string) {
  if (!STAGES.some((s) => s.id === stage)) return;
  const supabase = await createClient();
  // Row-level security limits this to the signed-in dealership's own leads.
  const { data: lead } = await supabase.from("leads").update({ stage }).eq("id", leadId).select("business_id, name, phone, email, car_interest, stage").maybeSingle();
  if (lead) after(() => sendWebhook(lead.business_id, "lead.stage_changed", lead));
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/pipeline");
}

export type CallLeadState = { error?: string; ok?: boolean };

// Has the dealership's receptionist phone this lead right now (outbound call through Dograh + Vobiz).
export async function callLead(_prev: CallLeadState, form: FormData): Promise<CallLeadState> {
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("id, name, agent_name, dograh_workflow_id, plan")
    .maybeSingle();
  if (!business?.dograh_workflow_id) return { error: "Your receptionist isn't ready yet." };
  if (business.plan === "paused") return { error: "Your account is paused." };

  // Row-level security: only this dealership's own leads can be called.
  const { data: lead } = await supabase
    .from("leads")
    .select("id, name, phone, car_interest, stage")
    .eq("id", String(form.get("lead_id")))
    .maybeSingle();
  if (!lead?.phone) return { error: "This lead has no phone number." };

  try {
    await callLeadNow(business, { ...lead, phone: lead.phone }, "follow_up");
  } catch (err) {
    console.error("Outbound call failed:", err);
    return { error: "Couldn't start the call. Check the phone number and your telephony balance." };
  }

  await supabase
    .from("leads")
    .update({
      last_contact_at: new Date().toISOString(),
      ...(lead.stage === "new" ? { stage: "contacted" } : {}),
    })
    .eq("id", lead.id);
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}
