"use client";

import { useActionState } from "react";
import { createBusiness, type OnboardingState } from "./actions";

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-indigo-500";

function Field(props: { label: string; name: string; hint?: string; defaultValue?: string; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{props.label}</span>
      <input
        name={props.name}
        type={props.type ?? "text"}
        required={props.required}
        defaultValue={props.defaultValue}
        placeholder={props.placeholder}
        className={inputClass}
      />
      {props.hint && <span className="mt-1 block text-xs text-slate-500">{props.hint}</span>}
    </label>
  );
}

export function OnboardingForm() {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(createBusiness, {});

  return (
    <form action={action} className="space-y-8">
      <section className="space-y-4 rounded-2xl bg-white p-6 ring-1 ring-slate-200">
        <h2 className="font-semibold text-slate-900">Your dealership</h2>
        <Field label="Dealership name" name="name" required placeholder="Prime Motors" />
        <Field label="City" name="city" required placeholder="Bangalore" />
        <Field label="Brands and models you sell" name="brands" required placeholder="Tata: Nexon, Punch, Harrier, Safari" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Showroom hours" name="showroom_hours" defaultValue="Mon–Sat, 9:30 AM – 7 PM" />
          <Field label="Service centre hours" name="service_hours" defaultValue="Mon–Sat, 9 AM – 6 PM" />
        </div>
        <Field label="Receptionist name" name="agent_name" defaultValue="Maya" />
      </section>

      <section className="space-y-4 rounded-2xl bg-white p-6 ring-1 ring-slate-200">
        <h2 className="font-semibold text-slate-900">Connect your calendar (Cal.com)</h2>
        <Field label="Event ID" name="cal_event_type_id" required placeholder="7354937"
          hint="Open your Test Drive event in Cal.com — it's the number in the address bar after /event-types/." />
        <Field label="Cal.com API key" name="cal_api_key" type="password" required placeholder="cal_live_…"
          hint="Cal.com → Settings → Developer → API Keys. Stored securely; never shown again." />
      </section>

      {state.error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}

      <button disabled={pending} className="w-full rounded-lg bg-indigo-600 py-3 font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
        {pending ? "Creating your AI receptionist…" : "Create my AI receptionist"}
      </button>
    </form>
  );
}
