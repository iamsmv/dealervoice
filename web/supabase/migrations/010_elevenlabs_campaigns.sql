-- Call lists placed through ElevenLabs batch calling: campaigns, Quick calls and website-form callbacks.
-- ElevenLabs has no calling hours, pause or automatic retry, so our server runs each list: it sends a batch
-- during calling hours, stops it when hours end, and sends one retry for people who didn't answer.
create table if not exists public.elevenlabs_campaigns (
  id             bigint generated always as identity primary key,
  business_id    uuid not null references public.businesses(id) on delete cascade,
  kind           text not null check (kind in ('campaign', 'quick', 'form')),
  role           text not null check (role in ('follow_up', 'marketing', 'payments')),
  name           text not null,
  agent_id       text not null,
  -- [{ id, phone, label, variables, greeting, attempts, status, conversation_id, finished_at }]
  contacts       jsonb not null,
  timezone       text not null default 'Asia/Kolkata',
  end_time       text not null default '20:00',  -- last dialling time; payment reminders '19:00'
  retry_minutes  int  not null default 30,       -- one retry this long after a missed call
  state          text not null default 'draft' check (state in ('draft', 'running', 'paused', 'completed', 'cancelled')),
  batch_id       text,                           -- the ElevenLabs batch dialling now, if any
  parent_id      bigint references public.elevenlabs_campaigns(id),  -- set on a "call back" list
  redialed       boolean not null default false,  -- a call-back list was made from this one
  removed        boolean not null default false,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  completed_at   timestamptz
);

create index if not exists elevenlabs_campaigns_active on public.elevenlabs_campaigns (state) where state = 'running';
create index if not exists elevenlabs_campaigns_business on public.elevenlabs_campaigns (business_id, created_at desc);

-- No policies: only the server (service role) reads or writes this.
alter table public.elevenlabs_campaigns enable row level security;
