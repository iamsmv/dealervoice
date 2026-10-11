-- Zoho Desk as the ticket system of record: a dealership connects its Zoho Desk, Priya creates tickets there
-- during the call (the customer hears Zoho's number) and our dashboard keeps a synced copy.
alter table public.business_secrets
  add column if not exists zoho_refresh_token text;

alter table public.business_features
  add column if not exists zoho_org_id        text,
  add column if not exists zoho_department_id text,
  add column if not exists zoho_portal_url    text;   -- e.g. https://desk.zoho.in/agent/<portal>/<department>, for "Open in Zoho" links

alter table public.support_tickets
  add column if not exists zoho_ticket_id     text,
  add column if not exists zoho_ticket_number text,
  add column if not exists zoho_web_url       text,
  -- 'synced' (in Zoho), 'pending' (Zoho was down: created with our number, pushed later), null (dealer has no Zoho)
  add column if not exists zoho_sync          text check (zoho_sync in ('synced', 'pending'));

create index if not exists support_tickets_zoho_open on public.support_tickets (business_id) where zoho_ticket_id is not null and status not in ('resolved', 'closed');
create index if not exists support_tickets_zoho_pending on public.support_tickets (business_id) where zoho_sync = 'pending';
