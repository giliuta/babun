-- ЗАЧИСТКА (владелец 04.10: «зачистить мёртвый код»). Прежние шаблоны SMS
-- компании жили в `tenant_state.prototype_state` и читались/писались этими
-- двумя функциями под правом `company.sms_templates`. Право погашено в
-- 20261004043917 (шаблоны SMS теперь у команды — `sms_team_templates`), а
-- код приложения, который их звал (`features/settings/sms-templates.ts`),
-- удалён в 14075165. Вызовов не осталось ни в приложении, ни в функциях
-- базы, ни в edge-функциях — функции снимаются.

drop function if exists public.read_sms_templates_safe();
drop function if exists public.write_sms_templates_safe(jsonb);

do $guard$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('read_sms_templates_safe', 'write_sms_templates_safe')
  ) then
    raise exception 'old SMS template functions still exist';
  end if;
end;
$guard$;
