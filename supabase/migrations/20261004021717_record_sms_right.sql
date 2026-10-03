-- «SMS» В ЗАПИСИ — СВОЁ ПРАВО (владелец 03.10: «добавь ещё в календарь — в
-- записи SMS, нужно туда добавить»).
--
-- Блок «SMS» внизу записи (история сообщений её клиенту, `SmsRecordBlock`)
-- до сих пор стоял у партнёра без своей строки прав: его открывали «Записи
-- клиентов» и «Клиент» записи. Теперь — право команды `record.sms` в блоке
-- «Запись клиента»: «Скрыты» · «Видит». Отправка SMS остаётся у трубки
-- клиента — правом «SMS» карточки клиента (`clients.sms`).
--
-- Нынешним партнёрам засеяно «Видит» — сегодня блок у них есть, и он не
-- пропадает; новому партнёру — «Скрыты» (первая ступень, как у файлов).
--
-- Держит сервер: `sms_for_appointment` отдаёт историю не владельцу только при
-- «Видит» у `record.sms` в команде записи — поверх прежних «Записей клиентов»
-- и «Клиента». Тело правится по якорю со сверкой md5 (03.10).

set local lock_timeout = '5s';

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values (
  'record.sms', 'calendar', 'calendar',
  array['off', 'read'],
  'SMS', false, true,
  array['function:public.sms_for_appointment(uuid)'],
  56
);

insert into public.member_access (tenant_id, user_id, block, team_id, level)
select mc.tenant_id, mc.user_id, 'record.sms', mc.team_id, 'read'
  from public.member_calendars mc
  join public.tenant_members tm
    on tm.tenant_id = mc.tenant_id and tm.user_id = mc.user_id
 where tm.role <> 'owner'
on conflict do nothing;

do $migration$
declare
  fn regprocedure := 'public.sms_for_appointment(uuid)'::regprocedure;
  def text;
  old_part text := $old$       and a.team_id = any(public.access_calendars('record.client', 'read'))
     ) then$old$;
  new_part text := $new$       and a.team_id = any(public.access_calendars('record.client', 'read'))
       -- «SMS» записи — своё право (03.10).
       and a.team_id = any(public.access_calendars('record.sms', 'read'))
     ) then$new$;
begin
  if (select md5(prosrc) from pg_proc where oid = fn) is distinct from '976f2463eb79d2c7e0653ec5d6ba7c46' then
    raise exception 'sms_for_appointment изменилась после 03.10 — перечитать тело перед правкой';
  end if;
  def := pg_get_functiondef(fn);
  if (length(def) - length(replace(def, old_part, ''))) / length(old_part) <> 1 then
    raise exception 'проверка «Клиента» в sms_for_appointment не найдена ровно один раз';
  end if;
  execute replace(def, old_part, new_part);
end
$migration$;

do $guard$
begin
  if not exists (select 1 from public.access_blocks where key = 'record.sms' and live) then
    raise exception 'сторож: права «SMS» записи нет в реестре';
  end if;
  if position('record.sms' in (select prosrc from pg_proc where oid = 'public.sms_for_appointment(uuid)'::regprocedure)) = 0 then
    raise exception 'сторож: sms_for_appointment не спрашивает «SMS» записи';
  end if;
  if has_function_privilege('anon', 'public.sms_for_appointment(uuid)', 'execute') then
    raise exception 'сторож: sms_for_appointment открылась anon';
  end if;
end
$guard$;
