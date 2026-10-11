# DealerVoice

AI voice receptionist and outbound calling dashboard for car dealerships.

- `web/` — Next.js app (dashboard, API routes, Supabase schema and migrations in `web/supabase/`)
- `prompts/` — voice agent system prompts
- `n8n/` — n8n request body used for Cal.com bookings
- `scripts/` — server install, packaging and deploy scripts

## Run locally

```bash
cd web
cp .env.local.example .env.local   # fill in your own keys
npm install
npm run dev
```

No credentials are included in this repository; every key is read from environment variables.
