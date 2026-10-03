-- «СКРЫТЬ СЧЁТ» — СЧЁТ ДЛЯ СЕБЯ (владелец 03.10).
--
-- «Скрыть я хочу, чтоб он просто скрылся со всего, но им можно было
-- пользоваться — нигде не показывался, только в счетах; накопительный счёт,
-- куда в конце месяца переводятся деньги; для всех невидимый».
--
-- Решено с владельцем 03.10:
--   • скрытый счёт РАБОТАЕТ: на него и с него переводят обычным «Перевести»;
--   • его нет нигде, кроме страницы «Счета» за шестерёнкой: ни в плитке
--     «Счета» на «Финансах» (деньги не считаются), ни в оплате записи, ни в
--     операциях и документах — это экран;
--   • ПАРТНЁРЫ ЕГО НЕ ВИДЯТ ВОВСЕ — это сервер (этот файл):
--       – `accounts.is_hidden`; ставит и снимает только владелец;
--       – ограничительная политика `accounts_hidden_owner_only`: строку
--         скрытого счёта видит и пишет только владелец;
--       – ограничительная политика `finance_transactions_hidden_owner_only`:
--         строки журнала на скрытом счёте — только владельцу (иначе перевод
--         на «Накопления» был бы виден партнёру со «Счетами»);
--       – `access_accounts_for` / `access_accounts_totals` у не-владельца
--         скрытый счёт не отдают: перевод, остатки и запись партнёра его не
--         знают;
--   • скрытый счёт не принимает деньги записи: `accounts_hidden_not_in_payments`
--     (все двери оплаты — пикер, автоподбор, запись оплаты — уже требуют
--     `show_in_payments = true`).
--
-- ПРЕЖНЕЕ «СКРЫТЬ» (закрыть счёт, `is_active = false`) ушло: закрытые счета,
-- которые не в «Удалённых», переезжают в «Удалённые счета» (остаток у них
-- нулевой — закрыть с деньгами сервер не давал). С историей — без срока,
-- пустые — 30 дней, вернуть можно оттуда. На 03.10 это 4 счёта AirFix.

set local lock_timeout = '5s';

-- ─── 0. Тела, которые правим, — как прочитаны 03.10 ───

do $pre$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.access_accounts_for(text, text)'::regprocedure)
     is distinct from '0bdee0b9a93e58614e0440d40850b2aa' then
    raise exception 'access_accounts_for изменилась после чтения 03.10 — перечитать тело';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.access_accounts_totals()'::regprocedure)
     is distinct from '680c925487bf8d180fb2962e1257d32f' then
    raise exception 'access_accounts_totals изменилась после чтения 03.10 — перечитать тело';
  end if;
end
$pre$;

-- ─── 1. Флаг и правило оплаты ───

-- Умолчание `false` — то, что и должно стоять у всех прошлых счетов.
alter table public.accounts add column if not exists is_hidden boolean not null default false;

alter table public.accounts
  add constraint accounts_hidden_not_in_payments
  check (not (is_hidden and show_in_payments));

comment on column public.accounts.is_hidden is
  'Скрытый счёт (владелец 03.10): работает, но виден только владельцу и только на странице «Счета». Деньги записи не принимает.';

-- ─── 2. Партнёр скрытого счёта не видит и не пишет ───

-- Скрытые счета компании — мимо RLS читающего (иначе партнёр, которому
-- строка счёта закрыта, не узнал бы, что она скрыта, и политика журнала
-- пропустила бы его строки).
create function public.hidden_account_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(array_agg(a.id), array[]::uuid[])
    from public.accounts a
   where a.tenant_id = public.current_tenant_id()
     and a.is_hidden;
$function$;

revoke all on function public.hidden_account_ids() from public, anon;
grant execute on function public.hidden_account_ids() to authenticated;

drop policy if exists accounts_hidden_owner_only on public.accounts;
create policy accounts_hidden_owner_only
  on public.accounts
  as restrictive
  for all
  to authenticated
  using (not is_hidden or (select public.current_user_role()) = 'owner')
  with check (not is_hidden or (select public.current_user_role()) = 'owner');

drop policy if exists finance_transactions_hidden_owner_only on public.finance_transactions;
create policy finance_transactions_hidden_owner_only
  on public.finance_transactions
  as restrictive
  for all
  to authenticated
  using (
    account_id is null
    or (select public.current_user_role()) = 'owner'
    or not (account_id = any (select unnest(public.hidden_account_ids())))
  )
  with check (
    account_id is null
    or (select public.current_user_role()) = 'owner'
    or not (account_id = any (select unnest(public.hidden_account_ids())))
  );

-- Перевод, остатки и записи партнёра считают «его» счета этими двумя
-- функциями: скрытый счёт у не-владельца из них выпадает.
create or replace function public.access_accounts_for(p_block text, p_min text)
 returns uuid[]
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  min_rank integer := array_position(array['off', 'read', 'write', 'full'], p_min);
  active_tenant uuid;
  caller_role text;
  granted_calendars text[];
  visible uuid[];
begin
  if caller is null or min_rank is null or min_rank < 2 then
    return array[]::uuid[];
  end if;

  if not exists (
    select 1
      from public.access_blocks b
     where b.key = p_block
       and b.scope = 'calendar'
  ) then
    return array[]::uuid[];
  end if;

  active_tenant := public.current_tenant_id();
  if active_tenant is null then
    return array[]::uuid[];
  end if;

  select tm.role into caller_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant
     and tm.user_id = caller;
  if caller_role is null then
    return array[]::uuid[];
  end if;

  if caller_role = 'owner' then
    select coalesce(array_agg(a.id order by a.id), array[]::uuid[])
      into visible
      from public.accounts a
     where a.tenant_id = active_tenant;
    return visible;
  end if;

  granted_calendars := public.access_calendars_of(active_tenant, caller, p_block, p_min);
  if cardinality(granted_calendars) = 0 then
    return array[]::uuid[];
  end if;

  select coalesce(array_agg(a.id order by a.id), array[]::uuid[])
    into visible
    from public.accounts a
   where a.tenant_id = active_tenant
     -- Скрытый счёт (владелец 03.10) — только владельцу.
     and not a.is_hidden
     and (
       (a.scope = 'team' and a.brigade_id = any(granted_calendars))
       or (
         min_rank = 2
         and a.scope = 'company'
         and exists (
           select 1
             from public.account_teams att
            where att.account_id = a.id
              and att.tenant_id = active_tenant
              and att.team_id = any(granted_calendars)
         )
       )
     );

  return visible;
end;
$function$;

create or replace function public.access_accounts_totals()
 returns uuid[]
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid;
  caller_role text;
  granted_calendars text[];
  visible uuid[];
begin
  if caller is null then
    return array[]::uuid[];
  end if;

  active_tenant := public.current_tenant_id();
  if active_tenant is null then
    return array[]::uuid[];
  end if;

  select tm.role into caller_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant
     and tm.user_id = caller;
  if caller_role is null then
    return array[]::uuid[];
  end if;

  if caller_role = 'owner' then
    select coalesce(array_agg(a.id order by a.id), array[]::uuid[])
      into visible
      from public.accounts a
     where a.tenant_id = active_tenant;
    return visible;
  end if;

  granted_calendars := public.access_calendars_of(active_tenant, caller, 'finance.accounts', 'read');
  if cardinality(granted_calendars) = 0 then
    return array[]::uuid[];
  end if;

  select coalesce(array_agg(a.id order by a.id), array[]::uuid[])
    into visible
    from public.accounts a
   where a.tenant_id = active_tenant
     -- Скрытый счёт (владелец 03.10) — только владельцу.
     and not a.is_hidden
     and (
       (a.scope = 'team' and a.brigade_id = any(granted_calendars))
       or (
         a.scope = 'company'
         and exists (
           select 1
             from public.account_teams att
            where att.account_id = a.id
              and att.tenant_id = active_tenant
         )
         and not exists (
           select 1
             from public.account_teams att
            where att.account_id = a.id
              and not (att.team_id = any(granted_calendars))
         )
       )
     );

  return visible;
end;
$function$;

-- ─── 3. Прежние «закрытые» — в «Удалённые счета» ───

update public.accounts
   set deleted_at = now()
 where is_active = false
   and deleted_at is null;

-- ─── 4. Сторож ───

do $guard$
begin
  if has_function_privilege('anon', 'public.hidden_account_ids()', 'execute') then
    raise exception 'сторож: hidden_account_ids исполнима без входа';
  end if;
  if not has_function_privilege('authenticated', 'public.hidden_account_ids()', 'execute') then
    raise exception 'сторож: политике журнала нечем проверить скрытые счета';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and policyname in ('accounts_hidden_owner_only', 'finance_transactions_hidden_owner_only')
         and permissive = 'RESTRICTIVE') <> 2 then
    raise exception 'сторож: ограничительные политики скрытого счёта не на месте';
  end if;
  if (select prosrc from pg_proc where oid = 'public.access_accounts_for(text, text)'::regprocedure) not like '%and not a.is_hidden%'
     or (select prosrc from pg_proc where oid = 'public.access_accounts_totals()'::regprocedure) not like '%and not a.is_hidden%' then
    raise exception 'сторож: помощники доступа к счетам не знают про скрытые';
  end if;
  if exists (select 1 from public.accounts where is_active = false and deleted_at is null) then
    raise exception 'сторож: остались закрытые счета вне «Удалённых»';
  end if;
  if exists (select 1 from public.accounts where is_hidden) then
    raise exception 'сторож: прошлые счета оказались скрытыми';
  end if;
end
$guard$;
