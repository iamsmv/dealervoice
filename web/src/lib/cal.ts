import "server-only";

type BookingInput = {
  apiKey: string;
  eventTypeId: number;
  name: string;
  email: string;
  phone?: string;
  startTime: string; // local time like 2026-10-09T17:00:00
  timeZone: string;
};

// Turns a wall-clock time in `timeZone` into a UTC ISO string, which Cal.com requires.
export function localToUtcIso(local: string, timeZone: string): string {
  const asIfUtc = new Date(`${local.replace(/Z$/, "")}Z`);
  if (Number.isNaN(asIfUtc.getTime())) throw new Error(`Invalid start_time: ${local}`);
  const tzWall = new Date(asIfUtc.toLocaleString("en-US", { timeZone }));
  const utcWall = new Date(asIfUtc.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(asIfUtc.getTime() - (tzWall.getTime() - utcWall.getTime())).toISOString();
}

export async function createCalBooking(input: BookingInput) {
  const res = await fetch("https://api.cal.com/v2/bookings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "cal-api-version": "2024-08-13",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      start: localToUtcIso(input.startTime, input.timeZone),
      eventTypeId: input.eventTypeId,
      attendee: {
        name: input.name,
        email: input.email,
        timeZone: input.timeZone,
        ...(input.phone ? { phoneNumber: input.phone } : {}),
      },
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error?.message ?? JSON.stringify(body);
    throw new Error(`Cal.com rejected the booking: ${message}`);
  }
  return body.data as { uid: string; start: string };
}

async function calPost(apiKey: string, path: string, body: unknown) {
  const res = await fetch(`https://api.cal.com/v2${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "cal-api-version": "2026-02-25",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Cal.com: ${json?.error?.message ?? JSON.stringify(json)}`);
  return json.data;
}

export async function cancelCalBooking(apiKey: string, uid: string, reason: string) {
  await calPost(apiKey, `/bookings/${uid}/cancel`, { cancellationReason: reason });
}

// Cal.com gives the moved booking a new uid, so callers must store the returned one.
export async function rescheduleCalBooking(apiKey: string, uid: string, startLocal: string, timeZone: string) {
  const data = await calPost(apiKey, `/bookings/${uid}/reschedule`, {
    start: localToUtcIso(startLocal, timeZone),
    reschedulingReason: "Changed by the dealership",
  });
  return data as { uid: string; start: string };
}
