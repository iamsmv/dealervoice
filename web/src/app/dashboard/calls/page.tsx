import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AutoRefresh } from "../auto-refresh";
import { type Call } from "@/lib/dograh";
import { listBusinessCalls } from "@/lib/agent-roles";
import { syncLeadsFromCalls } from "@/lib/leads";
import { Badge, type Tone, EmptyState, Notice, PageHeader, card, inputClass } from "../ui";
import { hasLiveCall, formatDateTime, formatDuration, formatOutcome, formatPhone } from "@/lib/format";

// Colour only: green = good result, amber = needs a follow-up, red = failed, indigo = still going.
function outcomeTone(outcome: string): Tone {
  if (["booking_done", "enquiry_answered", "support_answered", "promised_to_pay", "already_paid", "completed"].includes(outcome)) return "emerald";
  if (["no_answer", "busy", "voicemail", "callback_requested", "user_idle_max_duration_exceeded", "ticket_created", "payment_disputed"].includes(outcome)) return "amber";
  if (["failed", "do_not_call", "wrong_number", "agent_glitch"].includes(outcome)) return "red";
  if (outcome === "in_progress") return "indigo";
  return "slate";
}

export default async function CallsPage({ searchParams }: PageProps<"/dashboard/calls">) {
  const { q = "", channel = "" } = (await searchParams) as Record<string, string | undefined>;

  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id, dograh_workflow_id").maybeSingle();
  if (!business) redirect("/dashboard");

  let calls: Call[] = [];
  let loadError = false;
  if (business.dograh_workflow_id) {
    try {
      calls = await listBusinessCalls(business);
      await syncLeadsFromCalls(business.id, calls).catch((err) => console.error("Lead sync failed:", err));
    } catch (err) {
      console.error(err);
      loadError = true;
    }
  }

  // Show the lead's name next to numbers we already know.
  const { data: leads } = await supabase.from("leads").select("phone, name");
  const nameByPhone = new Map((leads ?? []).filter((l) => l.name).map((l) => [l.phone, l.name]));

  const digits = q.replace(/\D/g, "");
  const shown = calls.filter(
    (c) =>
      (!channel || c.channel === channel) &&
      (!digits || (c.customerNumber ?? "").replace(/\D/g, "").includes(digits)),
  );
  const totalMinutes = Math.round(calls.reduce((sum, c) => sum + c.durationSeconds, 0) / 60);

  return (
    <main className="px-4 py-8 md:px-8">
      <div className="mx-auto max-w-6xl">
        {/* A call is still going on: keep its outcome fresh without a manual reload. */}
        {hasLiveCall(calls) && <AutoRefresh label={false} />}
        <PageHeader
          title="Calls"
          count={calls.length}
          description={<>Every call to your receptionist — recording, transcript and outcome. <b className="font-semibold text-slate-800">{totalMinutes} min</b> in total.</>}
        />

        <form role="search" className="mt-6 flex flex-col gap-2 sm:flex-row">
          <input
            name="q"
            type="search"
            aria-label="Search by phone number"
            defaultValue={q}
            placeholder="🔍 Search phone number…"
            className={`flex-1 ${inputClass}`}
          />
          <select name="channel" aria-label="Filter by channel" defaultValue={channel} className={inputClass}>
            <option value="">All channels</option>
            <option value="phone">Phone calls</option>
            <option value="web">Browser tests</option>
          </select>
          <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">Apply filters</button>
        </form>

        {loadError && (
          <div className="mt-4"><Notice>Couldn&apos;t load calls right now. Please refresh in a minute.</Notice></div>
        )}

        <div className={`relative mt-4 overflow-x-auto ${card}`}>
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Channel</th>
                <th className="px-4 py-3 font-medium">Outcome</th>
                <th className="px-4 py-3 text-right font-medium">Duration</th>
                <th className="px-4 py-3 text-right font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((c) => {
                const name = c.customerNumber ? nameByPhone.get(c.customerNumber) : null;
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/calls/${c.id}`} className="font-medium text-slate-900 hover:text-indigo-600">
                        {name ?? (c.channel === "web" ? "Browser test call" : formatPhone(c.customerNumber))}
                      </Link>
                      {name && <p className="text-xs text-slate-500">{formatPhone(c.customerNumber)}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {c.channel === "phone" ? "📞 Phone" : "🌐 Browser"} · {c.direction === "inbound" ? "Inbound" : "Outbound"}
                      {c.role && <span className="ml-1 text-xs text-slate-500">· {c.role === "payments" ? "💰 Payment reminder" : "📣 Marketing"}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={outcomeTone(c.outcome)}>{formatOutcome(c.outcome)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatDuration(c.durationSeconds)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-slate-500">{formatDateTime(c.startedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length === 0 &&
            (calls.length === 0 ? (
              <EmptyState icon="📞" title="No calls yet">They&apos;ll appear here as people call your receptionist.</EmptyState>
            ) : (
              <EmptyState icon="🔍" title="No calls match these filters">Try another number or show all channels.</EmptyState>
            ))}
        </div>
      </div>
    </main>
  );
}
