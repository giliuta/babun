-- ЧЕК — ОТ ЮРЛИЦА КОМАНДЫ ПЛАТЕЖА, КАК ИНВОЙС (035·3, №131 / F-36).
--
-- `issue_invoice` без выбранных реквизитов берёт юрлицо команды документа
-- (`legal_entity_of_team`), у команды без своего — основное. Чек на доход без
-- инвойса брал основное всегда: оплата в команде B выходила чеком юрлица A —
-- чужое имя, чужой VAT-номер и чужая серия номеров.
--
-- Теперь `_issue_receipt_core` выбирает так же, как инвойс: реквизиты,
-- выбранные явно, → юрлицо команды платежа → основное. Права те же:
-- `resolve_company_id` пускает не-владельца только к юрлицу команды, где у
-- него «Документы: Меняет», а `_receipt_tx_allowed` и так требует это право в
-- команде платежа. Чек по инвойсу по-прежнему берёт юрлицо инвойса.
--
-- Тело правится по якорю в живом определении. С 20261027225321 (дата чека)
-- якоря не пересекаются — порядок любой.

do $migration$
declare
  d text := pg_get_functiondef('public._issue_receipt_core(public.finance_transactions, jsonb, uuid, date, text, text)'::regprocedure);
  anchor constant text := E'    company_uuid := public.resolve_company_id(p_tx.tenant_id, p_company_id);\n';
  replacement constant text := E'    -- Без выбранных реквизитов — юрлицо команды платежа, как у инвойса.\n'
    || E'    company_uuid := public.resolve_company_id(\n'
    || E'      p_tx.tenant_id,\n'
    || E'      coalesce(p_company_id, public.legal_entity_of_team(p_tx.tenant_id, p_tx.team_id))\n'
    || E'    );\n';
begin
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception '_issue_receipt_core: якорь выбора юрлица не найден ровно один раз';
  end if;
  execute replace(d, anchor, replacement);
end;
$migration$;
