-- ДЕНЬГИ — РОВНО ДО ЦЕНТА И НЕ БОЛЬШЕ ПРЕДЕЛА.
--
-- Формы приложения принимают сумму только целыми центами и не больше
-- 9 999 999 999,99 (`MAX_MONEY_CENTS`, тот же предел, что у numeric(12,2) счетов
-- и инвойсов). Но у операций, их VAT, долгов и чеков колонки — numeric без
-- предела, и сервер принимал 0.005 и 123 456 789 012 345,67 от любого клиента:
-- старой сборки, прямого запроса, ошибки округления. Баланс после этого
-- считался с долями цента, а сумма за пределом теряла точность в JavaScript.
--
-- Ограничение, а не триггер: проверка одна на любой путь записи — форма, rpc,
-- импорт. Существующие строки проверены на боевой: нарушителей нет.
-- Деньги записи (`appointments.*_amount`) не трогаем: их считает приложение
-- из цены и скидки в процентах, и жёсткая проверка там сорвала бы запись.

alter table public.finance_transactions
  add constraint finance_transactions_amount_cents
    check (amount = round(amount, 2) and abs(amount) <= 9999999999.99) not valid,
  add constraint finance_transactions_vat_amount_cents
    check (vat_amount is null or (vat_amount = round(vat_amount, 2) and abs(vat_amount) <= 9999999999.99)) not valid;
alter table public.finance_transactions validate constraint finance_transactions_amount_cents;
alter table public.finance_transactions validate constraint finance_transactions_vat_amount_cents;

alter table public.debts
  add constraint debts_amount_cents
    check (amount = round(amount, 2) and amount <= 9999999999.99) not valid;
alter table public.debts validate constraint debts_amount_cents;

alter table public.receipts
  add constraint receipts_amount_cents
    check (amount = round(amount, 2) and abs(amount) <= 9999999999.99) not valid,
  add constraint receipts_vat_amount_cents
    check (vat_amount is null or (vat_amount = round(vat_amount, 2) and abs(vat_amount) <= 9999999999.99)) not valid;
alter table public.receipts validate constraint receipts_amount_cents;
alter table public.receipts validate constraint receipts_vat_amount_cents;
