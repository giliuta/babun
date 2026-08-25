-- ─────────────────────────────────────────────────────────────────────
-- STORY-053b — fix _dispatch_push to call net.http_post (G3 hotfix).
--
-- Mirrors a function-body fix already applied via SQL Editor on
-- 2026-05-01 during G3 manual smoke. Recorded here so a fresh DB
-- reproduces production state.
--
-- Why: pg_net always installs its functions in the `net` schema,
-- ignoring the `WITH SCHEMA extensions` clause we passed at
-- `CREATE EXTENSION pg_net WITH SCHEMA extensions` in 20260501_003.
-- The original `_dispatch_push` called `extensions.http_post(...)`,
-- which does not exist. The function's `EXCEPTION WHEN OTHERS`
-- handler swallowed the "function does not exist" error so the
-- bug only surfaced when the smoke checked `net._http_response`
-- and saw zero rows even with the master flag flipped on.
--
-- Fix: call `net.http_post(...)`. Also add `net` to the function's
-- search_path as a defensive measure so the unqualified `http_post`
-- name would also resolve.
--
-- Lesson for future migrations: any extension that ships its own
-- schema (pg_net, pg_cron, postgis, …) probably ignores the
-- `CREATE EXTENSION ... WITH SCHEMA` clause. Always check
-- `pg_proc` for the actual schema after installing.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public._dispatch_push(
  p_event_type text,
  p_data       jsonb,
  p_recipients uuid[]
) returns void
  language plpgsql
  security definer
  set search_path = public, net, extensions
as $$
declare
  push_enabled text;
  skip_push    text;
  fn_url       text := 'https://rdtokosbqvgemicqeqwz.supabase.co/functions/v1/send_push';
begin
  -- Master switch (global). Read fresh on each call so flag flips
  -- take effect immediately. Missing row = treat as OFF (safe default).
  select value into push_enabled
    from public.app_settings
   where key = 'push_enabled';
  if not found or push_enabled is distinct from 'on' then
    return;
  end if;

  -- Bulk-import mute (transaction-scoped GUC).
  skip_push := current_setting('app.skip_push', true);
  if skip_push = '1' then
    return;
  end if;

  if p_recipients is null or cardinality(p_recipients) = 0 then
    return;
  end if;

  -- Fire and forget. pg_net queues the request and returns immediately.
  -- Failures land in net._http_response / function logs; we never
  -- propagate them up to the parent INSERT/UPDATE.
  perform net.http_post(
    url     := fn_url,
    body    := jsonb_build_object(
                 'user_ids',   to_jsonb(p_recipients),
                 'event_type', p_event_type,
                 'data',       p_data
               ),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
exception when others then
  raise warning 'dispatch_push failed: %', sqlerrm;
end;
$$;

comment on function public._dispatch_push(text, jsonb, uuid[]) is
  'STORY-053b — internal helper. Fan-out to send_push Edge Function. '
  'Gated by app_settings.push_enabled + transaction-scoped app.skip_push. '
  'Calls net.http_post (pg_net always installs into the net schema).';
