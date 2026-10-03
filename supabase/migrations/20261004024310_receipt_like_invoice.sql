-- ЧЕК — КАК ИНВОЙС (владелец 2026-10-04: «делай все пять пунктов… кому-то
-- понадобится выписать чек на принятие оплаты именно на этот объект —
-- делай всё чётко, как в инвойсе»; «я выписал чек, увидел мелочь, клиенту
-- ещё не отправлял — сразу отредактирую этот чек и отправлю»).
--
-- 1. Объект и реквизиты клиента у чека — те же снимки, что у инвойса
--    (`build_invoice_client_snapshot_with_object` + `…_for`), колонки
--    `location_id` и `client_requisites_id`.
-- 2. Дата чека — своя, правится (по умолчанию — день оплаты). Синхронизация
--    с доходом (`sync_receipt_with_income`) дату больше не переписывает.
-- 3. `update_receipt` — правка выписанного чека НА МЕСТЕ: строки, дата,
--    объект, реквизиты клиента. Номер, сумма, счёт и клиент остаются —
--    они от оплаты. Дата — в пределах года номера.
-- 4. Права — одно правило на выписку и правку (`_receipt_tx_allowed`, тело
--    из прежнего `issue_receipt`).
--
-- Тела `issue_receipt`, `_issue_receipt_core`, `sync_receipt_with_income` —
-- из живого `pg_get_functiondef` 04.10, изменены только описанные места.

set local lock_timeout = '5s';

alter table public.receipts add column if not exists location_id text;
alter table public.receipts add column if not exists client_requisites_id text;

-- ─── Права: кто выписывает и правит чек этой оплаты ───

create or replace function public._receipt_tx_allowed(p_tx public.finance_transactions)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tenant_uuid uuid := public.current_tenant_id();
  allowed boolean := false;
begin
  if public.current_user_role() = 'owner' then
    allowed := true;
  elsif p_tx.source = 'auto' and p_tx.appointment_id is not null then
    allowed := public.current_user_can_pay_appointment(p_tx.team_id, p_tx.master_id);
  elsif p_tx.debt_id is not null then
    allowed :=
      p_tx.team_id is not null
      and p_tx.team_id = any(public.access_calendars('finance.debts', 'write'))
      and p_tx.debt_id in (
        select d.id from public.debts d
         where d.tenant_id = tenant_uuid
           and d.team_id = any(public.access_calendars('finance.debts', 'write'))
      )
      and (
        p_tx.account_id is null
        or p_tx.account_id = any(public.access_accounts_for('finance.debts', 'write'))
      );
  else
    allowed :=
      p_tx.team_id is not null
      and (
        p_tx.team_id = any(public.access_calendars('finance.income', 'full'))
        or (
          p_tx.team_id = any(public.access_calendars('finance.income', 'write'))
          and p_tx.created_by is not distinct from auth.uid()
        )
      )
      and (
        p_tx.account_id is null
        or p_tx.account_id = any(public.access_accounts_for('finance.income', 'write'))
      );
  end if;
  -- 03.10: чек оплаченного инвойса выписывает и партнёр с «Документы:
  -- Выставляет» в команде инвойса.
  if allowed is not true
     and p_tx.invoice_id is not null
     and exists (
       select 1
         from public.invoices invoice
        where invoice.id = p_tx.invoice_id
          and invoice.tenant_id = tenant_uuid
          and invoice.brigade_id = p_tx.team_id
          and invoice.brigade_id = any(public.access_calendars('finance.documents', 'write'))
     ) then
    allowed := true;
  end if;
  return allowed is true;
end;
$$;

revoke all on function public._receipt_tx_allowed(public.finance_transactions) from public, anon, authenticated;

-- ─── Снимок получателя чека — как у инвойса ───

create or replace function public._receipt_client_snapshot(
  p_tenant_id uuid,
  p_client_id uuid,
  p_location_id text,
  p_client_requisites_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  snap jsonb;
begin
  snap := public.build_invoice_client_snapshot_with_object(p_tenant_id, p_client_id, p_location_id)
       || coalesce(public.build_invoice_client_snapshot_for(p_tenant_id, p_client_id, p_client_requisites_id), '{}'::jsonb);
  if snap is null then
    return null;
  end if;
  -- `name` — ключ прежних снимков чека: старые экраны читают его.
  return snap || jsonb_build_object('name', snap -> 'full_name');
end;
$$;

revoke all on function public._receipt_client_snapshot(uuid, uuid, text, text) from public, anon, authenticated;

-- ─── Ядро выписки: дата, объект, реквизиты клиента ───

drop function if exists public._issue_receipt_core(public.finance_transactions, jsonb, uuid);

create function public._issue_receipt_core(
  p_tx public.finance_transactions,
  p_lines jsonb default null,
  p_company_id uuid default null,
  p_issued_on date default null,
  p_location_id text default null,
  p_client_requisites_id text default null
)
returns public.receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  receipt_date date := coalesce(p_issued_on, p_tx.occurred_on);
  receipt_year integer;
  receipt_seq integer;
  receipt_number text;
  seller jsonb;
  buyer jsonb;
  company_uuid uuid;
  location_text text := nullif(btrim(p_location_id), '');
  requisites_text text := nullif(btrim(p_client_requisites_id), '');
  result_row public.receipts%rowtype;
begin
  if p_tx.type <> 'income' or p_tx.client_id is null or p_tx.amount <= 0 then
    return null;
  end if;

  receipt_year := extract(year from receipt_date)::integer;

  -- ПОВТОР НЕ ТРАТИТ НОМЕР. Операция под замком, готовый чек возвращается
  -- раньше, чем серия выдаст следующий номер.
  perform 1 from public.finance_transactions where id = p_tx.id for update;
  select * into result_row from public.receipts where transaction_id = p_tx.id;
  if found then
    return result_row;
  end if;

  -- Юрлицо чека — юрлицо его инвойса; чек без инвойса — выбранное или основное.
  select invoice.company_id into company_uuid
    from public.invoices invoice
   where invoice.id = p_tx.invoice_id
     and invoice.tenant_id = p_tx.tenant_id;
  if company_uuid is null then
    company_uuid := public.resolve_company_id(p_tx.tenant_id, p_company_id);
  end if;

  -- Снимок получателя до номера: объект не того клиента — отказ без дыры.
  buyer := public._receipt_client_snapshot(p_tx.tenant_id, p_tx.client_id, location_text, requisites_text);

  select numbering.seq, numbering.number
    into receipt_seq, receipt_number
    from public.next_document_number(
      p_tx.tenant_id, company_uuid, 'receipt', receipt_year
    ) as numbering;
  select jsonb_object_agg(entry.key, entry.value)
    into seller
    from jsonb_each(public.build_seller_snapshot(p_tx.tenant_id, company_uuid)) as entry
   where entry.key in (
     'name', 'address', 'vat_number', 'reg_number',
     'iban', 'bank_name', 'vat_mode', 'currency'
   );

  insert into public.receipts (
    tenant_id, number, year, seq, issued_on, amount, currency,
    vat_rate, vat_amount, client_id, appointment_id, invoice_id,
    transaction_id, account_id, payment_method, seller_snapshot, client_snapshot,
    lines, company_id, location_id, client_requisites_id
  ) values (
    p_tx.tenant_id,
    receipt_number,
    receipt_year, receipt_seq, receipt_date, round(p_tx.amount, 2),
    coalesce(p_tx.currency, 'EUR'), p_tx.vat_rate, p_tx.vat_amount,
    p_tx.client_id, p_tx.appointment_id, p_tx.invoice_id, p_tx.id,
    p_tx.account_id, p_tx.payment_method, coalesce(seller, '{}'::jsonb), buyer,
    public._receipt_lines_snapshot(p_lines), company_uuid, location_text, requisites_text
  )
  on conflict (transaction_id) where transaction_id is not null do nothing
  returning * into result_row;

  if not found then
    select * into result_row from public.receipts where transaction_id = p_tx.id;
  end if;
  return result_row;
end;
$$;

revoke all on function public._issue_receipt_core(public.finance_transactions, jsonb, uuid, date, text, text) from public, anon, authenticated;

-- ─── Выписка ───

drop function if exists public.issue_receipt(uuid, jsonb, uuid);

create function public.issue_receipt(
  p_transaction_id uuid,
  p_lines jsonb default null,
  p_company_id uuid default null,
  p_issued_on date default null,
  p_location_id text default null,
  p_client_requisites_id text default null
)
returns public.receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_uuid uuid := public.current_tenant_id();
  tx public.finance_transactions%rowtype;
  existing public.receipts%rowtype;
  result_row public.receipts%rowtype;
  refunded_amount numeric;
begin
  if auth.uid() is null or tenant_uuid is null then
    raise exception 'Войдите в приложение, чтобы выписать чек';
  end if;
  if p_transaction_id is null then
    raise exception 'Не указана операция';
  end if;

  select * into tx
    from public.finance_transactions
   where id = p_transaction_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Операция не найдена';
  end if;

  if public._receipt_tx_allowed(tx) is not true then
    raise exception 'Недостаточно прав, чтобы выписать чек по этой операции';
  end if;

  select * into existing from public.receipts where transaction_id = tx.id;
  if found then
    return existing;
  end if;

  if tx.type <> 'income' then
    raise exception 'Чек выписывается только на доход';
  end if;
  if tx.amount <= 0 then
    raise exception 'Сумма операции должна быть больше нуля';
  end if;
  if tx.client_id is null then
    raise exception 'У операции нет клиента — чек не нужен';
  end if;

  select coalesce(sum(abs(amount)), 0) into refunded_amount
    from public.finance_transactions
   where refund_of_id = tx.id and type = 'refund';
  if refunded_amount >= round(tx.amount, 2) then
    raise exception 'По операции оформлен полный возврат — чек не выписывается';
  end if;

  result_row := public._issue_receipt_core(
    tx, p_lines, p_company_id, p_issued_on, p_location_id, p_client_requisites_id
  );
  if result_row.id is null then
    select * into result_row from public.receipts where transaction_id = tx.id;
  end if;
  if result_row.id is null then
    raise exception 'Не удалось выписать чек';
  end if;
  return result_row;
end;
$$;

revoke all on function public.issue_receipt(uuid, jsonb, uuid, date, text, text) from public, anon;
grant execute on function public.issue_receipt(uuid, jsonb, uuid, date, text, text) to authenticated;

-- ─── Правка выписанного чека на месте ───

create or replace function public.update_receipt(
  p_receipt_id uuid,
  p_lines jsonb default null,
  p_issued_on date default null,
  p_location_id text default null,
  p_client_requisites_id text default null
)
returns public.receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_uuid uuid := public.current_tenant_id();
  target public.receipts%rowtype;
  tx public.finance_transactions%rowtype;
  next_date date;
  location_text text := nullif(btrim(p_location_id), '');
  requisites_text text := nullif(btrim(p_client_requisites_id), '');
  result_row public.receipts%rowtype;
begin
  if auth.uid() is null or tenant_uuid is null then
    raise exception 'Войдите в приложение, чтобы изменить чек';
  end if;
  select * into target
    from public.receipts
   where id = p_receipt_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Чек не найден';
  end if;
  if target.status <> 'issued' then
    raise exception 'Аннулированный чек не меняется';
  end if;
  select * into tx
    from public.finance_transactions
   where id = target.transaction_id and tenant_id = tenant_uuid;
  if not found then
    raise exception 'У чека нет оплаты — его не изменить';
  end if;
  if public._receipt_tx_allowed(tx) is not true then
    raise exception 'Недостаточно прав, чтобы изменить этот чек';
  end if;

  next_date := coalesce(p_issued_on, target.issued_on);
  if extract(year from next_date)::integer <> target.year then
    raise exception 'Дата чека — в пределах % года: номер % из серии этого года',
      target.year, target.number;
  end if;

  update public.receipts
     set lines = case when p_lines is null then lines else public._receipt_lines_snapshot(p_lines) end,
         issued_on = next_date,
         location_id = location_text,
         client_requisites_id = requisites_text,
         client_snapshot = public._receipt_client_snapshot(
           tenant_uuid, target.client_id, location_text, requisites_text
         )
   where id = target.id
  returning * into result_row;
  return result_row;
end;
$$;

revoke all on function public.update_receipt(uuid, jsonb, date, text, text) from public, anon;
grant execute on function public.update_receipt(uuid, jsonb, date, text, text) to authenticated;

-- ─── Доход правят — дата чека остаётся его ───

create or replace function public.sync_receipt_with_income()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type <> 'income' then
    return new;
  end if;
  update public.receipts receipt
     set amount = round(new.amount, 2),
         vat_rate = new.vat_rate,
         vat_amount = new.vat_amount,
         account_id = new.account_id,
         payment_method = new.payment_method
   where receipt.transaction_id = new.id
     and receipt.status = 'issued'
     and (receipt.amount is distinct from round(new.amount, 2)
       or receipt.vat_rate is distinct from new.vat_rate
       or receipt.vat_amount is distinct from new.vat_amount
       or receipt.account_id is distinct from new.account_id
       or receipt.payment_method is distinct from new.payment_method);
  return new;
end;
$$;

do $guard$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'issue_receipt') <> 1 then
    raise exception 'сторож: issue_receipt должна быть одна';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = '_issue_receipt_core') <> 1 then
    raise exception 'сторож: _issue_receipt_core должна быть одна';
  end if;
  if has_function_privilege('anon', 'public.issue_receipt(uuid, jsonb, uuid, date, text, text)', 'execute')
     or has_function_privilege('anon', 'public.update_receipt(uuid, jsonb, date, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public._issue_receipt_core(public.finance_transactions, jsonb, uuid, date, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public._receipt_tx_allowed(public.finance_transactions)', 'execute')
     or has_function_privilege('authenticated', 'public._receipt_client_snapshot(uuid, uuid, text, text)', 'execute') then
    raise exception 'сторож: права функций чека не те';
  end if;
  if not has_function_privilege('authenticated', 'public.issue_receipt(uuid, jsonb, uuid, date, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.update_receipt(uuid, jsonb, date, text, text)', 'execute') then
    raise exception 'сторож: владелец не может выписать или изменить чек';
  end if;
  if position('issued_on' in (select prosrc from pg_proc where oid = 'public.sync_receipt_with_income()'::regprocedure)) > 0 then
    raise exception 'сторож: доход всё ещё переписывает дату чека';
  end if;
end
$guard$;
