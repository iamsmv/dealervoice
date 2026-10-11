"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import type { AgentStudio, Voice } from "@/lib/dograh";
import { saveAgentAction, saveVoiceAction, type StudioState } from "./actions";

const card = "space-y-4 rounded-2xl bg-white p-5 ring-1 ring-slate-200";
const input = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const button = "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50";

function Status({ state }: { state: StudioState }) {
  if (state.error) return <p className="text-sm text-red-600">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-emerald-700">✓ Changes saved</p>;
  return null;
}

const personName = (v: Voice) => v.name.split(" - ")[0].trim();
const DEFAULT_VOICE = "Priya";

function VoiceOptions({ label, voices }: { label: string; voices: Voice[] }) {
  if (!voices.length) return null;
  return (
    <optgroup label={label}>
      {voices.map((v) => (
        <option key={v.voice_id} value={v.voice_id}>
          {v.name}{v.language === "en" ? " · English" : " · Hindi/English"}
        </option>
      ))}
    </optgroup>
  );
}

export function VoiceForm({ voices, current, agentName }: { voices: Voice[]; current: { voice: string; speed: number }; agentName: string }) {
  const [state, action, pending] = useActionState(saveVoiceAction, {});
  const [, startTransition] = useTransition();
  // Submitted by hand so React doesn't reset the form (which would jump the voice list to its first entry).
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => action(form));
  };
  // Dograh's unnamed "default" voice → suggest our default instead.
  const initial = voices.some((v) => v.voice_id === current.voice) ? current.voice : voices.find((v) => personName(v) === DEFAULT_VOICE)?.voice_id ?? "default";
  const [voice, setVoice] = useState(initial);
  const [name, setName] = useState(agentName);
  const [ownName, setOwnName] = useState(false);
  const [speed, setSpeed] = useState(current.speed);
  const audio = useRef<HTMLAudioElement>(null);
  const selected = voices.find((v) => v.voice_id === voice);

  const pickVoice = (id: string) => {
    setVoice(id);
    const v = voices.find((x) => x.voice_id === id);
    if (v && !ownName) setName(personName(v));
  };

  const preview = () => {
    if (!selected || !audio.current) return;
    audio.current.src = selected.preview_url;
    audio.current.play().catch(() => {});
  };

  const group = (gender: string, recommended: boolean) => voices.filter((v) => v.gender === gender && !!v.recommended === recommended);
  const mismatch = selected && name.trim() && name.trim().toLowerCase() !== personName(selected).toLowerCase();

  return (
    <form onSubmit={submit} className={card}>
      <div>
        <h2 className="font-semibold text-slate-900">Voice &amp; name</h2>
        <p className="text-xs text-slate-500">Used for every call, inbound and outbound. The receptionist takes the voice&apos;s name unless you choose your own.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="block flex-1 text-sm font-medium text-slate-700">
          Voice
          <select name="voice" value={voice} onChange={(e) => pickVoice(e.target.value)} className={input}>
            {!selected && <option value="default">Dograh default voice</option>}
            <VoiceOptions label="Recommended · Female" voices={group("female", true)} />
            <VoiceOptions label="Recommended · Male" voices={group("male", true)} />
            <VoiceOptions label="More female voices" voices={group("female", false)} />
            <VoiceOptions label="More male voices" voices={group("male", false)} />
          </select>
        </label>
        <button type="button" onClick={preview} disabled={!selected} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50">
          ▶ Preview
        </button>
      </div>
      {selected && <p className="text-xs text-slate-500">{selected.gender === "male" ? "Male" : "Female"} · {selected.description}</p>}
      <audio ref={audio} className="hidden" />

      <div className="text-sm font-medium text-slate-700">
        Receptionist name
        {ownName ? (
          <input name="agent_name" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} required className={input} />
        ) : (
          <>
            <input type="hidden" name="agent_name" value={name} />
            <p className="mt-1 text-base text-slate-900">{name}</p>
          </>
        )}
        <label className="mt-2 flex items-center gap-2 text-xs font-normal text-slate-600">
          <input
            type="checkbox"
            checked={ownName}
            onChange={(e) => {
              setOwnName(e.target.checked);
              if (!e.target.checked && selected) setName(personName(selected));
            }}
          />
          Use a different name
        </label>
      </div>
      {mismatch && (
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          ⚠ The voice is <b>{personName(selected)}</b> ({selected.gender}) but the receptionist will say &ldquo;this is {name.trim()}&rdquo;. Make sure the name suits a {selected.gender} voice.
        </p>
      )}

      <label className="block text-sm font-medium text-slate-700">
        Speaking speed: {speed.toFixed(1)}×
        <input type="range" name="speed" min={0.8} max={1.2} step={0.1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="mt-2 block w-full max-w-xs" />
      </label>
      <Status state={state} />
      <button disabled={pending} className={button}>{pending ? "Saving…" : "Save voice & name"}</button>
    </form>
  );
}

export function AgentForm({ agentName, studio }: { agentName: string; studio: AgentStudio }) {
  const [state, action, pending] = useActionState(saveAgentAction, {});
  return (
    <form action={action} className={card}>
      <div>
        <h2 className="font-semibold text-slate-900">What {agentName} says</h2>
        <p className="text-xs text-slate-500">Saving re-publishes {agentName}; it takes a few seconds.</p>
      </div>
      <label className="block text-sm font-medium text-slate-700">
        Greeting for incoming calls
        <input name="greeting" defaultValue={studio.customGreeting} placeholder={studio.greeting} maxLength={300} className={input} />
        <span className="mt-1 block text-xs font-normal text-slate-500">Leave empty to use the standard greeting shown above. Outbound calls use their own opening line.</span>
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Extra instructions
        <textarea
          name="instructions"
          defaultValue={studio.customInstructions}
          rows={5}
          maxLength={2000}
          placeholder={"e.g. We have a Diwali offer: free accessories worth ₹10,000 on the Nexon until 31 Oct.\nAlways mention free pick-up for service bookings."}
          className={input}
        />
        <span className="mt-1 block text-xs font-normal text-slate-500">Offers, policies or anything {agentName} should know. Write it plainly, like briefing a new staff member.</span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Longest call (minutes)
          <input type="number" name="max_minutes" min={1} max={15} defaultValue={Math.round(studio.settings.max_call_duration / 60)} className={input} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Hang up after silence (seconds)
          <input type="number" name="idle_seconds" min={5} max={30} defaultValue={studio.settings.max_user_idle_timeout} className={input} />
        </label>
      </div>
      <Status state={state} />
      <button disabled={pending} className={button}>{pending ? "Saving…" : `Save ${agentName}`}</button>
    </form>
  );
}
