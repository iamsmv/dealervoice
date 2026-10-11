"use client";

import { useOptimistic, useTransition } from "react";
import { setPlanAction } from "./actions";

const tone: Record<string, string> = {
  trial: "text-slate-700",
  starter: "text-indigo-700",
  pro: "text-emerald-700",
  paused: "text-red-700",
};

export function PlanSelect({ businessId, plan, plans }: { businessId: string; plan: string; plans: readonly { id: string; label: string }[] }) {
  const [optimistic, setOptimistic] = useOptimistic(plan);
  const [pending, startTransition] = useTransition();
  return (
    <select
      aria-label="Plan"
      value={optimistic}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        if (next === "paused" && !confirm("Pause this dealership? They won't be able to use the dashboard or place outbound calls.")) return;
        startTransition(async () => {
          setOptimistic(next);
          await setPlanAction(businessId, next);
        });
      }}
      className={`rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium ${tone[optimistic] ?? ""}`}
    >
      {plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
    </select>
  );
}
