-- НАЛОГ ПОСЛЕДНЕЙ ДОЛИ ДОБИРАЕТ БУМАГУ (аудит 2026-10-03).
--
-- record_invoice_payment кладёт в каждый платёж инвойса долю напечатанного
-- VAT: round(vat * платёж / итог, 2). Доли, округлённые каждая до цента,
-- расходятся с бумагой: счёт 100.00 с VAT 15.97, две оплаты по 50.00 — 7.99 +
-- 7.99 = 15.98; три по 33.33/33.33/33.34 — 15.96. Собранный VAT в отчёте
-- (summarizeVat) расходился с VAT на бумаге на цент за каждый такой счёт.
--
-- Теперь платёж, закрывающий счёт (ровно остаток) без возвратов по нему,
-- несёт остаток налога: напечатанное минус налог прежних долей. С возвратами
-- — как раньше, пропорционально (их налог считать здесь не берёмся).
--
-- ПРАВКА ОДНОЙ СТРОКИ ЖИВОГО ТЕЛА. Функция — 11 тысяч символов; переписывать
-- её из вывода инструментов значит рисковать опечаткой. Поэтому миграция берёт
-- тело из базы (pg_get_functiondef), сверяет md5 с тем, что видел аудит, и
-- меняет ровно одну строку. Тело поменяли с тех пор — миграция падает, а не
-- затирает чужое. Права и подпись функции create or replace сохраняет.

do $migration$
declare
  fn regprocedure := 'public.record_invoice_payment(uuid,uuid,numeric,uuid,text,date,text)'::regprocedure;
  def text;
  old_line text := $old$    payment_vat_amount := round(invoice_row.vat_amount * amount_value / invoice_row.total, 2);$old$;
  new_lines text := $new$    -- ПОСЛЕДНЯЯ ДОЛЯ ДОБИРАЕТ НАЛОГ БУМАГИ (аудит 03.10): доли, округлённые
    -- каждая до цента, расходились с напечатанным VAT. Платёж, закрывающий
    -- счёт без возвратов, несёт остаток — напечатанное минус прежние доли.
    if amount_value = remaining_total and direct_refunds = 0 and linked_refunds = 0 then
      payment_vat_amount := invoice_row.vat_amount - coalesce((
        select sum(coalesce(tx.vat_amount, 0))
          from public.finance_transactions tx
         where tx.tenant_id = tenant_uuid
           and tx.invoice_id = invoice_row.id
           and tx.type = 'income'
      ), 0);
    else
      payment_vat_amount := round(invoice_row.vat_amount * amount_value / invoice_row.total, 2);
    end if;$new$;
begin
  if (select md5(prosrc) from pg_proc where oid = fn) <> '15697b762586ffc9a7219eac6155533b' then
    raise exception 'record_invoice_payment изменилась после аудита 03.10 — перечитать тело перед правкой';
  end if;
  def := pg_get_functiondef(fn);
  if (length(def) - length(replace(def, old_line, ''))) / length(old_line) <> 1 then
    raise exception 'строка налога доли не найдена ровно один раз';
  end if;
  execute replace(def, old_line, new_lines);
end
$migration$;
