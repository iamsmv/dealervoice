import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { elevenlabs } from "@/lib/elevenlabs";
import type { AgentStudio, Voice } from "@/lib/dograh";

// Voice Studio for dealerships on ElevenLabs: the same page and forms as Dograh, reading and writing the
// ElevenLabs receptionist. Greeting and extra instructions are also kept in business_features, so rewriting
// the script from Settings keeps them.

type AgentSettings = {
  name: string;
  conversation_config: {
    agent: { first_message: string };
    tts: { voice_id: string; speed?: number | null };
    conversation?: { max_duration_seconds?: number };
    turn?: { silence_end_call_timeout?: number };
  };
};

type ElevenLabsVoice = { voice_id: string; name: string; description?: string | null; preview_url?: string | null; labels?: Record<string, string> };

// The dealership's own voices in ElevenLabs. Hindi / Indian voices come first and are marked as recommended,
// since callers speak Hinglish.
export async function listElevenLabsVoices(): Promise<Voice[]> {
  const r = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100", { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! }, cache: "no-store" });
  if (!r.ok) throw new Error(`ElevenLabs voices failed: ${r.status}`);
  const res = (await r.json()) as { voices: ElevenLabsVoice[] };
  return res.voices
    .map((v) => {
      const labels = v.labels ?? {};
      const indian = labels.language === "hi" || /indian|hindi/i.test(`${labels.accent ?? ""} ${v.name}`);
      return {
        voice_id: v.voice_id,
        name: v.name,
        description: v.description ?? labels.descriptive ?? "",
        gender: labels.gender ?? "",
        language: labels.language ?? "",
        accent: labels.accent ?? "",
        preview_url: v.preview_url ?? "",
        recommended: indian,
      };
    })
    .sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.name.localeCompare(b.name));
}

async function savedExtras(businessId: string) {
  const { data } = await createAdminClient().from("business_features").select("elevenlabs_greeting, elevenlabs_instructions").eq("business_id", businessId).maybeSingle();
  return { greeting: (data?.elevenlabs_greeting as string | null) ?? "", instructions: (data?.elevenlabs_instructions as string | null) ?? "" };
}

export async function getElevenLabsStudio(businessId: string, agentId: string, defaultGreeting: string) {
  const [agent, extras] = await Promise.all([elevenlabs<AgentSettings>(`/convai/agents/${agentId}`), savedExtras(businessId)]);
  const cc = agent.conversation_config;
  const studio: AgentStudio = {
    greeting: defaultGreeting,
    customGreeting: extras.greeting,
    customInstructions: extras.instructions,
    settings: {
      max_call_duration: cc.conversation?.max_duration_seconds ?? 600,
      max_user_idle_timeout: cc.turn?.silence_end_call_timeout ?? 20,
    },
  };
  return { studio, voice: { voice: cc.tts.voice_id, speed: cc.tts.speed ?? 1 } };
}

// Voice, speed and (when given) a new name. The name is the first part of the agent's name in ElevenLabs.
export async function saveElevenLabsVoice(agentId: string, input: { voiceId: string; speed: number; agentName?: string; dealershipName: string }) {
  await elevenlabs(`/convai/agents/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...(input.agentName ? { name: `${input.agentName} - ${input.dealershipName}` } : {}),
      conversation_config: { tts: { voice_id: input.voiceId, speed: input.speed } },
    }),
  });
}

// Greeting and extra instructions (kept in our database) plus the call limits (set on the agent).
export async function saveElevenLabsStudio(businessId: string, agentId: string, input: { greeting: string; instructions: string; maxSeconds: number; idleSeconds: number }) {
  const { error } = await createAdminClient()
    .from("business_features")
    .update({ elevenlabs_greeting: input.greeting || null, elevenlabs_instructions: input.instructions || null })
    .eq("business_id", businessId);
  if (error) throw new Error(`Saving Voice Studio failed: ${error.message}`);
  await elevenlabs(`/convai/agents/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify({ conversation_config: { conversation: { max_duration_seconds: input.maxSeconds }, turn: { silence_end_call_timeout: input.idleSeconds } } }),
  });
}

export const elevenLabsStudioExtras = savedExtras;
