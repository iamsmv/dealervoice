"use client";

import { useState } from "react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

// Every half hour from 6 AM to 11 PM, stored as minutes after midnight.
const TIMES = Array.from({ length: 35 }, (_, i) => 360 + i * 30);

function timeLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h % 12 || 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

function parseTime(text: string): number | null {
  const m = text.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return null;
  const h = (Number(m[1]) % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0);
  return h * 60 + Number(m[2] ?? 0);
}

// "Mon,Tue,Wed,Fri" → "Mon–Wed, Fri"
function dayRanges(days: string[]): string {
  const idx = DAYS.map((d, i) => (days.includes(d) ? i : -1)).filter((i) => i >= 0);
  const parts: string[] = [];
  for (let i = 0; i < idx.length; i++) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    parts.push(j - i >= 2 ? `${DAYS[idx[i]]}–${DAYS[idx[j]]}` : idx.slice(i, j + 1).map((k) => DAYS[k]).join(", "));
    i = j;
  }
  return parts.join(", ");
}

type Hours = { days: string[]; open: number; close: number; sunday: "same" | "half" };
const SUNDAY_HALF = { open: 600, close: 840 }; // 10 AM – 2 PM

function format(h: Hours): string {
  if (!h.days.length) return "Closed";
  const range = `${timeLabel(h.open)} – ${timeLabel(h.close)}`;
  const weekdays = h.days.filter((d) => d !== "Sun");
  const sun = h.days.includes("Sun");
  if (sun && h.sunday === "half") {
    const half = `Sun ${timeLabel(SUNDAY_HALF.open)} – ${timeLabel(SUNDAY_HALF.close)}`;
    return weekdays.length ? `${dayRanges(weekdays)}, ${range}; ${half}` : half;
  }
  return `${dayRanges(h.days)}, ${range}`;
}

// Best effort: reads what we saved before (e.g. "Mon–Sat, 9:30 AM – 7 PM; Sun 10 AM – 2 PM").
function parse(text: string | null): Hours {
  const fallback: Hours = { days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], open: 570, close: 1140, sunday: "same" };
  if (!text) return fallback;
  const [main, sunPart] = text.split(";");
  const m = main.match(/^(.+?),\s*([\d:]+\s*[AP]M)\s*[–-]\s*([\d:]+\s*[AP]M)\s*$/i);
  if (!m) return fallback;
  const days = new Set<string>();
  for (const piece of m[1].split(",")) {
    const [a, b] = piece.trim().split(/[–-]/).map((s) => s.trim());
    const ia = DAYS.indexOf(a as (typeof DAYS)[number]);
    const ib = b ? DAYS.indexOf(b as (typeof DAYS)[number]) : ia;
    if (ia < 0 || ib < 0) return fallback;
    for (let i = ia; i <= ib; i++) days.add(DAYS[i]);
  }
  const open = parseTime(m[2]);
  const close = parseTime(m[3]);
  if (open == null || close == null) return fallback;
  if (sunPart?.trim().startsWith("Sun")) days.add("Sun");
  return { days: [...days], open, close, sunday: sunPart ? "half" : "same" };
}

const PRESETS: { label: string; hours: Hours }[] = [
  { label: "Mon–Sat · 9:30 AM–7 PM", hours: { days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], open: 570, close: 1140, sunday: "same" } },
  { label: "Mon–Sat · 9 AM–6 PM", hours: { days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], open: 540, close: 1080, sunday: "same" } },
  { label: "All days · 10 AM–8 PM", hours: { days: [...DAYS], open: 600, close: 1200, sunday: "same" } },
  { label: "Mon–Sat + Sun half day", hours: { days: [...DAYS], open: 570, close: 1140, sunday: "half" } },
];

const chip = (on: boolean) =>
  `rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition ${on ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-100"}`;
const select = "mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

// Click-only opening-hours picker. Submits one readable line (what the receptionist says) as `name`.
export function HoursPicker({ label, name, defaultValue }: { label: string; name: string; defaultValue: string | null }) {
  const [h, setH] = useState<Hours>(() => parse(defaultValue));
  const value = format(h);
  const toggleDay = (d: string) =>
    setH((prev) => ({ ...prev, days: prev.days.includes(d) ? prev.days.filter((x) => x !== d) : [...prev.days, d] }));

  return (
    <fieldset className="space-y-3 rounded-xl p-4 ring-1 ring-slate-200">
      <legend className="px-1 text-sm font-medium text-slate-700">{label}</legend>
      <input type="hidden" name={name} value={value} />

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => setH(p.hours)} className={`${chip(format(p.hours) === value)} text-xs`}>
            {p.label}
          </button>
        ))}
      </div>

      <div>
        <p className="text-xs text-slate-500">Open on</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {DAYS.map((d) => (
            <button key={d} type="button" aria-pressed={h.days.includes(d)} onClick={() => toggleDay(d)} className={chip(h.days.includes(d))}>
              {d}
            </button>
          ))}
        </div>
      </div>

      {h.days.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-500">
            Opens
            <select value={h.open} onChange={(e) => setH({ ...h, open: Number(e.target.value) })} className={`block ${select}`}>
              {TIMES.filter((t) => t < h.close).map((t) => <option key={t} value={t}>{timeLabel(t)}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            Closes
            <select value={h.close} onChange={(e) => setH({ ...h, close: Number(e.target.value) })} className={`block ${select}`}>
              {TIMES.filter((t) => t > h.open).map((t) => <option key={t} value={t}>{timeLabel(t)}</option>)}
            </select>
          </label>
        </div>
      )}

      {h.days.includes("Sun") && (
        <div>
          <p className="text-xs text-slate-500">Sunday</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setH({ ...h, sunday: "same" })} className={chip(h.sunday === "same")}>Same hours</button>
            <button type="button" onClick={() => setH({ ...h, sunday: "half" })} className={chip(h.sunday === "half")}>Half day · 10 AM–2 PM</button>
          </div>
        </div>
      )}

      <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
        <span className="text-xs text-slate-500">Receptionist will say: </span>
        {value}
      </p>
    </fieldset>
  );
}
