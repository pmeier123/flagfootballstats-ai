-- One-time setup of the automatic Sheets export (run in the Supabase SQL editor after deploying the function).
-- Replace the three placeholders before running. Do NOT commit the filled-in file.
--   <PROJECT_REF>   e.g. abcdefghijklmnop
--   <EXPORT_SECRET> the same random value you stored as the function secret EXPORT_SECRET

create extension if not exists pg_cron;
create extension if not exists pg_net;

insert into public.settings (key, value) values
  ('sheets_export', 'on'),
  ('export_url', 'https://<PROJECT_REF>.supabase.co/functions/v1/export-sheets'),
  ('export_secret', '<EXPORT_SECRET>')
on conflict (key) do update set value = excluded.value;

-- Calls the export function only when a game has events that are not exported yet.
create or replace function public.trigger_export() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text := (select value from public.settings where key = 'export_url');
  v_secret text := (select value from public.settings where key = 'export_secret');
begin
  if v_url is null or v_secret is null then return; end if;
  if exists (
    select 1 from public.game_seq g
    left join public.export_state s on s.game_id = g.game_id
    where g.next_seq > coalesce(s.last_seq, 0)
  ) then
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  end if;
end $$;

revoke all on function public.trigger_export() from public, anon, authenticated;

select cron.unschedule('export-sheets') where exists (select 1 from cron.job where jobname = 'export-sheets');
-- Every minute: cheap check inside the database, the function is only invoked when something is pending.
select cron.schedule('export-sheets', '* * * * *', $$select public.trigger_export()$$);

-- Keeps the free project from being paused for inactivity (the check above already touches the database every minute).
select cron.unschedule('keepalive') where exists (select 1 from cron.job where jobname = 'keepalive');
select cron.schedule('keepalive', '0 6 * * *', $$select 1$$);
