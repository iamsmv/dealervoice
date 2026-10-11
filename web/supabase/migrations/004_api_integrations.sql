-- API & Integrations page.
-- Each dealership can bring its own Dograh account (falls back to the platform key when empty).
alter table public.business_secrets add column if not exists dograh_api_key text;
-- DealerVoice API key for the dealership's other software / MCP. Only a SHA-256 hash is stored.
alter table public.business_secrets add column if not exists api_key_hash text unique;
alter table public.business_secrets add column if not exists api_key_hint text;        -- last 4 characters, for display
alter table public.business_secrets add column if not exists api_key_created_at timestamptz;
