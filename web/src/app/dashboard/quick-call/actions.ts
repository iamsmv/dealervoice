"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { cancelOneOffCall, controlCampaign, createCampaign, FORM_CALL_PREFIX, getCampaign, QUICK_CALL_PREFIX } from "@/lib/dograh";
import { businessWorkflowIds, ensureElevenLabsRoleAgentFor, ensureRoleAgent, extraAgentsEnabled } from "@/lib/agent-roles";
import { localHour, marketingContext, outboundContext, paymentContext } from "@/lib/outbound";
import { voiceProvider } from "@/lib/elevenlabs";
import { cancelElevenLabsCampaign, createElevenLabsCampaign, getElevenLabsCampaign, type CallRole } from "@/lib/elevenlabs-calls";
import { normalisePhone } from "@/lib/phone";

export type QuickCallState = {
  error?: string;
  ok?: string;
  values?: Record<string, string>;
};

const RETRY_MINUTES = 15;

// One call to one person, with any of the three outbound scripts. Uses a hidden one-person campaign,
// so Dograh handles calling hours and one retry if they don't pick up (like the website form).
export async function quickCallAction(_prev: QuickCallState, form: FormData): Promise<QuickCallState> {
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id, name, agent_name, timezone, dograh_workflow_id, plan").maybeSingle();
  if (!business?.dograh_workflow_id) return { error: "Your receptionist isn't ready yet." };
  if (business.plan === "paused") return { error: "Your account is paused." };
  if (!(await extraAgentsEnabled(business.id))) return { error: "Quick call isn't switched on for your account." };

  const field = (name: string, max: number) => String(form.get(name) ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  const kind = ["follow_up", "marketing", "payments"].includes(String(form.get("kind"))) ? String(form.get("kind")) : "follow_up";
  const values = {
    kind,
    name: field("name", 80),
    phone: field("phone", 20),
    car: field("car", 60),
    offer: field("offer", 300),
    amount: field("amount", 20),
    due_date: field("due_date", 40),
    reference: field("reference", 40),
  };
  const phone = normalisePhone(values.phone);
  if (!phone) return { error: "Please enter a valid mobile number.", values };
  if (!values.name) return { error: "Please enter the person's name.", values };

  const timeZone = business.timezone ?? "Asia/Kolkata";
  let workflowId = Number(business.dograh_workflow_id);
  // The opening line names the agent, so it's built for whichever platform places the call.
  let contextFor: (agentName: string) => { variables: Record<string, string>; greeting: string };
  if (kind === "payments") {
    const amount = Number(values.amount.replace(/₹|rs\.?|inr|[,\s]/gi, ""));
    if (!Number.isFinite(amount) || amount <= 0) return { error: "Please enter the amount due, e.g. 12500.", values };
    if (!values.due_date) return { error: "Please pick the due date.", values };
    contextFor = (agent_name) => paymentContext({ ...business, agent_name }, { name: values.name, phone, amount, due_date: spokenDate(values.due_date), reference: values.reference || null });
  } else if (kind === "marketing") {
    if (values.offer.length < 10) return { error: "Please describe the offer the agent should tell them about.", values };
    contextFor = (agent_name) => marketingContext({ ...business, agent_name }, { name: values.name, car_interest: values.car || null }, values.offer);
  } else {
    contextFor = (agent_name) => outboundContext({ ...business, agent_name }, { name: values.name, phone, car_interest: values.car || null }, "follow_up");
  }
  const lastHour = kind === "payments" ? 19 : 20;
  const hours = `9 AM – ${lastHour === 19 ? "7" : "8"} PM`;

  // ElevenLabs: a one-person call list that our scheduler dials in calling hours and retries once.
  const voice = await voiceProvider(business.id);
  if (voice.provider === "elevenlabs") {
    try {
      const agentId = kind === "follow_up" ? voice.agentId : await ensureElevenLabsRoleAgentFor(business, kind as "marketing" | "payments", voice);
      if (kind !== "payments") {
        await supabase
          .from("leads")
          .upsert({ business_id: business.id, phone, name: values.name, car_interest: values.car || null, source: "manual", stage: "new" }, { onConflict: "business_id,phone", ignoreDuplicates: true });
      }
      const { variables, greeting } = contextFor(voice.agentName);
      await createElevenLabsCampaign({
        businessId: business.id,
        kind: "quick",
        role: kind as CallRole,
        name: values.name,
        agentId,
        contacts: [{ phone, label: kind === "payments" ? `${values.name} · ₹${values.amount}` : values.name, variables, greeting }],
        timeZone,
        endTime: kind === "payments" ? "19:00" : "20:00",
        retryMinutes: RETRY_MINUTES,
        start: true,
      });
    } catch (err) {
      console.error("Quick call (ElevenLabs) failed:", err);
      return { error: "Couldn't place the call. Please try again.", values };
    }
    revalidatePath("/dashboard/leads");
    revalidatePath("/dashboard/quick-call");
    return { ok: `${whenText(timeZone, lastHour, hours)}${voice.agentName} tries once more about ${RETRY_MINUTES} minutes later. The result will appear in Calls.` };
  }
  const context = contextFor(business.agent_name);

  try {
    if (kind !== "follow_up") workflowId = await ensureRoleAgent(business, kind as "marketing" | "payments");
    // Sales calls also keep the person as a lead (existing leads are left as they are). Payment calls don't.
    if (kind !== "payments") {
      await supabase
        .from("leads")
        .upsert({ business_id: business.id, phone, name: values.name, car_interest: values.car || null, source: "manual", stage: "new" }, { onConflict: "business_id,phone", ignoreDuplicates: true });
    }
    const campaign = await createCampaign({
      workflowId,
      // Readable details for the "Upcoming calls" list: type · name · phone · amount.
      name: [`${QUICK_CALL_PREFIX}${kind}`, values.name, phone, kind === "payments" ? `₹${values.amount}` : "", new Date().toISOString().slice(0, 16)].filter(Boolean).join(" · ").slice(0, 120),
      contacts: [{ phone, context: { ...context.variables, greeting_override_type: "text", greeting_override_text: context.greeting } }],
      timeZone,
      retryDelaySeconds: RETRY_MINUTES * 60,
      endTime: kind === "payments" ? "19:00" : "20:00",
    });
    await controlCampaign(campaign.id, "start");
  } catch (err) {
    console.error("Quick call failed:", err);
    return { error: "Couldn't place the call. Please try again.", values };
  }

  revalidatePath("/dashboard/calls");
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/quick-call");
  return { ok: `${whenText(timeZone, lastHour, hours)}${business.agent_name} tries once more about ${RETRY_MINUTES} minutes later. The result will appear in Calls.` };
}

function whenText(timeZone: string, lastHour: number, hours: string) {
  const hour = localHour(timeZone);
  return hour >= 9 && hour < lastHour
    ? "Calling now — their phone should ring within a minute. If they don't answer, "
    : `It's outside calling hours (${hours}), so the call will go out ${hour < 9 ? "today" : "tomorrow"} at 9 AM. If they don't answer then, `;
}

// The date picker sends 2026-10-15; the agent should say "15 October 2026".
function spokenDate(value: string): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return value;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

// Cancels a waiting or retrying one-person call (Quick call or website form) so it never rings.
export async function cancelUpcomingCallAction(campaignId: number): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id, dograh_workflow_id").maybeSingle();
  if (!business) return { error: "Please sign in again." };
  if ((await voiceProvider(business.id)).provider === "elevenlabs") {
    const list = await getElevenLabsCampaign(business.id, campaignId);
    if (!list || list.kind === "campaign") return { error: "Call not found." };
    if (list.state === "completed" || list.state === "cancelled") return { error: "That call has already finished." };
    await cancelElevenLabsCampaign(list);
    revalidatePath("/dashboard/quick-call");
    return {};
  }
  const campaign = await getCampaign(campaignId).catch(() => null);
  const oneOff = campaign && (campaign.name.startsWith(QUICK_CALL_PREFIX) || campaign.name.startsWith(FORM_CALL_PREFIX));
  if (!campaign || !oneOff || !(await businessWorkflowIds(business)).includes(campaign.workflow_id)) return { error: "Call not found." };
  if (campaign.state === "completed") return { error: "That call has already finished." };
  try {
    await cancelOneOffCall(campaign);
  } catch (err) {
    console.error("Cancel call failed:", err);
    return { error: "Couldn't cancel. Please try again." };
  }
  revalidatePath("/dashboard/quick-call");
  return {};
}
