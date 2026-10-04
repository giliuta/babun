-- ДЕНЬГИ ЗАПИСИ С ИНВОЙСОМ — ЧЕРЕЗ ИНВОЙС (владелец 04.10: «записал клиента,
-- выставил инвойс, он скинул предоплату — я нажал оплатить и сделал чек, а
-- инвойс остался неоплаченным; это будет расхождение во всех слоях финансов»).
--
-- Цепочка, которую держит сервер: пока по записи есть выставленный и не
-- оплаченный инвойс, счёт клиенту — ОН. Оплата идёт `record_invoice_payment`:
-- инвойс получает деньги и статус, запись закрывается его зачётом
-- (`settle_appointment_from_invoice_payment`), чек выписывается на платёж
-- инвойса. Прямая оплата записи (`record_appointment_payment` — плитки,
-- лист дня) в обход инвойса давала второй, несвязанный доход: запись
-- «оплачена», инвойс висит долгом. Теперь она отказывает словами, куда идти;
-- блок «Оплата» записи сам ведёт деньги в инвойс.

set local lock_timeout = '5s';

do $patch$
declare
  def text;
  needle constant text := E'  if appt.status = \'cancelled\' or appt.payment_status = \'refunded\' then\n    raise exception \'По отменённой заявке оплату не записать\';\n  end if;\n';
begin
  def := pg_get_functiondef('public.record_appointment_payment(uuid, uuid, numeric, uuid, text, timestamp with time zone, boolean)'::regprocedure);
  if (length(def) - length(replace(def, needle, ''))) / length(needle) <> 1 then
    raise exception 'record_appointment_payment: проверка отмены не найдена ровно один раз';
  end if;
  execute replace(def, needle, needle || E'  if exists (\n    select 1 from public.invoices inv\n     where inv.tenant_id = appt.tenant_id\n       and inv.appointment_id = appt.id\n       and coalesce(inv.kind, \'invoice\') = \'invoice\'\n       and inv.status = \'issued\'\n  ) then\n    raise exception \'По записи выставлен инвойс % — примите оплату по нему\',\n      (select inv.number from public.invoices inv\n        where inv.tenant_id = appt.tenant_id\n          and inv.appointment_id = appt.id\n          and coalesce(inv.kind, \'invoice\') = \'invoice\'\n          and inv.status = \'issued\'\n        order by inv.created_at desc\n        limit 1);\n  end if;\n');
end
$patch$;

do $guard$
begin
  if position('примите оплату по нему' in (select prosrc from pg_proc
       where oid = 'public.record_appointment_payment(uuid, uuid, numeric, uuid, text, timestamp with time zone, boolean)'::regprocedure)) = 0 then
    raise exception 'сторож: оплата записи идёт мимо инвойса';
  end if;
end
$guard$;
