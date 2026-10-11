import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBusinessCall } from "@/lib/agent-roles";
import { displayAgentName } from "@/lib/elevenlabs";
import { Badge, card } from "../../ui";
import { formatDateTime, formatDuration, formatOutcome, formatPhone } from "@/lib/format";

export default async function CallDetailPage({ params }: PageProps<"/dashboard/calls/[id]">) {
  const { id } = await params;
  // Dograh calls have numeric ids; ElevenLabs calls have "conv_…" ids.
  const runId = id.startsWith("conv_") ? id : Number(id);
  if (typeof runId === "number" && !Number.isInteger(runId)) notFound();

  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("id, dograh_workflow_id, agent_name")
    .maybeSingle();
  if (!business?.dograh_workflow_id) redirect("/dashboard");

  // Fetching through the dealership's own agent means one dealership can never open another's call.
  const detail = await getBusinessCall(business, runId).catch(() => null);
  if (!detail) notFound();
  const { call, recordingUrl, transcript } = detail;
  // ElevenLabs calls are spoken by that platform's agent, whose name can differ from the dashboard's.
  const agentName = typeof runId === "string" ? await displayAgentName(business) : business.agent_name;

  const { data: lead } = call.customerNumber
    ? await supabase.from("leads").select("name, stage").eq("phone", call.customerNumber).maybeSingle()
    : { data: null };

  return (
    <main className="px-4 py-8 md:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link href="/dashboard/calls" className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline">← All calls</Link>

        <div>
          <h1 className="break-words text-2xl font-bold tracking-tight text-slate-900">
            {lead?.name ?? (call.channel === "web" ? "Browser test call" : formatPhone(call.customerNumber))}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <Badge>{call.channel === "phone" ? "📞 Phone" : "🌐 Browser"} · {call.direction === "outbound" ? "Outbound" : "Inbound"}</Badge>
            <Badge tone="indigo">{formatOutcome(call.outcome)}</Badge>
            <span>{formatDateTime(call.startedAt)}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">⏱ {formatDuration(call.durationSeconds)}</span>
          </div>
          {lead?.name && <p className="mt-1 text-sm text-slate-500">{formatPhone(call.customerNumber)}</p>}
        </div>

        <section className={`${card} p-4 sm:p-6`}>
          <h2 className="font-semibold text-slate-900">🎧 Recording</h2>
          {recordingUrl ? (
            <audio controls preload="none" src={recordingUrl} className="mt-3 w-full" />
          ) : (
            <p className="mt-2 text-sm text-slate-500">No recording for this call.</p>
          )}
        </section>

        <section className={`${card} p-4 sm:p-6`}>
          <h2 className="font-semibold text-slate-900">💬 Transcript</h2>
          {transcript.length > 0 ? (
            <ol className="mt-4 space-y-3">
              {transcript.map((line, i) => (
                <li key={i} className={`flex ${line.speaker === "agent" ? "justify-start" : "justify-end"}`}>
                  <div
                    className={`max-w-[85%] break-words rounded-2xl px-4 py-2 text-sm ${
                      line.speaker === "agent" ? "rounded-bl-sm bg-slate-100 text-slate-900" : "rounded-br-sm bg-indigo-600 text-white"
                    }`}
                  >
                    <p className="text-[11px] font-medium opacity-70">
                      {line.speaker === "agent" ? agentName : "Caller"}
                    </p>
                    {line.text}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No transcript for this call.</p>
          )}
        </section>
      </div>
    </main>
  );
}
