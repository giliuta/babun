-- ЛЮБОЕ УДАЛЕНИЕ ЗАПИСИ — В «УДАЛЁННЫЕ ЗАПИСИ» (находка владельца №13, 28.10).
--
-- Ящик (миграция 20261016170000) брал снимок, только если удаление шло
-- через `delete_appointment` (флаг транзакции `babun.appointment_trash`).
-- Мимо ящика уходили:
--   • «Отменить» в тосте сразу после быстрого события и копии записи —
--     обычный `delete` (`useDeleteAppointment`), у сотрудника —
--     `member_appointment_delete` без флага;
--   • удаление из офлайн-очереди (реплей `delete` строки `appointments`);
--   • любое прямое `delete` SQL-ом (автор в журнале — «система»).
-- Ожидание владельца: что бы ни удалило запись календаря, она 30 дней лежит
-- в ящике и возвращается «Вернуть».
--
-- ТЕПЕРЬ ЯЩИК — ПО УМОЛЧАНИЮ, флаг больше не нужен. Мимо него, как задумано,
-- уходит только стирание, где возвращать некуда:
--   1. личное событие без календаря (`team_id is null`) — как было (5.1);
--   2. «Удалить навсегда» календаря из архива (`delete_calendar`): ящик
--      календаря он сам чистит, записи вернуть некуда —
--      `calendar_delete_in_progress()`, тот же пропуск, что у сторожей;
--   3. каскад удалённой компании (`tenants` → `on delete cascade`): строки
--      компании уже нет, снимок со ссылкой на неё не вставится;
--   4. удаление аккаунта (`delete_sole_owned_tenants_for_account`): его
--      личные события в уцелевшей компании — «Вернуть» событие может только
--      автор, а автора больше нет.
-- Запись с деньгами по-прежнему не удаляется вовсе: сторож
-- `guard_appointment_history_delete` стоит раньше ящика по имени.
--
-- Тело — с живой базы 28.10 (md5(prosrc) 60219f96…); изменились только
-- условия пропуска в начале, снимок прежний.
--
-- ПОПУТНО — КАСКАД КОМПАНИИ БЫЛ ЗАПЕРТ УЖЕ СЕЙЧАС. Надгробие снимка
-- (`deleted_appointment_leave_tombstone`, миграция 20261018172000) на каскаде
-- `tenants` → `deleted_appointments` вставляло строку `erased_appointment_blobs`
-- со ссылкой на стираемую компанию — FK-отказ, и удаление аккаунта
-- единственного владельца с непустыми «Удалёнными записями» падало целиком
-- (прогон в откате 28.10 на прежних телах). Файлы стёртой компании убирает
-- уборка аккаунта, надгробие ей не нужно. Тело — с живой базы
-- (md5(prosrc) f2e1d0e4…), добавлен только пропуск.

create or replace function public.trash_deleted_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- Личное событие без календаря в ящик не идёт: у ящика, как у всего в
  -- компании, команда обязательна. Удаляется, как раньше, насовсем —
  -- приложение так и спрашивает («Действие необратимо»).
  if old.team_id is null then
    return old;
  end if;
  -- Календарь стирается из архива: записи вернуть некуда.
  if public.calendar_delete_in_progress() then
    return old;
  end if;
  -- Каскад удалённой компании: снимок сослался бы на стёртую строку.
  if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    return old;
  end if;
  -- Стирание аккаунта уносит его личные события: вернуть их некому.
  if old.kind in ('event', 'personal')
     and exists (
       select 1 from auth.users u
        where u.id = old.created_by and u.deleted_at is not null
     ) then
    return old;
  end if;
  insert into public.deleted_appointments
    (id, tenant_id, team_id, kind, created_by, appointment, dependents,
     deleted_by, deleted_at, purge_at)
  values (
    old.id, old.tenant_id, old.team_id, old.kind, old.created_by, to_jsonb(old),
    jsonb_build_object(
      'photos', coalesce((
        select jsonb_agg(to_jsonb(p) order by p.sort_order, p.created_at)
          from public.appointment_photos p where p.appointment_id = old.id), '[]'::jsonb),
      'links', coalesce((
        select jsonb_agg(to_jsonb(l))
          from public.appointment_links l where l.appointment_id = old.id), '[]'::jsonb),
      'rating_tokens', coalesce((
        select jsonb_agg(to_jsonb(r))
          from public.master_rating_tokens r where r.appointment_id = old.id), '[]'::jsonb),
      'sms_messages', coalesce((
        select jsonb_agg(m.id) from public.sms_messages m where m.appointment_id = old.id), '[]'::jsonb),
      'sms_logs', coalesce((
        select jsonb_agg(s.id) from public.sms_logs s where s.appointment_id = old.id), '[]'::jsonb),
      'master_ratings', coalesce((
        select jsonb_agg(r.id) from public.master_ratings r where r.appointment_id = old.id), '[]'::jsonb),
      'client_attachments', coalesce((
        select jsonb_agg(c.id) from public.client_attachments c where c.appointment_id = old.id), '[]'::jsonb)
    ),
    auth.uid(), now(), now() + interval '30 days'
  );
  return old;
end;
$function$;

create or replace function public.deleted_appointment_leave_tombstone()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- Возврат кладёт запись обратно до удаления снимка: живая строка есть —
  -- файлы снова её, надгробие не нужно.
  if exists (
    select 1 from public.appointments a where a.id = old.id and a.tenant_id = old.tenant_id
  ) then
    return old;
  end if;
  -- Каскад удалённой компании: надгробие сослалось бы на стёртую строку,
  -- а файлы компании убирает уборка аккаунта.
  if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    return old;
  end if;
  insert into public.erased_appointment_blobs
    (appointment_id, tenant_id, team_id, kind, created_by, erased_by)
  values (old.id, old.tenant_id, old.team_id, old.kind, old.created_by, auth.uid())
  on conflict (appointment_id) do update
    set erased_by = excluded.erased_by, erased_at = now();
  return old;
end;
$function$;
