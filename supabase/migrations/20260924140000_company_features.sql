-- ФУНКЦИИ КОМПАНИИ (STORY-088, волна 0; владелец 24.09: «кому-то вообще не
-- нужно добавление объекта — тумблер выключить, и его не будет ни у кого
-- видно, даже у владельца»).
--
-- 1. `calendar_settings.disabled_features` — что в компании ВЫКЛЮЧЕНО. Одна
--    строка на компанию уже есть, её читают и владелец, и сотрудник (через
--    `read_operational_calendar_settings_safe`), у неё есть кэш на телефоне —
--    вторая таблица для той же природы настройки была бы второй дверью.
--    Пусто — включено всё: продукт не решает за бизнес, чего ему не надо.
--    Данные выключенной функции НЕ стираются; включили — всё на месте.
-- 2. `calendar_settings.booking_block_order` — порядок блоков формы записи.
--    Жил в телефоне (MMKV `babun-booking-blocks:<tenant>`): на втором
--    телефоне владельца форма собиралась иначе, у мастера — заводской.
-- 3. `read_operational_calendar_settings_safe()` отдаёт сотруднику то, без
--    чего его экран врал: минуты окна, «Доход и расход под календарём»,
--    цвета записи (у мастера были заводские) и функции компании.

alter table public.calendar_settings
  add column if not exists disabled_features text[] not null default '{}',
  add column if not exists booking_block_order text[];

alter table public.calendar_settings
  drop constraint if exists calendar_settings_disabled_features_known;
alter table public.calendar_settings
  add constraint calendar_settings_disabled_features_known check (
    disabled_features <@ array[
      'objects',          -- объекты клиентов и блок «Объект» в записи
      'day_labels',       -- метки дня
      'record_label',     -- метка записи
      'events',           -- события
      'record_payment',   -- оплата в записи
      'record_files',     -- файлы записи
      'record_note',      -- заметка записи
      'debts',            -- долги
      'accounts',         -- счета и переводы
      'documents',        -- инвойсы и чеки
      'client_people',    -- люди и связи клиентов
      'client_requisites',-- реквизиты клиентов
      'client_files'      -- файлы клиентов
    ]::text[]
  );

alter table public.calendar_settings
  drop constraint if exists calendar_settings_booking_block_order_known;
alter table public.calendar_settings
  add constraint calendar_settings_booking_block_order_known check (
    booking_block_order is null
    or booking_block_order <@ array[
      'team', 'label', 'when', 'client', 'object', 'services', 'payment', 'note', 'files'
    ]::text[]
  );

-- Сигнатура меняется (новые колонки результата) — `create or replace` этого
-- не умеет, функцию пересоздаём. Зависимых функций у неё нет (проверено).
drop function if exists public.read_operational_calendar_settings_safe();

create function public.read_operational_calendar_settings_safe()
 returns table(
   start_hour integer,
   end_hour integer,
   grid_step integer,
   week_start text,
   timezone text,
   buffer_minutes integer,
   hide_cancelled boolean,
   allow_overtime boolean,
   work_start_hour integer,
   work_end_hour integer,
   scroll_open_hour integer,
   start_minute integer,
   end_minute integer,
   show_day_finance boolean,
   record_color_rule text,
   record_color_palette jsonb,
   record_color_fallback text,
   disabled_features text[],
   booking_block_order text[]
 )
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_role text := public.current_user_role();
begin
  if auth.uid() is null
     or v_tenant_id is null
     or v_role is null
     or v_role not in ('owner', 'master') then
    raise exception 'calendar settings are unavailable for this membership'
      using errcode = '42501';
  end if;

  return query
  select cs.start_hour,
         cs.end_hour,
         cs.grid_step,
         cs.week_start,
         cs.timezone,
         cs.buffer_minutes,
         cs.hide_cancelled,
         cs.allow_overtime,
         cs.work_start_hour,
         cs.work_end_hour,
         cs.scroll_open_hour,
         cs.start_minute,
         cs.end_minute,
         cs.show_day_finance,
         cs.record_color_rule,
         cs.record_color_palette,
         cs.record_color_fallback,
         cs.disabled_features,
         cs.booking_block_order
    from public.calendar_settings cs
   where cs.tenant_id = v_tenant_id
   limit 1;
end;
$function$;

revoke all on function public.read_operational_calendar_settings_safe() from public, anon;
grant execute on function public.read_operational_calendar_settings_safe() to authenticated;

-- ─── Сторож ──────────────────────────────────────────────────────────────
do $audit$
begin
  if has_function_privilege('anon', 'public.read_operational_calendar_settings_safe()', 'execute') then
    raise exception 'operational settings must not be readable by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.read_operational_calendar_settings_safe()', 'execute') then
    raise exception 'operational settings must stay readable by members';
  end if;
  if exists (select 1 from public.calendar_settings where cardinality(disabled_features) > 0) then
    raise exception 'new column must start empty: nothing is switched off by the migration';
  end if;
end
$audit$;
