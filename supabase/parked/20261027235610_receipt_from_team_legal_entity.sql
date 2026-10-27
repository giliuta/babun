-- ЧЕК — ОТ ЮРЛИЦА КОМАНДЫ ПЛАТЕЖА, КАК ИНВОЙС (035·3, №131 / F-36).
--
-- `issue_invoice` без выбранных реквизитов берёт юрлицо команды документа
-- (`legal_entity_of_team`), у команды без своего — основное; не-владельцу
-- другое юрлицо выбрать не даёт. Чек на доход без инвойса брал юрлицо,
-- присланное приложением, иначе основное: партнёр команды B выписывал по одной
-- записи инвойс от юрлица B, а чек — от юрлица A (чужое имя, VAT-номер и серия
-- номеров).
--
-- Теперь `_issue_receipt_core` решает так же, как инвойс:
--   • реквизиты, выбранные явно, → юрлицо команды платежа → основное;
--   • не-владелец — только юрлицо команды платежа: другое отбивается тем же
--     отказом, что у инвойса. Приложению не-владельца достаточно слать `null`.
-- Права выбора не шире прежних: `resolve_company_id` пускает не-владельца
-- только к юрлицу команды, где у него «Документы: Меняет», а
-- `_receipt_tx_allowed` требует это право в команде платежа. Чек по инвойсу
-- по-прежнему берёт юрлицо инвойса.
--
-- Тело правится по якорю в живом определении. С 20261027225321 (дата чека)
-- якоря не пересекаются — порядок любой.

do $migration$
declare
  d text := pg_get_functiondef('public._issue_receipt_core(public.finance_transactions, jsonb, uuid, date, text, text)'::regprocedure);
  anchor constant text := E'    company_uuid := public.resolve_company_id(p_tx.tenant_id, p_company_id);\n';
  replacement constant text := E'    -- Как у инвойса: не-владелец — только от реквизитов команды платежа.\n'
    || E'    if public.current_user_role() is distinct from ''owner''\n'
    || E'       and p_company_id is not null\n'
    || E'       and p_company_id is distinct from coalesce(\n'
    || E'         public.legal_entity_of_team(p_tx.tenant_id, p_tx.team_id),\n'
    || E'         public.resolve_company_id(p_tx.tenant_id, null)\n'
    || E'       ) then\n'
    || E'      raise exception ''Документ команды выставляется от реквизитов этой команды''\n'
    || E'        using errcode = ''42501'', hint = ''block:finance.documents'';\n'
    || E'    end if;\n'
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
