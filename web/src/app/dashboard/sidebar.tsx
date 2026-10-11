"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { ThemeSwitch } from "../theme-switch";

const NAV = [
  { segment: null, href: "/dashboard", label: "Dashboard", icon: "🏠" },
  { segment: "leads", href: "/dashboard/leads", label: "Leads", icon: "👥" },
  { segment: "pipeline", href: "/dashboard/pipeline", label: "Pipeline", icon: "🗂️" },
  { segment: "appointments", href: "/dashboard/appointments", label: "Appointments", icon: "📅" },
  { segment: "calls", href: "/dashboard/calls", label: "Calls", icon: "📞" },
  { segment: "forms", href: "/dashboard/forms", label: "Forms", icon: "📝" },
  { segment: "campaigns", href: "/dashboard/campaigns", label: "Campaigns", icon: "📣" },
  { segment: "voice-studio", href: "/dashboard/voice-studio", label: "Voice Studio", icon: "🎙️" },
  { segment: "settings", href: "/dashboard/settings", label: "Settings", icon: "⚙️" },
  { segment: "integrations", href: "/dashboard/integrations", label: "API & Integrations", icon: "🔌" },
] as const;

const COMING_SOON: string[] = [];

// Support appears only for dealerships with extra agents switched on (client requirement #4).
const SUPPORT = { segment: "support", href: "/dashboard/support", label: "Support", icon: "🎧" } as const;
const QUICK_CALL = { segment: "quick-call", href: "/dashboard/quick-call", label: "Quick call", icon: "📲" } as const;

export function Sidebar({ businessName, agentName, showAdmin = false, showSupport = false }: { businessName: string; agentName: string; showAdmin?: boolean; showSupport?: boolean }) {
  const active = useSelectedLayoutSegment();
  // Extra agents on: Support after Calls, Quick call after Campaigns.
  const nav = showSupport ? [...NAV.slice(0, 5), SUPPORT, ...NAV.slice(5, 7), QUICK_CALL, ...NAV.slice(7)] : NAV;

  return (
    <aside className="border-b border-slate-200 bg-white md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r">
      <div className="flex items-center gap-3 px-4 py-4">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white shadow-sm">DV</span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900">DealerVoice</p>
          <p className="truncate text-xs text-slate-500">{businessName}</p>
        </div>
      </div>
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-col md:overflow-visible">
        {nav.map((item) => {
          const isActive = active === item.segment;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive ? "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-100" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <span aria-hidden="true" className="w-5 text-center text-base leading-none">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
        {COMING_SOON.map((label) => (
          <span
            key={label}
            title="Coming soon"
            className="hidden cursor-default items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-400 md:flex"
          >
            {label}
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase">Soon</span>
          </span>
        ))}
      </nav>
      {/* Only the DealerVoice owner (ADMIN_EMAILS) sees this. */}
      {showAdmin && (
        <div className="px-2 pb-2 md:mt-auto">
          <Link href="/admin" className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
            <span className="flex items-center gap-2.5"><span aria-hidden="true" className="w-5 text-center">🛡️</span>Admin</span>
            <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] uppercase text-white">Owner</span>
          </Link>
        </div>
      )}
      <div className={`hidden border-t border-slate-200 px-4 pt-3 md:block ${showAdmin ? "" : "md:mt-auto"}`}>
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500" />
          Receptionist: <span className="truncate font-medium text-slate-700">{agentName}</span>
        </p>
      </div>
      <div className="px-4 pb-3 pt-1 md:pb-4 md:pt-3">
        <ThemeSwitch />
      </div>
    </aside>
  );
}
