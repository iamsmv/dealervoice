-- Settings → Webhooks: where to send new leads / bookings, and the key used to sign them.
alter table public.businesses       add column if not exists webhook_url text;
alter table public.business_secrets add column if not exists webhook_secret text;
