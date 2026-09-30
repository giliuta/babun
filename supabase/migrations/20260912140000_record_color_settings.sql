-- Настройки цвета записи переезжают из телефона в компанию.
--
-- Правило автоцвета, палитра ситуаций («Нет клиента», «Нет объекта», «Нет
-- услуг») и запасной цвет жили ТОЛЬКО в MMKV устройства: ключи
-- `babun-booking-auto-color:<tenant>`, `babun-booking-palette:<tenant>`,
-- `babun-booking-fallback-color:<tenant>` в `features/appointments/
-- booking-prefs.ts`. Сервера у них не было вовсе.
--
-- Чем это оказалось на практике (2026-09-12, два симулятора владельца): один
-- и тот же аккаунт, одна компания, один бандл — и записи выкрашены по-разному
-- на двух экранах. Из того же корня: переустановка приложения стирает
-- настройку, а приглашённый сотрудник получает не то, что настроил владелец, а
-- заводские значения.
--
-- Настройка компании не имеет права жить на телефоне. Дом для неё уже есть —
-- `calendar_settings`, синглтон тенанта, где лежат часы, пояс, буфер и метки
-- личного календаря. Заводить вторую таблицу настроек значит заводить вторую
-- дверь к одному и тому же (канон «бери готовое, не пиши второе»).
--
-- NULL значит «заводское»: палитра и запасной цвет не обязаны существовать,
-- и продукт обязан знать разницу между «владелец выбрал серый» и «владелец не
-- выбирал ничего». У правила заводское значение одно ('team'), поэтому оно
-- not null с дефолтом.
--
-- ГРАНИЦА, КОТОРУЮ НАДО ЗНАТЬ: `read_operational_calendar_settings_safe()` —
-- единственный путь к настройкам для диспетчера и мастера — эти три поля пока
-- НЕ отдаёт, то есть у них цвета останутся заводскими. Сегодня это ничего не
-- ломает (в базе ноль мастеров с аккаунтом и ноль принятых приглашений), а
-- чинится это там же, где переписываются все безопасные функции — в очереди
-- прав на календарь (docs/PLAN-CALENDARS-2026-09-10.md).

alter table public.calendar_settings
  add column if not exists record_color_rule text not null default 'team',
  add column if not exists record_color_palette jsonb,
  add column if not exists record_color_fallback text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'calendar_settings_record_color_rule_check'
  ) then
    alter table public.calendar_settings
      add constraint calendar_settings_record_color_rule_check
      check (record_color_rule in ('team', 'label', 'service'));
  end if;
end $$;

comment on column public.calendar_settings.record_color_rule is
  'Чем красить запись, когда своего цвета у неё нет: цветом команды, метки '
  'или первой услуги. Заводское — team.';
comment on column public.calendar_settings.record_color_palette is
  'Палитра ситуаций {noClient,noObject,noServices} → hex или null. NULL '
  'целиком = владелец не трогал, действуют заводские цвета.';
comment on column public.calendar_settings.record_color_fallback is
  'Запасной цвет записи, когда не сработало ни одно правило. NULL = заводской.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'calendar_settings'
       and column_name = 'record_color_rule'
       and is_nullable = 'NO'
  ) then
    raise exception 'record_color_rule: колонка не встала или допускает NULL';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'calendar_settings_record_color_rule_check'
  ) then
    raise exception 'record_color_rule: проверка значений не встала';
  end if;
end $$;
