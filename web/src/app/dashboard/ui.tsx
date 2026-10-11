import Link from "next/link";
import type { ReactNode } from "react";

// Small shared presentational pieces so every dashboard page looks the same.

export function PageHeader({ title, count, description, actions, icon }: {
  title: ReactNode;
  count?: number;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
          {icon && <span aria-hidden="true" className="text-xl">{icon}</span>}
          {title}
          {count !== undefined && (
            <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-sm font-semibold tabular-nums text-indigo-700 ring-1 ring-indigo-100">
              {count}
            </span>
          )}
        </h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

const TONES = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  sky: "bg-sky-50 text-sky-700 ring-sky-200",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "slate", children, title, dot = false }: { tone?: Tone; children: ReactNode; title?: string; dot?: boolean }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-2xl">{icon}</span>
      <p className="mt-3 font-medium text-slate-900">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-slate-500">{children}</p>}
    </div>
  );
}

export function Notice({ tone = "amber", children }: { tone?: "amber" | "red"; children: ReactNode }) {
  const cls = tone === "red" ? "bg-red-50 text-red-800 ring-red-200" : "bg-amber-50 text-amber-800 ring-amber-200";
  return <p role="status" className={`rounded-xl p-3 text-sm ring-1 ${cls}`}>⚠️ {children}</p>;
}

// Pill-style tab links (Support views, Appointment tabs).
export function TabLinks({ tabs, label }: { tabs: { href: string; label: ReactNode; active: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            t.active ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export const card = "rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm";
export const inputClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500";
