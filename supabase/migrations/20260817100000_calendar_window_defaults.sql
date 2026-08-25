-- СТАНДАРТ КАЛЕНДАРЯ ДЛЯ НОВОГО ТЕНАНТА ПЕРЕЕЗЖАЕТ В БАЗУ.
--
-- Владелец 2026-08-17: «сделай просто основной стандарт: когда создаётся —
-- часы календаря ноль-ноль до 24, рабочие часы с шести до 20:00; кто хочет
-- поменять, тот заходит и меняет».
--
-- Клиент это уже знает (`DEFAULT_CALENDAR_SETTINGS`), а КОЛОНКИ — нет: они
-- отдавали `start_hour = 9`, `end_hour = 20` и NULL в рабочих часах. Пока
-- строку заводит клиент, расхождение не видно; но строку `calendar_settings`
-- создаёт и триггер на тенанта, и тогда новая фирма получала окно 09–20 вместо
-- суток — то есть стандарт продукта зависел от того, кто первый записал строку.
-- Два источника правды об одном стандарте — это не стандарт.
--
-- СУЩЕСТВУЮЩИЕ СТРОКИ НЕ ТРОГАЕМ. `set default` действует только на будущие
-- вставки; у живых тенантов окно уже выставлено (у всех 0/24), и переписывать
-- чужую настройку под «стандарт» значит отобрать сделанный выбор.

alter table public.calendar_settings
  alter column start_hour set default 0,
  alter column end_hour set default 24,
  alter column work_start_hour set default 6,
  alter column work_end_hour set default 20;

-- ─── Deploy assertions ───────────────────────────────────────────────
do $audit$
declare
  d record;
begin
  select
    (select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'calendar_settings'
        and column_name = 'start_hour') as start_hour,
    (select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'calendar_settings'
        and column_name = 'end_hour') as end_hour,
    (select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'calendar_settings'
        and column_name = 'work_start_hour') as work_start_hour,
    (select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'calendar_settings'
        and column_name = 'work_end_hour') as work_end_hour
  into d;

  if d.start_hour is distinct from '0'
     or d.end_hour is distinct from '24'
     or d.work_start_hour is distinct from '6'
     or d.work_end_hour is distinct from '20' then
    raise exception 'Календарь: дефолты колонок не встали (% / % / % / %)',
      d.start_hour, d.end_hour, d.work_start_hour, d.work_end_hour;
  end if;
end;
$audit$;
