-- ЛИМИТЫ ЧУЖОЙ КОМПАНИИ БОЛЬШЕ НЕ ЧИТАЮТСЯ (13.10, нашла сессия 025).
--
-- Четыре `tenant_quota_*` — security definer без проверки членства, и
-- authenticated мог звать их с ЛЮБЫМ UUID компании (UUID продукт раздаёт:
-- приглашения, ответы rpc). Живая картина после цены за календарь (12.10):
--   • `tenant_quota_clients`, `_appointments_month`, `_team_members` отдают
--     константу 999999999 — утекать нечему;
--   • `tenant_quota_sms_month` отдаёт бесплатную квоту SMS чужой компании и
--     через неё — её тариф (pro или нет). Это и есть утечка.
--
-- Черновик 15.09 (`supabase/parked/20260915020000_tenant_quota_members_only.sql`)
-- переписывал тела и оба триггера под внутренние имена — при живых телах
-- 13.10 это лишнее и рискованное. Здесь только права:
--   • `tenant_quota_sms_month` и `tenant_quota_team_members` приложению не
--     нужны (ни `src/`, ни edge-функции их не зовут) — у public, anon и
--     authenticated право отнято. Их серверные вызыватели
--     (`enforce_tenant_insert_quota`, `tenant_quota_summary`) — security
--     definer под postgres и право сохраняют; приём приглашения, который
--     вставляет участника ДО членства, не задет;
--   • `tenant_quota_clients` и `_appointments_month` зовёт `src/lib/quota.ts`
--     во всех выпущенных сборках: при ошибке rpc сборка не даёт создать
--     клиента или запись. Отнять их нельзя, а константа ничего не выдаёт.

revoke execute on function public.tenant_quota_sms_month(uuid) from public, anon, authenticated;
revoke execute on function public.tenant_quota_team_members(uuid) from public, anon, authenticated;

do $guard$
begin
  if has_function_privilege('authenticated', 'public.tenant_quota_sms_month(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.tenant_quota_team_members(uuid)', 'execute')
     or has_function_privilege('anon', 'public.tenant_quota_sms_month(uuid)', 'execute')
     or has_function_privilege('anon', 'public.tenant_quota_team_members(uuid)', 'execute') then
    raise exception 'миграция: лимиты чужой компании всё ещё читаются';
  end if;
  if not has_function_privilege('authenticated', 'public.tenant_quota_clients(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.tenant_quota_appointments_month(uuid)', 'execute') then
    raise exception 'миграция: выпущенные сборки потеряли лимиты своей компании';
  end if;
  if not has_function_privilege('postgres', 'public.tenant_quota_team_members(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.tenant_quota_sms_month(uuid)', 'execute') then
    raise exception 'миграция: триггер квот или сервер потеряли доступ';
  end if;
end
$guard$;
