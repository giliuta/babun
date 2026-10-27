-- МЁРТВЫЕ ДЕНЕЖНЫЕ ДВЕРИ ЗАКРЫТЫ ДЛЯ API (аудит 035, dat/M-08).
--
-- `reset_appointment_payment` (снять оплату записи целиком) и
-- `set_appointment_prepayment` (поставить предоплату одной суммой) — двери
-- старой формы оплаты. Приложение их не зовёт: обёртки в
-- `packages/shared/.../appointment-money.ts` остались без вызывающих после
-- зачистки 8f3bee646 (13.10), а магазинная 1.0 вышла уже без потребителей.
-- Но через `/rest/v1/rpc/…` они живы и меняют деньги записи в обход нынешних
-- дверей оплаты (`record_appointment_payment` / `cancel_appointment_payment`).
--
-- Функции не удаляются — снимается только право исполнения у людей: если
-- дверь окажется нужна, вернуть её — одна строка `grant`.

revoke execute on function public.reset_appointment_payment(uuid)
  from public, anon, authenticated;
revoke execute on function public.set_appointment_prepayment(uuid, numeric, text)
  from public, anon, authenticated;
