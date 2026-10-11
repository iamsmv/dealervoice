"use client";

import { startTransition, useActionState, useOptimistic, useTransition } from "react";
import { saveKnowledgeAction, setTicketStatusAction, type KnowledgeState } from "./actions";

type Option = { id: string; label: string };

export function StatusSelect({ ticketId, status, statuses }: { ticketId: string; status: string; statuses: readonly Option[] }) {
  const [value, setValue] = useOptimistic(status);
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Ticket status"
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        start(async () => {
          setValue(next);
          await setTicketStatusAction(ticketId, next);
        });
      }}
      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
    >
      {statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select>
  );
}

const EXAMPLE = `Service: first free service at 1,000 km or 1 month; then every 10,000 km or 1 year.
Service booking: Mon–Sat 9 AM – 6 PM. Pick-up and drop available within 10 km.
Warranty: 3 years / 1,00,000 km standard. Extended warranty can be bought within 90 days of purchase.
Roadside assistance: free for 3 years — call [your helpline number], 24×7.
Service status: our team calls back with the status; we can't check it live on this call.`;

// The FAQ the receptionist answers support questions from. Kept as plain text so owners can paste from anywhere.
export function KnowledgeForm({ current, agentName }: { current: string; agentName: string }) {
  const [state, action, pending] = useActionState<KnowledgeState, FormData>(saveKnowledgeAction, {});
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="space-y-3 rounded-2xl bg-white p-5 ring-1 ring-slate-200"
    >
      <div>
        <h2 className="font-semibold text-slate-900">Support information</h2>
        <p className="mt-1 text-sm text-slate-500">
          {agentName} answers support questions <b>only</b> from this. Anything not covered here becomes a ticket for your team. Paste your FAQ, service schedule, warranty rules and helpline numbers.
        </p>
      </div>
      <textarea
        name="knowledge"
        defaultValue={current}
        rows={10}
        maxLength={6000}
        placeholder={EXAMPLE}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
      />
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
        {state.ok && !pending && <span className="text-sm text-emerald-700">{state.ok}</span>}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
