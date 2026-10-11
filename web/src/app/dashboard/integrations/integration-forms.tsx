"use client";

import { useActionState, useState, useTransition } from "react";
import { CopyButton } from "../forms/copy-button";
import { connectDograhAction, generateApiKeyAction, revokeApiKeyAction, type IntegrationState } from "./actions";

const card = "space-y-4 rounded-2xl bg-white p-5 ring-1 ring-slate-200";
const input = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const button = "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50";
const quiet = "rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50";

function Message({ state }: { state: IntegrationState }) {
  if (state.error) return <p className="text-sm text-red-600">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-emerald-700">✓ {state.ok}</p>;
  return null;
}

function Badge({ on, label }: { on: boolean; label: string }) {
  return on ? (
    <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">● {label}</span>
  ) : (
    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">○ {label}</span>
  );
}

// Dograh (voice AI). Until a dealership connects its own account, DealerVoice's platform account is used.
export function ConnectDograhForm({ agentName, ownKeyEnding, agentId }: { agentName: string; ownKeyEnding: string | null; agentId: string | null }) {
  const [state, action, pending] = useActionState(connectDograhAction, {});
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-900">Dograh (voice AI)</p>
          <p className="text-xs text-slate-500">
            {ownKeyEnding ? `Your own Dograh account (key •••• ${ownKeyEnding})` : "Using the DealerVoice account"}
            {agentId ? ` · ${agentName} is agent ${agentId}` : ""}
          </p>
        </div>
        <Badge on label={ownKeyEnding ? "Your account" : "Connected"} />
      </div>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-indigo-600 hover:underline">
          {ownKeyEnding ? "Replace Dograh key" : "Connect your own Dograh account"}
        </button>
      ) : (
        <form action={action} className="space-y-3 rounded-xl bg-slate-50 p-4">
          <p className="text-xs text-slate-600">
            Paste an API key from <b>Dograh → Developers → API keys</b>. We&apos;ll build {agentName} in that account with the same instructions, voice settings and booking — it takes about 10 seconds.
            Afterwards, attach your phone number to the new agent in Dograh.
          </p>
          <input name="dograh_api_key" type="password" autoComplete="off" required placeholder="Dograh API key" className={input} />
          <Message state={state} />
          <div className="flex gap-2">
            <button disabled={pending} className={button}>{pending ? "Connecting…" : "Connect"}</button>
            <button type="button" onClick={() => setOpen(false)} className="px-3 text-sm text-slate-500">Cancel</button>
          </div>
        </form>
      )}
      {!open && <Message state={state} />}
    </div>
  );
}

// The dealership's own DealerVoice API key: generate (shown once), regenerate, revoke.
export function ApiKeyPanel({ hint, createdAt }: { hint: string | null; createdAt: string | null }) {
  const [state, setState] = useState<IntegrationState>({});
  const [pending, startTransition] = useTransition();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const run = (fn: () => Promise<IntegrationState>) => startTransition(async () => setState(await fn()));

  return (
    <section className={card}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-slate-900">DealerVoice API key</h2>
          <p className="text-xs text-slate-500">Lets your other software, or AI assistants like Claude, read and add leads. Keep it secret like a password.</p>
        </div>
        <Badge on={!!hint} label={hint ? "Active" : "No key"} />
      </div>

      {state.newKey ? (
        <div className="space-y-2 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <p className="text-sm font-medium text-amber-800">Copy your key now — it won&apos;t be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1.5 text-xs text-slate-900 ring-1 ring-slate-200">{state.newKey}</code>
            <CopyButton text={state.newKey} />
          </div>
        </div>
      ) : (
        hint && <p className="text-sm text-slate-700">Key <code className="rounded bg-slate-100 px-1.5 py-0.5">dv_live_••••{hint}</code>{createdAt && <span className="text-xs text-slate-500"> · created {createdAt}</span>}</p>
      )}

      <Message state={state} />
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={pending} onClick={() => run(generateApiKeyAction)} className={button}>
          {pending ? "Working…" : hint || state.newKey ? "Create a new key" : "Create API key"}
        </button>
        {(hint || state.newKey) &&
          (confirmRevoke ? (
            <span className="flex items-center gap-2 text-xs text-slate-600">
              Revoke? Anything using it stops working.
              <button disabled={pending} onClick={() => { setConfirmRevoke(false); run(revokeApiKeyAction); }} className="rounded-md bg-red-600 px-2 py-1 font-medium text-white">Yes, revoke</button>
              <button onClick={() => setConfirmRevoke(false)} className="text-slate-500">Keep</button>
            </span>
          ) : (
            <button onClick={() => setConfirmRevoke(true)} className={quiet}>Revoke</button>
          ))}
      </div>
      {(hint || state.newKey) && <p className="text-xs text-slate-500">Creating a new key replaces the old one immediately.</p>}
    </section>
  );
}

function Snippet({ code }: { code: string }) {
  return (
    <div className="flex items-start gap-2">
      <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-slate-100 p-3 text-xs text-slate-900">{code}</pre>
      <CopyButton text={code} />
    </div>
  );
}

// MCP set-up for Claude / Cursor, plus a short API reference with copy-paste examples.
export function DeveloperDocs({ appUrl }: { appUrl: string }) {
  const [tab, setTab] = useState<"claude-code" | "cursor" | "claude-desktop" | "api">("claude-code");
  const mcpUrl = `${appUrl}/api/mcp`;
  const key = "YOUR_API_KEY";
  const snippets = {
    "claude-code": `claude mcp add --transport http dealervoice ${mcpUrl} --header "Authorization: Bearer ${key}"`,
    cursor: JSON.stringify({ mcpServers: { dealervoice: { url: mcpUrl, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
    "claude-desktop": JSON.stringify(
      { mcpServers: { dealervoice: { command: "npx", args: ["-y", "mcp-remote", mcpUrl, "--header", "Authorization:${AUTH}"], env: { AUTH: `Bearer ${key}` } } } },
      null,
      2,
    ),
  };
  const tabs = [
    ["claude-code", "Claude Code"],
    ["cursor", "Cursor"],
    ["claude-desktop", "Claude Desktop"],
    ["api", "API reference"],
  ] as const;

  return (
    <section className={card}>
      <div>
        <h2 className="font-semibold text-slate-900">MCP &amp; API</h2>
        <p className="text-xs text-slate-500">
          Connect an AI assistant to your CRM, then ask things like &ldquo;show today&apos;s new leads&rdquo; or &ldquo;add Ravi, 98765 43210, interested in the Nexon&rdquo;.
          It can list, search and add leads, change stages, and read bookings, calls, campaigns and support tickets. It can&apos;t place calls or delete anything.
        </p>
      </div>
      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 text-sm">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-md px-3 py-1.5 font-medium ${tab === id ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "claude-code" && (
        <div className="space-y-2">
          <p className="text-xs text-slate-600">Run this once in a terminal, replacing YOUR_API_KEY:</p>
          <Snippet code={snippets["claude-code"]} />
        </div>
      )}
      {tab === "cursor" && (
        <div className="space-y-2">
          <p className="text-xs text-slate-600">Add to <code>~/.cursor/mcp.json</code>, replacing YOUR_API_KEY:</p>
          <Snippet code={snippets.cursor} />
        </div>
      )}
      {tab === "claude-desktop" && (
        <div className="space-y-2">
          <p className="text-xs text-slate-600">Claude Desktop → Settings → Developer → Edit config, add this (needs Node.js), replacing YOUR_API_KEY, then restart Claude:</p>
          <Snippet code={snippets["claude-desktop"]} />
        </div>
      )}
      {tab === "api" && (
        <div className="space-y-3 text-xs text-slate-600">
          <p>Send your key as <code>Authorization: Bearer YOUR_API_KEY</code>. Responses are JSON: <code>{"{ \"data\": … }"}</code> or <code>{"{ \"error\": \"…\" }"}</code>.</p>
          <ul className="space-y-1">
            <li><code>GET /api/v1/leads?search=&amp;stage=&amp;limit=</code> — list leads</li>
            <li><code>POST /api/v1/leads</code> — add a lead (name, phone, email, car_interest)</li>
            <li><code>PATCH /api/v1/leads/{"{id}"}</code> — change stage</li>
            <li><code>GET /api/v1/bookings?upcoming=true</code> — bookings</li>
            <li><code>GET /api/v1/calls?limit=20</code> — recent calls</li>
            <li><code>GET /api/v1/campaigns</code> — campaigns</li>
            <li><code>GET /api/v1/tickets?status=open</code> — support tickets (when Support is on)</li>
          </ul>
          <Snippet code={`curl -X POST ${appUrl}/api/v1/leads \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Ravi Kumar","phone":"9876543210","car_interest":"Nexon"}'`} />
        </div>
      )}
    </section>
  );
}
