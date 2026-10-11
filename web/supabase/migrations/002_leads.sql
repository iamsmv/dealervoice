-- Leads: every caller or enquiry for a dealership, one row per phone number.
-- Created automatically from phone calls and bookings, or added by hand.
create table if not exists public.leads (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  name             text,
  phone            text,                                -- E.164, e.g. +919876543210
  email            text,
  car_interest     text,                                -- e.g. "Nexon EV"
  source           text not null default 'manual',      -- phone_call | booking | manual
  stage            text not null default 'new',         -- new | contacted | test_drive_booked | negotiating | sold | lost
  notes            text,
  last_contact_at  timestamptz,
  created_at       timestamptz not null default now(),
  unique (business_id, phone)
);

create index if not exists leads_business_created_idx on public.leads (business_id, created_at desc);

alter table public.leads enable row level security;

-- Owners read and edit their own leads. Automatic writes come from the server (service role).
create policy "owner reads leads" on public.leads for select
  using (business_id in (select id from public.businesses where owner_id = auth.uid()));
create policy "owner creates leads" on public.leads for insert
  with check (business_id in (select id from public.businesses where owner_id = auth.uid()));
create policy "owner updates leads" on public.leads for update
  using (business_id in (select id from public.businesses where owner_id = auth.uid()));
create policy "owner deletes leads" on public.leads for delete
  using (business_id in (select id from public.businesses where owner_id = auth.uid()));

-- One-off: turn bookings made before this table existed into leads (latest booking per phone).
insert into public.leads (business_id, name, email, phone, source, stage, last_contact_at, created_at)
select distinct on (business_id, attendee_phone)
       business_id, attendee_name, attendee_email, attendee_phone, 'booking', 'test_drive_booked', created_at, created_at
from public.bookings
where status = 'booked' and attendee_phone is not null
order by business_id, attendee_phone, created_at desc
on conflict (business_id, phone) do nothing;
