"use client";

import { useActionState } from "react";
import { submitWebForm, type WebFormState } from "./actions";

export function TestDriveForm({ businessId, dealershipName, agentName, brands }: {
  businessId: string;
  dealershipName: string;
  agentName: string;
  brands: string | null;
}) {
  const [state, formAction, pending] = useActionState<WebFormState, FormData>(submitWebForm, {});

  if (state.done === "calling") {
    return (
      <div role="status" className="text-center">
        <p aria-hidden="true" className="text-4xl">📞</p>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">Thanks! We&apos;re calling you now.</h2>
        <p className="mt-1 text-sm text-slate-600">
          {agentName} from {dealershipName} will ring you in a moment to fix a time for your test drive.
        </p>
      </div>
    );
  }
  if (state.done === "later") {
    return (
      <div role="status" className="text-center">
        <p aria-hidden="true" className="text-4xl">✅</p>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">Thanks, we&apos;ve got your request.</h2>
        <p className="mt-1 text-sm text-slate-600">The {dealershipName} team will call you during opening hours.</p>
      </div>
    );
  }

  const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-indigo-500";
  return (
    <form key={JSON.stringify(state.values ?? {})} action={formAction} className="space-y-3">
      <input type="hidden" name="business_id" value={businessId} />
      {/* Spam trap: hidden from people, bots fill it in. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

      <label className="block text-sm font-medium text-slate-700">
        Your name *
        <input name="name" required defaultValue={state.values?.name} autoComplete="name" className={`mt-1 ${input}`} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Mobile number *
        <input name="phone" required type="tel" inputMode="tel" defaultValue={state.values?.phone} autoComplete="tel" placeholder="98765 43210" className={`mt-1 ${input}`} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Which car?
        <input name="car_interest" defaultValue={state.values?.car_interest} placeholder={brands ? `e.g. ${brands.split(":").pop()?.split(",")[0]?.trim()}` : "e.g. Nexon"} className={`mt-1 ${input}`} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Email (optional)
        <input name="email" type="email" defaultValue={state.values?.email} autoComplete="email" className={`mt-1 ${input}`} />
      </label>
      <label className="flex items-start gap-2 text-sm text-slate-600">
        <input name="consent" type="checkbox" required className="mt-1 h-4 w-4 shrink-0 accent-indigo-600" />
        <span>I agree to get a call from {dealershipName} (answered by our AI assistant) about my test drive.</span>
      </label>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50">
        {pending ? "Sending…" : "Book my test drive"}
      </button>
    </form>
  );
}
