import "server-only";
import { FORM_CALL_PREFIX, QUICK_CALL_PREFIX, type Campaign } from "@/lib/dograh";
import { formatPhone } from "@/lib/format";
import { inCallingHours, type ElevenLabsCampaign } from "@/lib/elevenlabs-calls";

// Turns a hidden one-person campaign into a row for the "Upcoming & retrying calls" list.

export type UpcomingCall = {
  id: number;
  who: string;
  phone: string | null;
  type: string;
  status: string;
  tone: "indigo" | "amber" | "slate";
};

const TYPES: Record<string, string> = {
  payments: "💰 Payment reminder",
  marketing: "📣 Marketing offer",
  follow_up: "Follow-up",
  web_form: "🌐 Website form callback",
};

// Names look like "[quick] payments · Suhas · +919876543210 · ₹5000 · 2026-10-06T15:18"
// (older ones: "[quick] payments Suhas 2026-10-06T15:18" or "[form] Ravi 2026-10-06T15:18").
function parseName(name: string) {
  const isForm = name.startsWith(FORM_CALL_PREFIX);
  const rest = name.slice(isForm ? FORM_CALL_PREFIX.length : QUICK_CALL_PREFIX.length);
  if (rest.includes(" · ")) {
    const [kind, who, phone, maybeAmount] = rest.split(" · ");
    return { kind, who, phone: phone?.startsWith("+") ? phone : null, amount: maybeAmount?.startsWith("₹") ? maybeAmount : null };
  }
  const m = rest.match(/^(?:(payments|marketing|follow_up) )?(.*?) \d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  return { kind: m?.[1] ?? (isForm ? "web_form" : "follow_up"), who: m?.[2] ?? rest, phone: null, amount: null };
}

function minutesNow(timeZone: string, now: Date) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now).split(":").map(Number);
  return h * 60 + m;
}

const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const label = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export function describeUpcoming(c: Campaign, now = new Date()): UpcomingCall {
  const { kind, who, phone, amount } = parseName(c.name);
  const slot = c.schedule_config?.slots?.[0] ?? { start_time: "09:00", end_time: "20:00", day_of_week: 0 };
  const current = minutesNow(c.schedule_config?.timezone ?? "Asia/Kolkata", now);
  const inHours = current >= toMinutes(slot.start_time) && current < toMinutes(slot.end_time);
  const nextOpen = `${current < toMinutes(slot.start_time) ? "today" : "tomorrow"} at ${label(slot.start_time)}`;

  let status: string;
  let tone: UpcomingCall["tone"] = "indigo";
  if (c.state === "paused") {
    status = "⏸ Paused";
    tone = "slate";
  } else if (c.processed_rows === 0) {
    status = inHours ? "📞 Calling now / shortly" : `⏰ Waiting — calls ${nextOpen}`;
    tone = inHours ? "indigo" : "amber";
  } else {
    status = inHours ? "🔁 Didn't answer — one more try about 15 min after the first ring" : `🔁 Didn't answer — one more try ${nextOpen}`;
    tone = "amber";
  }
  return {
    id: c.id,
    who,
    phone: phone ? formatPhone(phone) : null,
    type: `${TYPES[kind] ?? kind}${amount ? ` · ${amount}` : ""}`,
    status,
    tone,
  };
}

// The same row for an ElevenLabs Quick call or website-form callback.
export function describeElevenLabsUpcoming(c: ElevenLabsCampaign, now = new Date()): UpcomingCall {
  const person = c.contacts[0];
  const inHours = inCallingHours(c, now);
  const nextOpen = `${minutesNow(c.timezone, now) < toMinutes("09:00") ? "today" : "tomorrow"} at 9:00 AM`;
  let status: string;
  let tone: UpcomingCall["tone"] = "indigo";
  if (c.state === "paused") {
    status = "⏸ Paused";
    tone = "slate";
  } else if (person.status === "in_batch") {
    status = "📞 Calling now";
  } else if (person.attempts === 0) {
    status = inHours ? "📞 Calling now / shortly" : `⏰ Waiting — calls ${nextOpen}`;
    tone = inHours ? "indigo" : "amber";
  } else {
    status = inHours ? `🔁 Didn't answer — one more try about ${c.retry_minutes} min after the first ring` : `🔁 Didn't answer — one more try ${nextOpen}`;
    tone = "amber";
  }
  return {
    id: c.id,
    who: person.label.split(" · ")[0],
    phone: formatPhone(person.phone),
    type: `${TYPES[c.kind === "form" ? "web_form" : c.role] ?? c.role}${person.label.includes(" · ") ? ` · ${person.label.split(" · ")[1]}` : ""}`,
    status,
    tone,
  };
}
