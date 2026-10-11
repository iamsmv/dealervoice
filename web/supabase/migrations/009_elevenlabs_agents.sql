-- ElevenLabs agents for the extra jobs (marketing, payment reminders), one per dealership and role.
-- Kept apart from business_agents (Dograh) so the Dograh setup is untouched and switching back needs no data changes.
-- The receptionist's ElevenLabs agent stays in business_features.elevenlabs_agent_id.
create table if not exists public.elevenlabs_agents (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  role         text not null,           -- marketing | payments
  agent_id     text not null,
  created_at   timestamptz not null default now(),
  primary key (business_id, role)
);

-- No policies: only the server (service role) reads or writes this.
alter table public.elevenlabs_agents enable row level security;
