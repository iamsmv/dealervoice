"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { addLead, callLead, updateLeadStage, type AddLeadState, type CallLeadState } from "./actions";

type Option = { id: string; label: string };

export function StageSelect({ leadId, stage, stages }: { leadId: string; stage: string; stages: readonly Option[] }) {
  const [pending, startTransition] = useTransition();
  return (
    <select
      defaultValue={stage}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        startTransition(() => updateLeadStage(leadId, next));
      }}
      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
    >
      {stages.map((s) => (
        <option key={s.id} value={s.id}>{s.label}</option>
      ))}
    </select>
  );
}

export function AddLeadButton() {
  const [open, setOpen] = useState(false);
  // Closes the form once the lead is saved (React clears the fields after the action).
  const [state, formAction, pending] = useActionState<AddLeadState, FormData>(async (prev, form) => {
    const result = await addLead(prev, form);
    if (result.ok) setOpen(false);
    return result;
  }, {});

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
        + Add lead
      </button>
    );
  }

  const input = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
  return (
    <form key={JSON.stringify(state.values ?? {})} action={formAction} className="grid w-full gap-2 rounded-2xl bg-white p-4 ring-1 ring-slate-200 sm:grid-cols-2">
      <input name="name" defaultValue={state.values?.name} placeholder="Customer name *" required className={input} />
      <input name="phone" defaultValue={state.values?.phone} placeholder="Phone * e.g. 98765 43210" required className={input} />
      <input name="email" defaultValue={state.values?.email} type="email" placeholder="Email" className={input} />
      <input name="car_interest" defaultValue={state.values?.car_interest} placeholder="Interested in (e.g. Nexon EV)" className={input} />
      {state.error && <p className="text-sm text-red-600 sm:col-span-2">{state.error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <button disabled={pending} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
          {pending ? "Saving…" : "Save lead"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
          Cancel
        </button>
      </div>
    </form>
  );
}

// "Call" button: the AI receptionist phones this lead now. Asks for confirmation first,
// because it places a real (paid) phone call.
export function CallLeadButton({ leadId, label }: { leadId: string; label: string }) {
  const [confirming, setConfirming] = useState(false);
  // We only know the call was *started*; how it went shows up on the Calls page.
  const [justStarted, setJustStarted] = useState(false);
  const [state, formAction, pending] = useActionState<CallLeadState, FormData>(async (prev, form) => {
    const result = await callLead(prev, form);
    if (result.ok) {
      setConfirming(false); // on error, stay open so the message is visible
      setJustStarted(true);
      setTimeout(() => setJustStarted(false), 8000);
    }
    return result;
  }, {});

  if (justStarted) {
    return (
      <Link href="/dashboard/calls" className="whitespace-nowrap text-xs text-emerald-700 hover:underline">
        ✓ Call started — see Calls
      </Link>
    );
  }

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} title={`Have the receptionist call ${label}`} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
        📞 Call
      </button>
    );
  }
  return (
    <form action={formAction} className="flex items-center gap-1">
      <input type="hidden" name="lead_id" value={leadId} />
      <button disabled={pending} className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
        {pending ? "Dialling…" : `Call ${label}?`}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="px-1 text-xs text-slate-500">✕</button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
