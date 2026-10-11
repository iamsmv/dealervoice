"use client";

import { useOptimistic, useTransition } from "react";
import { setExtraAgentsAction } from "./actions";

// On/off switch for the extra agents (marketing campaigns etc.) for one dealership.
export function ExtraAgentsToggle({ businessId, enabled }: { businessId: string; enabled: boolean }) {
  const [on, setOn] = useOptimistic(enabled);
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Extra agents"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          setOn(!on);
          await setExtraAgentsAction(businessId, !on);
        })
      }
      className={`rounded-full px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${on ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-slate-100 text-slate-500"}`}
    >
      {on ? "On" : "Off"}
    </button>
  );
}
