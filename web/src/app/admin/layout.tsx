import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";

export const metadata = { title: "DealerVoice Admin", robots: { index: false } };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const email = await requireAdmin();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-8">
          <Link href="/admin" className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-[11px] font-bold text-white">DV</span>
            DealerVoice <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] uppercase text-white">Admin</span>
          </Link>
          <span className="flex items-center gap-4">
            <Link href="/dashboard" className="text-xs font-medium text-indigo-600 hover:underline">← My dashboard</Link>
            <span className="hidden truncate text-xs text-slate-500 sm:inline">{email}</span>
          </span>
        </div>
      </header>
      {children}
    </div>
  );
}
