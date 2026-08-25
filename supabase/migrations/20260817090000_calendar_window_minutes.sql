-- ЧАСЫ КАЛЕНДАРЯ ПОЛУЧАЮТ МИНУТЫ.
--
-- Владелец 2026-08-17: «часы календаря — два тумблера: отдельно кручу часы,
-- отдельно минуты, минуты в пятиминутку». Барабан минут поверх колонок,
-- которые умеют только целые часы, был бы обманом: человек ставит 08:30, а
-- сохраняется 08:00 — ровно тот класс тихой лжи, который в этом продукте
-- запрещён (см. комментарии в features/calendar/window.ts).
--
-- ПОЧЕМУ ДВЕ НОВЫЕ КОЛОНКИ, А НЕ ПЕРЕВОД ЧАСОВ В МИНУТЫ. `start_hour` и
-- `end_hour` читают и клиент, и серверные функции, и веб-бэкап
-- `tenant_state.prototype_state`. Смена ЕДИНИЦЫ в колонке с прежним именем —
-- это мина: любой не переписанный читатель молча получит 510 вместо 8 и
-- нарисует рельс на 510-м часу. Поэтому час остаётся часом, а минуты приходят
-- отдельным полем; вместе они дают ровно то, что накрутили барабаны.
--
-- ШАГ ПЯТЬ ЗАПИСАН В ОГРАНИЧЕНИЕ. Барабан минут — пятиминутка, и это не
-- декорация формы: значение вне сетки (08:37) не выражается контролом, то есть
-- в базу попасть могло бы только мимо продукта, и починить его человек уже не
-- смог бы — крутилка такой минуты не покажет.

alter table public.calendar_settings
  add column if not exists start_minute integer not null default 0,
  add column if not exists end_minute integer not null default 0;

comment on column public.calendar_settings.start_minute is
  'Минуты начала видимого окна календаря, кратны 5. Вместе со start_hour дают границу «С».';
comment on column public.calendar_settings.end_minute is
  'Минуты конца видимого окна календаря, кратны 5. При end_hour = 24 всегда 0 — 1440-й минуты в сутках нет.';

do $add_checks$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.calendar_settings'::regclass
       and conname = 'calendar_settings_window_minutes_check'
  ) then
    alter table public.calendar_settings
      add constraint calendar_settings_window_minutes_check
      check (
        start_minute >= 0 and start_minute <= 59 and start_minute % 5 = 0
        and end_minute >= 0 and end_minute <= 59 and end_minute % 5 = 0
        -- Конец суток минут не имеет: 24:35 не существует.
        and (end_hour <> 24 or end_minute = 0)
      );
  end if;

  -- Окно шириной ноль или назад — не окно. Проверка живёт в базе, а не только
  -- в форме: рельс с winEnd <= winStart делит на ноль в геометрии сетки.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.calendar_settings'::regclass
       and conname = 'calendar_settings_window_order_check'
  ) then
    alter table public.calendar_settings
      add constraint calendar_settings_window_order_check
      check (end_hour * 60 + end_minute > start_hour * 60 + start_minute);
  end if;
end;
$add_checks$;

-- ─── Deploy assertions ───────────────────────────────────────────────
do $audit$
declare
  bad integer;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'calendar_settings'
       and column_name = 'start_minute'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'calendar_settings'
       and column_name = 'end_minute'
  ) then
    raise exception 'Часы календаря: минутные колонки не создались';
  end if;

  select count(*) into bad
    from public.calendar_settings
   where start_minute % 5 <> 0
      or end_minute % 5 <> 0
      or (end_hour = 24 and end_minute <> 0)
      or end_hour * 60 + end_minute <= start_hour * 60 + start_minute;
  if bad > 0 then
    raise exception 'Часы календаря: % строк не проходят новые правила', bad;
  end if;
end;
$audit$;
