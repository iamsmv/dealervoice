"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { listVoices, renameAgent, saveAgentStudio, setVoiceSettings } from "@/lib/dograh";
import { updateElevenLabsAgentsFor, updateRoleAgents } from "@/lib/agent-roles";
import { voiceProvider } from "@/lib/elevenlabs";
import { listElevenLabsVoices, saveElevenLabsStudio, saveElevenLabsVoice } from "@/lib/elevenlabs-studio";

export type StudioState = { error?: string; ok?: boolean };

async function loadBusiness() {
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id, name, city, brands, showroom_hours, service_hours, agent_name, dograh_workflow_id").maybeSingle();
  return { supabase, business };
}

async function workflowId() {
  const { business } = await loadBusiness();
  return business?.dograh_workflow_id ? Number(business.dograh_workflow_id) : null;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// Saves the voice and, if it changed, the receptionist's name (in our database and in the agent).
export async function saveVoiceAction(_prev: StudioState, form: FormData): Promise<StudioState> {
  const { supabase, business } = await loadBusiness();
  if (!business?.dograh_workflow_id) return { error: "Your receptionist isn't ready yet." };
  const agentName = String(form.get("agent_name") ?? "").trim().slice(0, 30);
  if (!/^[\p{L} .'-]+$/u.test(agentName)) return { error: "Please enter a name for your receptionist (letters only)." };
  const voice = String(form.get("voice") ?? "");
  const speed = clamp(Number(form.get("speed") ?? 1) || 1, 0.8, 1.2);
  const provider = await voiceProvider(business.id);
  if (provider.provider === "elevenlabs") {
    const elVoices = await listElevenLabsVoices().catch(() => []);
    if (!elVoices.some((v) => v.voice_id === voice)) return { error: "Please pick a voice from the list." };
    try {
      const renamed = agentName !== provider.agentName;
      await saveElevenLabsVoice(provider.agentId, { voiceId: voice, speed, agentName: renamed ? agentName : undefined, dealershipName: business.name });
      // A new name is spoken in the script and greeting, so rewrite them (and the job agents) too.
      if (renamed) await updateElevenLabsAgentsFor(business.id, { dealership_name: business.name, city: business.city, brands: business.brands, showroom_hours: business.showroom_hours ?? "", service_hours: business.service_hours ?? "" });
    } catch (err) {
      console.error("Save voice (ElevenLabs) failed:", err);
      return { error: "Couldn't save the voice. Please try again." };
    }
    revalidatePath("/dashboard", "layout");
    return { ok: true };
  }
  const voices = await listVoices().catch(() => []);
  if (voice !== "default" && !voices.some((v) => v.voice_id === voice)) return { error: "Please pick a voice from the list." };
  try {
    await setVoiceSettings(voice, speed);
    if (agentName !== business.agent_name) {
      await renameAgent(Number(business.dograh_workflow_id), agentName);
      await updateRoleAgents(business.id, { agent_name: agentName });
      const { error } = await supabase.from("businesses").update({ agent_name: agentName }).eq("id", business.id);
      if (error) throw error;
      revalidatePath("/dashboard", "layout");
    }
  } catch (err) {
    console.error("Save voice failed:", err);
    return { error: "Couldn't save the voice. Please try again." };
  }
  revalidatePath("/dashboard/voice-studio");
  return { ok: true };
}

export async function saveAgentAction(_prev: StudioState, form: FormData): Promise<StudioState> {
  const id = await workflowId();
  if (!id) return { error: "Your receptionist isn't ready yet." };
  const customGreeting = String(form.get("greeting") ?? "").trim().slice(0, 300);
  const customInstructions = String(form.get("instructions") ?? "").trim().slice(0, 2000);
  const minutes = clamp(Number(form.get("max_minutes")) || 5, 1, 15);
  const idle = clamp(Number(form.get("idle_seconds")) || 10, 5, 30);

  const { business } = await loadBusiness();
  const provider = business ? await voiceProvider(business.id) : null;
  if (business && provider?.provider === "elevenlabs") {
    try {
      await saveElevenLabsStudio(business.id, provider.agentId, { greeting: customGreeting, instructions: customInstructions, maxSeconds: minutes * 60, idleSeconds: idle });
      // Greeting and instructions live in the script, so rewrite it with them.
      await updateElevenLabsAgentsFor(business.id, { dealership_name: business.name, city: business.city, brands: business.brands, showroom_hours: business.showroom_hours ?? "", service_hours: business.service_hours ?? "" });
    } catch (err) {
      console.error("Save agent (ElevenLabs) failed:", err);
      return { error: "Couldn't save. Please try again." };
    }
    revalidatePath("/dashboard/voice-studio");
    return { ok: true };
  }
  try {
    await saveAgentStudio(id, {
      customGreeting,
      customInstructions,
      settings: { max_call_duration: minutes * 60, max_user_idle_timeout: idle },
    });
  } catch (err) {
    console.error("Save agent failed:", err);
    return { error: "Couldn't save. Please try again." };
  }
  revalidatePath("/dashboard/voice-studio");
  return { ok: true };
}
