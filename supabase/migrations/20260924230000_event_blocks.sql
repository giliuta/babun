-- БЛОКИ СОБЫТИЯ — СВОИ, НЕ ОБЩИЕ С ЗАПИСЬЮ (владелец 2026-09-24: «на одной
-- странице дизайна: выбор блоков в записи, выбор блоков в событиях»).
--
-- До сих пор форма события брала блоки записи: выключенный в записи
-- «Объект» пропадал и в событии, и наоборот — включить заметку событию,
-- не включив её записи, было нельзя. Блоки события — те же функции
-- компании (`calendar_settings.disabled_features`, миграция
-- 20260924140000), со своими ключами:
--   event_label   — метка события
--   event_client  — клиент события
--   event_object  — объект события
--   event_note    — заметка события
--   event_files   — файлы события
-- Выключенный блок пропадает у всей компании; данные не стираются.
--
-- Меняется только список допустимых ключей: пустой список по-прежнему
-- значит «включено всё», поэтому у всех компаний ничего не пропадает.

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
      'client_files',     -- файлы клиентов
      'event_label',      -- метка события
      'event_client',     -- клиент события
      'event_object',     -- объект события
      'event_note',       -- заметка события
      'event_files'       -- файлы события
    ]::text[]
  );
