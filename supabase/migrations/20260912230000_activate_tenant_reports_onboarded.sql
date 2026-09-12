-- `activate_tenant` заодно отвечает, пройден ли у компании онбординг.
--
-- Переход в другую компанию занимал на симуляторе 30–60 секунд, и почти всё
-- это время экран держал гейт «Открываем компанию». Замер по шагам: сама
-- транзакция перехода — 5 секунд (activate 2.3 + refreshSession 2.5), а гейт
-- после неё — ЕЩЁ 29.
--
-- Гейт всё это время выяснял ровно один факт: у новой компании заполнен
-- `onboarded_at` или человека надо вести в мастер настройки. Ответ он берёт
-- отдельным запросом `current_tenant_profile_safe` — с таймаутом 6 секунд и
-- повтором, — и делает это сразу после смены токена, когда клиент ещё
-- разбирается с новой сессией: отсюда таймауты и минута ожидания.
--
-- Спрашивать незачем: `activate_tenant` в эту же секунду держит нужную строку
-- в руках. Возвращаем факт вместе с ролью — и клиент ставит тот самый штамп
-- «эта компания онбординг прошла», который гейт и так умеет читать без сети.
--
-- ФАКТ, А НЕ ДОГАДКА: возвращается именно `onboarded_at is not null`, а не
-- «раз есть календари, значит прошла». Догадка однажды провела бы человека
-- мимо мастера настройки его собственной компании.

create or replace function public.activate_tenant(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_master_id text;
  v_available jsonb;
  v_onboarded boolean;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to activate a tenant'
      using errcode = '42501';
  end if;

  select tm.role, tm.master_id
    into v_role, v_master_id
    from public.tenant_members tm
   where tm.tenant_id = p_tenant_id
     and tm.user_id = auth.uid();

  if not found then
    raise exception 'tenant membership not found'
      using errcode = '42501';
  end if;

  select t.onboarded_at is not null
    into v_onboarded
    from public.tenants t
   where t.id = p_tenant_id;

  select coalesce(
    jsonb_agg(x.tenant_id order by x.joined_at, x.tenant_id),
    '[]'::jsonb
  )
    into v_available
    from (
      select tm.tenant_id::text as tenant_id,
             min(tm.joined_at) as joined_at
        from public.tenant_members tm
       where tm.user_id = auth.uid()
       group by tm.tenant_id
    ) x;

  update auth.users u
     set raw_app_meta_data =
       (coalesce(u.raw_app_meta_data, '{}'::jsonb) - 'tenant_master_id')
       || jsonb_build_object(
         'tenant_id', p_tenant_id::text,
         'tenant_role', v_role,
         'available_tenants', v_available
       )
       || case
            when v_master_id is null then '{}'::jsonb
            else jsonb_build_object('tenant_master_id', v_master_id)
          end
   where u.id = auth.uid();

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'role', v_role,
    'master_id', v_master_id,
    'onboarded', coalesce(v_onboarded, false)
  );
end;
$$;

revoke all on function public.activate_tenant(uuid) from public, anon;
grant execute on function public.activate_tenant(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'activate_tenant'
       and position('onboarded' in p.prosrc) > 0
  ) then
    raise exception 'activate_tenant: факт онбординга не возвращается';
  end if;

  if has_function_privilege('anon', 'public.activate_tenant(uuid)', 'EXECUTE') then
    raise exception 'activate_tenant: функция открыта анониму';
  end if;
end $$;
