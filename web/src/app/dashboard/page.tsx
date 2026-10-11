import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWidgetScriptUrl } from "@/lib/dograh";
import { TalkWidget } from "./talk-widget";
import { Badge, EmptyState, card } from "./ui";
import { displayAgentName } from "@/lib/elevenlabs";

const QUICK_LINKS = [
  { href: "/dashboard/leads", icon: "👥", label: "Leads", hint: "Everyone who called" },
  { href: "/dashboard/calls", icon: "📞", label: "Calls", hint: "Recordings & transcripts" },
  { href: "/dashboard/campaigns", icon: "📣", label: "Campaigns", hint: "Call a list of leads" },
  { href: "/dashboard/forms", icon: "📝", label: "Forms", hint: "Test-drive form link" },
];

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  const { data: business } = await supabase.from("businesses").select("*").maybeSingle();

  if (!business) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-4xl">
          <p className="text-sm text-slate-500">Signed in as {data.claims.email as string}</p>
          <h1 className="mt-1 text-3xl font-bold text-slate-900">Welcome to DealerVoice</h1>
          <div className="mt-8 rounded-2xl bg-white p-6 ring-1 ring-slate-200">
            <h2 className="text-lg font-semibold text-slate-900">Set up your AI receptionist</h2>
            <p className="mt-1 text-sm text-slate-500">Tell us about your dealership and connect your calendar.</p>
            <Link href="/dashboard/onboarding" className="mt-4 inline-block rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-500">
              Start setup
            </Link>
          </div>
        </div>
      </main>
    );
  }
  business.agent_name = await displayAgentName(business);

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, attendee_name, attendee_phone, start_time, status, error, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  let widgetSrc: string | null = null;
  if (business.dograh_workflow_id) {
    widgetSrc = await getWidgetScriptUrl(Number(business.dograh_workflow_id)).catch(() => null);
  }

  return (
    <main className="px-4 py-8 md:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <p className="text-sm text-slate-500">Signed in as {data.claims.email as string}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">{business.name}</h1>
          <p className="mt-1 text-slate-600">{[business.city, business.brands].filter(Boolean).join(" · ")}</p>
        </div>

        <section className={`${card} flex flex-col gap-4 p-6 sm:flex-row sm:items-center`}>
          <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-3xl">🎙️</span>
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-900">
              Your AI receptionist: {business.agent_name}
              {business.dograh_workflow_id ? <Badge tone="emerald" dot>Live</Badge> : <Badge tone="amber" dot>Setting up</Badge>}
            </h2>
            {business.dograh_workflow_id ? (
              <p className="mt-1 text-sm text-slate-600">
                Live and ready. Use the call button in the corner of this page to talk to {business.agent_name} from your browser.
              </p>
            ) : (
              <p className="mt-1 text-sm text-amber-700">Your agent is still being created. Refresh in a minute.</p>
            )}
          </div>
        </section>

        <nav aria-label="Quick links" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {QUICK_LINKS.map((q) => (
            <Link key={q.href} href={q.href} className={`${card} group p-4 transition hover:-translate-y-0.5 hover:ring-indigo-300`}>
              <span aria-hidden="true" className="text-2xl">{q.icon}</span>
              <p className="mt-2 font-semibold text-slate-900 group-hover:text-indigo-700">{q.label}</p>
              <p className="text-xs text-slate-500">{q.hint}</p>
            </Link>
          ))}
        </nav>

        <section className={card}>
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-6 py-4">
            <h2 className="font-semibold text-slate-900">Recent bookings</h2>
            <Link href="/dashboard/appointments" className="text-sm font-medium text-indigo-600 hover:underline">All appointments →</Link>
          </div>
          {bookings && bookings.length > 0 ? (
            <ul className="divide-y divide-slate-100 px-6">
              {bookings.map((b) => (
                <li key={b.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{b.attendee_name}</p>
                    <p className="text-sm text-slate-500">{b.attendee_phone}</p>
                  </div>
                  <div className="text-sm sm:text-right">
                    {b.status === "booked" ? (
                      <p className="text-slate-900">📅 {b.start_time ? dateFormat.format(new Date(b.start_time)) : "—"}</p>
                    ) : (
                      <Badge tone="red" title={b.error ?? ""}>Failed – team should call back</Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="📅" title="No bookings yet">
              They&apos;ll appear here as {business.agent_name} books them.
            </EmptyState>
          )}
        </section>
      </div>
      {widgetSrc && <TalkWidget src={widgetSrc} />}
    </main>
  );
}
