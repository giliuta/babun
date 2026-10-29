-- ПУШ ОБ ОПЛАТЕ: ИМЯ КЛИЕНТА И СКРЫТЫЕ СЧЕТА (пачка 7, С4).
--
-- Пуши выключены (`app_settings.mobile_push_enabled = off`); закрыть до
-- включения. `push_activity_targets` для оплаты отдавал `show_client = true`
-- каждому с «Доходами» команды, хотя имя клиента записи ему могло быть
-- закрыто («Клиент записи: Скрыт»), и звал всех, даже если доход лёг на
-- скрытый или не его счёт. Теперь имя клиента в оплате — по тому же праву,
-- что у записи, а об оплате на счёте, которого человек не видит
-- (`access_accounts_for`: скрытый — только владельцу, счёт команды — её
-- людям, общий — людям его команд), пуша нет вовсе.
--
-- Тело правится по якорям в живом определении.

create or replace function public.push_payment_account_seen(p_tenant uuid, p_account uuid, p_teams text[])
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- Тот же счёт, что открывает `access_accounts_for(…, 'read')`.
  select p_account is null or exists (
    select 1
      from public.accounts a
     where a.id = p_account
       and a.tenant_id = p_tenant
       and not a.is_hidden
       and (
         (a.scope = 'team' and a.brigade_id = any(p_teams))
         or (a.scope = 'company' and exists (
           select 1 from public.account_teams att
            where att.account_id = a.id
              and att.tenant_id = p_tenant
              and att.team_id = any(p_teams)
         ))
       )
  )
$function$;

revoke execute on function public.push_payment_account_seen(uuid, uuid, text[]) from public, anon, authenticated;

do $migration$
declare
  d text := pg_get_functiondef('public.push_activity_targets(change_log)'::regprocedure);
  a1 constant text := E'  v_fields text[];\n';
  r1 constant text := E'  v_fields text[];\n'
    || E'  v_account uuid;\n';
  a2 constant text := E'    v_kind := ''payment'';\n'
    || E'    v_block := ''finance.income'';\n';
  r2 constant text := a2
    || E'    if p_log.meta ->> ''account_id'' ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'' then\n'
    || E'      v_account := (p_log.meta ->> ''account_id'')::uuid;\n'
    || E'    end if;\n';
  a3 constant text := E'           case\n'
    || E'             -- Запись без календаря видит только владелец.\n';
  r3 constant text := E'           case\n'
    || E'             -- Об оплате на счёте, которого он не видит, — ни слова.\n'
    || E'             when v_kind = ''payment'' and p.role <> ''owner''\n'
    || E'                  and not public.push_payment_account_seen(p_log.tenant_id, v_account, p.seen) then null\n'
    || E'             -- Запись без календаря видит только владелец.\n';
  a4 constant text := E'             when v_kind = ''payment'' then true\n';
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1
     or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1
     or (length(d) - length(replace(d, a3, ''))) / length(a3) <> 1
     or (length(d) - length(replace(d, a4, ''))) / length(a4) <> 1 then
    raise exception 'push_activity_targets: якоря оплаты не найдены ровно один раз';
  end if;
  execute replace(replace(replace(replace(d, a1, r1), a2, r2), a3, r3), a4, '');
end;
$migration$;

do $guard$
declare
  src text := pg_get_functiondef('public.push_activity_targets(change_log)'::regprocedure);
begin
  if position('when v_kind = ''payment'' then true' in src) > 0 then
    raise exception 'push_activity_targets снова отдаёт имя клиента в каждой оплате';
  end if;
  if position('push_payment_account_seen(p_log.tenant_id, v_account, p.seen)' in src) = 0 then
    raise exception 'push_activity_targets: счета оплаты не проверяются';
  end if;
  if has_function_privilege('anon', 'public.push_payment_account_seen(uuid, uuid, text[])', 'execute')
     or has_function_privilege('authenticated', 'public.push_payment_account_seen(uuid, uuid, text[])', 'execute') then
    raise exception 'push_payment_account_seen исполним снаружи';
  end if;
end;
$guard$;
