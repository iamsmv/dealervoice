import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupportSettings } from "@/lib/agent-roles";
import { isOverdue, ticketNumber, TICKET_CATEGORIES, TICKET_FIELDS, TICKET_PRIORITIES, TICKET_STATUSES, type Ticket } from "@/lib/tickets";
import { formatDateTime, formatPhone } from "@/lib/format";
import { KnowledgeForm, StatusSelect } from "./support-forms";
import { Badge, EmptyState, PageHeader, TabLinks, card } from "../ui";
import { displayAgentName } from "@/lib/elevenlabs";

// Time left to respond, from the priority's response target. Null once resolved/closed or already overdue.
function responseWindow(t: Pick<Ticket, "priority" | "status" | "created_at">, now = Date.now()) {
  if (t.status === "resolved" || t.status === "closed") return null;
  const total = (TICKET_PRIORITIES.find((p) => p.id === t.priority)?.slaHours ?? 24) * 3_600_000;
  const left = total - (now - new Date(t.created_at).getTime());
  if (left <= 0) return null;
  const mins = Math.ceil(left / 60_000);
  const text = mins < 60 ? `${mins} min left` : mins < 48 * 60 ? `${Math.floor(mins / 60)}h ${mins % 60 ? `${mins % 60}m ` : ""}left` : `${Math.round(mins / 60 / 24)} days left`;
  const share = left / total;
  return { text, share, bar: share > 0.5 ? "bg-emerald-500" : share > 0.2 ? "bg-amber-400" : "bg-red-500" };
}

const priorityBadge: Record<string, string> = {
  urgent: "bg-red-50 text-red-700 ring-red-200",
  high: "bg-amber-50 text-amber-700 ring-amber-200",
  normal: "bg-slate-100 text-slate-700 ring-slate-200",
  low: "bg-slate-50 text-slate-500 ring-slate-200",
};

const VIEWS = [
  { id: "active", label: "Active", statuses: ["open", "in_progress", "waiting_customer"] },
  { id: "done", label: "Resolved", statuses: ["resolved", "closed"] },
  { id: "all", label: "All", statuses: [] as string[] },
];

export default async function SupportPage({ searchParams }: PageProps<"/dashboard/support">) {
  const { view = "active" } = (await searchParams) as Record<string, string | undefined>;
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id, agent_name").maybeSingle();
  if (!business) redirect("/dashboard");
  business.agent_name = await displayAgentName(business);

  const settings = await getSupportSettings(business.id);
  if (!settings.enabled) {
    return (
      <main className="px-4 py-8 md:px-8">
        <div className={`mx-auto max-w-3xl ${card}`}>
          <EmptyState icon="🎧" title="Support tickets aren’t switched on">Ask the DealerVoice team to turn on extra agents for your account.</EmptyState>
        </div>
      </main>
    );
  }

  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0];
  let query = supabase.from("support_tickets").select(TICKET_FIELDS).order("created_at", { ascending: false }).limit(200);
  if (current.statuses.length) query = query.in("status", current.statuses);
  const { data } = await query;
  const tickets = (data ?? []) as Ticket[];
  const label = (list: readonly { id: string; label: string }[], id: string) => list.find((x) => x.id === id)?.label ?? id;
  const overdue = tickets.filter((t) => isOverdue(t)).length;

  return (
    <main className="px-4 py-8 md:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <PageHeader
          title="Support"
          description={<>When {business.agent_name} can&apos;t solve a customer&apos;s problem on the call, a ticket appears here with a number the customer was given.</>}
        />

        <div className="flex flex-wrap items-center gap-2">
          <TabLinks label="Ticket views" tabs={VIEWS.map((v) => ({ href: `/dashboard/support?view=${v.id}`, label: v.label, active: v.id === current.id }))} />
          {overdue > 0 && <span className="ml-auto"><Badge tone="red">⏰ {overdue} overdue</Badge></span>}
        </div>

        <ul className="space-y-3">
          {tickets.map((t) => {
            const late = isOverdue(t);
            const respond = responseWindow(t);
            return (
              <li key={t.id} className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ${late ? "border-l-4 border-l-red-500 ring-red-300" : "ring-slate-200"}`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                      #{ticketNumber(t)}
                      {t.zoho_web_url ? (
                        <a href={t.zoho_web_url} target="_blank" rel="noreferrer" className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200 hover:underline">Open in Zoho ↗</a>
                      ) : t.zoho_sync === "pending" && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">⏳ sending to Zoho</span>
                      )}
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${priorityBadge[t.priority] ?? priorityBadge.normal}`}>{label(TICKET_PRIORITIES, t.priority)}</span>
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">{label(TICKET_CATEGORIES, t.category)}</span>
                      {late && <span className="text-xs font-semibold text-red-600">⏰ overdue</span>}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">{t.description}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {t.customer_name ?? "Unknown caller"}
                      {t.phone && (
                        <> · <Link href={`/dashboard/calls?q=${encodeURIComponent(t.phone)}`} className="text-indigo-600 hover:underline">{formatPhone(t.phone)}</Link></>
                      )}
                      {t.vehicle && ` · ${t.vehicle}`} · {formatDateTime(t.created_at)}
                    </p>
                    {respond && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                        <span className="whitespace-nowrap">Respond within: <b className="font-semibold text-slate-800">{respond.text}</b></span>
                        <span
                          role="progressbar"
                          aria-label="Time left to respond"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(respond.share * 100)}
                          className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200"
                        >
                          <span className={`block h-full rounded-full ${respond.bar}`} style={{ width: `${Math.max(4, Math.round(respond.share * 100))}%` }} />
                        </span>
                      </div>
                    )}
                  </div>
                  <StatusSelect ticketId={t.id} status={t.status} statuses={TICKET_STATUSES} />
                </div>
              </li>
            );
          })}
          {tickets.length === 0 && (
            <li className={card}>
              {current.id === "active" ? (
                <EmptyState icon="🎉" title="No open tickets">Nothing waiting on your team right now.</EmptyState>
              ) : (
                <EmptyState icon="🎫" title="No tickets here yet" />
              )}
            </li>
          )}
        </ul>

        <KnowledgeForm current={settings.knowledgeBase} agentName={business.agent_name} />
      </div>
    </main>
  );
}
