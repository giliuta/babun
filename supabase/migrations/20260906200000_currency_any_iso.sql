-- STORY-071: валюта бизнеса — любой код ISO 4217, а не пять.
-- Владелец 2026-09-06: «добавь все виды валют». Ограничение на tenants
-- перечисляло пять кодов; теперь проверяется форма кода — три заглавные
-- латинские буквы. Словарь имён и символов живёт в приложении
-- (`packages/shared/src/common/utils/currencies.ts`).
-- day_closures не трогаем: закрытие дня считает в одной валюте и остаётся
-- EUR до своей истории. У accounts колонки currency в проде нет — миграция
-- 20260815130000 её не завела, править нечего.

alter table public.tenants drop constraint if exists tenants_currency_check;
alter table public.tenants
  add constraint tenants_currency_check check (currency ~ '^[A-Z]{3}$');
