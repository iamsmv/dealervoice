import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAgentStudio, getVoiceSettings, listVoices } from "@/lib/dograh";
import { AgentForm, VoiceForm } from "./studio-forms";
import { voiceProvider } from "@/lib/elevenlabs";
import { getElevenLabsStudio, listElevenLabsVoices } from "@/lib/elevenlabs-studio";
import { receptionistGreeting } from "@/lib/elevenlabs-receptionist-prompt";
import { Notice, PageHeader } from "../ui";

export default async function VoiceStudioPage() {
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id, name, agent_name, dograh_workflow_id").maybeSingle();
  if (!business) redirect("/dashboard");

  const provider = await voiceProvider(business.id).catch(() => ({ provider: "dograh" as const }));
  let agentName = business.agent_name;
  let voices, voice, studio;
  if (provider.provider === "elevenlabs") {
    // ElevenLabs: the same forms, reading the ElevenLabs receptionist.
    agentName = provider.agentName;
    const [list, el] = await Promise.all([
      listElevenLabsVoices().catch(() => []),
      getElevenLabsStudio(business.id, provider.agentId, receptionistGreeting({ agent_name: agentName, dealership_name: business.name })).catch(() => null),
    ]);
    voices = list;
    voice = el?.voice ?? null;
    studio = el?.studio ?? null;
  } else {
    const workflowId = business.dograh_workflow_id ? Number(business.dograh_workflow_id) : null;
    [voices, voice, studio] = await Promise.all([
      listVoices().catch(() => []),
      getVoiceSettings().catch(() => null),
      workflowId ? getAgentStudio(workflowId).catch(() => null) : null,
    ]);
  }

  return (
    <main className="px-4 py-8 md:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title="Voice Studio" description={<>Choose how {agentName} sounds and what she says. Changes apply to the next call.</>} />

        {!studio || !voice ? (
          <Notice>Couldn&apos;t load your receptionist&apos;s settings right now. Please refresh.</Notice>
        ) : (
          <>
            <VoiceForm voices={voices} current={voice} agentName={agentName} />
            <AgentForm key={agentName} agentName={agentName} studio={studio} />
          </>
        )}
      </div>
    </main>
  );
}
