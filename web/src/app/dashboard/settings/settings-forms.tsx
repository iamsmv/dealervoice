"use client";

import { useActionState, useState, useTransition } from "react";
import { HoursPicker } from "./hours-picker";
import { saveCalendarAction, saveDetailsAction, saveWebhookAction, testWebhookAction, type SettingsState } from "./actions";

const card = "space-y-4 rounded-2xl bg-white p-5 ring-1 ring-slate-200";
const input = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const button = "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50";

function Message({ state }: { state: SettingsState }) {
  if (state.error) return <p className="text-sm text-red-600">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-emerald-700">✓ {state.ok}</p>;
  return null;
}

function Field({ label, name, defaultValue, hint, ...rest }: { label: string; name: string; defaultValue?: string | number | null; hint?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "defaultValue">) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input name={name} defaultValue={defaultValue ?? ""} className={input} {...rest} />
      {hint && <span className="mt-1 block text-xs font-normal text-slate-500">{hint}</span>}
    </label>
  );
}

type Business = { name: string; city: string | null; brands: string | null; showroom_hours: string | null; service_hours: string | null; agent_name: string };

export function DetailsForm({ business }: { business: Business }) {
  const [state, action, pending] = useActionState(saveDetailsAction, {});
  const [, startTransition] = useTransition();
  // Submitted by hand (not via form action) so React doesn't reset the form afterwards —
  // a reset would jump the hour dropdowns back to their first option.
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => action(form));
  };
  return (
    <form onSubmit={submit} className={card}>
      <div>
        <h2 className="font-semibold text-slate-900">Dealership details</h2>
        <p className="text-xs text-slate-500">{business.agent_name} uses these on every call. Saving updates {business.agent_name} straight away.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Dealership name" name="name" defaultValue={business.name} required maxLength={80} />
        <Field label="City" name="city" defaultValue={business.city} required maxLength={60} />
      </div>
      <Field label="Brands and models you sell" name="brands" defaultValue={business.brands} required maxLength={300} hint="e.g. Tata: Nexon, Punch, Harrier" />
      <div className="grid gap-4 lg:grid-cols-2">
        <HoursPicker label="Showroom hours" name="showroom_hours" defaultValue={business.showroom_hours} />
        <HoursPicker label="Service centre hours" name="service_hours" defaultValue={business.service_hours} />
      </div>
      <Message state={state} />
      <button disabled={pending} className={button}>{pending ? "Saving…" : "Save details"}</button>
    </form>
  );
}

export function CalendarForm({ eventId, keyEnding }: { eventId: number | null; keyEnding: string | null }) {
  const [state, action, pending] = useActionState(saveCalendarAction, {});
  return (
    <form action={action} className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-900">Cal.com calendar</p>
          <p className="text-xs text-slate-500">Where test drives and visits are booked.</p>
        </div>
        {keyEnding && eventId ? (
          <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">● Connected</span>
        ) : (
          <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">○ Needs setup</span>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Event ID" name="cal_event_type_id" defaultValue={eventId} inputMode="numeric" required />
        <Field
          label="API key"
          name="cal_api_key"
          type="password"
          autoComplete="off"
          placeholder={keyEnding ? `•••• ${keyEnding}  (leave empty to keep)` : "cal_live_…"}
          hint="Only type a key to replace the current one. It's stored securely and never shown."
        />
      </div>
      <Message state={state} />
      <button disabled={pending} className={button}>{pending ? "Saving…" : "Save calendar"}</button>
    </form>
  );
}

export function WebhookForm({ url, secret }: { url: string; secret: string | null }) {
  const [state, action, pending] = useActionState(saveWebhookAction, {});
  const [testState, testAction, testing] = useActionState(testWebhookAction, {});
  const [showSecret, setShowSecret] = useState(false);
  return (
    <section className={card}>
      <div>
        <h2 className="font-semibold text-slate-900">Webhook</h2>
        <p className="text-xs text-slate-500">
          Sends new leads, stage changes and bookings to another system you use — your own CRM, or Google Sheets through n8n or Zapier.
        </p>
      </div>
      <form action={action} className="space-y-3">
        <Field label="Webhook URL" name="webhook_url" type="url" defaultValue={url} placeholder="https://your-n8n.example.com/webhook/dealervoice" hint="Leave empty to turn webhooks off." />
        <Message state={state} />
        <button disabled={pending} className={button}>{pending ? "Saving…" : "Save webhook"}</button>
      </form>
      {url && (
        <div className="space-y-3 border-t border-slate-200 pt-4">
          <p className="text-xs text-slate-500">
            Events: <code>lead.created</code>, <code>lead.stage_changed</code>, <code>booking.created</code>. Each request carries an
            <code> X-DealerVoice-Signature</code> header (HMAC-SHA256 of the body with your signing secret) so your system can check it came from us.
          </p>
          {secret && (
            <p className="text-xs text-slate-700">
              Signing secret:{" "}
              <code className="break-all rounded bg-slate-100 px-1.5 py-0.5">{showSecret ? secret : "whsec_••••••••"}</code>{" "}
              <button type="button" onClick={() => setShowSecret((s) => !s)} className="text-indigo-600 hover:underline">
                {showSecret ? "Hide" : "Show"}
              </button>
            </p>
          )}
          <form action={testAction} className="flex flex-wrap items-center gap-3">
            <button disabled={testing} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50">
              {testing ? "Sending…" : "Send test event"}
            </button>
            <Message state={testState} />
          </form>
        </div>
      )}
    </section>
  );
}
