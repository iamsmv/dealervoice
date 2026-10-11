import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { businessWorkflowIds, extraAgentsEnabled } from "@/lib/agent-roles";
import { listPendingOneOffCalls } from "@/lib/dograh";
import { describeElevenLabsUpcoming, describeUpcoming, type UpcomingCall } from "@/lib/upcoming-calls";
import { listElevenLabsCampaigns } from "@/lib/elevenlabs-calls";
import { UpcomingCalls } from "./upcoming-calls";
import { AutoRefresh } from "../auto-refresh";
import { PageHeader } from "../ui";
import { QuickCallForm } from "./quick-call-form";
import { voiceProvider } from "@/lib/elevenlabs";

export default async function QuickCallPage() {
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id, agent_name, dograh_workflow_id").maybeSingle();
  if (!business) redirect("/dashboard");

  if (!(await extraAgentsEnabled(business.id))) {
    return (
      <main className="px-4 py-8 md:px-8">
        <p className="mx-auto max-w-3xl rounded-2xl bg-white p-6 text-sm text-slate-600 ring-1 ring-slate-200">Quick call isn&apos;t switched on for your account.</p>
      </main>
    );
  }

  // ElevenLabs calls use that agent's own name and ring once, right away.
  const voice = await voiceProvider(business.id).catch(() => ({ provider: "dograh" as const }));
  const agentName = voice.provider === "elevenlabs" ? voice.agentName : business.agent_name;

  let upcoming: UpcomingCall[] = [];
  try {
    upcoming =
      voice.provider === "elevenlabs"
        ? (await listElevenLabsCampaigns(business.id, ["quick", "form"])).filter((c) => c.state === "running" || c.state === "paused").map((c) => describeElevenLabsUpcoming(c))
        : (await listPendingOneOffCalls(await businessWorkflowIds(business))).map((c) => describeUpcoming(c));
  } catch (err) {
    console.error("Upcoming calls failed:", err);
  }

  // Lets the owner pick an existing lead instead of typing the number.
  const { data: leads } = await supabase.from("leads").select("name, phone, car_interest").not("phone", "is", null).order("last_contact_at", { ascending: false, nullsFirst: false }).limit(200);

  return (
    <main className="px-4 py-8 md:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          icon="📲"
          title="Quick call"
          description={`Have ${agentName} call one person right now — a follow-up, an offer, or a payment reminder. For a whole list, use Campaigns.`}
        />
        {upcoming.length > 0 && <AutoRefresh seconds={30} label={false} />}
        <UpcomingCalls calls={upcoming} />
        <QuickCallForm agentName={agentName} leads={(leads ?? []).map((l) => ({ name: l.name ?? "", phone: l.phone!, car: l.car_interest ?? "" }))} />
      </div>
    </main>
  );
}
