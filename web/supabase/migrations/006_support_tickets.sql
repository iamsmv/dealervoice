-- L1 support (client requirement #4). Additive only; nothing existing changes.

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
