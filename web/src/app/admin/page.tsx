import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { type Call } from "@/lib/dograh";
import { listBusinessCalls } from "@/lib/agent-roles";
import { withBusinessDograh } from "@/lib/dograh-key";
import { PLANS } from "@/lib/admin-auth";
import { formatDateTime } from "@/lib/format";
import { PlanSelect } from "./plan-select";
import { ExtraAgentsToggle } from "./extra-agents-toggle";

// Calls and minutes in the current calendar month (India time is close enough for a usage view).
function monthUsage(calls: Call[]) {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const thisMonth = calls.filter((c) => new Date(c.startedAt) >= start);
  return { calls: thisMonth.length, minutes: Math.ceil(thisMonth.reduce((s, c) => s + c.durationSeconds, 0) / 60) };
}

export default async function AdminPage() {
  const db = createAdminClient();
  const [{ data: businesses }, { data: users }, { data: leads }, { data: features }] = await Promise.all([
    db.from("businesses").select("id, name, city, plan, owner_id, agent_name, dograh_workflow_id, created_at").order("created_at", { ascending: false }),
    db.auth.admin.listUsers({ perPage: 1000 }),
    db.from("leads").select("business_id"),
    db.from("business_features").select("business_id, extra_agents"),
  ]);
  const extraOn = new Set((features ?? []).filter((f) => f.extra_agents).map((f) => f.business_id));

  const emailById = new Map(users?.users.map((u) => [u.id, u.email ?? "—"]));
  const leadCount: Record<string, number> = {};
  for (const l of leads ?? []) leadCount[l.business_id] = (leadCount[l.business_id] ?? 0) + 1;

  const rows = await Promise.all(
    (businesses ?? []).map(async (b) => {
      const calls = b.dograh_workflow_id ? await withBusinessDograh(b.id, () => listBusinessCalls(b, 100)).catch(() => null) : [];
      return { ...b, usage: calls ? monthUsage(calls) : null };
    }),
  );

  const totals = rows.reduce((t, r) => ({ calls: t.calls + (r.usage?.calls ?? 0), minutes: t.minutes + (r.usage?.minutes ?? 0) }), { calls: 0, minutes: 0 });
  const paying = rows.filter((r) => r.plan === "starter" || r.plan === "pro").length;

  return (
    <main className="px-4 py-8 md:px-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dealerships</h1>
        <p className="mt-1 text-sm text-slate-600">Every dealership on DealerVoice, their plan and this month&apos;s usage.</p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Dealerships", rows.length],
            ["Paying", paying],
            ["Calls this month", totals.calls],
            ["Minutes this month", totals.minutes],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</p>
            </div>
          ))}
        </div>

        <div className="relative mt-6 overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Dealership</th>
                <th className="px-4 py-3 font-medium">Dealer login</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium" title="Marketing campaigns and other client features">Extra agents</th>
                <th className="px-4 py-3 text-right font-medium">Calls (month)</th>
                <th className="px-4 py-3 text-right font-medium">Minutes</th>
                <th className="px-4 py-3 text-right font-medium">Leads</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{r.name}</p>
                    <p className="text-xs text-slate-500">{r.city} · {r.agent_name}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{emailById.get(r.owner_id) ?? "—"}</td>
                  <td className="px-4 py-3"><PlanSelect businessId={r.id} plan={r.plan} plans={PLANS} /></td>
                  <td className="px-4 py-3"><ExtraAgentsToggle businessId={r.id} enabled={extraOn.has(r.id)} /></td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{r.usage?.calls ?? "?"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{r.usage?.minutes ?? "?"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{leadCount[r.id] ?? 0}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{formatDateTime(r.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/admin/${r.id}`} className="whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50">
                      View as customer →
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">No dealerships yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">Usage counts the latest 100 calls per dealership. Billing is manual: invoice the client, then set the plan here.</p>
      </div>
    </main>
  );
}
