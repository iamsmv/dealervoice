import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCalBooking } from "@/lib/cal";
import { sendBookingConfirmation } from "@/lib/whatsapp";
import { recordBookingLead } from "@/lib/leads";
import { sendWebhook } from "@/lib/webhooks";
import { isAuthorisedToolCall } from "@/lib/tool-auth";

// Called by every dealership's agent (Dograh tool "dv_book_appointment").
// business_id comes from the agent's own variables, so one endpoint serves all tenants.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const { business_id, name, email, phone, start_time, car_model } = body ?? {};
  if (!(await isAuthorisedToolCall(request.headers, business_id))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!business_id || !name || !email || !start_time) {
    return NextResponse.json(
      { ok: false, message: "Missing business_id, name, email or start_time." },
      { status: 400 },
    );
  }

  const db = createAdminClient();
  const { data: business } = await db
    .from("businesses")
    .select("id, name, timezone, cal_event_type_id, business_secrets(cal_api_key)")
    .eq("id", business_id)
    .maybeSingle();

  const secrets = business?.business_secrets as { cal_api_key: string | null } | null | undefined;
  if (!business || !business.cal_event_type_id || !secrets?.cal_api_key) {
    return NextResponse.json(
      { ok: false, message: "This dealership has not connected its calendar yet." },
      { status: 409 },
    );
  }

  try {
    const booking = await createCalBooking({
      apiKey: secrets.cal_api_key,
      eventTypeId: business.cal_event_type_id,
      name,
      email,
      phone,
      startTime: start_time,
      timeZone: business.timezone,
    });

    const { error: saveError } = await db.from("bookings").insert({
      business_id,
      attendee_name: name,
      attendee_email: email,
      attendee_phone: phone,
      start_time: booking.start,
      cal_booking_uid: booking.uid,
    });
    // The slot is already booked in Cal.com, so carry on; just make the missing row visible in the logs.
    if (saveError) console.error(`Booking ${booking.uid} saved in Cal.com but not in the database:`, saveError.message);

    after(() =>
      sendWebhook(business_id, "booking.created", {
        name,
        email,
        phone: phone ?? null,
        car_model: typeof car_model === "string" ? car_model : null,
        start_time: booking.start,
        cal_booking_uid: booking.uid,
      }),
    );

    await recordBookingLead({ businessId: business_id, name, email, phone, carModel: typeof car_model === "string" ? car_model.trim().slice(0, 60) : undefined }).catch((err) =>
      console.error("Could not update lead after booking:", err),
    );

    const whatsappSent = phone
      ? await sendBookingConfirmation({
          to: phone,
          name,
          dealershipName: business.name,
          startTime: booking.start,
          timeZone: business.timezone,
        })
      : false;

    return NextResponse.json({
      ok: true,
      message: whatsappSent
        ? "Booked. A confirmation has been sent by email and WhatsApp."
        : "Booked. A confirmation email has been sent.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Booking failed";
    await db.from("bookings").insert({
      business_id,
      attendee_name: name,
      attendee_email: email,
      attendee_phone: phone,
      status: "failed",
      error: message,
    });
    // Non-2xx tells the agent the booking did not happen, so it won't claim success.
    return NextResponse.json({ ok: false, message }, { status: 422 });
  }
}
