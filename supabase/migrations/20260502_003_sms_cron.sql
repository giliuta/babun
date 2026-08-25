-- ─────────────────────────────────────────────────────────────────────
-- STORY-047 G4 — pg_cron schedule for the send_sms Edge Function.
--
-- The cron heartbeat fires `send_sms` every 5 minutes. The Edge
-- Function does all of the work:
--   * checks `app_settings.sms_enabled = 'on'` (master switch)
--   * iterates enabled tenant_sms_config rows
--   * matches appointments against the 24h / 2h windows
--   * inserts sms_messages with the rendered template
--
-- So pg_cron never needs to know "is SMS on" — keep its body trivial.
--
-- pg_cron schema gotcha (parallel to STORY-053b's pg_net lesson): the
-- extension installs from the `extensions` schema, but its bookkeeping
-- tables (cron.job, cron.job_run_details) live in a hardcoded `cron`
-- schema regardless of the `with schema extensions` clause. Same
-- pattern as `extensions.http_post` vs `net._http_response`. Don't
-- try to qualify cron.schedule with the wrong namespace.
--
-- Auth pattern: send_sms has Verify JWT OFF (matches send_push),
-- so the cron call doesn't need an Authorization header. Keeping
-- the call body minimal also avoids leaking any service-role key
-- through GUC lookups (`current_setting('app.settings.service_role_key')`
-- is a Supabase managed feature but not portable; we don't depend on it).
--
-- Idempotency: `cron.schedule` upserts by jobname when the same name
-- is reused. Re-running this migration replaces the prior schedule
-- with the new one rather than spawning a duplicate.
-- ─────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron with schema extensions;

-- Re-running the migration replaces the prior schedule rather than
-- spawning a duplicate. cron.schedule on a duplicate jobname raises;
-- unschedule first defensively.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sms_reminder_check') then
    perform cron.unschedule('sms_reminder_check');
  end if;
end $$;

select cron.schedule(
  'sms_reminder_check',
  '*/5 * * * *',  -- every 5 minutes (top, :05, :10, ...)
  $$
    select extensions.http_post(
      url     := 'https://rdtokosbqvgemicqeqwz.supabase.co/functions/v1/send_sms',
      body    := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  $$
);

comment on extension pg_cron is
  'STORY-047 G4 — schedule the send_sms Edge Function every 5 minutes. '
  'Other future cron jobs (quota refresh, push retry, etc.) ride on '
  'the same extension; bookkeeping is in the hardcoded cron schema.';

-- Diagnostics / runbook
-- ────────────────────────────────────────────────────────────────────
-- List active jobs:
--   select jobid, schedule, command, active, jobname from cron.job;
--
-- Manually fire the SMS sweep right now:
--   select cron.dispatch('sms_reminder_check');
--   -- or curl directly:
--   -- curl -X POST '.../functions/v1/send_sms' -H 'content-type: application/json' --data '{}'
--
-- Most recent runs:
--   select start_time, end_time, status, return_message
--     from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname='sms_reminder_check')
--    order by start_time desc limit 20;
--
-- Disable the schedule (without dropping it):
--   update cron.job set active = false where jobname = 'sms_reminder_check';
--
-- Re-enable:
--   update cron.job set active = true  where jobname = 'sms_reminder_check';
--
-- Drop the schedule entirely:
--   select cron.unschedule('sms_reminder_check');
