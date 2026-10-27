-- ВОЗВРАТ ПРИ ОТМЕНЕ — ДНЁМ ОТМЕНЫ; КАЛЕНДАРЬ С ВЫПУЩЕННЫМ ИНВОЙСОМ НЕ
-- СТИРАЕТСЯ (аудит 035: fin/F-04, fin/F-08; оба — решения 035).
--
-- 1. Отмена оплаченной записи пишет возврат (`reconcile_appointment_finance`).
--    У «записи из истории» (заведена задним числом) он датировался днём
--    ОПЛАТЫ: возврат, сделанный в октябре, менял итог мая. Теперь возврат —
--    день, когда деньги вернули: рабочий день отмены. Возвраты из формы
--    («Вернуть клиенту», «Снять оплату») этой правкой не трогаются.
-- 2. «Удалить календарь навсегда» аннулировал его выпущенные инвойсы
--    (`status = 'void'`) без кредит-ноты: номер серии «съеден» без
--    сторно-документа, чего закон о VAT не допускает. Теперь календарь, где
--    есть выпущенный инвойс без кредит-ноты, не стирается — отказ с причиной.
--
-- Тела правятся по якорям в живых определениях.

do $migration$
declare
  r text := pg_get_functiondef('public.reconcile_appointment_finance'::regproc);
  r_old constant text := E'          case\n'
    || E'            when public.appointment_history_entry_date(appointment_row.id) is not null\n'
    || E'              then income_candidate.occurred_on\n'
    || E'            else business_today\n'
    || E'          end,\n';
  r_new constant text := E'          business_today,\n';
  c text := pg_get_functiondef('public.delete_calendar(text)'::regprocedure);
  c_anchor constant text := E'  insert into public._calendar_delete_context (transaction_id, tenant_id, team_id)\n';
  c_block constant text := E'  -- Выпущенный инвойс без кредит-ноты: стирание календаря аннулировало бы\n'
    || E'  -- его номер без сторно-документа.\n'
    || E'  if exists (\n'
    || E'    select 1 from public.invoices i\n'
    || E'     where i.tenant_id = v_tenant and i.brigade_id = p_team_id\n'
    || E'       and i.kind = ''invoice'' and i.status not in (''void'', ''cancelled'')\n'
    || E'       and not exists (\n'
    || E'         select 1 from public.invoices cn\n'
    || E'          where cn.tenant_id = v_tenant and cn.credit_note_of_id = i.id\n'
    || E'       )\n'
    || E'  ) then\n'
    || E'    raise exception ''В календаре есть выпущенный инвойс без кредит-ноты — сначала отмените его кредит-нотой''\n'
    || E'      using errcode = ''P0001'', hint = ''calendar:issued_invoice'';\n'
    || E'  end if;\n\n';
begin
  if (length(r) - length(replace(r, r_old, ''))) / length(r_old) <> 1 then
    raise exception 'reconcile_appointment_finance: якорь даты возврата не найден ровно один раз';
  end if;
  if (length(c) - length(replace(c, c_anchor, ''))) / length(c_anchor) <> 1 then
    raise exception 'delete_calendar: якорь не найден ровно один раз';
  end if;
  execute replace(r, r_old, r_new);
  execute replace(c, c_anchor, c_block || c_anchor);
end;
$migration$;
