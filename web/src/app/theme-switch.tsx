"use client";

import { useSyncExternalStore } from "react";

type Theme = "system" | "light" | "dark";
const OPTIONS: { id: Theme; label: string }[] = [
  { id: "light", label: "☀️ Light" },
  { id: "dark", label: "🌙 Dark" },
  { id: "system", label: "Auto" },
];

// The choice lives on <html data-theme> (read by globals.css) and in localStorage for next time.
function readTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
}

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function setTheme(theme: Theme) {
  const root = document.documentElement;
  try {
    if (theme === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", theme);
  } catch {}
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  listeners.forEach((cb) => cb());
}

export function ThemeSwitch() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);
  return (
    <div role="group" aria-label="Theme" className="inline-flex rounded-lg bg-slate-200 p-0.5 text-xs">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={theme === o.id}
          onClick={() => setTheme(o.id)}
          className={`rounded-md px-2 py-1 ${theme === o.id ? "bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-300" : "text-slate-500 hover:text-slate-800"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
