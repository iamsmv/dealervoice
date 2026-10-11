"use client";

import { useActionState, useState } from "react";
import { cancelAppointment, rescheduleAppointment, type AppointmentActionState } from "./actions";

// Reschedule / Cancel buttons for one upcoming appointment.
export function AppointmentControls({ bookingId }: { bookingId: string }) {
  const [mode, setMode] = useState<"idle" | "reschedule" | "cancel">("idle");
  const [rescheduleState, reschedule, rescheduling] = useActionState<AppointmentActionState, FormData>(
    async (prev, form) => {
      const result = await rescheduleAppointment(prev, form);
      if (result.ok) setMode("idle");
      return result;
    },
    {},
  );
  const [cancelState, cancel, cancelling] = useActionState<AppointmentActionState, FormData>(cancelAppointment, {});
  const error = mode === "reschedule" ? rescheduleState.error : mode === "cancel" ? cancelState.error : undefined;

  if (mode === "reschedule") {
    return (
      <form action={reschedule} className="flex flex-wrap items-center justify-end gap-2">
        <input type="hidden" name="booking_id" value={bookingId} />
        <input type="datetime-local" name="start" required step={1800} className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
        <button disabled={rescheduling} className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
          {rescheduling ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setMode("idle")} className="px-1 text-xs text-slate-500">Back</button>
        {error && <p className="w-full text-right text-xs text-red-600">{error}</p>}
      </form>
    );
  }

  if (mode === "cancel") {
    return (
      <form action={cancel} className="flex flex-wrap items-center justify-end gap-2">
        <input type="hidden" name="booking_id" value={bookingId} />
        <span className="text-xs text-slate-600">Cancel this appointment?</span>
        <button disabled={cancelling} className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
          {cancelling ? "Cancelling…" : "Yes, cancel"}
        </button>
        <button type="button" onClick={() => setMode("idle")} className="px-1 text-xs text-slate-500">Keep</button>
        {error && <p className="w-full text-right text-xs text-red-600">{error}</p>}
      </form>
    );
  }

  return (
    <div className="flex justify-end gap-2">
      <button onClick={() => setMode("reschedule")} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
        Reschedule
      </button>
      <button onClick={() => setMode("cancel")} className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
        Cancel
      </button>
    </div>
  );
}
