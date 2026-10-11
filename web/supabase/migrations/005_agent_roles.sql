-- Client requirements (marketing, payment reminders, support): extra agents per dealership.
-- Additive only: the original single-receptionist setup (businesses.dograh_workflow_id) is untouched,
-- so switching the feature off (or rolling back to tag v1-video) needs no database changes.

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
