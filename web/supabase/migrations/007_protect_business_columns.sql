-- Security fix: a signed-in dealer could change their own plan, agent id or owner straight
-- through the database API (the "owner updates business" policy covers every column).
-- This trigger keeps those columns server-only. The server (service role) and the SQL editor are unaffected.

create or replace function public.businesses_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  jwt_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
begin
  if jwt_role in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.plan := 'trial';
      new.dograh_workflow_id := null;
    else
      new.plan := old.plan;
      new.dograh_workflow_id := old.dograh_workflow_id;
      new.owner_id := old.owner_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists businesses_guard on public.businesses;
create trigger businesses_guard before insert or update on public.businesses
  for each row execute function public.businesses_guard();
