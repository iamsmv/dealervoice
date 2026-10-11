// Shared display helpers for the dashboard (India time, short durations).

const dateTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : "—";
}

export function formatDuration(seconds: number): string {
  if (!seconds) return "0s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

// "+919876543210" → "+91 98765 43210"
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const m = phone.match(/^\+91(\d{5})(\d{5})$/);
  return m ? `+91 ${m[1]} ${m[2]}` : phone;
}

// Dograh disposition codes → plain words.
export function formatOutcome(outcome: string): string {
  const labels: Record<string, string> = {
    user_hangup: "Caller hung up",
    user_idle_max_duration_exceeded: "No response",
    busy: "Busy / declined",
    no_answer: "No answer",
    voicemail: "Voicemail",
    failed: "Call failed",
    completed: "Completed",
    booking_done: "Booked ✓ (agent ended)",
    enquiry_answered: "Answered (agent ended)",
    caller_not_interested: "Not interested",
    callback_requested: "Call back later",
    do_not_call: "Do not call",
    ticket_created: "Support ticket opened 🎫",
    support_answered: "Support question answered",
    promised_to_pay: "Promised to pay 💰",
    already_paid: "Says already paid",
    payment_disputed: "Disputed — needs accounts team",
    wrong_person: "Wrong person / not available",
    wrong_number: "Wrong number",
    other: "Agent ended call",
    in_progress: "In progress",
    agent_glitch: "⚠ Agent glitch — check booking",
  };
  return labels[outcome] ?? outcome.replace(/_/g, " ");
}

// True if a call that started in the last 30 minutes hasn't finished yet (pages then refresh themselves).
export function hasLiveCall(calls: { completed: boolean; startedAt: string }[], now = Date.now()): boolean {
  return calls.some((c) => !c.completed && now - new Date(c.startedAt).getTime() < 30 * 60_000);
}
