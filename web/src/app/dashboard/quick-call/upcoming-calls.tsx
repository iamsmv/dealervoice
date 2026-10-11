"use client";

import { useState, useTransition } from "react";
import { cancelUpcomingCallAction } from "./actions";
import type { UpcomingCall } from "@/lib/upcoming-calls";

const toneClass = {
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
};

// Calls that will still ring someone: the owner can see them and cancel a mistake before it happens.
export function UpcomingCalls({ calls }: { calls: UpcomingCall[] }) {
  return (
    <section className="rounded-2xl bg-white ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="font-semibold text-slate-900">Upcoming &amp; retrying calls</h2>
          <p className="text-xs text-slate-500">Quick calls and website-form callbacks that haven&apos;t finished. Cancel one if it was a mistake.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-semibold tabular-nums text-slate-700">{calls.length}</span>
      </div>
      {calls.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-slate-500">Nothing waiting. Finished calls appear in Calls.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {calls.map((c) => <Row key={c.id} call={c} />)}
        </ul>
      )}
    </section>
  );
}

function Row({ call }: { call: UpcomingCall }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-slate-900">{call.who}{call.phone && <span className="ml-2 text-sm font-normal text-slate-500">{call.phone}</span>}</p>
        <p className="mt-0.5 text-xs text-slate-500">{call.type}</p>
        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${toneClass[call.tone]}`}>{call.status}</span>
        {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
      {confirming ? (
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-slate-600">Cancel this call?</span>
          <button
            disabled={pending}
            onClick={() => start(async () => { const r = await cancelUpcomingCallAction(call.id); if (r.error) { setError(r.error); setConfirming(false); } })}
            className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {pending ? "Cancelling…" : "Yes, cancel"}
          </button>
          <button onClick={() => setConfirming(false)} className="text-xs text-slate-500">Keep</button>
        </span>
      ) : (
        <button onClick={() => setConfirming(true)} className="shrink-0 rounded-md px-3 py-1 text-xs font-medium text-red-600 ring-1 ring-red-200 hover:bg-red-50">
          ✖ Cancel
        </button>
      )}
    </li>
  );
}
