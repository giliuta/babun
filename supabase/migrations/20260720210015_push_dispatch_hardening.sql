-- send_push also runs with gateway JWT verification disabled because its
-- The 14-digit prefix is a unique Supabase CLI migration version.
-- caller is a Postgres trigger. Authenticate that internal hop explicitly and
-- close the historically client-callable _dispatch_push SECURITY DEFINER RPC.

insert into public.edge_cron_secrets (name, secret)
values ('send_push', encode(gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

create or replace function public._dispatch_push(
  p_event_type text,
  p_data jsonb,
  p_recipients uuid[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  push_enabled text;
  skip_push text;
  dispatch_secret text;
  fn_url text := 'https://rdtokosbqvgemicqeqwz.supabase.co/functions/v1/send_push';
begin
  select setting.value into push_enabled
    from public.app_settings setting
   where setting.key = 'push_enabled';
  if not found or push_enabled is distinct from 'on' then
    return;
  end if;

  skip_push := current_setting('app.skip_push', true);
  if skip_push = '1'
     or p_recipients is null
     or cardinality(p_recipients) = 0 then
    return;
  end if;
  if cardinality(p_recipients) > 500 then
    raise exception 'Push recipient limit exceeded';
  end if;

  select secret.secret into dispatch_secret
    from public.edge_cron_secrets secret
   where secret.name = 'send_push';
  if dispatch_secret is null then
    raise exception 'Push dispatch secret is missing';
  end if;

  perform net.http_post(
    url := fn_url,
    body := jsonb_build_object(
      'user_ids', to_jsonb(p_recipients),
      'event_type', p_event_type,
      'data', p_data
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', dispatch_secret
    )
  );
exception when others then
  -- Notifications remain best-effort and never roll back the business write.
  raise warning 'dispatch_push failed: %', sqlerrm;
end;
$function$;

revoke all on function public._dispatch_push(text, jsonb, uuid[])
  from public, anon, authenticated;

do $audit$
begin
  if has_function_privilege(
       'anon', 'public._dispatch_push(text,jsonb,uuid[])', 'EXECUTE'
     )
     or has_function_privilege(
       'authenticated', 'public._dispatch_push(text,jsonb,uuid[])', 'EXECUTE'
     ) then
    raise exception 'Push dispatch helper remains client-callable';
  end if;
  if position(
       'x-dispatch-secret'
       in pg_get_functiondef(
         'public._dispatch_push(text,jsonb,uuid[])'::regprocedure
       )
     ) = 0 then
    raise exception 'Push dispatch secret header is missing';
  end if;
end;
$audit$;
