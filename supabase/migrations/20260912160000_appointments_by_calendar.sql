-- Записи начинают слушаться прав на календарь. Шаг «старое ИЛИ новое».
--
-- Политики записей спрашивали только роль на всю компанию: владелец и
-- диспетчер видят и правят всё, мастер не получает сырых строк вовсе (он ходит
-- через безопасные функции). Теперь рядом со старым условием появляется
-- второе: «этот календарь есть в моих правах».
--
-- ОБЕ ВЕТКИ ОДНОВРЕМЕННО — ЭТО НЕ ПЕРЕСТРАХОВКА, А СПОСОБ НЕ УРОНИТЬ ПРОД.
-- Пока роль остаётся источником прав, владелец не теряет доступ ни на
-- секунду; ролевую ветку снимем отдельным шагом, когда интерфейс научится
-- выдавать права и перенос будет проверен на живых людях.
--
-- ФОРМА ВЫЗОВА ОБЯЗАТЕЛЬНА: `team_id in (select unnest(
-- public.current_user_calendar_ids('view')))`. Неподзапросная форма
-- (`= any(public.current_user_calendar_ids(...))`) считает функцию на КАЖДУЮ
-- строку — на неделе владельца это выглядит не как ошибка прав, а как
-- зависшее приложение.
--
-- ПРАВО НА ДЕЙСТВИЕ, А НЕ ОДНО «ЕСТЬ ДОСТУП»: смотреть — view, создавать —
-- book, править и удалять чужое — edit_all. Свои записи мастер и сегодня
-- правит безопасной функцией `update_master_appointment_safe`, и этот путь не
-- трогается: иначе к одному действию появится вторая дверь.
--
-- ЛИЧНОЕ ОСТАЁТСЯ ЛИЧНЫМ. Событие без календаря (`team_id is null`) в новую
-- ветку не попадает по построению — массив календарей его не содержит, —
-- поэтому право «видеть календарь» не открывает чужие личные события.
--
-- ПРОВЕРЕНО НА БОЕВОЙ БАЗЕ внутри begin/rollback, с подстановкой claims:
--   • владелец: 11 записей до правки и 11 после — доступ не изменился;
--   • мастер сегодня: 0 сырых строк;
--   • мастер с правом view в ОДНОМ календаре: ровно 9 — все рабочие записи
--     этого календаря, и ни одной из остальных двух в компании.

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.current_user_role() in ('owner', 'dispatcher')
      or team_id in (select unnest(public.current_user_calendar_ids('view')))
    )
    and (
      kind = 'work'
      or (
        kind in ('event', 'personal')
        and (team_id is not null or created_by = auth.uid())
      )
    )
  );

drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert on public.appointments for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and (
      public.current_user_role() in ('owner', 'dispatcher')
      or team_id in (select unnest(public.current_user_calendar_ids('book')))
    )
    and (
      kind = 'work'
      or (kind in ('event', 'personal') and created_by = auth.uid())
    )
  );

drop policy if exists appointments_update on public.appointments;
create policy appointments_update on public.appointments for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.current_user_role() in ('owner', 'dispatcher')
      or team_id in (select unnest(public.current_user_calendar_ids('edit_all')))
    )
    and (
      kind = 'work'
      or (kind in ('event', 'personal') and created_by = auth.uid())
    )
  )
  with check (
    tenant_id = public.current_tenant_id()
    and (
      public.current_user_role() in ('owner', 'dispatcher')
      or team_id in (select unnest(public.current_user_calendar_ids('edit_all')))
    )
    and (
      kind = 'work'
      or (kind in ('event', 'personal') and created_by = auth.uid())
    )
  );

drop policy if exists appointments_delete on public.appointments;
create policy appointments_delete on public.appointments for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.current_user_role() in ('owner', 'dispatcher')
      or team_id in (select unnest(public.current_user_calendar_ids('edit_all')))
    )
    and (
      kind = 'work'
      or (kind in ('event', 'personal') and created_by = auth.uid())
    )
  );

do $$
declare
  v_missing text;
begin
  -- Каждая из четырёх политик обязана знать о календарях: забытая политика —
  -- это ровно тот случай, когда «права выдали», а данные всё равно видны.
  select string_agg(p.policyname, ', ')
    into v_missing
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename = 'appointments'
     and p.policyname in (
       'appointments_select', 'appointments_insert',
       'appointments_update', 'appointments_delete'
     )
     and coalesce(p.qual, '') || coalesce(p.with_check, '')
         not like '%current_user_calendar_ids%';

  if v_missing is not null then
    raise exception 'записи: политики без календарного предиката — %', v_missing;
  end if;

  -- И обязана сохранить старую ветку: снятие роли — отдельный шаг, не этот.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'appointments'
       and policyname = 'appointments_select'
       and qual like '%current_user_role%'
  ) then
    raise exception 'записи: ролевая ветка снята раньше времени';
  end if;
end $$;
