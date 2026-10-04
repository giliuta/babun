-- ПРАВКА И УДАЛЕНИЕ ВЫСТАВЛЕННОГО ИНВОЙСА (владелец 2026-10-04: «нужна функция
-- редактировать инвойс после выставления — я ещё не отправил клиенту, могу
-- отредактировать»; «полностью удалить инвойс, который мы даже не успели
-- скинуть, — смахнуть вправо, и тогда восстанавливается порядковый номер»).
--
-- 1. `update_invoice_draft` — правка на месте, тот же номер. Функция была
--    мёртвой: invoker без права исполнения у `authenticated`. Теперь definer
--    (правило «только владелец, только без оплат» внутри — как было), плюс
--    дата выставления (в пределах года номера), объект и реквизиты клиента.
--    Реквизиты продавца не меняются: номер — из серии их юрлица.
-- 2. `delete_invoice` — удаление ТОЛЬКО последнего инвойса серии, без оплат
--    и без кредит-ноты: номер возвращается в серию, дыры нет. Документ из
--    середины серии отменяется кредит-нотой (сплошная нумерация для VAT).
--    Триггер `prevent_settled_invoice_delete` пропускает ровно это удаление.
--
-- Тело `update_invoice_draft` и триггера — из живого `pg_get_functiondef`,
-- правки — точечными заменами с проверкой «ровно одно вхождение».

set local lock_timeout = '5s';

do $patch$
declare
  def text;
  old_sig constant text := 'public.update_invoice_draft(uuid, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid)';
  edits text[][] := array[
    -- новые параметры
    array[
      'p_company_id uuid DEFAULT NULL::uuid, p_account_id uuid DEFAULT NULL::uuid)',
      'p_company_id uuid DEFAULT NULL::uuid, p_account_id uuid DEFAULT NULL::uuid, p_issued_on date DEFAULT NULL::date, p_location_id text DEFAULT NULL::text, p_client_requisites_id text DEFAULT NULL::text)'
    ],
    -- definer: правило владельца внутри функции
    array[E' LANGUAGE plpgsql\n', E' LANGUAGE plpgsql\n SECURITY DEFINER\n'],
    -- переменные
    array[
      E'  invoice_vat_mode text;\nbegin',
      E'  invoice_vat_mode text;\n  next_issued_on date;\n  location_text text := nullif(btrim(p_location_id), \'\');\n  requisites_text text := nullif(btrim(p_client_requisites_id), \'\');\nbegin'
    ],
    -- дата выставления — в пределах года номера, срок не раньше неё
    array[
      E'  if p_due_on is not null and p_due_on < invoice_row.issued_on then',
      E'  next_issued_on := coalesce(p_issued_on, invoice_row.issued_on);\n  if extract(year from next_issued_on)::integer <> invoice_row.year then\n    raise exception \'Дата инвойса — в пределах % года: номер % из серии этого года\',\n      invoice_row.year, invoice_row.number;\n  end if;\n  if location_text is not null and p_client_id is null and p_appointment_id is null then\n    raise exception \'Объект выбирают у клиента — сначала клиент\';\n  end if;\n  if p_due_on is not null and p_due_on < next_issued_on then'
    ],
    -- что пишется
    array[
      E'         company_id = p_company_id,',
      E'         company_id = coalesce(invoice_row.company_id, p_company_id),\n         issued_on = next_issued_on,\n         location_id = location_text,\n         client_requisites_id = requisites_text,'
    ]
  ];
  i integer;
begin
  def := pg_get_functiondef(old_sig::regprocedure);
  for i in 1 .. array_length(edits, 1) loop
    if (length(def) - length(replace(def, edits[i][1], ''))) / length(edits[i][1]) <> 1 then
      raise exception 'update_invoice_draft: правка % не найдена ровно один раз', i;
    end if;
    def := replace(def, edits[i][1], edits[i][2]);
  end loop;
  execute 'drop function ' || old_sig;
  execute def;
end
$patch$;

revoke all on function public.update_invoice_draft(uuid, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, date, text, text) from public, anon;
grant execute on function public.update_invoice_draft(uuid, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, date, text, text) to authenticated;

-- ─── Удаление последнего инвойса серии ───

do $trg$
declare
  def text;
  needle constant text := E'  raise exception \'Инвойс нельзя удалить; аннулируйте документ\';';
  replacement constant text := E'  -- Последний инвойс серии без оплат удаляет `delete_invoice` (04.10): номер\n  -- возвращается в серию, дыры нет.\n  if current_setting(\'babun.invoice_delete\', true) = old.id::text then\n    return old;\n  end if;\n  raise exception \'Инвойс нельзя удалить; аннулируйте документ\';';
begin
  def := pg_get_functiondef('public.prevent_settled_invoice_delete()'::regprocedure);
  if (length(def) - length(replace(def, needle, ''))) / length(needle) <> 1 then
    raise exception 'prevent_settled_invoice_delete: отказ не найден ровно один раз';
  end if;
  execute replace(def, needle, replacement);
end
$trg$;

create or replace function public.delete_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_uuid uuid := public.current_tenant_id();
  target public.invoices%rowtype;
  last_seq integer;
begin
  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Удалить инвойс может только владелец'
      using errcode = '42501', hint = 'access:owner_only';
  end if;
  select * into target
    from public.invoices
   where id = p_invoice_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Инвойс не найден';
  end if;
  if target.kind <> 'invoice' then
    raise exception 'Кредит-нота не удаляется — она сама является сторно';
  end if;
  if target.status <> 'issued' then
    raise exception 'Удалить можно только неоплаченный инвойс';
  end if;
  if exists (
    select 1 from public.finance_transactions
     where tenant_id = tenant_uuid and invoice_id = target.id
  ) or exists (
    select 1 from public.receipts where invoice_id = target.id
  ) then
    raise exception 'По инвойсу есть платежи или чек — его не удалить';
  end if;
  if exists (
    select 1 from public.invoices note
     where note.credit_note_of_id = target.id and note.tenant_id = tenant_uuid
  ) then
    raise exception 'По инвойсу выписана кредит-нота — его не удалить';
  end if;

  -- Серия — замком, чтобы параллельный выпуск не встал между проверкой и
  -- возвратом номера.
  perform 1 from public.document_sequences s
   where s.tenant_id = tenant_uuid
     and s.legal_entity_id is not distinct from target.company_id
     and s.doc_type = 'invoice'
     and s.year = target.year
   for update;
  select max(i.seq) into last_seq
    from public.invoices i
   where i.tenant_id = tenant_uuid
     and i.kind = 'invoice'
     and i.company_id is not distinct from target.company_id
     and i.year = target.year;
  if last_seq is distinct from target.seq then
    raise exception 'Удалить можно только последний инвойс серии (%) — этот отмените кредит-нотой', last_seq;
  end if;

  perform set_config('babun.invoice_delete', target.id::text, true);
  delete from public.invoices where id = target.id;
  perform set_config('babun.invoice_delete', '', true);

  -- Номер возвращается в серию, если после него ничего не выдавали и не
  -- переставляли вручную.
  update public.document_sequences s
     set last_number = target.seq - 1,
         updated_at = now()
   where s.tenant_id = tenant_uuid
     and s.legal_entity_id is not distinct from target.company_id
     and s.doc_type = 'invoice'
     and s.year = target.year
     and s.last_number = target.seq;
end;
$$;

revoke all on function public.delete_invoice(uuid) from public, anon;
grant execute on function public.delete_invoice(uuid) to authenticated;

do $guard$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'update_invoice_draft') <> 1 then
    raise exception 'сторож: update_invoice_draft должна быть одна';
  end if;
  if not has_function_privilege('authenticated', 'public.update_invoice_draft(uuid, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, date, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.delete_invoice(uuid)', 'execute') then
    raise exception 'сторож: владелец не может править или удалить инвойс';
  end if;
  if has_function_privilege('anon', 'public.update_invoice_draft(uuid, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, date, text, text)', 'execute')
     or has_function_privilege('anon', 'public.delete_invoice(uuid)', 'execute') then
    raise exception 'сторож: функции инвойса открыты anon';
  end if;
  if position('babun.invoice_delete' in (select prosrc from pg_proc
       where oid = 'public.prevent_settled_invoice_delete()'::regprocedure)) = 0 then
    raise exception 'сторож: триггер удаления не знает delete_invoice';
  end if;
end
$guard$;
