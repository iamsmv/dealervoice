-- Which voice platform a dealership's calls use: Dograh (default, the original setup) or ElevenLabs ElevenAgents.
-- Additive only: every dealership stays on Dograh until the admin switches it, and switching back needs no data changes.
alter table public.business_features
  add column if not exists voice_provider      text not null default 'dograh' check (voice_provider in ('dograh', 'elevenlabs')),
  add column if not exists elevenlabs_agent_id text;
