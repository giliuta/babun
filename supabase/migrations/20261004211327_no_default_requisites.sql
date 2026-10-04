-- НОВЫЙ АККАУНТ — БЕЗ РЕКВИЗИТОВ (владелец 04.10: «почему выбрано Babun как
-- реквизиты — это новый свежий аккаунт, мне надо с нуля добавлять; не надо
-- делать первые реквизиты»). Триггер `trg_tenants_default_legal_entity`
-- заводил каждому новому аккаунту пустой набор с именем аккаунта, и тот
-- вставал «Основными · Не заполнены».
--
-- Приложение к нулю наборов готово: блок «Реквизиты» инвойса пишет «Добавьте,
-- чем подписывать инвойс», первый добавленный набор становится основным.
-- Сервер теперь сам не выставит документ без реквизитов: инвойс и чек без
-- юрлица отказывают словами, куда идти.
--
-- Пустой набор свежего аккаунта «Babun» (ни документов, ни серий, ни команд)
-- удалён — по слову владельца.

set local lock_timeout = '5s';

drop trigger if exists trg_tenants_default_legal_entity on public.tenants;
drop function if exists public.create_default_legal_entity();

do $patch$
declare
  def text;
  needle text;
begin
  def := pg_get_functiondef('public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text, text)'::regprocedure);
  needle := E'    coalesce(p_company_id, public.legal_entity_of_team(tenant_uuid, resolved_brigade_id))\n  );\n';
  if (length(def) - length(replace(def, needle, ''))) / length(needle) <> 1 then
    raise exception 'issue_invoice: выбор юрлица не найден ровно один раз';
  end if;
  execute replace(def, needle, needle ||
    E'  if resolved_company_id is null then\n    raise exception \'Сначала добавьте реквизиты: Кабинет → Реквизиты\';\n  end if;\n');

  def := pg_get_functiondef('public._issue_receipt_core(public.finance_transactions, jsonb, uuid, date, text, text)'::regprocedure);
  needle := E'    company_uuid := public.resolve_company_id(p_tx.tenant_id, p_company_id);\n  end if;\n';
  if (length(def) - length(replace(def, needle, ''))) / length(needle) <> 1 then
    raise exception '_issue_receipt_core: выбор юрлица не найден ровно один раз';
  end if;
  execute replace(def, needle, needle ||
    E'  if company_uuid is null then\n    raise exception \'Сначала добавьте реквизиты: Кабинет → Реквизиты\';\n  end if;\n');
end
$patch$;

delete from public.legal_entities le
 where le.id = '84f12bf6-7836-4264-8fdb-03da181dbce7'
   and le.tenant_id = '984aadf4-5804-40f4-b403-d1e76ccebc3b'
   and coalesce(btrim(le.vat_number), '') = ''
   and not exists (select 1 from public.invoices i where i.company_id = le.id)
   and not exists (select 1 from public.receipts r where r.company_id = le.id)
   and not exists (select 1 from public.teams t where t.legal_entity_id = le.id)
   and not exists (select 1 from public.document_sequences s where s.legal_entity_id = le.id);

do $guard$
begin
  if exists (select 1 from pg_trigger where tgname = 'trg_tenants_default_legal_entity') then
    raise exception 'сторож: триггер реквизитов по умолчанию остался';
  end if;
  if position('Сначала добавьте реквизиты' in (select prosrc from pg_proc
       where oid = 'public._issue_receipt_core(public.finance_transactions, jsonb, uuid, date, text, text)'::regprocedure)) = 0 then
    raise exception 'сторож: чек без реквизитов не отказывает';
  end if;
end
$guard$;
