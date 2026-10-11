import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listCampaigns, type Campaign } from "@/lib/dograh";
import { SOURCES, STAGES } from "@/lib/leads";
import { formatDateTime } from "@/lib/format";
import { CallBackButton, CampaignButtons, NewCampaignForm, RemoveCampaignButton } from "./campaign-controls";
import { AutoRefresh } from "../auto-refresh";
import { EmptyState, Notice, PageHeader, card } from "../ui";
import { businessWorkflowIds, extraAgentsEnabled, listRoleAgents } from "@/lib/agent-roles";
import { ROLE_LABELS } from "@/lib/role-prompts";
import { voiceProvider } from "@/lib/elevenlabs";
import { asCampaign, listElevenLabsCampaigns } from "@/lib/elevenlabs-calls";
import { displayAgentName } from "@/lib/elevenlabs";

const stateBadge: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-200",
  created: "bg-slate-100 text-slate-700 ring-slate-200",
  running: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  paused: "bg-amber-50 text-amber-800 ring-amber-200",
  completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
};

// Green = finished; amber = everyone called once but retries still pending; indigo = calling.
function barColour(state: string, processed: number, total: number) {
  if (state === "completed") return "bg-emerald-500";
  if (total > 0 && processed >= total) return "bg-amber-400";
  return "bg-indigo-500";
}

export default async function CampaignsPage() {
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id, agent_name, dograh_workflow_id").maybeSingle();
  if (!business) redirect("/dashboard");
  business.agent_name = await displayAgentName(business);

  const [workflowIds, roleAgents, marketing] = await Promise.all([
    businessWorkflowIds(business),
    listRoleAgents(business.id),
    extraAgentsEnabled(business.id),
  ]);
  const roleOf = new Map(roleAgents.map((a) => [a.workflowId, `${a.role === "payments" ? "💰" : "📣"} ${ROLE_LABELS[a.role]}`]));

  let campaigns: Campaign[] = [];
  let loadError = false;
  const voice = await voiceProvider(business.id).catch(() => ({ provider: "dograh" as const }));
  const elRoles = new Map<number, string>();
  if (voice.provider === "elevenlabs") {
    try {
      campaigns = (await listElevenLabsCampaigns(business.id, ["campaign"])).map((row) => {
        const c = asCampaign(row);
        if (c.role !== "follow_up") elRoles.set(c.id, `${c.role === "payments" ? "💰" : "📣"} ${ROLE_LABELS[c.role]}`);
        return c;
      });
    } catch (err) {
      console.error(err);
      loadError = true;
    }
  } else if (workflowIds.length) {
    campaigns = await listCampaigns(workflowIds).catch((err) => {
      console.error(err);
      loadError = true;
      return [];
    });
  }

  // How many callable leads sit in each stage, shown next to the stage checkboxes.
  const { data: leads } = await supabase.from("leads").select("stage").not("phone", "is", null);
  const counts: Record<string, number> = {};
  for (const l of leads ?? []) counts[l.stage] = (counts[l.stage] ?? 0) + 1;

  return (
    <main className="px-4 py-8 md:px-8">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title="Campaigns"
          count={campaigns.length}
          description={<>{business.agent_name} calls a list of your leads for you — great for following up enquiries that went quiet.</>}
          actions={<NewCampaignForm stages={STAGES} sources={SOURCES} counts={counts} marketing={marketing} />}
        />

        {campaigns.some((c) => c.state === "running") && (
          <div className="mt-4">
            <AutoRefresh />
          </div>
        )}

        {loadError && <div className="mt-4"><Notice>Couldn&apos;t load campaigns right now. Please refresh.</Notice></div>}

        <ul className="mt-6 space-y-3">
          {campaigns.map((c) => {
            const total = c.total_rows ?? 0;
            // Dograh counts retries as extra processed rows, so cap at the list size.
            const called = Math.min(c.processed_rows, total);
            const pct = total ? Math.round((called / total) * 100) : 0;
            return (
              <li key={c.id} className={`${card} p-4 sm:p-5`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                      <span className="break-words">{c.name}</span>
                      {(elRoles.get(c.id) ?? roleOf.get(c.workflow_id)) && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-200">{elRoles.get(c.id) ?? roleOf.get(c.workflow_id)}</span>}
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${stateBadge[c.state] ?? stateBadge.draft}`}>
                        {c.state === "running" && <span aria-hidden="true" className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current align-middle" />}
                        {c.state === "created" || c.state === "draft" ? "not started" : c.state}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Created {formatDateTime(c.created_at)}
                      {c.started_at && ` · started ${formatDateTime(c.started_at)}`}
                      {c.completed_at && ` · finished ${formatDateTime(c.completed_at)}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CampaignButtons id={c.id} state={c.state} total={total} />
                    {c.state !== "running" && <RemoveCampaignButton id={c.id} />}
                  </div>
                </div>
                {c.state === "completed" && (
                  <div className="mt-3">
                    {c.redialed_campaign_id ? (
                      <p className="text-xs text-slate-500">🔁 A call-back list was made from this campaign (see &ldquo;{c.name} – call back&rdquo;).</p>
                    ) : (
                      !c.parent_campaign_id && <CallBackButton id={c.id} />
                    )}
                  </div>
                )}
                <div className="mt-3">
                  <div
                    role="progressbar"
                    aria-label={`${c.name} progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                    className="h-2.5 overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200"
                  >
                    <div className={`h-full rounded-full transition-all ${barColour(c.state, c.processed_rows, total)}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">
                    <b className="font-semibold tabular-nums text-slate-800">{called} of {total}</b> called{c.failed_rows ? ` · ${c.failed_rows} failed` : ""}
                    {total > 0 && called >= total && c.state !== "completed"
                      ? c.state === "paused"
                        ? " · retries for anyone who didn't answer are on hold — press Resume to allow them"
                        : " · waiting to retry anyone who didn't answer (about 30 min after their first call)"
                      : " · results appear in Calls and Leads"}
                  </p>
                </div>
              </li>
            );
          })}
          {campaigns.length === 0 && !loadError && (
            <li className={card}>
              <EmptyState icon="📣" title="No campaigns yet">Create one to have your receptionist call a list of leads.</EmptyState>
            </li>
          )}
        </ul>
      </div>
    </main>
  );
}
