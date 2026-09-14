-- МАСТЕР ЧИТАЕТ ЗАПИСИ ТОЛЬКО ЧЕРЕЗ БЕЗОПАСНЫЙ СПИСОК (этап 0(г) плана доступа).
--
-- Дыра, подтверждённая на боевой 14.09: мастер с правом `view` на календарь
-- прямым запросом `GET /rest/v1/appointments?select=total_amount,payments`
-- получал строки записей ЦЕЛИКОМ — с суммами и оплатами. Ветка права `view` в
-- `appointments_select` не смотрела на роль. Приложение мастеру суммы не
-- показывает (он читает `list_master_appointments_safe`, где суммы обнулены),
-- но сотрудник со своим входом может спросить сервер мимо приложения.
-- Единственный мастер в базе: 3 записи, в одной €210.
--
-- ЧТО МЕНЯЕТСЯ. Ветка права `view` работает только для диспетчера. Мастер
-- читает записи исключительно через `list_master_appointments_safe`
-- (SECURITY DEFINER, ей политика не нужна). Условие написано как
-- `= 'dispatcher'`, а не `<> 'master'`: новая роль, если появится, не пройдёт
-- сюда молча (разбор проверяющего 14.09).
--
-- ЧТО НЕ МЕНЯЕТСЯ. Ветки владельца и диспетчера без строк прав — дословно
-- прежние; условие видимости событий — прежнее. Политика меняется через
-- ALTER POLICY: роли и команда остаются как были, сторож миграции
-- 20260720210010 (ровно четыре политики записей) и сторож 20260913000000
-- (`current_user_has_calendar_grants` в политике) продолжают проходить.
--
-- ЧЕГО ЭТА МИГРАЦИЯ СОЗНАТЕЛЬНО НЕ ДЕЛАЕТ. Не добавляет права `view` в
-- `update_master_appointment_safe` и в проверки фото: это превратило бы право
-- «смотреть» в право «менять». Мастер без карточки, у которого есть только
-- `view`, и сегодня не может двигать статус и грузить фото — это этап 0(д)
-- (назначения — строками прав) и уровни `record.status`.
--
-- Приложение не меняется: все пути чтения записей для роли master уже идут
-- через `list_master_appointments_safe` (calendar/queries.ts, clients/appointments.ts,
-- lib/tenant-prefetch.ts); очередь и realtime у мастера не монтируются.

alter policy appointments_select on public.appointments
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or (
        (select public.current_user_role()) = 'dispatcher'
        and not (select public.current_user_has_calendar_grants())
      )
      or (
        (select public.current_user_role()) = 'dispatcher'
        and team_id in (select unnest(public.current_user_calendar_ids('view')))
      )
    )
    and (
      kind = 'work'
      or (
        kind = any (array['event', 'personal'])
        and (team_id is not null or created_by = auth.uid())
      )
    )
  );

do $guard$
declare
  q text;
begin
  select qual into q
    from pg_policies
   where schemaname = 'public' and tablename = 'appointments' and policyname = 'appointments_select';
  if q is null then
    raise exception 'миграция: политики appointments_select нет';
  end if;
  if position('current_user_has_calendar_grants' in q) = 0 then
    raise exception 'миграция: из политики пропало гашение ветки роли';
  end if;
  -- Ветка права `view` обязана стоять под ролью диспетчера.
  if q !~ '''dispatcher''::text\)\s+AND\s+\(team_id IN \(\s*SELECT unnest\(current_user_calendar_ids\(''view''::text\)\)' then
    raise exception 'миграция: ветка права view не ограничена ролью диспетчера: %', q;
  end if;
end
$guard$;
