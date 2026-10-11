"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { controlCampaign, createCampaign, getCampaign, redialCampaign, removeCampaign } from "@/lib/dograh";
import { STAGES } from "@/lib/leads";
import { marketingContext, outboundContext, paymentContext } from "@/lib/outbound";
import { contactsFromCsv, paymentsFromCsv, type ImportedContact } from "@/lib/csv";
import { fetchSheetCsv } from "@/lib/google-sheets";
import { businessWorkflowIds, ensureElevenLabsRoleAgentFor, ensureRoleAgent, extraAgentsEnabled } from "@/lib/agent-roles";
import { voiceProvider, type VoiceProvider } from "@/lib/elevenlabs";
import { controlElevenLabsCampaign, createElevenLabsCampaign, getElevenLabsCampaign, redialElevenLabsCampaign, removeElevenLabsCampaign } from "@/lib/elevenlabs-calls";

export type CreateCampaignState = {
  error?: string;
  ok?: boolean;
  count?: number;
  // Sent back on errors so the form keeps the owner's choices.
  values?: { name: string; stages: string[]; source: string; mode: string; kind: string; offer: string; listFrom: string; sheetUrl: string };
  skipped?: number;
};

const MAX_FILE_BYTES = 1_000_000;

const MAX_CONTACTS = 500;

async function loadBusiness() {
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("id, name, agent_name, timezone, dograh_workflow_id, plan")
    .maybeSingle();
  return { supabase, business };
}

// Campaigns may belong to the receptionist or to one of the dealership's extra agents.
async function ownsCampaign(business: { id: string; dograh_workflow_id: string | null }, workflowId: number) {
  return (await businessWorkflowIds(business)).includes(workflowId);
}

const MAX_OFFER = 300;

// On ElevenLabs dealerships, campaign ids are our own call lists: returns that list (null if it isn't theirs).
// Undefined means the dealership is on Dograh.
async function elevenLabsList(businessId: string, id: number) {
  const voice: VoiceProvider = await voiceProvider(businessId);
  if (voice.provider !== "elevenlabs") return undefined;
  return getElevenLabsCampaign(businessId, id);
}

// The call list comes from an uploaded CSV file or a shared Google Sheet link.
async function readList(form: FormData): Promise<{ text: string } | { error: string }> {
  if (form.get("list_from") === "sheet") return fetchSheetCsv(String(form.get("sheet_url") ?? ""));
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Please choose a CSV file, or switch to Google Sheet link." };
  if (file.size > MAX_FILE_BYTES) return { error: "That file is too big (max 1 MB, about 20,000 rows)." };
  return { text: await file.text() };
}

export type SheetPreview = { error?: string; count?: number; skipped?: number; sample?: string[]; columns?: string[] };

// "Check sheet": reads the sheet and shows what would be called, without creating anything.
export async function previewSheetAction(url: string, kind: string): Promise<SheetPreview> {
  const { business } = await loadBusiness();
  if (!business) return { error: "Please sign in again." };
  const sheet = await fetchSheetCsv(url);
  if ("error" in sheet) return { error: sheet.error };
  const columns = sheet.text.split(/\r?\n/)[0].split(/[,;]/).map((c) => c.replace(/"/g, "").trim()).filter(Boolean).slice(0, 12);
  if (kind === "payments") {
    const parsed = paymentsFromCsv(sheet.text, MAX_CONTACTS);
    if (parsed.error) return { error: parsed.error, columns };
    return { count: parsed.contacts.length, skipped: parsed.skipped, columns, sample: parsed.contacts.slice(0, 3).map((c) => `${c.name} · ${c.phone} · ₹${c.amount.toLocaleString("en-IN")} due ${c.due_date}`) };
  }
  const parsed = contactsFromCsv(sheet.text, MAX_CONTACTS);
  if (parsed.error) return { error: parsed.error, columns };
  return { count: parsed.contacts.length, skipped: parsed.skipped, columns, sample: parsed.contacts.slice(0, 3).map((c) => `${c.name ?? "No name"} · ${c.phone}${c.car_interest ? ` · ${c.car_interest}` : ""}`) };
}

// Builds the call list from this dealership's leads and creates a campaign in Dograh as a draft.
// Nothing is dialled until the owner presses Start.
export async function createCampaignAction(_prev: CreateCampaignState, form: FormData): Promise<CreateCampaignState> {
  const { supabase, business } = await loadBusiness();
  if (!business?.dograh_workflow_id) return { error: "Your receptionist isn't ready yet." };
  if (business.plan === "paused") return { error: "Your account is paused." };

  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const stages = form.getAll("stages").map(String).filter((s) => STAGES.some((x) => x.id === s));
  const source = String(form.get("source") ?? "");
  const mode = form.get("mode") === "upload" ? "upload" : "leads";
  const listFrom = form.get("list_from") === "sheet" ? "sheet" : "file";
  const sheetUrl = String(form.get("sheet_url") ?? "").trim().slice(0, 500);
  // "marketing" / "payments" use the extra agents; only when the admin has switched them on.
  const requested = String(form.get("kind") ?? "");
  const kind = (requested === "marketing" || requested === "payments") && (await extraAgentsEnabled(business.id)) ? requested : "follow_up";
  const offer = String(form.get("offer") ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_OFFER);
  const values = { name, stages, source, mode, kind, offer, listFrom, sheetUrl };
  if (!name) return { error: "Please give the campaign a name.", values };
  if (kind === "marketing" && offer.length < 10) return { error: "Please describe the offer the agent should tell people about.", values };

  // Payment reminders: always an uploaded list of who owes what. Not added to Leads (they're existing customers).
  if (kind === "payments") {
    const list = await readList(form);
    if ("error" in list) return { error: list.error, values };
    const parsed = paymentsFromCsv(list.text, MAX_CONTACTS);
    if (parsed.error) return { error: parsed.error, values };
    if (!parsed.contacts.length) return { error: "No valid rows found. Each row needs name, phone, amount and due date.", values };
    const voice = await voiceProvider(business.id);
    if (voice.provider === "elevenlabs") {
      try {
        await createElevenLabsCampaign({
          businessId: business.id,
          kind: "campaign",
          role: "payments",
          name,
          agentId: await ensureElevenLabsRoleAgentFor(business, "payments", voice),
          contacts: parsed.contacts.map((p) => ({ phone: p.phone, label: p.name, ...paymentContext({ ...business, agent_name: voice.agentName }, p) })),
          timeZone: business.timezone ?? "Asia/Kolkata",
          endTime: "19:00",
        });
      } catch (err) {
        console.error("Create payment campaign (ElevenLabs) failed:", err);
        return { error: "Couldn't create the campaign. Please try again.", values };
      }
      revalidatePath("/dashboard/campaigns");
      return { ok: true, count: parsed.contacts.length, skipped: parsed.skipped };
    }
    const contacts = parsed.contacts.map((p) => {
      const { variables, greeting } = paymentContext(business, p);
      return { phone: p.phone, context: { ...variables, greeting_override_type: "text", greeting_override_text: greeting } };
    });
    try {
      await createCampaign({
        workflowId: await ensureRoleAgent(business, "payments"),
        name,
        contacts,
        timeZone: business.timezone ?? "Asia/Kolkata",
        endTime: "19:00", // payment calls only 9 AM – 7 PM (RBI recovery-call norm is 8 AM – 7 PM)
      });
    } catch (err) {
      console.error("Create payment campaign failed:", err);
      return { error: "Couldn't create the campaign. Please try again.", values };
    }
    revalidatePath("/dashboard/campaigns");
    return { ok: true, count: contacts.length, skipped: parsed.skipped };
  }

  let leads: ImportedContact[];
  let skipped = 0;
  if (mode === "upload") {
    const list = await readList(form);
    if ("error" in list) return { error: list.error, values };
    const parsed = contactsFromCsv(list.text, MAX_CONTACTS);
    if (parsed.error) return { error: parsed.error, values };
    if (!parsed.contacts.length) return { error: "No valid phone numbers found in the file.", values };
    leads = parsed.contacts;
    skipped = parsed.skipped;
    // Everyone on the list becomes a lead (existing leads are left as they are).
    const { error } = await supabase
      .from("leads")
      .upsert(leads.map((l) => ({ ...l, business_id: business.id, source: "import", stage: "new" })), { onConflict: "business_id,phone", ignoreDuplicates: true });
    if (error) return { error: error.message, values };
  } else {
    if (stages.length === 0) return { error: "Pick at least one stage to call.", values };
    // Row-level security keeps this to the signed-in dealership's leads.
    let query = supabase.from("leads").select("name, phone, car_interest").in("stage", stages).not("phone", "is", null).limit(MAX_CONTACTS);
    if (source) query = query.eq("source", source);
    const { data, error } = await query;
    if (error) return { error: error.message, values };
    if (!data?.length) return { error: "No leads match these filters.", values };
    leads = data.map((l) => ({ ...l, phone: l.phone! }));
  }

  const voice = await voiceProvider(business.id);
  if (voice.provider === "elevenlabs") {
    const agentBusiness = { ...business, agent_name: voice.agentName };
    try {
      await createElevenLabsCampaign({
        businessId: business.id,
        kind: "campaign",
        role: kind === "marketing" ? "marketing" : "follow_up",
        name,
        agentId: kind === "marketing" ? await ensureElevenLabsRoleAgentFor(business, "marketing", voice) : voice.agentId,
        contacts: leads.map((lead) => ({
          phone: lead.phone,
          label: lead.name ?? "No name",
          ...(kind === "marketing" ? marketingContext(agentBusiness, lead, offer) : outboundContext(agentBusiness, lead, "follow_up")),
        })),
        timeZone: business.timezone ?? "Asia/Kolkata",
      });
    } catch (err) {
      console.error("Create campaign (ElevenLabs) failed:", err);
      return { error: "Couldn't create the campaign. Please try again.", values };
    }
    revalidatePath("/dashboard/campaigns");
    revalidatePath("/dashboard/leads");
    return { ok: true, count: leads.length, skipped };
  }

  const contacts = leads.map((lead) => {
    const { variables, greeting } = kind === "marketing" ? marketingContext(business, lead, offer) : outboundContext(business, lead, "follow_up");
    return {
      phone: lead.phone,
      context: { ...variables, greeting_override_type: "text", greeting_override_text: greeting },
    };
  });

  try {
    // The Marketing agent is created in Dograh the first time it's needed.
    const workflowId = kind === "marketing" ? await ensureRoleAgent(business, "marketing") : Number(business.dograh_workflow_id);
    await createCampaign({
      workflowId,
      name,
      contacts,
      timeZone: business.timezone ?? "Asia/Kolkata",
    });
  } catch (err) {
    console.error("Create campaign failed:", err);
    return { error: "Couldn't create the campaign. Please try again.", values };
  }
  revalidatePath("/dashboard/campaigns");
  revalidatePath("/dashboard/leads");
  return { ok: true, count: contacts.length, skipped };
}

// Start / pause / resume — only for campaigns that belong to this dealership's agent.
export async function campaignControlAction(campaignId: number, action: "start" | "pause" | "resume") {
  const { business } = await loadBusiness();
  if (!business?.dograh_workflow_id) return;
  if (business.plan === "paused" && action !== "pause") return;
  const el = await elevenLabsList(business.id, campaignId);
  if (el !== undefined) {
    if (el && el.kind === "campaign") await controlElevenLabsCampaign(el, action);
    revalidatePath("/dashboard/campaigns");
    return;
  }
  const campaign = await getCampaign(campaignId).catch(() => null);
  if (!campaign || !(await ownsCampaign(business, campaign.workflow_id))) return;
  await controlCampaign(campaignId, action);
  revalidatePath("/dashboard/campaigns");
}

// Hides a campaign from the dashboard (Dograh keeps its call history). Not allowed while it's dialling.
export async function removeCampaignAction(campaignId: number) {
  const { business } = await loadBusiness();
  if (!business?.dograh_workflow_id) return;
  const el = await elevenLabsList(business.id, campaignId);
  if (el !== undefined) {
    if (el && el.kind === "campaign" && el.state !== "running") await removeElevenLabsCampaign(el);
    revalidatePath("/dashboard/campaigns");
    return;
  }
  const campaign = await getCampaign(campaignId).catch(() => null);
  if (!campaign || !(await ownsCampaign(business, campaign.workflow_id)) || campaign.state === "running") return;
  await removeCampaign(campaign);
  revalidatePath("/dashboard/campaigns");
}

export type CallBackState = { error?: string; info?: string };

// "Call back people who didn't answer": a new, not-started campaign with just those people.
export async function callBackAction(campaignId: number): Promise<CallBackState> {
  const { business } = await loadBusiness();
  if (!business?.dograh_workflow_id) return { error: "Your receptionist isn't ready yet." };
  if (business.plan === "paused") return { error: "Your account is paused." };
  const el = await elevenLabsList(business.id, campaignId);
  if (el !== undefined) {
    if (!el || el.kind !== "campaign") return { error: "Campaign not found." };
    if (el.state !== "completed") return { error: "You can call people back once the campaign has finished." };
    try {
      if ((await redialElevenLabsCampaign(el)) === null) return { info: "Everyone answered — there's nobody to call back." };
    } catch (err) {
      console.error("Call back (ElevenLabs) failed:", err);
      return { error: "Couldn't set up the call-back. Please try again." };
    }
    revalidatePath("/dashboard/campaigns");
    return {};
  }
  const campaign = await getCampaign(campaignId).catch(() => null);
  if (!campaign || !(await ownsCampaign(business, campaign.workflow_id))) return { error: "Campaign not found." };
  if (campaign.state !== "completed") return { error: "You can call people back once the campaign has finished." };
  try {
    const id = await redialCampaign(campaign);
    if (id === null) return { info: "Everyone answered — there's nobody to call back." };
  } catch (err) {
    console.error("Call back failed:", err);
    return { error: "Couldn't set up the call-back. Please try again." };
  }
  revalidatePath("/dashboard/campaigns");
  return {};
}
