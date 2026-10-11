import "server-only";
import { controlCampaign, createCampaign, FORM_CALL_PREFIX, startOutboundCall } from "@/lib/dograh";
import type { PaymentContact } from "@/lib/csv";
import { startElevenLabsCall, voiceProvider } from "@/lib/elevenlabs";
import { createElevenLabsCampaign } from "@/lib/elevenlabs-calls";

type CallBusiness = { id: string; name: string; agent_name: string; dograh_workflow_id: string | null; timezone?: string | null };
type CallLead = { name: string | null; phone: string; car_interest: string | null };

// Why we're calling — changes only Priya's opening line.
export type CallReason = "follow_up" | "web_form";

// Opening line + {{variables}} for an outbound call to this lead.
export function outboundContext(business: CallBusiness, lead: CallLead, reason: CallReason) {
  const firstName = lead.name?.split(" ")[0];
  const hi = `Hi${firstName ? ` ${firstName}` : ""}, this is ${business.agent_name} from ${business.name}.`;
  const car = lead.car_interest ? ` for the ${lead.car_interest}` : "";
  const greeting =
    reason === "web_form"
      ? `${hi} You just asked about a test drive${car} on our website, so I'm calling to set it up. Is this a good time?`
      : `${hi} I'm calling about your enquiry${car}. Is this a good time to talk?`;
  return {
    variables: { call_direction: "outbound", lead_name: lead.name ?? "the customer", car_interest: lead.car_interest ?? "a car" },
    greeting,
  };
}

// Has the dealership's receptionist phone a lead now. Throws if the call can't be started.
export async function callLeadNow(business: CallBusiness, lead: CallLead, reason: CallReason) {
  const voice = await voiceProvider(business.id);
  if (voice.provider === "elevenlabs") {
    const el = outboundContext({ ...business, agent_name: voice.agentName }, lead, reason);
    return startElevenLabsCall(voice.agentId, lead.phone, el.variables, el.greeting);
  }
  const { variables, greeting } = outboundContext(business, lead, reason);
  if (!business.dograh_workflow_id) throw new Error("This dealership's receptionist isn't set up yet.");
  return startOutboundCall(Number(business.dograh_workflow_id), lead.phone, {
    ...variables,
    greeting_override: { type: "text", text: greeting },
  });
}

// Calls a lead now and, if they miss it, once more after `retryMinutes` (calling hours only).
// Uses a hidden one-person Dograh campaign, which handles the dial and the retry for us.
export async function callLeadWithRetry(business: CallBusiness & { timezone?: string | null }, lead: CallLead, reason: CallReason, retryMinutes = 15) {
  // ElevenLabs: a one-person call list that our scheduler dials and retries.
  const voice = await voiceProvider(business.id);
  if (voice.provider === "elevenlabs") {
    const el = outboundContext({ ...business, agent_name: voice.agentName }, lead, reason);
    const list = await createElevenLabsCampaign({
      businessId: business.id,
      kind: "form",
      role: "follow_up",
      name: lead.name ?? "Website visitor",
      agentId: voice.agentId,
      contacts: [{ phone: lead.phone, label: lead.name ?? "Website visitor", variables: el.variables, greeting: el.greeting }],
      timeZone: business.timezone ?? "Asia/Kolkata",
      retryMinutes,
      start: true,
    });
    return list.id;
  }
  const { variables, greeting } = outboundContext(business, lead, reason);
  if (!business.dograh_workflow_id) throw new Error("This dealership's receptionist isn't set up yet.");
  const campaign = await createCampaign({
    workflowId: Number(business.dograh_workflow_id),
    name: [`${FORM_CALL_PREFIX}web_form`, lead.name ?? "Website visitor", lead.phone, new Date().toISOString().slice(0, 16)].join(" · ").slice(0, 120),
    contacts: [{ phone: lead.phone, context: { ...variables, greeting_override_type: "text", greeting_override_text: greeting } }],
    timeZone: business.timezone ?? "Asia/Kolkata",
    retryDelaySeconds: retryMinutes * 60,
  });
  await controlCampaign(campaign.id, "start");
  return campaign.id;
}

// True between 9 AM and 8 PM in the dealership's time zone — we never ring customers at night.
export function isCallingHours(timeZone = "Asia/Kolkata", now = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now));
  return hour >= 9 && hour < 20;
}

// Opening line + {{variables}} for a marketing call: the offer is spoken by the Marketing agent.
export function marketingContext(business: { name: string; agent_name: string }, lead: CallLead | { name: string | null; car_interest: string | null }, offer: string) {
  const firstName = lead.name?.split(" ")[0];
  const car = lead.car_interest ? ` on the ${lead.car_interest}` : "";
  return {
    variables: { call_direction: "outbound", lead_name: lead.name ?? "the customer", car_interest: lead.car_interest ?? "a car", offer },
    greeting: `Hi${firstName ? ` ${firstName}` : ""}, this is ${business.agent_name} from ${business.name}. I'm calling with a special offer${car}. Do you have a minute?`,
  };
}

// Opening line + {{variables}} for a payment reminder. The greeting only asks for the person by name:
// the amount is said only after they confirm who they are.
export function paymentContext(business: { name: string; agent_name: string }, p: PaymentContact) {
  const amountWords = `${p.amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })} rupees`;
  return {
    variables: { call_direction: "outbound", customer_name: p.name, amount_words: amountWords, due_date: p.due_date, reference: p.reference ?? "none" },
    greeting: `Hi, this is ${business.agent_name} from ${business.name}. Am I speaking with ${p.name}?`,
  };
}

// The hour (0-23) in the dealership's time zone.
export function localHour(timeZone = "Asia/Kolkata", now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now));
}
