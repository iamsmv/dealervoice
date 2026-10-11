"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// While something is still happening (a call or campaign in progress), re-fetch the page every few seconds.
export function AutoRefresh({ seconds = 10, label = true }: { seconds?: number; label?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return label ? <p className="text-xs text-slate-500">Updating live every {seconds} seconds…</p> : null;
}
