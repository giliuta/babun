-- ⚠️ ПЕРЕД НАКАТОМ (16.09, нашла сессия 009): тело `enforce_plan_limits` ниже снято
-- ДО НДС-миграций 009 и вернуло бы ветку `invoices` без пропуска кредит-ноты — на
-- бесплатном тарифе `cancel_invoice` откатится. Взять ЖИВОЕ тело (16.09
-- `md5(prosrc)` = ca611e347120088fe5630652c152bb32), заменить в нём только
-- `public.tenant_effective_plan` → `public._tenant_effective_plan` и прогнать в откате заново.
--
-- ТАРИФ И ЛИМИТЫ КОМПАНИИ ВИДИТ ТОЛЬКО ЕЁ УЧАСТНИК.
--
-- Нашла сессия 007 (15.09): `tenant_effective_plan` и пять `tenant_quota_*`
-- (`20260503_001_billing.sql`) — security definer без проверки членства. Любой
-- вошедший узнавал тариф и лимиты ЧУЖОЙ компании по её UUID, а UUID компаний
-- продукт раздаёт (приглашения, ответы rpc). У anon права не было и нет.
--
-- ПОЧЕМУ НЕ ПРОСТО REVOKE И НЕ ПРОВЕРКА ВНУТРИ:
--   • приложение (`src/lib/quota.ts`) при ошибке этих rpc не даёт создать
--     клиента или запись — отзыв у authenticated сломал бы выпущенную сборку;
--   • триггер `enforce_tenant_insert_quota` зовёт лимит команды при вставке в
--     tenant_members из `accept_invitation`, когда вошедший ещё НЕ член компании.
--     Проверка членства в самой функции сорвала бы приём приглашения.
--
-- ПОЭТОМУ ТРИ СЛОЯ:
--   1. тела — во внутренних `_tenant_effective_plan` и `_tenant_quota_*`, закрытых
--      от anon и authenticated; значения лимитов перенесены без изменений;
--   2. оба триггера (`enforce_tenant_insert_quota`, `enforce_plan_limits`, оба
--      security definer) зовут внутренние имена; остальной текст дословно прежний;
--   3. публичные имена — обёртки: пускают, если входа нет (сервисный ключ,
--      внутренние вызовы) или вошедший — участник этой компании; иначе 42501,
--      hint `quota:not_member`. Клиенту менять ничего не нужно.

create or replace function public._tenant_effective_plan(t_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(plan_override, plan) from public.tenants where id = t_id;
$function$;

create or replace function public._tenant_quota_clients(t_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $function$
  select case public._tenant_effective_plan(t_id)
    when 'lifetime'       then 999999999
    when 'beta_unlimited' then 999999999
    when 'business'       then 999999999
    when 'pro'            then 1000
    else 100
  end;
$function$;

create or replace function public._tenant_quota_appointments_month(t_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $function$
  select case public._tenant_effective_plan(t_id)
    when 'lifetime'       then 999999999
    when 'beta_unlimited' then 999999999
    when 'business'       then 999999999
    when 'pro'            then 999999999
    else 50
  end;
$function$;

create or replace function public._tenant_quota_team_members(t_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $function$
  select case public._tenant_effective_plan(t_id)
    when 'lifetime'       then 999999999
    when 'beta_unlimited' then 999999999
    when 'business'       then 999999999
    when 'pro'            then 5
    else 1
  end;
$function$;

create or replace function public._tenant_quota_sms_month(t_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(
    (select c.free_quota_per_month from public.tenant_sms_config c where c.tenant_id = t_id),
    case public._tenant_effective_plan(t_id)
      when 'lifetime'       then 999999999
      when 'beta_unlimited' then 999999999
      when 'business'       then 999999999
      when 'pro'            then 200
      else 10
    end
  );
$function$;

create or replace function public._tenant_quota_reader_allowed(t_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select auth.uid() is null
      or exists (
        select 1 from public.tenant_members tm
         where tm.tenant_id = t_id and tm.user_id = auth.uid()
      );
$function$;

revoke all on function public._tenant_effective_plan(uuid) from public, anon, authenticated;
revoke all on function public._tenant_quota_clients(uuid) from public, anon, authenticated;
revoke all on function public._tenant_quota_appointments_month(uuid) from public, anon, authenticated;
revoke all on function public._tenant_quota_team_members(uuid) from public, anon, authenticated;
revoke all on function public._tenant_quota_sms_month(uuid) from public, anon, authenticated;
revoke all on function public._tenant_quota_reader_allowed(uuid) from public, anon, authenticated;

create or replace function public.tenant_effective_plan(t_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not public._tenant_quota_reader_allowed(t_id) then
    raise exception 'тариф и лимиты компании видит только её участник'
      using errcode = '42501', hint = 'quota:not_member';
  end if;
  return public._tenant_effective_plan(t_id);
end;
$function$;

create or replace function public.tenant_quota_clients(t_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not public._tenant_quota_reader_allowed(t_id) then
    raise exception 'тариф и лимиты компании видит только её участник'
      using errcode = '42501', hint = 'quota:not_member';
  end if;
  return public._tenant_quota_clients(t_id);
end;
$function$;

create or replace function public.tenant_quota_appointments_month(t_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not public._tenant_quota_reader_allowed(t_id) then
    raise exception 'тариф и лимиты компании видит только её участник'
      using errcode = '42501', hint = 'quota:not_member';
  end if;
  return public._tenant_quota_appointments_month(t_id);
end;
$function$;

create or replace function public.tenant_quota_team_members(t_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not public._tenant_quota_reader_allowed(t_id) then
    raise exception 'тариф и лимиты компании видит только её участник'
      using errcode = '42501', hint = 'quota:not_member';
  end if;
  return public._tenant_quota_team_members(t_id);
end;
$function$;

create or replace function public.tenant_quota_sms_month(t_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not public._tenant_quota_reader_allowed(t_id) then
    raise exception 'тариф и лимиты компании видит только её участник'
      using errcode = '42501', hint = 'quota:not_member';
  end if;
  return public._tenant_quota_sms_month(t_id);
end;
$function$;

create or replace function public.tenant_quota_summary(t_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not public._tenant_quota_reader_allowed(t_id) then
    raise exception 'тариф и лимиты компании видит только её участник'
      using errcode = '42501', hint = 'quota:not_member';
  end if;
  return jsonb_build_object(
    'plan',               public._tenant_effective_plan(t_id),
    'clients',            public._tenant_quota_clients(t_id),
    'appointments_month', public._tenant_quota_appointments_month(t_id),
    'team_members',       public._tenant_quota_team_members(t_id),
    'sms_month',          public._tenant_quota_sms_month(t_id)
  );
end;
$function$;

create or replace function public.enforce_plan_limits()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_plan text;
begin
  if new.tenant_id is null then
    raise exception 'ограничение тарифа требует tenant_id' using errcode = '22023';
  end if;

  v_plan := public._tenant_effective_plan(new.tenant_id);

  if v_plan is distinct from 'free' then
    return new;
  end if;

  if tg_table_name = 'appointments' then
    if new.kind = 'work' then
      raise exception 'Записывать клиентов в этом тарифе нельзя'
        using errcode = 'P0001', hint = 'plan:book-clients';
    end if;
    return new;
  end if;

  if tg_table_name = 'services' then
    raise exception 'Услуги доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:services';
  end if;

  if tg_table_name = 'masters' then
    raise exception 'Мастера доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:masters';
  end if;

  if tg_table_name = 'invoices' then
    raise exception 'Документы доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:documents';
  end if;

  return new;
end;
$function$;

create or replace function public.enforce_tenant_insert_quota()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_limit integer;
  v_current integer;
  v_pending integer;
  v_projected integer;
  v_has_reserved_invitation boolean := false;
  v_month_start timestamptz;
begin
  if new.tenant_id is null then
    raise exception 'quota guard requires tenant_id'
      using errcode = '22023';
  end if;

  if tg_table_schema <> 'public' then
    raise exception 'quota guard attached outside public schema'
      using errcode = '55000';
  end if;

  if tg_table_name = 'clients' then
    perform pg_advisory_xact_lock(
      hashtextextended('tenant-quota:clients:' || new.tenant_id::text, 0)
    );

    v_limit := public._tenant_quota_clients(new.tenant_id);
    select count(*)::integer
      into v_current
      from public.clients client
     where client.tenant_id = new.tenant_id;

    if v_current >= v_limit then
      raise exception 'quota_exceeded: clients %/%', v_current, v_limit
        using errcode = 'P0001',
              detail = 'quota_exceeded:clients';
    end if;
    return new;
  end if;

  if tg_table_name = 'appointments' then
    if tg_op = 'UPDATE' then
      if new.created_at is distinct from old.created_at then
        raise exception 'appointment created_at is server-owned and immutable'
          using errcode = '22023';
      end if;
      return new;
    end if;

    -- Match the billing UI/repository contract: usage belongs to the UTC
    -- calendar month in which the server received the row, not the scheduled
    -- date. Stamping + immutability closes the direct-PostgREST backdating
    -- bypass while leaving the operational appointment date untouched.
    new.created_at := statement_timestamp();
    v_month_start := date_trunc(
      'month',
      timezone('UTC', new.created_at)
    ) at time zone 'UTC';

    perform pg_advisory_xact_lock(
      hashtextextended(
        'tenant-quota:appointments-month:' || new.tenant_id::text,
        0
      )
    );

    v_limit := public._tenant_quota_appointments_month(new.tenant_id);
    select count(*)::integer
      into v_current
      from public.appointments appointment
     where appointment.tenant_id = new.tenant_id
       and appointment.created_at >= v_month_start
       and appointment.created_at < v_month_start + interval '1 month';

    if v_current >= v_limit then
      raise exception 'quota_exceeded: appointments_month %/%',
        v_current, v_limit
        using errcode = 'P0001',
              detail = 'quota_exceeded:appointments_month';
    end if;
    return new;
  end if;

  if tg_table_name = 'invitations' then
    -- Accepted or already-expired audit rows do not reserve a team slot.
    if new.accepted_at is not null or new.expires_at <= statement_timestamp() then
      return new;
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('tenant-quota:team-members:' || new.tenant_id::text, 0)
    );

    v_limit := public._tenant_quota_team_members(new.tenant_id);
    select count(*)::integer
      into v_current
      from public.tenant_members member
     where member.tenant_id = new.tenant_id;
    select count(*)::integer
      into v_pending
      from public.invitations invitation
     where invitation.tenant_id = new.tenant_id
       and invitation.accepted_at is null
       and invitation.expires_at > statement_timestamp();

    v_projected := v_current + v_pending + 1;
    if v_projected > v_limit then
      raise exception 'quota_exceeded: team_members %/%',
        v_current + v_pending, v_limit
        using errcode = 'P0001',
              detail = 'quota_exceeded:team_members';
    end if;
    return new;
  end if;

  if tg_table_name = 'tenant_members' then
    perform pg_advisory_xact_lock(
      hashtextextended('tenant-quota:team-members:' || new.tenant_id::text, 0)
    );

    v_limit := public._tenant_quota_team_members(new.tenant_id);
    select count(*)::integer
      into v_current
      from public.tenant_members member
     where member.tenant_id = new.tenant_id;
    select count(*)::integer
      into v_pending
      from public.invitations invitation
     where invitation.tenant_id = new.tenant_id
       and invitation.accepted_at is null
       and invitation.expires_at > statement_timestamp();

    -- accept_invitation() and invited handle_new_user() insert membership
    -- before stamping accepted_at. Match that user's active bearer row so the
    -- pending reservation is converted, not double-counted. Ordinary owner
    -- bootstrap has no reservation and naturally consumes the Free slot 1/1.
    select exists (
      select 1
        from auth.users account
        join public.invitations invitation
          on invitation.tenant_id = new.tenant_id
         and lower(invitation.email) = lower(coalesce(account.email, ''))
       where account.id = new.user_id
         and invitation.accepted_at is null
         and invitation.expires_at > statement_timestamp()
         and invitation.role = new.role
         and invitation.master_id is not distinct from new.master_id
    ) into v_has_reserved_invitation;

    v_projected := v_current + v_pending
      + case when v_has_reserved_invitation then 0 else 1 end;
    if v_projected > v_limit then
      raise exception 'quota_exceeded: team_members %/%',
        v_current + v_pending, v_limit
        using errcode = 'P0001',
              detail = 'quota_exceeded:team_members';
    end if;
    return new;
  end if;

  raise exception 'quota guard attached to unsupported table %', tg_table_name
    using errcode = '55000';
end;
$function$;

do $guard$
declare
  v_body text;
begin
  select string_agg(pg_get_functiondef(p.oid), E'\n') into v_body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('enforce_tenant_insert_quota', 'enforce_plan_limits');
  if position('public.tenant_quota_' in v_body) > 0 or position('public.tenant_effective_plan(' in v_body) > 0 then
    raise exception 'миграция: триггер квот всё ещё зовёт публичные обёртки';
  end if;
  if has_function_privilege('authenticated', 'public._tenant_effective_plan(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._tenant_quota_team_members(uuid)', 'execute')
     or has_function_privilege('anon', 'public.tenant_quota_summary(uuid)', 'execute') then
    raise exception 'миграция: внутренние тела квот открыты';
  end if;
  if not has_function_privilege('authenticated', 'public.tenant_quota_clients(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.tenant_quota_appointments_month(uuid)', 'execute') then
    raise exception 'миграция: приложение потеряло лимиты своей компании';
  end if;
end
$guard$;
