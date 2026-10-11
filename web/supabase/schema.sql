-- DealerVoice database schema. Run once in Supabase → SQL Editor.

-- One row per dealership (tenant). Each signed-up user owns one business for now.
create table if not exists public.businesses (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  city            text,
  brands          text,                       -- e.g. "Tata: Nexon, Punch, Harrier"
  showroom_hours  text default 'Mon–Sat, 9:30 AM – 7 PM',
  service_hours   text default 'Mon–Sat, 9 AM – 6 PM',
  timezone        text not null default 'Asia/Kolkata',
  agent_name      text not null default 'Maya',
  dograh_workflow_id  text,                   -- the customer's agent in Dograh
  cal_event_type_id   bigint,                 -- Cal.com event used for test drives
  plan            text not null default 'trial',
  created_at      timestamptz not null default now(),
  unique (owner_id)
);

-- Secrets (Cal.com API key) live in a separate table that the browser can never read.
create table if not exists public.business_secrets (
  business_id   uuid primary key references public.businesses(id) on delete cascade,
  cal_api_key   text,
  updated_at    timestamptz not null default now()
);

-- Every booking the agent makes, for the customer's dashboard.
create table if not exists public.bookings (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  attendee_name  text,
  attendee_email text,
  attendee_phone text,
  start_time     timestamptz,
  cal_booking_uid text,
  status         text not null default 'booked',   -- booked | failed
  error          text,
  created_at     timestamptz not null default now()
);

alter table public.businesses       enable row level security;
alter table public.business_secrets enable row level security;
alter table public.bookings         enable row level security;

-- Owners can see and edit only their own business.
create policy "owner reads business"   on public.businesses for select using (owner_id = auth.uid());
create policy "owner creates business" on public.businesses for insert with check (owner_id = auth.uid());
create policy "owner updates business" on public.businesses for update using (owner_id = auth.uid());

-- Owners can read their own bookings. Writes come only from the server (service role).
create policy "owner reads bookings" on public.bookings for select
  using (business_id in (select id from public.businesses where owner_id = auth.uid()));

-- business_secrets has RLS on and no policies: only the server's service role can touch it.

-- ── Added 2026-10-06 (also in migrations/002_leads.sql) ──
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

-- 003_webhooks
alter table public.businesses       add column if not exists webhook_url text;
alter table public.business_secrets add column if not exists webhook_secret text;

-- 004_api_integrations
-- Each dealership can bring its own Dograh account (falls back to the platform key when empty).
alter table public.business_secrets add column if not exists dograh_api_key text;
-- DealerVoice API key for the dealership's other software / MCP. Only a SHA-256 hash is stored.
alter table public.business_secrets add column if not exists api_key_hash text unique;
alter table public.business_secrets add column if not exists api_key_hint text;        -- last 4 characters, for display
alter table public.business_secrets add column if not exists api_key_created_at timestamptz;

-- 005_agent_roles

-- Which dealerships have the extra agents switched on. Only the admin (server) reads or writes this.
create table if not exists public.business_features (
  business_id   uuid primary key references public.businesses(id) on delete cascade,
  extra_agents  boolean not null default false,
  updated_at    timestamptz not null default now()
);

-- One Dograh agent per job. The inbound receptionist stays in businesses.dograh_workflow_id.
create table if not exists public.business_agents (
  business_id         uuid not null references public.businesses(id) on delete cascade,
  role                text not null,           -- marketing | payments | support
  dograh_workflow_id  text not null,
  created_at          timestamptz not null default now(),
  primary key (business_id, role)
);

-- No policies: the browser can't read or change these; the server uses the service role.
alter table public.business_features enable row level security;
alter table public.business_agents   enable row level security;

-- 006_support_tickets
-- Support knowledge base (FAQ text the receptionist answers from) and the agent's ticket tool.
alter table public.business_features add column if not exists support_kb text;
alter table public.business_features add column if not exists ticket_tool_uuid text;

-- Tickets the receptionist opens when it can't solve a customer's problem on the call.
create table if not exists public.support_tickets (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  number         integer not null,                       -- per dealership: 1001, 1002…
  customer_name  text,
  phone          text,
  vehicle        text,                                   -- model and/or registration number
  category       text not null default 'other',          -- service | warranty | breakdown | billing | product_question | complaint | other
  priority       text not null default 'normal',         -- urgent | high | normal | low
  description    text not null,
  status         text not null default 'open',           -- open | in_progress | waiting_customer | resolved | closed
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  unique (business_id, number)
);

create index if not exists support_tickets_business_idx on public.support_tickets (business_id, created_at desc);

alter table public.support_tickets enable row level security;

-- Owners read and update their own tickets. Tickets are created by the server (the agent's tool).
create policy "owner reads tickets" on public.support_tickets for select
  using (business_id in (select id from public.businesses where owner_id = auth.uid()));
create policy "owner updates tickets" on public.support_tickets for update
  using (business_id in (select id from public.businesses where owner_id = auth.uid()));

-- 007_protect_business_columns
create or replace function public.businesses_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  jwt_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
begin
  if jwt_role in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.plan := 'trial';
      new.dograh_workflow_id := null;
    else
      new.plan := old.plan;
      new.dograh_workflow_id := old.dograh_workflow_id;
      new.owner_id := old.owner_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists businesses_guard on public.businesses;
create trigger businesses_guard before insert or update on public.businesses
  for each row execute function public.businesses_guard();
