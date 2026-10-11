import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { AutoRefresh } from "../auto-refresh";
import { type Call } from "@/lib/dograh";
import { listBusinessCalls } from "@/lib/agent-roles";
import { SOURCES, STAGES, syncLeadsFromCalls } from "@/lib/leads";
import { hasLiveCall, formatDateTime, formatOutcome, formatPhone } from "@/lib/format";
import { EmptyState, Notice, PageHeader, card, inputClass } from "../ui";
import { AddLeadButton, CallLeadButton, StageSelect } from "./lead-controls";

const stageDot: Record<string, string> = {
  new: "bg-sky-500",
  contacted: "bg-teal-500",
  test_drive_booked: "bg-violet-500",
  negotiating: "bg-amber-500",
  sold: "bg-emerald-500",
  lost: "bg-slate-400",
};

export default async function LeadsPage({ searchParams }: PageProps<"/dashboard/leads">) {
  const { q = "", stage = "", source = "" } = (await searchParams) as Record<string, string | undefined>;

  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id, dograh_workflow_id").maybeSingle();
  if (!business) redirect("/dashboard");

  // Pick up anyone who has phoned since the last visit, and remember each number's latest call.
  let calls: Call[] = [];
  if (business.dograh_workflow_id) {
    try {
      calls = await listBusinessCalls(business);
      await syncLeadsFromCalls(business.id, calls);
    } catch (err) {
      console.error("Lead sync failed:", err);
    }
  }
  const latestCall = new Map<string, Call>();
  for (const c of calls) {
    if (!c.customerNumber) continue;
    const prev = latestCall.get(c.customerNumber);
    if (!prev || c.startedAt > prev.startedAt) latestCall.set(c.customerNumber, c);
  }

  let query = supabase
    .from("leads")
    .select("id, name, phone, email, car_interest, source, stage, last_contact_at, created_at")
    .order("last_contact_at", { ascending: false, nullsFirst: false })
    .limit(500);
  if (stage) query = query.eq("stage", stage);
  if (source) query = query.eq("source", source);
  const { data: leads, error } = await query;

  const needle = q.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const shown = (leads ?? []).filter(
    (l) =>
      !needle ||
      (l.name ?? "").toLowerCase().includes(needle) ||
      (l.email ?? "").toLowerCase().includes(needle) ||
      (digits.length > 0 && (l.phone ?? "").includes(digits)),
  );
  const sourceLabel = (id: string) => SOURCES.find((s) => s.id === id)?.label ?? id;

  return (
    <main className="px-4 py-8 md:px-8">
      <div className="mx-auto max-w-6xl">
        {/* A call is still going on: keep its outcome fresh without a manual reload. */}
        {hasLiveCall(calls) && <AutoRefresh label={false} />}
        <PageHeader
          title="Leads"
          count={leads?.length ?? 0}
          description="Everyone who called or booked — added automatically, matched by phone number."
          actions={<AddLeadButton />}
        />

        <form role="search" className="mt-6 flex flex-col gap-2 sm:flex-row">
          <input name="q" type="search" aria-label="Search leads" defaultValue={q} placeholder="🔍 Search name, email or phone…" className={`flex-1 ${inputClass}`} />
          <select name="stage" aria-label="Filter by stage" defaultValue={stage} className={inputClass}>
            <option value="">All stages</option>
            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select name="source" aria-label="Filter by source" defaultValue={source} className={inputClass}>
            <option value="">All sources</option>
            {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">Apply filters</button>
        </form>

        {error && (
          <div className="mt-4">
            <Notice>Leads aren&apos;t set up in the database yet ({error.message}).</Notice>
          </div>
        )}

        <div className={`relative mt-4 overflow-x-auto ${card}`}>
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3 font-medium">Last activity</th>
                <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                        {(l.name ?? "?").split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{l.name ?? "Unknown caller"}</p>
                        {l.email && <p className="truncate text-xs text-slate-500">{l.email}</p>}
                        {l.car_interest && <p className="truncate text-xs text-slate-700">🚗 {l.car_interest}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatPhone(l.phone)}</td>
                  <td className="px-4 py-3"><span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200">{sourceLabel(l.source)}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${stageDot[l.stage] ?? "bg-slate-300"}`} />
                      <StageSelect leadId={l.id} stage={l.stage} stages={STAGES} />
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <LastActivity call={l.phone ? latestCall.get(l.phone) : undefined} fallback={l.last_contact_at} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {l.phone && <CallLeadButton leadId={l.id} label={l.name?.split(" ")[0] ?? "this lead"} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!error && shown.length === 0 &&
            ((leads?.length ?? 0) === 0 ? (
              <EmptyState icon="👥" title="No leads yet">Callers and bookings will appear here automatically.</EmptyState>
            ) : (
              <EmptyState icon="🔍" title="No leads match these filters">Try a different search, or clear the stage and source filters.</EmptyState>
            ))}
        </div>
      </div>
    </main>
  );
}

// Latest call with this number (direction + how it went), linking to its recording; otherwise the last contact time.
function LastActivity({ call, fallback }: { call?: Call; fallback: string | null }) {
  if (!call) return <span className="text-slate-500">{fallback ? formatDateTime(fallback) : "—"}</span>;
  return (
    <Link href={`/dashboard/calls/${call.id}`} className="group block">
      <span className="text-slate-800 group-hover:text-indigo-600">
        📞 {call.direction === "outbound" ? "Outbound" : "Inbound"} · {formatOutcome(call.outcome)}
      </span>
      <span className="block text-xs text-slate-500">{formatDateTime(call.startedAt)}</span>
    </Link>
  );
}
