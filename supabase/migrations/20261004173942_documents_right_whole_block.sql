-- ПРАВО «ДОКУМЕНТЫ» — ВЕСЬ БЛОК (владелец 2026-10-04: «да, давай делай» —
-- по его правилу 30.09 «„Меняет“ — весь блок»).
--
-- Аудит прав 04.10 нашёл, что «Документы» держались не тем:
--  • «Скрыт» не мешал выписать и править чек — `_receipt_tx_allowed` смотрел
--    только на право денег; теперь не-владельцу нужен «Документы: Меняет» в
--    команде платежа;
--  • «Скрыт» не прятал чеки — политика `receipts_read_own_money` отдавала
--    чек по видимым деньгам; теперь ещё и «Документы» хотя бы «Видит» в его
--    команде;
--  • «Видит и меняет» обещал «выписывает целиком», а оплата, правка, отмена,
--    кредит-нота, удаление и возврат были только у владельца. Теперь их даёт
--    «Документы: Меняет» в команде документа. Номер серии — по-прежнему у
--    владельца (Кабинет → Реквизиты).
--
-- Проверки «только владелец» в девяти функциях заменены точечно (тело — из
-- живого `pg_get_functiondef`, «ровно одно вхождение»). Оплата инвойса
-- (`record_invoice_payment`) переведена в definer: её правила внутри неё и в
-- `validate_invoice_payment_insert`, а не в чужих политиках таблиц.

set local lock_timeout = '5s';

-- ─── Помощники: «может менять документы этой команды» ───

create or replace function public._documents_write_team(p_team text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'owner'
      or (p_team is not null
          and p_team = any(public.access_calendars('finance.documents', 'write')));
$$;

create or replace function public._documents_write_invoice(p_invoice_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'owner'
      or exists (
        select 1 from public.invoices i
         where i.id = p_invoice_id
           and i.tenant_id = public.current_tenant_id()
           and i.brigade_id = any(public.access_calendars('finance.documents', 'write'))
      );
$$;

create or replace function public._documents_write_receipt(p_receipt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'owner'
      or exists (
        select 1 from public.receipts r
         where r.id = p_receipt_id
           and r.tenant_id = public.current_tenant_id()
           and r.team_id = any(public.access_calendars('finance.documents', 'write'))
      );
$$;

revoke all on function public._documents_write_team(text) from public, anon, authenticated;
revoke all on function public._documents_write_invoice(uuid) from public, anon, authenticated;
revoke all on function public._documents_write_receipt(uuid) from public, anon, authenticated;

-- ─── Девять функций: «только владелец» → «Документы: Меняет» ───

create or replace function pg_temp.patch(p_sig text, p_edits text[][])
returns void
language plpgsql
as $$
declare
  def text;
  i integer;
begin
  def := pg_get_functiondef(p_sig::regprocedure);
  for i in 1 .. array_length(p_edits, 1) loop
    if (length(def) - length(replace(def, p_edits[i][1], ''))) / length(p_edits[i][1]) <> 1 then
      raise exception '%: правка % не найдена ровно один раз', p_sig, i;
    end if;
    def := replace(def, p_edits[i][1], p_edits[i][2]);
  end loop;
  execute def;
end;
$$;

select pg_temp.patch('public.update_invoice_draft(uuid, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, date, text, text)', array[
  array[
    E'public.current_user_role() is distinct from \'owner\' then\n    raise exception \'Недостаточно прав для редактирования инвойса\';',
    E'not (public._documents_write_invoice(p_invoice_id)\n         and public._documents_write_team(coalesce(p_brigade_id,\n               (select i.brigade_id from public.invoices i where i.id = p_invoice_id)))) then\n    raise exception \'Нужно право «Документы: Видит и меняет» в команде документа\';'
  ]
]);

select pg_temp.patch('public.delete_invoice(uuid)', array[
  array[
    E'public.current_user_role() is distinct from \'owner\' then\n    raise exception \'Удалить инвойс может только владелец\'',
    E'not public._documents_write_invoice(p_invoice_id) then\n    raise exception \'Нужно право «Документы: Видит и меняет» в команде документа\''
  ]
]);

select pg_temp.patch('public.cancel_invoice(uuid, text)', array[
  array[
    E'public.current_user_role() is distinct from \'owner\' then\n    raise exception \'Отменить инвойс может только владелец\';',
    E'not public._documents_write_invoice(p_invoice_id) then\n    raise exception \'Нужно право «Документы: Видит и меняет» в команде документа\';'
  ]
]);

select pg_temp.patch('public.issue_partial_credit_note(uuid, uuid, numeric, text, text)', array[
  array[
    E'public.current_user_role() is distinct from \'owner\' then\n    raise exception \'Выписать кредит-ноту может только владелец\'',
    E'not public._documents_write_invoice(p_invoice_id) then\n    raise exception \'Нужно право «Документы: Видит и меняет» в команде документа\''
  ]
]);

select pg_temp.patch('public.delete_credit_note(uuid)', array[
  array[
    E'public.current_user_role() is distinct from \'owner\' then\n    raise exception \'Удалить кредит-ноту может только владелец\'',
    E'not public._documents_write_invoice(p_note_id) then\n    raise exception \'Нужно право «Документы: Видит и меняет» в команде документа\''
  ]
]);

select pg_temp.patch('public.record_invoice_payment(uuid, uuid, numeric, uuid, text, date, text)', array[
  array[
    E'public.current_user_role() is distinct from \'owner\' then\n    raise exception \'Недостаточно прав для оплаты инвойса\';',
    E'not public._documents_write_invoice(p_invoice_id) then\n    raise exception \'Нужно право «Документы: Видит и меняет» в команде документа\';'
  ],
  array[E' LANGUAGE plpgsql\n', E' LANGUAGE plpgsql\n SECURITY DEFINER\n']
]);

select pg_temp.patch('public.refund_receipt(uuid, uuid, numeric, text, text)', array[
  array[
    E'public.current_user_role() is distinct from \'owner\' then\n    raise exception \'Вернуть деньги по чеку может только владелец\'',
    E'not public._documents_write_receipt(p_receipt_id) then\n    raise exception \'Нужно право «Документы: Видит и меняет» в команде документа\''
  ]
]);

select pg_temp.patch('public.issue_receipt_credit_note(uuid, text, text)', array[
  array[
    E'public.current_user_role() is distinct from \'owner\' then\n    raise exception \'Выписать кредит-ноту может только владелец\'',
    E'not public._documents_write_receipt(p_receipt_id) then\n    raise exception \'Нужно право «Документы: Видит и меняет» в команде документа\''
  ]
]);

select pg_temp.patch('public.delete_receipt(uuid)', array[
  array[
    E'public.current_user_role() is distinct from \'owner\' then\n    raise exception \'Удалить чек может только владелец\'',
    E'not public._documents_write_receipt(p_receipt_id) then\n    raise exception \'Нужно право «Документы: Видит и меняет» в команде документа\''
  ]
]);

-- ─── Чек: выписать и править — только с «Документы: Меняет» ───

select pg_temp.patch('public._receipt_tx_allowed(public.finance_transactions)', array[
  array[
    E'  return allowed is true;',
    E'  -- Не-владельцу чек — документ: без «Документы: Меняет» в команде\n  -- платежа его не выписать и не поправить (аудит прав 04.10).\n  if allowed is true and not public._documents_write_team(p_tx.team_id) then\n    return false;\n  end if;\n  return allowed is true;'
  ]
]);

-- ─── Чек: читать — только с «Документы» хотя бы «Видит» ───

drop policy if exists receipts_read_own_money on public.receipts;
create policy receipts_read_own_money on public.receipts
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and transaction_id in (
      select ft.id from public.finance_transactions ft
       where ft.tenant_id = (select public.current_tenant_id())
    )
    and (
      client_id is null
      or client_id in (select unnest(public.access_block_client_ids('clients.history', 'read')))
    )
    and team_id in (select unnest(public.access_calendars('finance.documents', 'read')))
  );

do $guard$
declare
  fn text;
begin
  foreach fn in array array[
    'update_invoice_draft', 'delete_invoice', 'cancel_invoice',
    'issue_partial_credit_note', 'delete_credit_note', 'record_invoice_payment',
    'refund_receipt', 'issue_receipt_credit_note', 'delete_receipt'
  ] loop
    if exists (
      select 1 from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = fn
         and position('is distinct from ''owner''' in p.prosrc) > 0
    ) then
      raise exception 'сторож: % всё ещё только для владельца', fn;
    end if;
  end loop;
  if position('_documents_write_team' in (select prosrc from pg_proc
       where oid = 'public._receipt_tx_allowed(public.finance_transactions)'::regprocedure)) = 0 then
    raise exception 'сторож: чек не смотрит на право «Документы»';
  end if;
  if has_function_privilege('authenticated', 'public._documents_write_team(text)', 'execute') then
    raise exception 'сторож: помощник прав открыт снаружи';
  end if;
end
$guard$;
