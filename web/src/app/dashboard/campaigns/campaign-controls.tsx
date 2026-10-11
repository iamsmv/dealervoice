"use client";

import { useActionState, useState, useTransition } from "react";
import { callBackAction, campaignControlAction, createCampaignAction, previewSheetAction, removeCampaignAction, type CallBackState, type CreateCampaignState, type SheetPreview } from "./actions";

type Option = { id: string; label: string };

// Example file offered for download, so owners see the expected columns.
const SAMPLE_CSV = "data:text/csv;charset=utf-8," + encodeURIComponent("name,phone,car\nRavi Kumar,98765 43210,Nexon\nAnita Rao,+91 91234 56789,Punch\n");
const SAMPLE_PAYMENTS_CSV = "data:text/csv;charset=utf-8," + encodeURIComponent("name,phone,amount,due_date,reference\nRavi Kumar,98765 43210,12500,15 Oct 2026,EMI-0042\nAnita Rao,+91 91234 56789,4800,20 Oct 2026,Service bill 1187\n");

export function NewCampaignForm({ stages, sources, counts, marketing = false }: {
  stages: readonly Option[];
  sources: readonly Option[];
  counts: Record<string, number>; // leads with a phone number, per stage
  marketing?: boolean; // extra agents switched on: offer "Marketing offer" and "Payment reminder" campaigns
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"leads" | "upload">("leads");
  const [kind, setKind] = useState<"follow_up" | "marketing" | "payments">("follow_up");
  const [state, formAction, pending] = useActionState<CreateCampaignState, FormData>(async (prev, form) => {
    const result = await createCampaignAction(prev, form);
    if (result.ok) setOpen(false);
    return result;
  }, {});

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button onClick={() => setOpen(true)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
          + New campaign
        </button>
        {state.ok && (
          <p className="text-xs text-emerald-700">
            Campaign created with {state.count} people{state.skipped ? ` (${state.skipped} rows skipped: missing, invalid or repeated numbers)` : ""}. Press Start when ready.
          </p>
        )}
      </div>
    );
  }

  const input = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
  return (
    <form key={JSON.stringify(state.values ?? {})} action={formAction} className="w-full space-y-4 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <label className="block text-sm font-medium text-slate-700">
        Campaign name
        <input name="name" required defaultValue={state.values?.name} placeholder="e.g. Follow up new enquiries – October" className={`mt-1 w-full ${input}`} />
      </label>
      <input type="hidden" name="mode" value={mode} />
      {marketing && (
        <div>
          <input type="hidden" name="kind" value={kind} />
          <p className="text-sm font-medium text-slate-700">Type of call</p>
          <div className="mt-2 inline-flex flex-wrap rounded-lg bg-slate-100 p-1 text-sm">
            {([["follow_up", "Follow up enquiries"], ["marketing", "📣 Marketing offer"], ["payments", "💰 Payment reminder"]] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setKind(id)}
                className={`rounded-md px-3 py-1.5 font-medium ${kind === id ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {kind === "marketing" && (
            <label className="mt-3 block text-sm font-medium text-slate-700">
              What&apos;s the offer?
              <textarea
                name="offer"
                required
                minLength={10}
                maxLength={300}
                rows={2}
                defaultValue={state.values?.offer}
                placeholder="e.g. Diwali offer: free accessories worth ₹15,000 on every Nexon booked before 31 October."
                className={`mt-1 w-full ${input}`}
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">The marketing agent tells each person exactly this — nothing more. Interested people can book a test drive on the call.</span>
            </label>
          )}
        </div>
      )}
      {kind === "payments" ? (
        <div className="space-y-2">
          <ListSource kind="payments" label="List of payments due" initial={state.values} />
          <p className="text-xs text-slate-500">
            Columns: <b>name</b>, <b>phone</b>, <b>amount</b>, <b>due_date</b>, and optionally <b>reference</b> (EMI / invoice number). Paste a Google Sheet link, or upload a CSV exported from Excel, Tally or your DMS. Up to 500 people.{" "}
            <a href={SAMPLE_PAYMENTS_CSV} download="dealervoice-payments-sample.csv" className="font-medium text-indigo-600 hover:underline">Download a sample</a>
          </p>
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
            The agent first checks it&apos;s speaking to the right person, and only then mentions the amount. It never asks for card, bank or UPI details and never takes payment on the call. Calls only 9 AM – 7 PM.
          </p>
        </div>
      ) : (<>
      <div>
        <p className="text-sm font-medium text-slate-700">Who to call</p>
        <div className="mt-2 inline-flex rounded-lg bg-slate-100 p-1 text-sm">
          {([["leads", "From my leads"], ["upload", "From a list (Google Sheet or CSV)"]] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={`rounded-md px-3 py-1.5 font-medium ${mode === id ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {mode === "leads" && (<>
      <fieldset>
        <legend className="text-sm font-medium text-slate-700">Call leads in these stages</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {stages.map((s) => (
            <label key={s.id} className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-700">
              <input type="checkbox" name="stages" value={s.id} defaultChecked={state.values ? state.values.stages.includes(s.id) : s.id === "new" || s.id === "contacted"} />
              {s.label} <span className="text-xs text-slate-500">({counts[s.id] ?? 0})</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm font-medium text-slate-700">
        Source
        <select name="source" defaultValue={state.values?.source ?? ""} className={`mt-1 block ${input}`}>
          <option value="">Any source</option>
          {sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      </>)}
      {mode === "upload" && (
        <div className="space-y-2">
          <ListSource kind="contacts" label="Your list" initial={state.values} />
          <p className="text-xs text-slate-500">
            Columns: <b>name</b>, <b>phone</b>, and optionally <b>car</b>. Paste a Google Sheet link, or upload a CSV from Excel. Up to 500 people; everyone is also added to Leads.{" "}
            <a href={SAMPLE_CSV} download="dealervoice-sample.csv" className="font-medium text-indigo-600 hover:underline">Download a sample</a>
          </p>
        </div>
      )}
      </>)}
      <p className="text-xs text-slate-500">
        Calls 2 people at a time, only between 9 AM and {kind === "payments" ? "7" : "8"} PM, and tries once more after 30 minutes if busy or unanswered. The campaign is saved as a draft — nothing is dialled until you press Start.
      </p>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-2">
        <button disabled={pending} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Creating…" : "Create campaign"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
      </div>
    </form>
  );
}

// Start (with a confirmation, since it places real calls), Pause and Resume.
export function CampaignButtons({ id, state, total }: { id: number; state: string; total: number }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const run = (action: "start" | "pause" | "resume") => startTransition(() => campaignControlAction(id, action));
  const btn = "rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50";

  // Dograh reports a new, not-yet-started campaign as "created" (older versions: "draft").
  if (state === "created" || state === "draft") {
    return confirming ? (
      <span className="flex items-center gap-2">
        <span className="text-xs text-slate-600">{total ? `Call ${total} people?` : "Start calling?"}</span>
        <button disabled={pending} onClick={() => run("start")} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500`}>Yes, start</button>
        <button onClick={() => setConfirming(false)} className="text-xs text-slate-500">Cancel</button>
      </span>
    ) : (
      <button onClick={() => setConfirming(true)} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500`}>▶ Start</button>
    );
  }
  if (state === "running") return <button disabled={pending} onClick={() => run("pause")} className={`${btn} border border-slate-300 text-slate-700`}>⏸ Pause</button>;
  if (state === "paused") return <button disabled={pending} onClick={() => run("resume")} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500`}>▶ Resume</button>;
  return null;
}

// Remove (hide) a campaign that isn't dialling, after a confirmation.
export function RemoveCampaignButton({ id }: { id: number }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-red-50 hover:text-red-600">
        🗑 Remove
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-slate-600">Remove this campaign?</span>
      <button disabled={pending} onClick={() => startTransition(() => removeCampaignAction(id))} className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
        {pending ? "Removing…" : "Yes, remove"}
      </button>
      <button onClick={() => setConfirming(false)} className="text-xs text-slate-500">Keep</button>
    </span>
  );
}

// On a finished campaign: one click (plus a plain confirmation) to call again only the people who didn't pick up.
export function CallBackButton({ id }: { id: number }) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<CallBackState>({});
  const [pending, startTransition] = useTransition();
  if (result.info || result.error) {
    return <span className={`text-xs ${result.error ? "text-red-600" : "text-slate-600"}`}>{result.error ?? result.info}</span>;
  }
  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500">
        🔁 Call back people who didn&apos;t answer
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-600">Make a new list of just the people who didn&apos;t answer? Nothing is dialled until you press Start.</span>
      <button
        disabled={pending}
        onClick={() => startTransition(async () => setResult(await callBackAction(id)))}
        className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? "Creating…" : "Yes, create"}
      </button>
      <button onClick={() => setConfirming(false)} className="text-xs text-slate-500">Cancel</button>
    </span>
  );
}

// Where the call list comes from: a shared Google Sheet link (no download needed) or a CSV file.
// The last sheet link is remembered on this device, so next month's campaign is one click.
function ListSource({ kind, label, initial }: { kind: "contacts" | "payments"; label: string; initial?: { listFrom: string; sheetUrl: string } }) {
  const storageKey = `dv-sheet-${kind}`;
  const [from, setFrom] = useState<"sheet" | "file">(initial?.listFrom === "file" ? "file" : "sheet");
  const [url, setUrl] = useState(() => {
    if (initial?.sheetUrl) return initial.sheetUrl;
    try { return typeof window === "undefined" ? "" : localStorage.getItem(storageKey) ?? ""; } catch { return ""; }
  });
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [checking, startCheck] = useTransition();
  const remember = (value: string) => { try { localStorage.setItem(storageKey, value); } catch {} };
  const box = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

  return (
    <div className="space-y-2">
      <input type="hidden" name="list_from" value={from} />
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <div className="inline-flex rounded-lg bg-slate-100 p-1 text-xs">
          {([["sheet", "🔗 Google Sheet link"], ["file", "📄 Upload CSV"]] as const).map(([id, text]) => (
            <button key={id} type="button" aria-pressed={from === id} onClick={() => { setFrom(id); setPreview(null); }}
              className={`rounded-md px-2.5 py-1 font-medium ${from === id ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600"}`}>
              {text}
            </button>
          ))}
        </div>
      </div>
      {from === "sheet" ? (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              name="sheet_url"
              type="url"
              required
              value={url}
              onChange={(e) => { setUrl(e.target.value); setPreview(null); }}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              aria-label="Google Sheet link"
              className={box}
            />
            <button
              type="button"
              disabled={!url || checking}
              onClick={() => startCheck(async () => {
                const result = await previewSheetAction(url, kind === "payments" ? "payments" : "contacts");
                setPreview(result);
                if (!result.error) remember(url);
              })}
              className="mt-1 shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {checking ? "Checking…" : "Check sheet"}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            In Google Sheets: <b>Share → General access → Anyone with the link → Viewer</b>, then copy the link from the address bar. Open the right tab first if the sheet has several.
          </p>
          {preview?.error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-xs text-red-700 ring-1 ring-red-200">{preview.error}{preview.columns?.length ? ` Columns found: ${preview.columns.join(", ")}.` : ""}</p>}
          {preview && !preview.error && (
            <div role="status" className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 ring-1 ring-emerald-200">
              <p className="font-medium">✅ {preview.count} {preview.count === 1 ? "person" : "people"} ready to call{preview.skipped ? ` · ${preview.skipped} rows skipped (missing, invalid or repeated numbers${kind === "payments" ? ", or no amount / due date" : ""})` : ""}</p>
              {preview.columns && <p className="mt-1 text-emerald-700">Columns: {preview.columns.join(", ")}</p>}
              {preview.sample && preview.sample.length > 0 && (
                <ul className="mt-1 list-inside list-disc text-emerald-700">{preview.sample.map((r) => <li key={r}>{r}</li>)}</ul>
              )}
            </div>
          )}
        </>
      ) : (
        <input type="file" name="file" accept=".csv,text/csv" required aria-label="CSV file" className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700" />
      )}
    </div>
  );
}
