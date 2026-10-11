import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatPhone } from "@/lib/format";
import { AppointmentControls } from "./appointment-controls";
import { EmptyState, PageHeader, TabLinks, card } from "../ui";

type Booking = {
  id: string;
  attendee_name: string | null;
  attendee_email: string | null;
  attendee_phone: string | null;
  start_time: string | null;
  status: string;
  error: string | null;
  created_at: string;
};

const statusBadge: Record<string, { label: string; className: string }> = {
  booked: { label: "Booked", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  cancelled: { label: "Cancelled", className: "bg-slate-100 text-slate-600 ring-slate-200" },
  failed: { label: "Failed – call back", className: "bg-red-50 text-red-700 ring-red-200" },
};

export default async function AppointmentsPage({ searchParams }: PageProps<"/dashboard/appointments">) {
  const { show = "upcoming" } = (await searchParams) as Record<string, string | undefined>;

  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id").maybeSingle();
  if (!business) redirect("/dashboard");

  const { data } = await supabase
    .from("bookings")
    .select("id, attendee_name, attendee_email, attendee_phone, start_time, status, error, created_at")
    .order("start_time", { ascending: true, nullsFirst: false })
    .limit(500);
  const bookings = (data ?? []) as Booking[];

  const now = new Date().toISOString();
  const isUpcoming = (b: Booking) => b.status === "booked" && !!b.start_time && b.start_time >= now;
  const tabs = {
    upcoming: bookings.filter(isUpcoming),
    past: bookings.filter((b) => b.status === "booked" && !isUpcoming(b)).reverse(),
    other: bookings.filter((b) => b.status !== "booked").reverse(),
  };
  const current = show in tabs ? (show as keyof typeof tabs) : "upcoming";
  const shown = tabs[current];
  const tabLabels = { upcoming: "Upcoming", past: "Past", other: "Cancelled & failed" };

  return (
    <main className="px-4 py-8 md:px-8">
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Appointments" description="Test drives and visits booked by your receptionist. Changes here update your Cal.com calendar." />

        <div className="mt-6">
          <TabLinks
            label="Appointment views"
            tabs={(Object.keys(tabs) as (keyof typeof tabs)[]).map((key) => ({
              href: `/dashboard/appointments?show=${key}`,
              active: key === current,
              label: (
                <>
                  {tabLabels[key]} <span className="ml-1 rounded-full bg-slate-200 px-1.5 text-xs tabular-nums text-slate-700">{tabs[key].length}</span>
                </>
              ),
            }))}
          />
        </div>

        <ul className={`mt-4 divide-y divide-slate-100 ${card}`}>
          {shown.map((b) => {
            const badge = statusBadge[b.status] ?? { label: b.status, className: "bg-slate-100 text-slate-600" };
            return (
              <li key={b.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                    <span>📅 {b.start_time ? formatDateTime(b.start_time) : "No time"}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${badge.className}`} title={b.error ?? ""}>
                      {badge.label}
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-slate-700">{b.attendee_name ?? "Unknown"} · {formatPhone(b.attendee_phone)}</p>
                  {b.attendee_email && <p className="truncate text-xs text-slate-500">{b.attendee_email}</p>}
                </div>
                {current === "upcoming" && <AppointmentControls bookingId={b.id} />}
              </li>
            );
          })}
          {shown.length === 0 && (
            <li>
              <EmptyState icon="📅" title={current === "upcoming" ? "No upcoming appointments" : "Nothing here yet"}>
                {current === "upcoming" ? "New test drives booked by your receptionist will show up here." : undefined}
              </EmptyState>
            </li>
          )}
        </ul>
      </div>
    </main>
  );
}
