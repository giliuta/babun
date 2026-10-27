-- ДОКУМЕНТЫ: СКРЫТЫЙ СЧЁТ, МЁРТВАЯ РОЛЬ, ЯЗЫК ПО УМОЛЧАНИЮ (аудит 035:
-- fin/F-06, fin/F-07, fin/F-31).
--
-- 1. Чеки на скрытый счёт не-владельцу не видны (`receipts_hidden_owner_only`),
--    а инвойсы — видны: партнёр с «Документы · Видит» открывал инвойс,
--    оплаченный на скрытый счёт, — «Оплачен», а платежей под ним нет, и сам
--    факт скрытого счёта раскрыт. Теперь у инвойсов то же ограничение.
-- 2. `legal_entities_read` и `receipts_read` пускали роль `dispatcher`. Таких
--    людей в базе нет, но вернись роль — диспетчер увидел бы ВСЕ чеки и
--    юрлица мимо «Документов». Остаётся только владелец (партнёры читают
--    документы по своим политикам блока «Документы»).
-- 3. `invoices.language` по умолчанию `'ru'`: инвойс, выпущенный повтором
--    «Выставить» после потерянного ответа, оставался русским при EN в форме
--    (язык записывался вторым запросом). Документ продавца на Кипре по
--    умолчанию — английский; русский выбирают явно. Клиентская часть
--    (`app/invoices/new.tsx`) — отдельный шаг.

drop policy if exists invoices_hidden_owner_only on public.invoices;
create policy invoices_hidden_owner_only on public.invoices
  as restrictive
  for select
  to authenticated
  using (
    account_id is null
    or (select public.current_user_role()) = 'owner'
    or not (account_id in (select unnest(public.hidden_account_ids())))
  );

alter policy legal_entities_read on public.legal_entities
  using ((tenant_id = (select public.current_tenant_id())) and ((select public.current_user_role()) = 'owner'));

alter policy receipts_read on public.receipts
  using ((tenant_id = (select public.current_tenant_id())) and ((select public.current_user_role()) = 'owner'));

alter table public.invoices alter column language set default 'en';
