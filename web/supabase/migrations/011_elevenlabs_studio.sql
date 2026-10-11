-- Voice Studio edits and the support-ticket tool for dealerships on ElevenLabs: kept here so rewriting Priya's
-- script from Settings (or a later template change) never loses them. Dograh dealerships keep theirs inside Dograh.
alter table public.business_features
  add column if not exists elevenlabs_greeting        text,
  add column if not exists elevenlabs_instructions    text,
  add column if not exists elevenlabs_ticket_tool_id  text;
