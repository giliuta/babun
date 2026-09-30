-- УДАЛЁННЫЕ РЕКВИЗИТЫ НЕ ДЕРЖАТ ВЫДАННЫЙ ЧЕК.
--
-- Владелец 22.09: реквизиты — справочник как услуги и метки, «вправо сдвинуть
-- — удалить, влево — скрывать». Инвойс уже отпускает набор при удалении
-- (`invoices_company_id_fkey … on delete set null`), а чек держал его связью
-- без правила: первый же чек, подписанный набором, делал набор неудаляемым
-- (23503), и свайп «Удалить» отвечал ошибкой.
--
-- Бумаге это не вредит: и чек, и инвойс печатают продавца из СВОЕГО снимка
-- (`seller_snapshot`), снятого при выдаче. Связь с живой строкой нужна только
-- затем, чтобы знать, каким набором подписано, пока набор жив.

begin;

set local lock_timeout = '5s';

alter table public.receipts drop constraint if exists receipts_company_id_fkey;
alter table public.receipts
  add constraint receipts_company_id_fkey
  foreign key (company_id) references public.companies(id) on delete set null;

-- Сторож: обе связи отпускают набор.
do $$
begin
  if (
    select count(*) from pg_constraint
     where confrelid = 'public.companies'::regclass
       and contype = 'f'
       and confdeltype = 'n'
       and conname in ('receipts_company_id_fkey', 'invoices_company_id_fkey')
  ) <> 2 then
    raise exception 'receipts/invoices must release a deleted company (on delete set null)';
  end if;
end
$$;

commit;
