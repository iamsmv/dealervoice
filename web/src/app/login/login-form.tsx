"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ linkError }: { linkError: boolean }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(linkError ? "error" : "idle");
  const [message, setMessage] = useState(
    linkError ? "That sign-in link has expired or was already used. Please request a new one." : "",
  );

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    } else {
      setStatus("sent");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-slate-900">
          <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">DV</span>
          DealerVoice
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Sign in</h1>
        <p className="mt-1 text-sm text-slate-500">We&apos;ll email you a secure sign-in link. No password needed.</p>

        {status === "sent" ? (
          <p role="status" className="mt-6 rounded-lg bg-green-50 p-4 text-sm text-green-800 ring-1 ring-green-200">📬 
            Check <b>{email}</b> for your sign-in link.
          </p>
        ) : (
          <form onSubmit={sendLink} className="mt-6 space-y-4">
            <label htmlFor="login-email" className="sr-only">Email address</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@dealership.com"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 focus:border-indigo-500"
            />
            <button
              disabled={status === "sending"}
              className="w-full rounded-lg bg-indigo-600 py-2.5 font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {status === "sending" ? "Sending…" : "Email me a sign-in link"}
            </button>
            {status === "error" && <p role="alert" className="text-sm text-red-600">{message}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
