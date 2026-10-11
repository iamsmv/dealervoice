"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cancelCalBooking, rescheduleCalBooking } from "@/lib/cal";

export type AppointmentActionState = { error?: string; ok?: boolean };

// Loads a booking only if it belongs to the signed-in dealership (row-level security),
// plus that dealership's Cal.com key, which only the server can read.
async function loadOwnedBooking(bookingId: string) {
  const supabase = await createClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, business_id, cal_booking_uid, status, businesses(timezone)")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking?.cal_booking_uid || booking.status !== "booked") return null;

  const admin = createAdminClient();
  const { data: secrets } = await admin
    .from("business_secrets")
    .select("cal_api_key")
    .eq("business_id", booking.business_id)
    .maybeSingle();
  if (!secrets?.cal_api_key) return null;

  const timeZone = (booking.businesses as { timezone?: string } | null)?.timezone ?? "Asia/Kolkata";
  return { booking, apiKey: secrets.cal_api_key as string, timeZone, admin };
}

export async function cancelAppointment(
  _prev: AppointmentActionState,
  form: FormData,
): Promise<AppointmentActionState> {
  const owned = await loadOwnedBooking(String(form.get("booking_id")));
  if (!owned) return { error: "This appointment can't be cancelled." };

  try {
    await cancelCalBooking(owned.apiKey, owned.booking.cal_booking_uid!, "Cancelled by the dealership");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cancelling failed.";
    // Already cancelled or removed in Cal.com itself (e.g. by hand): the slot is free, so just bring our list in line.
    if (!/cancelled already|not found/i.test(message)) return { error: message };
  }
  await owned.admin.from("bookings").update({ status: "cancelled" }).eq("id", owned.booking.id);
  revalidatePath("/dashboard/appointments");
  return { ok: true };
}

export async function rescheduleAppointment(
  _prev: AppointmentActionState,
  form: FormData,
): Promise<AppointmentActionState> {
  const owned = await loadOwnedBooking(String(form.get("booking_id")));
  if (!owned) return { error: "This appointment can't be rescheduled." };

  const start = String(form.get("start") ?? ""); // "2026-10-10T11:00" from the date-time picker
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start)) return { error: "Please pick a new date and time." };

  try {
    const moved = await rescheduleCalBooking(owned.apiKey, owned.booking.cal_booking_uid!, `${start}:00`, owned.timeZone);
    await owned.admin
      .from("bookings")
      .update({ start_time: moved.start, cal_booking_uid: moved.uid })
      .eq("id", owned.booking.id);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Rescheduling failed." };
  }
  revalidatePath("/dashboard/appointments");
  return { ok: true };
}
