-- ЯЗЫК БУМАГИ ИНВОЙСА — ЛЮБОЙ ЯЗЫК ПРИЛОЖЕНИЯ (владелец 2026-10-04: «выбор
-- языка в инвойсе… я могу выбирать язык соответственно тому, что я выберу»).
--
-- Было: бумага на русском или английском, и база держала это проверкой
-- `invoices_language_check (language in ('ru','en'))`. Приложение теперь
-- говорит на семи языках (Кабинет → «Языки»), и инвойс, чек к нему и
-- кредит-нота печатаются на любом из них — список тот же, что
-- `UI_LOCALES` в packages/shared/src/i18n/locales.ts.
--
-- Кредит-нота наследует язык отменяемого инвойса (`_issue_credit_note` берёт
-- `original.language`) — новая проверка пропускает и её. Старые строки
-- ('ru', 'en') остаются в списке.

alter table public.invoices drop constraint if exists invoices_language_check;

alter table public.invoices
  add constraint invoices_language_check
  check (language = any (array['ru', 'en', 'bg', 'el', 'uk', 'de', 'es']::text[]));
