"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { quickCallAction, type QuickCallState } from "./actions";

type Kind = "follow_up" | "marketing" | "payments";
type Lead = { name: string; phone: string; car: string };

const KINDS: { id: Kind; label: string; hint: string }[] = [
  { id: "follow_up", label: "Follow-up", hint: "Checks in about their enquiry and offers a test drive." },
  { id: "marketing", label: "📣 Marketing offer", hint: "Tells them your offer, exactly as you type it. Books a test drive if they're interested." },
  { id: "payments", label: "💰 Payment reminder", hint: "Confirms it's the right person before mentioning money. Never asks for card or bank details. 9 AM – 7 PM only." },
];

const input = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const label = "block text-sm font-medium text-slate-700";

export function QuickCallForm({ agentName, leads }: { agentName: string; leads: Lead[] }) {
  const [state, action, pending] = useActionState<QuickCallState, FormData>(quickCallAction, {});
  const [kind, setKind] = useState<Kind>((state.values?.kind as Kind) ?? "follow_up");
  const [confirming, setConfirming] = useState<FormData | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const v = state.values ?? {};

  // Picking a lead from the list fills in their name, number and car.
  function pickLead(phone: string) {
    const lead = leads.find((l) => l.phone === phone);
    const f = formRef.current;
    if (!lead || !f) return;
    (f.elements.namedItem("name") as HTMLInputElement).value = lead.name;
    (f.elements.namedItem("phone") as HTMLInputElement).value = lead.phone;
    const car = f.elements.namedItem("car") as HTMLInputElement | null;
    if (car) car.value = lead.car;
  }

  return (
    <form
      ref={formRef}
      key={JSON.stringify(v)}
      onSubmit={(e) => {
        e.preventDefault();
        setConfirming(new FormData(e.currentTarget));
      }}
      className="space-y-5 rounded-2xl bg-white p-5 ring-1 ring-slate-200"
    >
      <input type="hidden" name="kind" value={kind} />
      <div>
        <p className={label}>Type of call</p>
        <div className="mt-2 inline-flex flex-wrap rounded-lg bg-slate-100 p-1 text-sm">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              aria-pressed={kind === k.id}
              onClick={() => setKind(k.id)}
              className={`rounded-md px-3 py-1.5 font-medium ${kind === k.id ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600"}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">{KINDS.find((k) => k.id === kind)?.hint}</p>
      </div>

      {leads.length > 0 && kind !== "payments" && (
        <label className={label}>
          Pick from your leads <span className="font-normal text-slate-500">(optional)</span>
          <select defaultValue="" onChange={(e) => pickLead(e.target.value)} className={input}>
            <option value="">— or type the details below —</option>
            {leads.map((l) => <option key={l.phone} value={l.phone}>{l.name || "Unknown"} · {l.phone}{l.car ? ` · ${l.car}` : ""}</option>)}
          </select>
        </label>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>Name<input name="name" required defaultValue={v.name} placeholder="e.g. Ravi Kumar" className={input} /></label>
        <label className={label}>Mobile number<input name="phone" required inputMode="tel" defaultValue={v.phone} placeholder="e.g. 98765 43210" className={input} /></label>
        {kind !== "payments" && (
          <label className={label}>Car <span className="font-normal text-slate-500">(optional)</span><input name="car" defaultValue={v.car} placeholder="e.g. Nexon" className={input} /></label>
        )}
      </div>

      {kind === "marketing" && (
        <label className={label}>
          What&apos;s the offer?
          <textarea name="offer" required minLength={10} maxLength={300} rows={2} defaultValue={v.offer} placeholder="e.g. Diwali offer: free accessories worth ₹15,000 on every Nexon booked before 31 October." className={input} />
        </label>
      )}

      {kind === "payments" && (
        <div className="grid gap-4 sm:grid-cols-3">
          <label className={label}>Amount due (₹)<input name="amount" required inputMode="decimal" defaultValue={v.amount} placeholder="12500" className={input} /></label>
          <label className={label}>Due date<input type="date" name="due_date" required defaultValue={v.due_date} className={input} /></label>
          <label className={label}>Reference <span className="font-normal text-slate-500">(optional)</span><input name="reference" defaultValue={v.reference} placeholder="EMI-0042" className={input} /></label>
        </div>
      )}

      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.ok && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 ring-1 ring-emerald-200">✅ {state.ok}</p>}

      {confirming ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-indigo-50 p-3 ring-1 ring-indigo-100">
          <span className="text-sm text-slate-800">
            {agentName} will call <b>{String(confirming.get("name"))}</b> at <b>{String(confirming.get("phone"))}</b> — now, or at 9 AM if it&apos;s outside calling hours. This is a real call; you can cancel it from the list above until it rings.
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const data = confirming;
              setConfirming(null);
              startTransition(() => action(data));
            }}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Yes, call now
          </button>
          <button type="button" onClick={() => setConfirming(null)} className="text-sm text-slate-600">Cancel</button>
        </div>
      ) : (
        <button disabled={pending} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
          {pending ? "Placing the call…" : "📞 Call now"}
        </button>
      )}
      <p className="text-xs text-slate-500">If they don&apos;t answer, {agentName} tries once more about 15 minutes after the first ring. Outside calling hours, the first ring waits until 9 AM. Results appear in Calls.</p>
    </form>
  );
}
