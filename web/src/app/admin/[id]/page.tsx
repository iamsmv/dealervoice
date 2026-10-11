import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { listBusinessCalls } from "@/lib/agent-roles";
import { withBusinessDograh } from "@/lib/dograh-key";
import { STAGES } from "@/lib/leads";
import { PLANS } from "@/lib/admin-auth";
import { formatDateTime, formatDuration, formatOutcome, formatPhone } from "@/lib/format";

// Read-only support view of one dealership: what they see, without being able to change anything.
export default async function AdminDealershipPage({ params }: PageProps<"/admin/[id]">) {
  const { id } = await params;
  const db = createAdminClient();
  const { data: business } = await db
    .from("businesses")
    .select("id, name, city, brands, showroom_hours, service_hours, agent_name, plan, dograh_workflow_id, cal_event_type_id, webhook_url, owner_id")
    .eq("id", id)
    .maybeSingle();
  if (!business) notFound();

  const [{ data: owner }, { data: leads }, { data: bookings }, calls] = await Promise.all([
    db.auth.admin.getUserById(business.owner_id),
    db.from("leads").select("id, name, phone, stage, source, car_interest, last_contact_at").eq("business_id", id).order("created_at", { ascending: false }).limit(20),
    db.from("bookings").select("id, attendee_name, attendee_phone, start_time, status").eq("business_id", id).order("start_time", { ascending: false }).limit(10),
    business.dograh_workflow_id ? withBusinessDograh(business.id, () => listBusinessCalls(business, 20)).catch(() => null) : Promise.resolve([]),
  ]);
  const stageLabel = (s: string) => STAGES.find((x) => x.id === s)?.label ?? s;

  const card = "rounded-2xl bg-white shadow-sm ring-1 ring-slate-200";
  const th = "px-4 py-2 font-medium";
  const td = "px-4 py-2";

  return (
    <main className="px-4 py-6 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          <span>👁 Viewing as <b>{business.name}</b> — read-only support view</span>
          <Link href="/admin" className="font-medium underline">Exit</Link>
        </div>

        <section className={`${card} grid gap-4 p-5 sm:grid-cols-2`}>
          <div>
            <h1 className="text-xl font-bold text-slate-900">{business.name}</h1>
            <p className="text-sm text-slate-500">{business.city} · Receptionist {business.agent_name} · Plan <b>{PLANS.find((p) => p.id === business.plan)?.label ?? business.plan}</b></p>
            <p className="mt-2 text-sm text-slate-700">Dealer login: {owner?.user?.email ?? "—"}</p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-slate-500">Brands</dt><dd className="text-slate-900">{business.brands}</dd>
            <dt className="text-slate-500">Showroom</dt><dd className="text-slate-900">{business.showroom_hours}</dd>
            <dt className="text-slate-500">Service</dt><dd className="text-slate-900">{business.service_hours}</dd>
            <dt className="text-slate-500">Dograh agent</dt><dd className="text-slate-900">{business.dograh_workflow_id ?? "not created"}</dd>
            <dt className="text-slate-500">Cal.com event</dt><dd className="text-slate-900">{business.cal_event_type_id ?? "not set"}</dd>
            <dt className="text-slate-500">Webhook</dt><dd className="min-w-0 truncate text-slate-900">{business.webhook_url ?? "off"}</dd>
          </dl>
        </section>

        <section className={card}>
          <h2 className="px-4 pt-4 font-semibold text-slate-900">Recent calls</h2>
          {calls === null && <p className="px-4 py-3 text-sm text-amber-700">Couldn&apos;t load calls from Dograh.</p>}
          <div className="relative overflow-x-auto">
            <table className="mt-2 w-full min-w-[600px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr><th className={th}>When</th><th className={th}>Customer</th><th className={th}>Direction</th><th className={th}>Outcome</th><th className={`${th} text-right`}>Duration</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {(calls ?? []).map((c) => (
                  <tr key={c.id}>
                    <td className={`${td} whitespace-nowrap`}>{formatDateTime(c.startedAt)}</td>
                    <td className={`${td} whitespace-nowrap`}>{c.channel === "web" ? "Browser" : formatPhone(c.customerNumber)}</td>
                    <td className={td}>{c.direction}</td>
                    <td className={td}>{formatOutcome(c.outcome)}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatDuration(c.durationSeconds)}</td>
                  </tr>
                ))}
                {calls?.length === 0 && <tr><td colSpan={5} className={`${td} py-6 text-center text-slate-500`}>No calls yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className={card}>
            <h2 className="px-4 pt-4 font-semibold text-slate-900">Latest leads</h2>
            <ul className="mt-2 divide-y divide-slate-100 text-sm">
              {(leads ?? []).map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-slate-900">{l.name ?? "Unknown caller"}</span>
                    <span className="text-xs text-slate-500">{formatPhone(l.phone)}{l.car_interest ? ` · ${l.car_interest}` : ""}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{stageLabel(l.stage)}</span>
                </li>
              ))}
              {!leads?.length && <li className="px-4 py-6 text-center text-slate-500">No leads yet.</li>}
            </ul>
          </section>

          <section className={card}>
            <h2 className="px-4 pt-4 font-semibold text-slate-900">Bookings</h2>
            <ul className="mt-2 divide-y divide-slate-100 text-sm">
              {(bookings ?? []).map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-slate-900">{b.attendee_name ?? "—"}</span>
                    <span className="text-xs text-slate-500">{formatDateTime(b.start_time)}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${b.status === "booked" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{b.status}</span>
                </li>
              ))}
              {!bookings?.length && <li className="px-4 py-6 text-center text-slate-500">No bookings yet.</li>}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
