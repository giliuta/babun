-- Snapshot of the live `public` schema: functions and their execute grants (376).
-- Taken 2026-10-13 from production with read-only catalog queries
-- (see docs/db/README.md). Reference only — never apply this file;
-- the history that built it is supabase/migrations/.

CREATE OR REPLACE FUNCTION public._dispatch_push(p_event_type text, p_data jsonb, p_recipients uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  push_enabled text;
  skip_push text;
  dispatch_secret text;
  fn_url text := 'https://rdtokosbqvgemicqeqwz.supabase.co/functions/v1/send_push';
begin
  select setting.value into push_enabled
    from public.app_settings setting
   where setting.key = 'push_enabled';
  if not found or push_enabled is distinct from 'on' then
    return;
  end if;

  skip_push := current_setting('app.skip_push', true);
  if skip_push = '1'
     or p_recipients is null
     or cardinality(p_recipients) = 0 then
    return;
  end if;
  if cardinality(p_recipients) > 500 then
    raise exception 'Push recipient limit exceeded';
  end if;

  select secret.secret into dispatch_secret
    from public.edge_cron_secrets secret
   where secret.name = 'send_push';
  if dispatch_secret is null then
    raise exception 'Push dispatch secret is missing';
  end if;

  perform net.http_post(
    url := fn_url,
    body := jsonb_build_object(
      'user_ids', to_jsonb(p_recipients),
      'event_type', p_event_type,
      'data', p_data
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', dispatch_secret
    )
  );
exception when others then
  -- Notifications remain best-effort and never roll back the business write.
  raise warning 'dispatch_push failed: %', sqlerrm;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public._documents_write_invoice(p_invoice_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.current_user_role() = 'owner'
      or exists (
        select 1 from public.invoices i
         where i.id = p_invoice_id
           and i.tenant_id = public.current_tenant_id()
           and i.brigade_id = any(public.access_calendars('finance.documents', 'write'))
      );
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public._documents_write_receipt(p_receipt_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.current_user_role() = 'owner'
      or exists (
        select 1 from public.receipts r
         where r.id = p_receipt_id
           and r.tenant_id = public.current_tenant_id()
           and r.team_id = any(public.access_calendars('finance.documents', 'write'))
      );
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public._documents_write_team(p_team text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.current_user_role() = 'owner'
      or (p_team is not null
          and p_team = any(public.access_calendars('finance.documents', 'write')));
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public._issue_credit_note(p_invoice_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  original public.invoices%rowtype;
  note_id uuid;
  note_date date;
  note_year integer;
  note_seq integer;
  note_number text;
  income_total numeric := 0;
  direct_refunds numeric := 0;
  linked_refunds numeric := 0;
begin
  select * into original
    from public.invoices
   where id = p_invoice_id
   for update;
  if not found then
    raise exception 'Инвойс для кредит-ноты не найден';
  end if;
  if original.kind <> 'invoice' then
    raise exception 'Кредит-нота не сторнируется — она сама является сторно';
  end if;

  -- Повтор возвращает уже выписанную ноту.
  select note.id into note_id
    from public.invoices note
   where note.credit_note_of_id = original.id
     and note.tenant_id = original.tenant_id
     and note.kind = 'credit_note'
     and not note.credit_partial
   order by note.created_at, note.id
   limit 1;
  if found then
    return note_id;
  end if;

  if original.status <> 'issued' then
    raise exception 'Кредит-нота выписывается только на действующий инвойс без оплаты';
  end if;

  select
    coalesce(sum(case when type = 'income' then greatest(amount, 0) else 0 end), 0),
    coalesce(sum(case when type = 'refund' then abs(amount) else 0 end), 0)
    into income_total, direct_refunds
    from public.finance_transactions
   where invoice_id = original.id
     and type in ('income', 'refund');
  select coalesce(sum(abs(refund.amount)), 0)
    into linked_refunds
    from public.finance_transactions refund
    join public.finance_transactions income on income.id = refund.refund_of_id
   where income.invoice_id = original.id
     and income.type = 'income'
     and refund.type = 'refund'
     and refund.invoice_id is null;
  if income_total - direct_refunds - linked_refunds > 0 then
    raise exception 'По инвойсу у нас остаются деньги — кредит-нота выписывается после возврата';
  end if;

  note_date := public.tenant_business_date(original.tenant_id);
  note_year := extract(year from note_date)::integer;
  -- Серия кредит-нот — у юрлица инвойса (STORY-101).
  select numbering.seq, numbering.number
    into note_seq, note_number
    from public.next_document_number(
      original.tenant_id, original.company_id, 'credit_note', note_year
    ) as numbering;

  -- Снимки сторон дублирует триггер `capture_invoice_document_snapshots`:
  -- он берёт их из этой же строки инвойса, что бы здесь ни передали.
  insert into public.invoices (
    tenant_id, number, year, seq, issued_on, client_id, appointment_id,
    brigade_id, subtotal_net, vat_percent, vat_amount, total, currency,
    status, kind, credit_note_of_id, notes, created_by, language, vat_mode,
    seller_snapshot, client_snapshot
  ) values (
    original.tenant_id,
    note_number,
    note_year,
    note_seq,
    note_date,
    original.client_id,
    original.appointment_id,
    original.brigade_id,
    -(original.total - original.credited_amount
      - round(original.vat_amount * (original.total - original.credited_amount) / nullif(original.total, 0), 2)),
    original.vat_percent,
    -round(original.vat_amount * (original.total - original.credited_amount) / nullif(original.total, 0), 2),
    -(original.total - original.credited_amount),
    original.currency,
    'issued',
    'credit_note',
    original.id,
    coalesce(nullif(btrim(p_reason), ''), 'Отмена инвойса ' || original.number),
    auth.uid(),
    original.language,
    original.vat_mode,
    original.seller_snapshot,
    original.client_snapshot
  )
  returning id into note_id;

  -- Позиции инвойса с минусом (04.10): видно, что именно сторнировано.
  insert into public.invoice_lines (invoice_id, position, title, qty, unit_price, total, description, unit)
  select note_id, line.position, line.title, line.qty, -line.unit_price, -line.total, line.description, line.unit
    from public.invoice_lines line
   where line.invoice_id = original.id
     and original.credited_amount = 0;

  return note_id;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public._issue_receipt_core(p_tx finance_transactions, p_lines jsonb DEFAULT NULL::jsonb, p_company_id uuid DEFAULT NULL::uuid, p_issued_on date DEFAULT NULL::date, p_location_id text DEFAULT NULL::text, p_client_requisites_id text DEFAULT NULL::text)
 RETURNS receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  perform 1 from public.finance_transactions where id = p_tx.id for update;
  select * into result_row from public.receipts where transaction_id = p_tx.id;
  if found then
    return result_row;
  end if;
  select invoice.company_id into company_uuid
    from public.invoices invoice
   where invoice.id = p_tx.invoice_id
     and invoice.tenant_id = p_tx.tenant_id;
  if company_uuid is null then
    company_uuid := public.resolve_company_id(p_tx.tenant_id, p_company_id);
  end if;
  if company_uuid is null then
    raise exception 'Сначала добавьте реквизиты: Кабинет → Реквизиты';
  end if;
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
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public._issue_receipt_credit_note(p_receipt_id uuid, p_amount numeric, p_reason text, p_language text)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  receipt_row public.receipts%rowtype;
  note_row public.invoices%rowtype;
  business_date date;
  note_year integer;
  note_seq integer;
  note_number text;
  note_vat numeric(12,2);
  amount_value numeric(12,2) := round(p_amount, 2);
  reason_text text := nullif(btrim(p_reason), '');
  language_value text := coalesce(nullif(btrim(p_language), ''), 'en');
  line jsonb;
  pos integer := 0;
begin
  select * into receipt_row from public.receipts where id = p_receipt_id;
  if not found then
    raise exception 'Чек не найден';
  end if;
  business_date := public.tenant_business_date(receipt_row.tenant_id);
  note_year := extract(year from business_date)::integer;
  select numbering.seq, numbering.number
    into note_seq, note_number
    from public.next_document_number(
      receipt_row.tenant_id, receipt_row.company_id, 'credit_note', note_year
    ) as numbering;
  note_vat := case
    when coalesce(receipt_row.vat_amount, 0) > 0 and receipt_row.amount > 0
      then round(receipt_row.vat_amount * amount_value / receipt_row.amount, 2)
    else 0
  end;

  insert into public.invoices (
    tenant_id, number, year, seq, issued_on, client_id, appointment_id,
    brigade_id, subtotal_net, vat_percent, vat_amount, total, currency,
    status, kind, credit_note_of_receipt_id, notes, created_by, language,
    vat_mode, company_id, seller_snapshot
  ) values (
    receipt_row.tenant_id, note_number, note_year, note_seq, business_date,
    receipt_row.client_id, receipt_row.appointment_id, receipt_row.team_id,
    -(amount_value - note_vat), coalesce(receipt_row.vat_rate, 0), -note_vat,
    -amount_value, receipt_row.currency, 'issued', 'credit_note',
    receipt_row.id,
    coalesce(reason_text, 'Возврат по чеку ' || receipt_row.number),
    auth.uid(),
    case when language_value in ('ru', 'en', 'bg', 'el', 'uk', 'de', 'es')
      then language_value else 'en' end,
    case when note_vat > 0 then 'inclusive' else 'off' end,
    receipt_row.company_id,
    receipt_row.seller_snapshot
  )
  returning * into note_row;

  if amount_value = round(receipt_row.amount, 2)
     and jsonb_typeof(receipt_row.lines) = 'array' then
    for line in select value from jsonb_array_elements(receipt_row.lines) loop
      insert into public.invoice_lines (invoice_id, position, title, qty, unit_price, total, description, unit)
      values (
        note_row.id,
        pos,
        coalesce(nullif(btrim(line ->> 'name'), ''), 'Оплата'),
        coalesce((line ->> 'qty')::numeric, 1),
        -coalesce((line ->> 'unitPrice')::numeric, (line ->> 'sum')::numeric, 0),
        -coalesce((line ->> 'sum')::numeric, 0),
        null,
        nullif(line ->> 'unit', '')
      );
      pos := pos + 1;
    end loop;
  end if;

  select * into note_row from public.invoices where id = note_row.id;
  return note_row;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public._js_number(p jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  s text;
begin
  if p is null then
    return null;
  end if;
  case jsonb_typeof(p)
    when 'number' then
      return (p #>> '{}')::numeric;
    when 'null' then
      return 0;
    when 'boolean' then
      return case when (p #>> '{}')::boolean then 1 else 0 end;
    when 'string' then
      s := btrim(p #>> '{}', E' \t\n\r');
      if s = '' then
        return 0;
      end if;
      if s ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$' then
        return s::numeric;
      end if;
      return null;
    else
      return null;
  end case;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public._mcp_probe()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
begin
  return 1;
end;
$function$
;
grant execute on function public._mcp_probe() to anon;
grant execute on function public._mcp_probe() to authenticated;
grant execute on function public._mcp_probe() to service_role;

CREATE OR REPLACE FUNCTION public._receipt_client_snapshot(p_tenant_id uuid, p_client_id uuid, p_location_id text, p_client_requisites_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  snap jsonb;
begin
  snap := public.build_invoice_client_snapshot_with_object(p_tenant_id, p_client_id, p_location_id)
       || coalesce(public.build_invoice_client_snapshot_for(p_tenant_id, p_client_id, p_client_requisites_id), '{}'::jsonb);
  if snap is null then
    return null;
  end if;
  return snap || jsonb_build_object('name', snap -> 'full_name');
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public._receipt_lines_snapshot(p_lines jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_lines is null or jsonb_typeof(p_lines) <> 'array' then null
    when jsonb_array_length(p_lines) = 0 then null
    when jsonb_array_length(p_lines) > 200 then null
    else (
      select case when count(*) = 0 then null else jsonb_agg(cleaned order by ord) end
        from (
          select ord,
                 jsonb_build_object(
                   'name', left(btrim(item ->> 'name'), 200),
                   'qty', public._receipt_num(item ->> 'qty'),
                   'unit', nullif(left(btrim(coalesce(item ->> 'unit', '')), 24), ''),
                   'unitPrice', public._receipt_num(item ->> 'unitPrice'),
                   'sum', public._receipt_num(item ->> 'sum')
                 ) as cleaned
            from jsonb_array_elements(p_lines) with ordinality as e(item, ord)
           where jsonb_typeof(item) = 'object'
             and btrim(coalesce(item ->> 'name', '')) <> ''
        ) kept
    )
  end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public._receipt_num(p_value text)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
begin
  -- Запятая — тот же разделитель, что точка: человек пишет «1,5», и документ
  -- обязан прочесть это как полтора, а не как ноль.
  return coalesce(replace(btrim(coalesce(p_value, '')), ',', '.')::numeric, 0);
exception when others then
  return 0;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public._receipt_tx_allowed(p_tx finance_transactions)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Не-владельцу чек — документ: без «Документы: Меняет» в команде
  -- платежа его не выписать и не поправить (аудит прав 04.10).
  if allowed is true and not public._documents_write_team(p_tx.team_id) then
    return false;
  end if;
  return allowed is true;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public._refund_invoice_money(p_invoice invoices, p_amount numeric, p_on date, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  income_row public.finance_transactions%rowtype;
  to_refund numeric(12,2) := round(coalesce(p_amount, 0), 2);
  refundable numeric(12,2);
  step numeric(12,2);
begin
  while to_refund > 0 loop
    select tx.* into income_row
      from public.finance_transactions tx
     where tx.tenant_id = p_invoice.tenant_id
       and tx.invoice_id = p_invoice.id
       and tx.type = 'income'
       and greatest(tx.amount, 0) > coalesce((
         select sum(abs(r.amount)) from public.finance_transactions r
          where r.refund_of_id = tx.id and r.type = 'refund'
       ), 0)
     order by tx.created_at desc
     limit 1
     for update;
    if not found then
      raise exception 'Не нашлось платежа инвойса для возврата';
    end if;
    if income_row.source = 'auto' or income_row.appointment_payment_kind is not null then
      raise exception 'Деньги по записи возвращаются в самой записи';
    end if;
    select greatest(income_row.amount, 0) - coalesce(sum(abs(r.amount)), 0)
      into refundable
      from public.finance_transactions r
     where r.refund_of_id = income_row.id and r.type = 'refund';
    step := least(to_refund, refundable);
    insert into public.finance_transactions (
      tenant_id, type, amount, currency, category_id, account_id,
      appointment_id, client_id, team_id, master_id, payment_method, notes,
      occurred_on, invoice_id, refund_of_id, source, created_by
    ) values (
      p_invoice.tenant_id, 'refund', -step, income_row.currency, income_row.category_id,
      income_row.account_id, income_row.appointment_id, income_row.client_id,
      income_row.team_id, income_row.master_id, income_row.payment_method,
      p_note,
      greatest(p_on, income_row.occurred_on),
      p_invoice.id, income_row.id, 'manual', auth.uid()
    );
    to_refund := to_refund - step;
  end loop;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public._tg_notify_inviter_invite_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Did the invitation just transition from "pending" to "accepted"?
  if OLD.accepted_at is not null or NEW.accepted_at is null then
    return NEW;
  end if;

  -- Skip if the inviter accepted their own invite (corner case).
  if NEW.invited_by_user_id is null or NEW.invited_by_user_id = auth.uid() then
    return NEW;
  end if;

  perform public._dispatch_push(
    'inviter.invite_accepted',
    jsonb_build_object(
      'invitation_id', NEW.id,
      'tenant_id',     NEW.tenant_id,
      'email',         NEW.email,
      'role',          NEW.role,
      'accepted_at',   NEW.accepted_at
    ),
    array[NEW.invited_by_user_id]
  );

  return NEW;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public._tg_notify_owner_new_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  owner_ids uuid[];
begin
  -- Skip if the new member IS an owner (no one to "notify" — the
  -- second-owner case is rare enough we let it slide), or the new
  -- member is the same user as auth.uid() (self-add edge case).
  if NEW.role = 'owner' or NEW.user_id = auth.uid() then
    return NEW;
  end if;

  -- Recipients = all owners of this tenant other than auth.uid().
  -- (No reason to notify the owner who just clicked Invite.)
  select coalesce(array_agg(user_id), '{}')
    into owner_ids
    from public.tenant_members
   where tenant_id = NEW.tenant_id
     and role      = 'owner'
     and user_id  <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);

  perform public._dispatch_push(
    'owner.new_member',
    jsonb_build_object(
      'tenant_id',  NEW.tenant_id,
      'user_id',    NEW.user_id,
      'role',       NEW.role,
      'joined_at',  NEW.joined_at
    ),
    owner_ids
  );

  return NEW;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invitation public.invitations%rowtype;
  v_caller_email text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to accept an invitation'
      using errcode = '42501';
  end if;

  select lower(coalesce(u.email, '')) into v_caller_email
    from auth.users u where u.id = auth.uid();

  if coalesce(v_caller_email, '') = '' then
    raise exception 'signed-in account has no email' using errcode = '42501';
  end if;

  select * into v_invitation from public.invitations where token = p_token;
  if not found then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_invitation.tenant_id::text || ':' || lower(v_invitation.email), 0)
  );
  if v_invitation.master_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(v_invitation.tenant_id::text || ':master:' || v_invitation.master_id, 1)
    );
  end if;

  select * into v_invitation from public.invitations where token = p_token for update;
  if not found then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;

  if v_invitation.accepted_at is not null then
    -- Already accepted by this very person (signup through the link did it):
    -- return without granting again — the owner may have narrowed the rights
    -- since.
    if v_invitation.accepted_by_user_id = auth.uid()
       and exists (
         select 1 from public.tenant_members tm
          where tm.tenant_id = v_invitation.tenant_id and tm.user_id = auth.uid()
       ) then
      return v_invitation.tenant_id;
    end if;
    raise exception 'invitation already accepted' using errcode = '42501';
  end if;

  if v_invitation.expires_at <= now() then
    raise exception 'invitation expired' using errcode = '42501';
  end if;

  if v_invitation.role not in ('dispatcher', 'master') then
    raise exception 'unsupported invitation role' using errcode = '42501';
  end if;

  if lower(v_invitation.email) <> v_caller_email then
    raise exception 'invitation email does not match the signed-in account'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.tenants t
     where t.id = v_invitation.tenant_id and t.onboarded_at is not null
  ) then
    raise exception 'finish company setup before inviting employees'
      using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_invitation.tenant_id::text || ':user:' || auth.uid()::text, 2)
  );

  if exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = v_invitation.tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'this account already has access to the tenant'
      using errcode = '23505';
  end if;

  -- Приглашение зовёт в несколько календарей (15.09): отказ — только когда
  -- живых среди них не осталось ни одного. Иначе архив одного «домашнего»
  -- ломал весь приём, хотя помощник пропустил бы его и выдал остальные.
  -- Без живых календарей отказ остаётся: диспетчер без строк прав видел бы
  -- всю компанию, а мастер без карточки — ничего.
  if v_invitation.team_id is not null and not exists (
    select 1
      from unnest(coalesce(v_invitation.team_ids, array[v_invitation.team_id])) as x(team_id)
      join public.teams t
        on t.tenant_id = v_invitation.tenant_id
       and t.id = x.team_id
       and t.is_active
  ) then
    raise exception 'invitation calendar is archived'
      using errcode = '42501';
  end if;

  -- Мастер без карточки — только в календарь (create_invitation держит то же).
  if v_invitation.role = 'master'
     and v_invitation.master_id is null
     and v_invitation.team_id is null then
    raise exception 'master invitation requires a calendar or an employee card'
      using errcode = '22023';
  end if;

  if v_invitation.role = 'master'
     and v_invitation.master_id is not null
     and (
       not exists (
         select 1 from public.masters m
          where m.tenant_id = v_invitation.tenant_id
            and m.id = v_invitation.master_id
            and m.is_active
       )
       or exists (
         select 1 from public.tenant_members tm
          where tm.tenant_id = v_invitation.tenant_id
            and tm.master_id = v_invitation.master_id
       )
     ) then
    raise exception 'employee card is unavailable' using errcode = '23505';
  end if;

  insert into public.tenant_members (
    tenant_id, user_id, role, invited_by_user_id, master_id
  ) values (
    v_invitation.tenant_id, auth.uid(), v_invitation.role,
    v_invitation.invited_by_user_id, v_invitation.master_id
  );

  perform public.grant_invitation_calendar(v_invitation, auth.uid());

  update public.invitations
     set accepted_at = now(), accepted_by_user_id = auth.uid()
   where id = v_invitation.id;

  update auth.users u
     set raw_app_meta_data =
       coalesce(u.raw_app_meta_data, '{}'::jsonb)
       || jsonb_build_object(
         'available_tenants',
         coalesce(
           (
             select jsonb_agg(x.tenant_id order by x.joined_at, x.tenant_id)
               from (
                 select tm.tenant_id::text as tenant_id, min(tm.joined_at) as joined_at
                   from public.tenant_members tm
                  where tm.user_id = auth.uid()
                  group by tm.tenant_id
               ) x
           ),
           '[]'::jsonb
         )
       )
   where u.id = auth.uid();

  return v_invitation.tenant_id;
end;
$function$
;
grant execute on function public.accept_invitation(p_token text) to authenticated;

CREATE OR REPLACE FUNCTION public.accept_invitation_by_id(p_invitation_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to accept an invitation'
      using errcode = '42501';
  end if;

  v_token := public.inbox_invitation_token(p_invitation_id);
  if v_token is null then
    raise exception 'invitation not found'
      using errcode = 'P0002', hint = 'invite:not_found';
  end if;

  return public.accept_invitation(v_token);
end;
$function$
;
grant execute on function public.accept_invitation_by_id(p_invitation_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.access_accounts_for(p_block text, p_min text)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller uuid := auth.uid();
  min_rank integer := array_position(array['off', 'read', 'write', 'full'], p_min);
  active_tenant uuid;
  caller_role text;
  granted_calendars text[];
  visible uuid[];
begin
  if caller is null or min_rank is null or min_rank < 2 then
    return array[]::uuid[];
  end if;

  if not exists (
    select 1
      from public.access_blocks b
     where b.key = p_block
       and b.scope = 'calendar'
  ) then
    return array[]::uuid[];
  end if;

  active_tenant := public.current_tenant_id();
  if active_tenant is null then
    return array[]::uuid[];
  end if;

  select tm.role into caller_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant
     and tm.user_id = caller;
  if caller_role is null then
    return array[]::uuid[];
  end if;

  if caller_role = 'owner' then
    select coalesce(array_agg(a.id order by a.id), array[]::uuid[])
      into visible
      from public.accounts a
     where a.tenant_id = active_tenant;
    return visible;
  end if;

  granted_calendars := public.access_calendars_of(active_tenant, caller, p_block, p_min);
  if cardinality(granted_calendars) = 0 then
    return array[]::uuid[];
  end if;

  select coalesce(array_agg(a.id order by a.id), array[]::uuid[])
    into visible
    from public.accounts a
   where a.tenant_id = active_tenant
     -- Скрытый счёт (владелец 03.10) — только владельцу.
     and not a.is_hidden
     and (
       (a.scope = 'team' and a.brigade_id = any(granted_calendars))
       or (
         min_rank = 2
         and a.scope = 'company'
         and exists (
           select 1
             from public.account_teams att
            where att.account_id = a.id
              and att.tenant_id = active_tenant
              and att.team_id = any(granted_calendars)
         )
       )
     );

  return visible;
end;
$function$
;
grant execute on function public.access_accounts_for(p_block text, p_min text) to authenticated;

CREATE OR REPLACE FUNCTION public.access_accounts_totals()
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid;
  caller_role text;
  granted_calendars text[];
  visible uuid[];
begin
  if caller is null then
    return array[]::uuid[];
  end if;

  active_tenant := public.current_tenant_id();
  if active_tenant is null then
    return array[]::uuid[];
  end if;

  select tm.role into caller_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant
     and tm.user_id = caller;
  if caller_role is null then
    return array[]::uuid[];
  end if;

  if caller_role = 'owner' then
    select coalesce(array_agg(a.id order by a.id), array[]::uuid[])
      into visible
      from public.accounts a
     where a.tenant_id = active_tenant;
    return visible;
  end if;

  granted_calendars := public.access_calendars_of(active_tenant, caller, 'finance.accounts', 'read');
  if cardinality(granted_calendars) = 0 then
    return array[]::uuid[];
  end if;

  select coalesce(array_agg(a.id order by a.id), array[]::uuid[])
    into visible
    from public.accounts a
   where a.tenant_id = active_tenant
     -- Скрытый счёт (владелец 03.10) — только владельцу.
     and not a.is_hidden
     and (
       (a.scope = 'team' and a.brigade_id = any(granted_calendars))
       or (
         a.scope = 'company'
         and exists (
           select 1
             from public.account_teams att
            where att.account_id = a.id
              and att.tenant_id = active_tenant
         )
         and not exists (
           select 1
             from public.account_teams att
            where att.account_id = a.id
              and not (att.team_id = any(granted_calendars))
         )
       )
     );

  return visible;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.access_apply_changes(p_tenant uuid, p_user uuid, p_changes jsonb, p_set_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  change jsonb;
  b public.access_blocks%rowtype;
  change_team text;
  change_level text;
begin
  if p_tenant is null or p_user is null
     or p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'изменения — массив для человека компании' using errcode = '22023', hint = 'access:bad_changes';
  end if;

  -- «Кто выставил» приходит аргументом, а не из текущего входа: при регистрации
  -- по ссылке вошедшего ещё нет, и уровни выставляет пригласивший.
  for change in select value from jsonb_array_elements(p_changes) loop
    select * into b from public.access_blocks where key = change ->> 'block';
    if not found then
      raise exception 'неизвестный блок %', change ->> 'block' using errcode = '22023', hint = 'access:bad_block';
    end if;

    change_team := nullif(change ->> 'team_id', '');
    change_level := change ->> 'level';

    -- Хранятся только значения не по умолчанию: «нет строки» и есть умолчание.
    if change_level = b.levels[1] then
      delete from public.member_access ma
       where ma.tenant_id = p_tenant
         and ma.user_id = p_user
         and ma.block = b.key
         and ma.team_id is not distinct from change_team;
    else
      insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
      values (p_tenant, p_user, b.key, change_team, change_level, p_set_by, now())
      on conflict (tenant_id, user_id, block, team_id)
      do update set level = excluded.level, set_by = excluded.set_by, set_at = excluded.set_at;
    end if;
  end loop;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.access_block_client_ids(p_block text, p_min text)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(b.client_id), array[]::uuid[])
    from public.access_client_blocks() b
   where case
           when p_min = 'write' then b.blocks ->> p_block = 'write'
           else b.blocks ->> p_block in ('read', 'write')
         end
$function$
;
grant execute on function public.access_block_client_ids(p_block text, p_min text) to authenticated;

CREATE OR REPLACE FUNCTION public.access_blocks_rename_in_invitations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.invitations i
     set access_changes = (
       select coalesce(jsonb_agg(
                case when c.change ->> 'block' = old.key
                     then jsonb_set(c.change, '{block}', to_jsonb(new.key))
                     else c.change
                end
                order by c.ord), '[]'::jsonb)
         from jsonb_array_elements(i.access_changes) with ordinality as c(change, ord)
     )
   where i.accepted_at is null
     and i.access_changes @> jsonb_build_array(jsonb_build_object('block', old.key));
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.access_calendars(p_block text, p_min text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    return array[]::text[];
  end if;
  return public.access_calendars_of(public.current_tenant_id(), caller, p_block, p_min);
end;
$function$
;
grant execute on function public.access_calendars(p_block text, p_min text) to authenticated;

CREATE OR REPLACE FUNCTION public.access_calendars_of(p_tenant uuid, p_user uuid, p_block text, p_min text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  min_rank integer := array_position(array['off', 'read', 'write', 'full'], p_min);
  member_role text;
  block_row public.access_blocks%rowtype;
  granted text[];
begin
  if p_tenant is null or p_user is null or min_rank is null or min_rank < 2 then
    return array[]::text[];
  end if;

  select * into block_row
    from public.access_blocks b
   where b.key = p_block
     and b.scope = 'calendar';
  if not found then
    return array[]::text[];
  end if;

  select tm.role into member_role
    from public.tenant_members tm
   where tm.tenant_id = p_tenant
     and tm.user_id = p_user;
  if member_role is null then
    return array[]::text[];
  end if;

  if member_role = 'owner' then
    select coalesce(array_agg(t.id order by t.id), array[]::text[])
      into granted
      from public.teams t
     where t.tenant_id = p_tenant;
    return granted;
  end if;

  if not block_row.live or block_row.owner_only then
    return array[]::text[];
  end if;

  select coalesce(array_agg(mc.team_id order by mc.team_id), array[]::text[])
    into granted
    from public.member_calendars mc
    -- Архивный календарь сотруднику закрыт целиком (аудит 24.09).
    join public.teams t
      on t.tenant_id = mc.tenant_id
     and t.id = mc.team_id
     and t.is_active
    left join public.member_access ma
      on ma.tenant_id = mc.tenant_id
     and ma.user_id = mc.user_id
     and ma.block = block_row.key
     and ma.team_id = mc.team_id
   where mc.tenant_id = p_tenant
     and mc.user_id = p_user
     and array_position(array['off', 'read', 'write', 'full'], coalesce(ma.level, block_row.levels[1])) >= min_rank
     and (
       block_row.key = 'calendar.records'
       or array_position(array['read', 'write'], public.access_records_level(p_tenant, p_user, mc.team_id)) is not null
     );

  return granted;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.access_client_blocks()
 RETURNS TABLE(client_id uuid, blocks jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid := public.current_tenant_id();
  -- 02.10: «Клиент», «История» и «SMS» — свои права, как остальные блоки;
  -- «Меню клиента» (напомнить, чёрный список) и «Удаление клиента» (03.10) —
  -- тоже по клиенту.
  block_keys constant text[] := array[
    'clients.client', 'clients.note', 'clients.people', 'clients.history',
    'clients.objects', 'clients.files', 'clients.requisites', 'clients.labels',
    'clients.personal', 'clients.sms', 'clients.menu',
    'clients.delete',
    -- 03.10: «Тег» — своё право, отдельно от «Метки»; «Долг и деньги» ушли
    -- в «Историю» — ключа `clients.money` больше нет.
    'clients.tags'
  ];
begin
  if caller is null or active_tenant is null
     or public.current_user_role() is not distinct from 'owner' then
    return;
  end if;

  return query
    with teams as (
      select t.team_id,
             public.access_team_level(active_tenant, caller, 'clients', t.team_id) as card_level,
             public.access_client_ids_in(array[t.team_id]) as ids
        from unnest(public.access_calendars('clients', 'read')) as t(team_id)
    ),
    levels as (
      -- База — своим ключом: с 02.10 только «Видит» (создание и меню — свои права).
      select tm.team_id, 'clients'::text as block_key,
             case when tm.card_level = 'write' then 2 else 1 end as rank
        from teams tm
      union all
      -- Блок «Меняет» — своим правом (02.10), без «Меняет» у базы. Страницу
      -- клиента открывает каждый, кому клиент виден (02.10: «Открывает
      -- карточку» убрано) — блоки страницы больше не гаснут.
      select tm.team_id, k.block_key,
             case
               when l.level = 'write' then 2
               when l.level in ('read', 'write') then 1
               else 0
             end
        from teams tm
       cross join unnest(block_keys) as k(block_key)
       cross join lateral (
         select public.access_team_level(active_tenant, caller, k.block_key, tm.team_id) as level
       ) l
    ),
    per_client as (
      select cid as client_id, lv.block_key, max(lv.rank) as rank
        from teams tm
        join levels lv on lv.team_id = tm.team_id
       cross join unnest(tm.ids) as cid
       group by cid, lv.block_key
    )
    select pc.client_id,
           jsonb_object_agg(
             pc.block_key,
             case pc.rank when 2 then 'write' when 1 then 'read' else 'off' end
           )
      from per_client pc
     group by pc.client_id;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.access_client_ids()
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid;
  caller_role text;
begin
  if caller is null then
    return array[]::uuid[];
  end if;

  active_tenant := public.current_tenant_id();
  if active_tenant is null then
    return array[]::uuid[];
  end if;

  select tm.role into caller_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant
     and tm.user_id = caller;

  -- Владельца пускает своя ветка окна; набор — только для сотрудника.
  if caller_role is null or caller_role = 'owner' then
    return array[]::uuid[];
  end if;

  return public.access_client_ids_in(public.access_calendars('clients', 'read'));
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.access_client_ids_in(p_teams text[])
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid := public.current_tenant_id();
  today date;
begin
  if caller is null or active_tenant is null or coalesce(cardinality(p_teams), 0) = 0 then
    return array[]::uuid[];
  end if;

  today := public.tenant_business_date(active_tenant);

  -- 02.10: «только база клиентов, которая закреплена за командой, к которой
  -- у него есть доступ» — клиент с командой из открытых ему. «Ограничения»:
  -- «Без ограничения» — все клиенты команды; остальные ступени — клиент
  -- команды с неотменённой записью этой команды в окне до и после сегодня;
  -- неизвестное — самое узкое, «Неделя».
  return coalesce((
    with lv as (
      select t.team_id,
             coalesce(public.access_team_level(active_tenant, caller, 'clients.scope', t.team_id), 'week') as level
        from unnest(p_teams) as t(team_id)
    ),
    win as (
      select lv.team_id,
             case lv.level
               when 'near' then interval '14 days'
               when 'month' then interval '1 month'
               when 'quarter' then interval '3 months'
               when 'half' then interval '6 months'
               else interval '7 days'
             end as span
        from lv
       where lv.level not in ('own', 'all')
    )
    select array_agg(c.id order by c.id)
      from public.clients c
     where c.tenant_id = active_tenant
       and c.deleted_at is null
       and (
         c.team_id in (select lv.team_id from lv where lv.level in ('own', 'all'))
         or exists (
           select 1
             from win w
             join public.appointments a
               on a.tenant_id = active_tenant
              and a.client_id = c.id
              and a.team_id = w.team_id
            where w.team_id = c.team_id
              and a.status is distinct from 'cancelled'
              and a.date between (today - w.span)::date::text and (today + w.span)::date::text
         )
         -- 03.10: клиент, которого он сам завёл в этой команде, виден ему
         -- всегда — иначе «Создание клиента» рождает клиента, которого тут же
         -- «нет» («client not found» на первой же правке). Только команды из
         -- набора: чужой команде «завёл сам» базу не открывает.
         or (c.created_by = caller and c.team_id in (select lv.team_id from lv))
       )
  ), array[]::uuid[]);
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.access_company(p_block text, p_min text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller uuid := auth.uid();
  min_rank integer := array_position(array['off', 'read', 'write', 'full'], p_min);
  active_tenant uuid;
  caller_role text;
  block_row public.access_blocks%rowtype;
  stored_level text;
begin
  if caller is null or min_rank is null or min_rank < 2 then
    return false;
  end if;

  active_tenant := public.current_tenant_id();
  if active_tenant is null then
    return false;
  end if;

  select tm.role into caller_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant
     and tm.user_id = caller;
  if caller_role is null then
    return false;
  end if;

  select * into block_row
    from public.access_blocks b
   where b.key = p_block
     and b.scope = 'company';
  if not found then
    if p_block in ('clients', 'clients.contacts') and exists (
      select 1 from public.access_blocks b where b.key = p_block
    ) then
      return caller_role = 'owner'
        or cardinality(public.access_calendars(p_block, p_min)) > 0;
    end if;
    return false;
  end if;

  if caller_role = 'owner' then
    return true;
  end if;

  if not block_row.live or block_row.owner_only then
    return false;
  end if;

  select ma.level into stored_level
    from public.member_access ma
   where ma.tenant_id = active_tenant
     and ma.user_id = caller
     and ma.block = block_row.key
     and ma.team_id is null;

  return coalesce(
    array_position(array['off', 'read', 'write', 'full'], coalesce(stored_level, block_row.levels[1])) >= min_rank,
    false
  );
end;
$function$
;
grant execute on function public.access_company(p_block text, p_min text) to authenticated;

CREATE OR REPLACE FUNCTION public.access_company_level(p_block text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid;
  caller_role text;
  block_row public.access_blocks%rowtype;
  stored_level text;
  scope_levels text[];
begin
  if caller is null then
    return null;
  end if;

  active_tenant := public.current_tenant_id();
  if active_tenant is null then
    return null;
  end if;

  select tm.role into caller_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant
     and tm.user_id = caller;
  if caller_role is null then
    return null;
  end if;

  select * into block_row
    from public.access_blocks b
   where b.key = p_block
     and b.scope = 'company';
  if not found then
    if p_block = 'clients.scope' then
      if caller_role = 'owner' then
        return 'all';
      end if;
      -- Самое широкое положение среди команд, где «Клиенты» открыты.
      select coalesce(array_agg(public.access_team_level(active_tenant, caller, 'clients.scope', t.team_id)), array[]::text[])
        into scope_levels
        from unnest(public.access_calendars('clients', 'read')) as t(team_id);
      return case
        when 'all' = any(scope_levels) then 'all'
        when 'own' = any(scope_levels) then 'own'
        when 'month' = any(scope_levels) then 'month'
        else 'near'
      end;
    end if;
    return null;
  end if;

  -- Владелец права выдаёт, а не получает: у него самое полное положение.
  if caller_role = 'owner' then
    return block_row.levels[array_length(block_row.levels, 1)];
  end if;

  if not block_row.live or block_row.owner_only then
    return block_row.levels[1];
  end if;

  select ma.level into stored_level
    from public.member_access ma
   where ma.tenant_id = active_tenant
     and ma.user_id = caller
     and ma.block = block_row.key
     and ma.team_id is null;

  return coalesce(stored_level, block_row.levels[1]);
end;
$function$
;
grant execute on function public.access_company_level(p_block text) to authenticated;

CREATE OR REPLACE FUNCTION public.access_contact_client_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- 02.10: номер открыт у клиента, чей блок «Клиент» он видит.
  select case
    when public.current_user_role() is distinct from 'owner'
      then public.access_block_client_ids('clients.client', 'read')
    else array[]::uuid[]
  end
$function$
;
grant execute on function public.access_contact_client_ids() to authenticated;

CREATE OR REPLACE FUNCTION public.access_day_contact_client_ids()
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant uuid := public.current_tenant_id();
  day_teams text[];
  today text;
begin
  if auth.uid() is null or active_tenant is null then
    return array[]::uuid[];
  end if;
  day_teams := public.access_day_contact_teams();
  if cardinality(day_teams) = 0 then
    return array[]::uuid[];
  end if;
  today := public.tenant_business_date(active_tenant)::text;
  return coalesce((
    select array_agg(distinct a.client_id)
      from public.appointments a
      join public.clients c
        on c.id = a.client_id
       and c.tenant_id = a.tenant_id
       and c.deleted_at is null
     where a.tenant_id = active_tenant
       and a.client_id is not null
       and a.team_id = any(day_teams)
       and a.status is distinct from 'cancelled'
       and a.date = today
  ), array[]::uuid[]);
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.access_day_contact_teams()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when auth.uid() is null or public.current_user_role() is not distinct from 'owner'
      then array[]::text[]
    else coalesce(array(
      select t.team_id
        from unnest(public.access_calendars('clients', 'read')) as t(team_id)
       where public.access_team_level(public.current_tenant_id(), auth.uid(), 'clients.contacts', t.team_id) = 'day'
    ), array[]::text[])
  end
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.access_map_for(p_tenant_id uuid, p_user_id uuid, p_include_off boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  member_role text;
  member_version bigint;
  company_levels jsonb;
  calendar_levels jsonb;
  attached jsonb;
begin
  select tm.role, tm.access_version
    into member_role, member_version
    from public.tenant_members tm
   where tm.tenant_id = p_tenant_id and tm.user_id = p_user_id;

  if member_role is null then
    return null;
  end if;

  if member_role = 'owner' then
    return jsonb_build_object(
      'tenant_id', p_tenant_id, 'is_owner', true, 'version', member_version,
      'company', '{}'::jsonb, 'calendars', '{}'::jsonb
    );
  end if;

  select coalesce(jsonb_object_agg(b.key, coalesce(ma.level, b.levels[1])), '{}'::jsonb)
    into company_levels
    from public.access_blocks b
    left join public.member_access ma
      on ma.tenant_id = p_tenant_id
     and ma.user_id = p_user_id
     and ma.block = b.key
     and ma.team_id is null
   where (b.live or p_include_off) and b.scope = 'company' and not b.owner_only;

  select coalesce(jsonb_object_agg(per_team.team_id, per_team.blocks), '{}'::jsonb)
    into calendar_levels
    from (
      select mc.team_id,
             jsonb_object_agg(b.key, coalesce(ma.level, b.levels[1])) as blocks,
             public.access_records_level(p_tenant_id, p_user_id, mc.team_id) as records_level
        from public.member_calendars mc
        cross join public.access_blocks b
        left join public.member_access ma
          on ma.tenant_id = mc.tenant_id
         and ma.user_id = mc.user_id
         and ma.block = b.key
         and ma.team_id = mc.team_id
       where mc.tenant_id = p_tenant_id
         and mc.user_id = p_user_id
         and (b.live or p_include_off)
         and b.scope = 'calendar'
       group by mc.team_id
    ) per_team
   where p_include_off or array_position(array['read', 'write'], per_team.records_level) is not null;

  if p_include_off then
    select coalesce(jsonb_agg(mc.team_id order by mc.team_id), '[]'::jsonb)
      into attached
      from public.member_calendars mc
     where mc.tenant_id = p_tenant_id and mc.user_id = p_user_id;
    return jsonb_build_object(
      'tenant_id', p_tenant_id, 'is_owner', false, 'version', member_version,
      'attached_calendars', attached,
      'company', company_levels, 'calendars', calendar_levels
    );
  end if;

  return jsonb_build_object(
    'tenant_id', p_tenant_id, 'is_owner', false, 'version', member_version,
    'company', company_levels, 'calendars', calendar_levels
  );
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.access_records_level(p_tenant uuid, p_user uuid, p_team text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select coalesce(ma.level, b.levels[1])
      from public.access_blocks b
      left join public.member_access ma
        on ma.tenant_id = p_tenant
       and ma.user_id = p_user
       and ma.block = b.key
       and ma.team_id = p_team
     where b.key = 'calendar.records'
  ), 'off')
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.access_team_level(p_tenant uuid, p_user uuid, p_block text, p_team text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select ma.level
       from public.member_access ma
      where ma.tenant_id = p_tenant
        and ma.user_id = p_user
        and ma.block = p_block
        and ma.team_id = p_team),
    (select b.levels[1] from public.access_blocks b where b.key = p_block)
  )
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.access_validate_changes(p_tenant uuid, p_team_ids text[], p_changes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  change jsonb;
  b public.access_blocks%rowtype;
  change_team text;
  change_level text;
  change_key text;
  seen text[] := array[]::text[];
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'изменения — массив' using errcode = '22023', hint = 'access:bad_changes';
  end if;

  for change in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(change) <> 'object' then
      raise exception 'изменение — объект {block, team_id, level}' using errcode = '22023', hint = 'access:bad_changes';
    end if;

    select * into b from public.access_blocks where key = change ->> 'block';
    if not found then
      raise exception 'неизвестный блок %', change ->> 'block' using errcode = '22023', hint = 'access:bad_block';
    end if;
    -- Код ошибки прежний, как у `set_member_access` и сторожа `member_access`:
    -- экран различает отказы по `hint`, а 42501 здесь честнее — это не опечатка,
    -- а право, которое сотруднику не выдаётся вообще.
    if b.owner_only then
      raise exception 'блок % выдаётся только владельцу', b.key using errcode = '42501', hint = 'access:owner_only';
    end if;
    -- Живость блока НЕ проверяется (владелец 15.09): уровень хранится сейчас,
    -- применяется, когда блок оживёт.

    change_team := nullif(change ->> 'team_id', '');
    change_level := change ->> 'level';

    if b.scope = 'calendar' then
      -- Архив здесь НЕ проверяется. Архив календаря никого от него не открепляет,
      -- и экран прав владельца по-прежнему показывает такой календарь: снять
      -- уровень до «Скрыт» или поменять его там обязано работать, иначе
      -- сохранённое «Меняет» переживёт архив и заработает, когда календарь
      -- вернут и блок оживёт. Прежний `set_member_access` архив тоже не
      -- проверял. Приглашению архивные календари отказывают `create_invitation`
      -- и `update_invitation` до этой проверки, а сверка с `p_team_ids` ниже
      -- пропускает только их календари.
      if change_team is null or not exists (
        select 1 from public.teams t
         where t.tenant_id = p_tenant
           and t.id = change_team
      ) then
        raise exception 'календарь не из этой компании' using errcode = '22023', hint = 'access:bad_team';
      end if;
      -- Уровень календарного блока бывает только у календаря человека:
      -- прикреплённого (права живого сотрудника) или названного в приглашении.
      if not coalesce(change_team = any(p_team_ids), false) then
        raise exception 'человек не прикреплён к календарю' using errcode = '22023', hint = 'access:not_attached';
      end if;
    elsif change_team is not null then
      raise exception 'блок % действует на всю компанию', b.key using errcode = '22023', hint = 'access:bad_team';
    end if;

    if change_level is null or not (change_level = any(b.levels)) then
      raise exception 'у блока % нет положения %', b.key, change_level using errcode = '22023', hint = 'access:bad_level';
    end if;

    -- Один блок в одном календаре дважды — это два разных ответа на один
    -- вопрос; какой из них «правильный», сервер не угадывает.
    change_key := b.key || '@' || coalesce(change_team, '');
    if change_key = any(seen) then
      raise exception 'блок % назван дважды', b.key using errcode = '22023', hint = 'access:bad_changes';
    end if;
    seen := seen || change_key;
  end loop;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.access_writer_target(p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant uuid := public.current_tenant_id();
  target_role text;
begin
  if auth.uid() is null or active_tenant is null
     or not (public.current_user_role() = 'owner' or public.access_company('company.partners', 'write')) then
    raise exception 'права меняет владелец' using errcode = '42501', hint = 'access:not_owner';
  end if;
  select tm.role into target_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant and tm.user_id = p_user_id;
  if target_role is null then
    raise exception 'человек не состоит в компании' using errcode = '22023', hint = 'access:not_member';
  end if;
  if p_user_id = auth.uid() or target_role = 'owner' then
    raise exception 'владелец не ограничивается' using errcode = '42501', hint = 'access:target_owner';
  end if;
  -- Директор не трогает других директоров (04.10).
  if not public.partners_manageable(p_user_id) then
    raise exception 'Права этого партнёра меняет владелец'
      using errcode = '42501', hint = 'access:not_manageable';
  end if;
  return active_tenant;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.account_balances(p_tenant uuid)
 RETURNS TABLE(account_id uuid, delta numeric, has_history boolean, is_active boolean, last_outflow_on date, last_tx_on date, first_tx_on date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  caller_is_owner boolean;
  visible_accounts uuid[];
begin
  if auth.uid() is null then
    raise exception 'Балансы счетов доступны только участникам компании';
  end if;
  if tenant_uuid is null then
    raise exception 'Компания не определена';
  end if;
  if p_tenant is not null and p_tenant is distinct from tenant_uuid then
    raise exception 'Счета другой компании недоступны';
  end if;

  caller_is_owner := coalesce(public.current_user_role() = 'owner', false);
  if not caller_is_owner then
    visible_accounts := public.access_accounts_totals();
  end if;

  return query
  with ledger as (
    select
      t.account_id as ledger_account_id,
      sum(
        case
          when t.type = 'expense' then -t.amount
          when t.type = 'refund' then -abs(t.amount)
          else t.amount
        end
      ) as ledger_delta,
      count(*) as tx_count,
      max(t.occurred_on) filter (
        where t.type = 'transfer' and t.amount < 0
      ) as ledger_last_outflow_on,
      max(t.occurred_on) as ledger_last_tx_on,
      min(t.occurred_on) as ledger_first_tx_on
    from public.finance_transactions t
    where t.tenant_id = tenant_uuid
      and (caller_is_owner or t.account_id = any(visible_accounts))
    group by t.account_id
  ),
  tenant_accounts as (
    select a.id, a.is_active
    from public.accounts a
    where a.tenant_id = tenant_uuid
      and (caller_is_owner or a.id = any(visible_accounts))
  )
  select
    coalesce(tenant_accounts.id, ledger.ledger_account_id) as account_id,
    round(coalesce(ledger.ledger_delta, 0), 2) as delta,
    coalesce(ledger.tx_count, 0) > 0 as has_history,
    coalesce(tenant_accounts.is_active, true) as is_active,
    ledger.ledger_last_outflow_on as last_outflow_on,
    ledger.ledger_last_tx_on as last_tx_on,
    ledger.ledger_first_tx_on as first_tx_on
  from tenant_accounts
  full join ledger on ledger.ledger_account_id = tenant_accounts.id;
end;
$function$
;
grant execute on function public.account_balances(p_tenant uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.account_has_history(p_account_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.finance_transactions f where f.account_id = p_account_id)
      or exists (select 1 from public.receipts r where r.account_id = p_account_id)
      or exists (select 1 from public.appointments a where a.payment_account_id = p_account_id)
      or exists (select 1 from public.invoices i where i.account_id = p_account_id)
      -- Операция в «Удалённых операциях» вернётся на этот счёт.
      or exists (
        select 1 from public.deleted_operations d
         where d.operation->>'account_id' = p_account_id::text
      );
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.account_period_totals(p_tenant uuid, p_from date, p_to date)
 RETURNS TABLE(account_id uuid, opening_before numeric, income numeric, expense numeric, refund numeric, transfer_in numeric, transfer_out numeric, net numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  caller_is_owner boolean;
  visible_accounts uuid[];
begin
  if auth.uid() is null then
    raise exception 'Сводка по счетам доступна только участникам компании';
  end if;
  if tenant_uuid is null then
    raise exception 'Компания не определена';
  end if;
  if p_tenant is not null and p_tenant is distinct from tenant_uuid then
    raise exception 'Счета другой компании недоступны';
  end if;
  if p_from is null or p_to is null then
    raise exception 'Укажите период целиком';
  end if;
  if p_from > p_to then
    raise exception 'Начало периода позже его конца';
  end if;

  caller_is_owner := coalesce(public.current_user_role() = 'owner', false);
  if not caller_is_owner then
    visible_accounts := public.access_accounts_totals();
  end if;

  return query
  with ledger as (
    select
      t.account_id as ledger_account_id,
      sum(
        case
          when t.type = 'expense' then -t.amount
          when t.type = 'refund' then -abs(t.amount)
          else t.amount
        end
      ) filter (where t.occurred_on < p_from) as delta_before,
      sum(t.amount) filter (
        where t.type = 'income' and t.occurred_on >= p_from
      ) as income_total,
      sum(-t.amount) filter (
        where t.type = 'expense' and t.occurred_on >= p_from
      ) as expense_total,
      sum(-abs(t.amount)) filter (
        where t.type = 'refund' and t.occurred_on >= p_from
      ) as refund_total,
      sum(t.amount) filter (
        where t.type = 'transfer' and t.amount > 0 and t.occurred_on >= p_from
      ) as transfer_in_total,
      sum(t.amount) filter (
        where t.type = 'transfer' and t.amount < 0 and t.occurred_on >= p_from
      ) as transfer_out_total,
      sum(
        case
          when t.type = 'expense' then -t.amount
          when t.type = 'refund' then -abs(t.amount)
          else t.amount
        end
      ) filter (
        where t.type <> 'transfer' and t.occurred_on >= p_from
      ) as net_total
    from public.finance_transactions t
    where t.tenant_id = tenant_uuid
      and t.occurred_on <= p_to
      and (caller_is_owner or t.account_id = any(visible_accounts))
    group by t.account_id
  ),
  tenant_accounts as (
    select a.id, a.opening_balance
    from public.accounts a
    where a.tenant_id = tenant_uuid
      and (caller_is_owner or a.id = any(visible_accounts))
  )
  select
    coalesce(tenant_accounts.id, ledger.ledger_account_id) as account_id,
    round(
      coalesce(tenant_accounts.opening_balance, 0) + coalesce(ledger.delta_before, 0),
      2
    ) as opening_before,
    round(coalesce(ledger.income_total, 0), 2) as income,
    round(coalesce(ledger.expense_total, 0), 2) as expense,
    round(coalesce(ledger.refund_total, 0), 2) as refund,
    round(coalesce(ledger.transfer_in_total, 0), 2) as transfer_in,
    round(coalesce(ledger.transfer_out_total, 0), 2) as transfer_out,
    round(coalesce(ledger.net_total, 0), 2) as net
  from tenant_accounts
  full join ledger on ledger.ledger_account_id = tenant_accounts.id;
end;
$function$
;
grant execute on function public.account_period_totals(p_tenant uuid, p_from date, p_to date) to authenticated;

CREATE OR REPLACE FUNCTION public.account_serves_team(p_account_id uuid, p_team_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.accounts a
     where a.id = p_account_id
       and (
         (a.scope = 'team' and a.brigade_id = p_team_id)
         or (a.scope = 'company' and exists (
           select 1 from public.account_teams att
            where att.account_id = a.id and att.team_id = p_team_id
         ))
       )
  )
$function$
;
grant execute on function public.account_serves_team(p_account_id uuid, p_team_id text) to authenticated;

CREATE OR REPLACE FUNCTION public.account_trash_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ledger_balance numeric(14,2);
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is not null or new.purge_at is not null then
      raise exception 'Новый счёт не бывает удалённым'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    -- Удаление: только с нулём на счёте — формула сторожа закрытия.
    select round(
      new.opening_balance + coalesce(sum(
        case
          when t.type = 'expense' then -t.amount
          when t.type = 'refund' then -abs(t.amount)
          else t.amount
        end
      ), 0),
      2
    ) into ledger_balance
    from public.finance_transactions t
    where t.account_id = old.id;
    if ledger_balance <> 0 then
      raise exception 'Счёт с остатком % нельзя удалить; сначала обнулите его', ledger_balance
        using errcode = '23514', hint = 'account:balance';
    end if;
    new.deleted_at := now();
    new.is_active := false;
    new.is_primary := false;
  elsif old.deleted_at is not null and new.deleted_at is null then
    -- «Восстановить»: обычный открытый счёт, срок снят.
    new.is_active := true;
    new.purge_at := null;
    return new;
  elsif old.deleted_at is not null then
    -- Всё ещё в «Удалённых»: время удаления не переписывается, остаток —
    -- ноль, открыть можно только восстановлением.
    new.deleted_at := old.deleted_at;
    if new.is_active then
      raise exception 'Удалённый счёт сначала восстановите'
        using errcode = '23514', hint = 'account:deleted';
    end if;
    if new.opening_balance is distinct from old.opening_balance then
      raise exception 'Удалённый счёт сначала восстановите'
        using errcode = '23514', hint = 'account:deleted';
    end if;
  else
    -- Не удалён — срока стирания не бывает.
    new.purge_at := null;
    return new;
  end if;

  new.purge_at := case
    when public.account_has_history(new.id) then null
    else new.deleted_at + interval '30 days'
  end;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.activate_tenant(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_master_id text;
  v_available jsonb;
  v_onboarded boolean;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to activate a tenant'
      using errcode = '42501';
  end if;

  select tm.role, tm.master_id
    into v_role, v_master_id
    from public.tenant_members tm
   where tm.tenant_id = p_tenant_id
     and tm.user_id = auth.uid();

  if not found then
    raise exception 'tenant membership not found'
      using errcode = '42501';
  end if;

  select t.onboarded_at is not null
    into v_onboarded
    from public.tenants t
   where t.id = p_tenant_id;

  select coalesce(
    jsonb_agg(x.tenant_id order by x.joined_at, x.tenant_id),
    '[]'::jsonb
  )
    into v_available
    from (
      select tm.tenant_id::text as tenant_id,
             min(tm.joined_at) as joined_at
        from public.tenant_members tm
       where tm.user_id = auth.uid()
       group by tm.tenant_id
    ) x;

  update auth.users u
     set raw_app_meta_data =
       (coalesce(u.raw_app_meta_data, '{}'::jsonb) - 'tenant_master_id')
       || jsonb_build_object(
         'tenant_id', p_tenant_id::text,
         'tenant_role', v_role,
         'available_tenants', v_available
       )
       || case
            when v_master_id is null then '{}'::jsonb
            else jsonb_build_object('tenant_master_id', v_master_id)
          end
   where u.id = auth.uid();

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'role', v_role,
    'master_id', v_master_id,
    'onboarded', coalesce(v_onboarded, false)
  );
end;
$function$
;
grant execute on function public.activate_tenant(p_tenant_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.add_platform_admin(p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where email = p_email;
  if v_user_id is null then
    raise notice 'add_platform_admin: user with email % not found', p_email;
    return;
  end if;
  insert into public.platform_admins (user_id, granted_by, notes)
    values (v_user_id, v_user_id, 'bootstrap via add_platform_admin')
    on conflict (user_id) do nothing;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.admin_billing_history(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_topups  json;
  v_events  json;
begin
  if not public.is_platform_admin() then
    return json_build_object('error', 'forbidden');
  end if;

  -- Recent topups joined with tenant name + owner.
  select coalesce(json_agg(row_to_json(r)), '[]'::json)
  into v_topups
  from (
    select
      tp.id,
      tp.tenant_id,
      t.name as tenant_name,
      tp.amount_cents,
      tp.credits_added,
      tp.pack_label,
      tp.status,
      tp.stripe_session_id,
      tp.stripe_payment_intent_id,
      tp.created_at,
      tp.completed_at
    from public.sms_topups tp
    left join public.tenants t on t.id = tp.tenant_id
    order by tp.created_at desc
    limit p_limit offset p_offset
  ) r;

  -- Recent billing events (subscription state transitions).
  if to_regclass('public.billing_events') is not null then
    execute $sql$
      select coalesce(json_agg(row_to_json(r)), '[]'::json)
      from (
        select
          be.id,
          be.tenant_id,
          t.name as tenant_name,
          be.event_type,
          be.stripe_event_id,
          be.created_at
        from public.billing_events be
        left join public.tenants t on t.id = be.tenant_id
        order by be.created_at desc
        limit $1 offset $2
      ) r
    $sql$
    into v_events using p_limit, p_offset;
  else
    v_events := '[]'::json;
  end if;

  return json_build_object(
    'topups', v_topups,
    'events', v_events
  );
end;
$function$
;
grant execute on function public.admin_billing_history(p_limit integer, p_offset integer) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_dashboard_summary()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total_tenants    integer;
  v_paid_tenants     integer;
  v_pending_senders  integer;
  v_sms_today        integer;
  v_topups_total_eur numeric;
begin
  if not public.is_platform_admin() then
    return json_build_object('error', 'forbidden');
  end if;

  select count(*) into v_total_tenants from public.tenants;

  select count(*) into v_paid_tenants
    from public.tenants
    where plan in ('pro', 'business')
       or plan_override in ('pro', 'business', 'lifetime');

  select count(*) into v_pending_senders
    from public.tenant_sms_config
    where sender_status = 'pending';

  select count(*) into v_sms_today
    from public.sms_logs
    where created_at >= date_trunc('day', now());

  select coalesce(sum(amount_cents), 0) / 100.0 into v_topups_total_eur
    from public.sms_topups
    where status = 'completed';

  return json_build_object(
    'total_tenants', v_total_tenants,
    'paid_tenants', v_paid_tenants,
    'pending_senders', v_pending_senders,
    'sms_today', v_sms_today,
    'topups_total_eur', v_topups_total_eur
  );
end;
$function$
;
grant execute on function public.admin_dashboard_summary() to authenticated;

CREATE OR REPLACE FUNCTION public.admin_pending_senders()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_rows json;
begin
  if not public.is_platform_admin() then
    return json_build_object('error', 'forbidden');
  end if;

  select coalesce(json_agg(row_to_json(j) order by j.sender_requested_at asc), '[]'::json)
    into v_rows
    from (
      select
        sc.tenant_id,
        sc.sender_name,
        sc.sender_status,
        sc.sender_requested_at,
        sc.sender_rejection_reason,
        t.name as tenant_name,
        (select email from auth.users
          where id = (
            select user_id from public.tenant_members
            where tenant_id = sc.tenant_id and role = 'owner'
            limit 1
          )) as owner_email
      from public.tenant_sms_config sc
      join public.tenants t on t.id = sc.tenant_id
      where sc.sender_status = 'pending'
    ) j;

  return v_rows;
end;
$function$
;
grant execute on function public.admin_pending_senders() to authenticated;

CREATE OR REPLACE FUNCTION public.admin_resolve_tenant_owner_email(p_tenant_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text;
begin
  if not public.is_platform_admin() then
    return null;
  end if;

  select u.email
    into v_email
    from public.tenant_members tm
    join auth.users u on u.id = tm.user_id
    where tm.tenant_id = p_tenant_id
      and tm.role = 'owner'
    order by tm.joined_at asc
    limit 1;

  return v_email;
end;
$function$
;
grant execute on function public.admin_resolve_tenant_owner_email(p_tenant_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_stats_summary(p_days integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_signups   json;
  v_sms       json;
  v_topup     json;
  v_mrr_cents integer;
  v_paid_count integer;
begin
  if not public.is_platform_admin() then
    return json_build_object('error', 'forbidden');
  end if;

  -- Signups per day.
  select coalesce(json_agg(row_to_json(r) order by r.day), '[]'::json)
  into v_signups
  from (
    select date_trunc('day', created_at)::date as day, count(*)::int as count
    from public.tenants
    where created_at >= now() - (p_days || ' days')::interval
    group by 1
  ) r;

  -- SMS per day (all sends, including failed).
  if to_regclass('public.sms_logs') is not null then
    execute $sql$
      select coalesce(json_agg(row_to_json(r) order by r.day), '[]'::json)
      from (
        select date_trunc('day', created_at)::date as day, count(*)::int as count
        from public.sms_logs
        where created_at >= now() - ($1 || ' days')::interval
        group by 1
      ) r
    $sql$
    into v_sms using p_days;
  else
    v_sms := '[]'::json;
  end if;

  -- Topup revenue per day (completed only).
  if to_regclass('public.sms_topups') is not null then
    execute $sql$
      select coalesce(json_agg(row_to_json(r) order by r.day), '[]'::json)
      from (
        select date_trunc('day', created_at)::date as day,
               (sum(amount_cents))::int as cents
        from public.sms_topups
        where status = 'completed'
          and created_at >= now() - ($1 || ' days')::interval
        group by 1
      ) r
    $sql$
    into v_topup using p_days;
  else
    v_topup := '[]'::json;
  end if;

  -- Crude MRR estimate: count tenants on pro/business * fixed price.
  -- For wave-2 stats we read from STRIPE_PRICE env via app code; here
  -- we just count and let the page compute the EUR. Returns counts.
  select count(*) into v_paid_count
    from public.tenants
    where plan in ('pro', 'business')
       or plan_override in ('pro', 'business', 'lifetime');

  v_mrr_cents := 0; -- Computed by app from price IDs.

  return json_build_object(
    'days', p_days,
    'signups_by_day', v_signups,
    'sms_by_day', v_sms,
    'topup_eur_by_day', v_topup,
    'paid_tenants', v_paid_count
  );
end;
$function$
;
grant execute on function public.admin_stats_summary(p_days integer) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_tenant_detail(p_tenant_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant       json;
  v_owner_email  text;
  v_sms          json;
  v_recent_logs  json;
  v_topups       json;
  v_billing      json;
begin
  if not public.is_platform_admin() then
    return json_build_object('error', 'forbidden');
  end if;

  select row_to_json(t) into v_tenant
    from (
      select id, name, vertical, city, plan, plan_override,
             stripe_customer_id, stripe_subscription_id,
             subscription_status, current_period_end, created_at
      from public.tenants where id = p_tenant_id
    ) t;
  if v_tenant is null then
    return json_build_object('error', 'not_found');
  end if;

  select u.email into v_owner_email
    from public.tenant_members tm
    join auth.users u on u.id = tm.user_id
    where tm.tenant_id = p_tenant_id and tm.role = 'owner'
    order by tm.joined_at asc
    limit 1;

  select row_to_json(s) into v_sms
    from (
      select sender_name, sender_status, sender_requested_at,
             sender_approved_at, sender_rejection_reason,
             balance_cents, free_sms_remaining, total_sent_count,
             enabled
      from public.tenant_sms_config where tenant_id = p_tenant_id
    ) s;

  select coalesce(json_agg(row_to_json(l) order by l.created_at desc), '[]'::json)
    into v_recent_logs
    from (
      select id, to_phone, body, sender_name_used, cost_cents,
             was_free, twilio_status, error_message, created_at
      from public.sms_logs
      where tenant_id = p_tenant_id
      order by created_at desc
      limit 20
    ) l;

  select coalesce(json_agg(row_to_json(tp) order by tp.created_at desc), '[]'::json)
    into v_topups
    from (
      select id, amount_cents, credits_added, pack_label,
             status, created_at, completed_at
      from public.sms_topups
      where tenant_id = p_tenant_id
      order by created_at desc
      limit 20
    ) tp;

  select coalesce(json_agg(row_to_json(be) order by be.created_at desc), '[]'::json)
    into v_billing
    from (
      select id, event_type, stripe_event_id, payload, created_at
      from public.billing_events
      where tenant_id = p_tenant_id
      order by created_at desc
      limit 20
    ) be;

  return json_build_object(
    'tenant', v_tenant,
    'owner_email', v_owner_email,
    'sms', v_sms,
    'recent_logs', v_recent_logs,
    'topups', v_topups,
    'billing_events', v_billing
  );
end;
$function$
;
grant execute on function public.admin_tenant_detail(p_tenant_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_tenants_list(p_search text DEFAULT NULL::text, p_plan_filter text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rows json;
begin
  if not public.is_platform_admin() then
    return json_build_object('error', 'forbidden');
  end if;

  with members as (
    select tm.tenant_id, u.email, tm.role
    from public.tenant_members tm
    join auth.users u on u.id = tm.user_id
    where tm.role = 'owner'
  ),
  joined as (
    select
      t.id,
      t.name,
      t.plan,
      t.plan_override,
      t.created_at,
      m.email as owner_email,
      sc.sender_name,
      sc.sender_status,
      sc.balance_cents,
      sc.free_sms_remaining,
      sc.total_sent_count,
      (select count(*) from public.appointments a where a.tenant_id = t.id)
        as appointment_count,
      (select count(*) from public.clients c where c.tenant_id = t.id)
        as client_count
    from public.tenants t
    left join members m on m.tenant_id = t.id
    left join public.tenant_sms_config sc on sc.tenant_id = t.id
    where (
      p_search is null or p_search = ''
      or t.name ilike '%' || p_search || '%'
      or m.email ilike '%' || p_search || '%'
    )
    and (
      p_plan_filter is null or p_plan_filter = ''
      or t.plan = p_plan_filter
      or t.plan_override = p_plan_filter
    )
    order by t.created_at desc
    limit p_limit offset p_offset
  )
  select coalesce(json_agg(row_to_json(joined)), '[]'::json) into v_rows
    from joined;

  return v_rows;
end;
$function$
;
grant execute on function public.admin_tenants_list(p_search text, p_plan_filter text, p_limit integer, p_offset integer) to authenticated;

CREATE OR REPLACE FUNCTION public.apply_location_label_changes(p_labels jsonb, p_remove_ids jsonb DEFAULT '[]'::jsonb)
 RETURNS SETOF location_labels
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
    select *
      from public.apply_team_location_label_changes(
        (select t.id
           from public.teams t
          where t.tenant_id = public.current_tenant_id()
            and t.is_active
          order by t.position, t.created_at
          limit 1),
        p_labels,
        p_remove_ids
      );
end;
$function$
;
grant execute on function public.apply_location_label_changes(p_labels jsonb, p_remove_ids jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.apply_team_location_label_changes(p_team_id text, p_labels jsonb, p_remove_ids jsonb DEFAULT '[]'::jsonb)
 RETURNS SETOF location_labels
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  label_count integer;
begin
  if auth.uid() is null
     or tenant_uuid is null
     or (
       public.current_user_role() is distinct from 'owner'
       and not coalesce(p_team_id = any(public.access_calendars('clients.settings_objects', 'write')), false)
     ) then
    raise exception 'Нет права настраивать типы объектов этой команды'
      using errcode = '42501', hint = 'block:clients.settings_objects';
  end if;
  if p_team_id is null
     or not exists (
       select 1 from public.teams team
        where team.tenant_id = tenant_uuid
          and team.id = p_team_id
     ) then
    raise exception 'Команда типов объектов не найдена в компании'
      using errcode = '23503';
  end if;
  if p_labels is null or jsonb_typeof(p_labels) <> 'array' then
    raise exception 'Список типов объектов имеет неверный формат';
  end if;
  if p_remove_ids is null or jsonb_typeof(p_remove_ids) <> 'array' then
    raise exception 'Список удаляемых типов объектов имеет неверный формат';
  end if;

  label_count := jsonb_array_length(p_labels);
  if label_count > 100 then
    raise exception 'Можно сохранить не больше 100 типов объектов';
  end if;
  if jsonb_array_length(p_remove_ids) > 100 then
    raise exception 'Можно удалить не больше 100 типов объектов за один раз';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_labels) item
     where jsonb_typeof(item) is distinct from 'object'
        or jsonb_typeof(item -> 'id') is distinct from 'string'
        or jsonb_typeof(item -> 'name') is distinct from 'string'
        or char_length(btrim(item ->> 'id')) not between 1 and 160
        or char_length(btrim(item ->> 'name')) not between 1 and 80
        or (
          item ? 'position'
          and not (
            jsonb_typeof(item -> 'position') = 'number'
            and (item ->> 'position') ~ '^[0-9]{1,6}$'
          )
        )
  ) then
    raise exception 'Каждый тип объекта должен иметь идентификатор и название';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_labels) item
     where (
             item ? 'color'
             and jsonb_typeof(item -> 'color') = 'string'
             and btrim(item ->> 'color') <> ''
             and btrim(item ->> 'color') !~ '^#[0-9A-Fa-f]{6}$'
           )
        or (
             item ? 'icon'
             and jsonb_typeof(item -> 'icon') = 'string'
             and btrim(item ->> 'icon') <> ''
             and btrim(item ->> 'icon') !~ '^[a-z0-9-]{1,40}$'
           )
  ) then
    raise exception 'Цвет или значок типа объекта имеет неверный формат';
  end if;
  if (
    select count(distinct btrim(item ->> 'id'))
      from jsonb_array_elements(p_labels) item
  ) <> label_count then
    raise exception 'Идентификаторы типов объектов не должны повторяться';
  end if;
  if (
    select count(distinct lower(btrim(item ->> 'name')))
      from jsonb_array_elements(p_labels) item
  ) <> label_count then
    raise exception 'Названия типов объектов не должны повторяться';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_remove_ids) item
     where jsonb_typeof(item) is distinct from 'string'
        or char_length(btrim(item #>> '{}')) not between 1 and 160
  ) then
    raise exception 'Список удаляемых типов объектов повреждён';
  end if;
  if (
    select count(distinct btrim(item #>> '{}'))
      from jsonb_array_elements(p_remove_ids) item
  ) <> jsonb_array_length(p_remove_ids) then
    raise exception 'Удаляемые типы объектов не должны повторяться';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_labels) label_item
      join jsonb_array_elements(p_remove_ids) remove_item
        on btrim(label_item ->> 'id') = btrim(remove_item #>> '{}')
  ) then
    raise exception 'Тип объекта нельзя одновременно сохранить и удалить';
  end if;
  -- Тип другой команды не правится и не отбирается чужим списком.
  if exists (
    select 1
      from public.location_labels l
      join jsonb_array_elements(p_labels) item
        on btrim(item ->> 'id') = l.id
     where l.tenant_id = tenant_uuid
       and l.team_id <> p_team_id
  ) then
    raise exception 'Тип объекта принадлежит другой команде'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(tenant_uuid::text || ':location-labels:' || p_team_id, 0)
  );

  update public.location_labels l
     set is_active = false,
         updated_at = now()
   where l.tenant_id = tenant_uuid
     and l.team_id = p_team_id
     and l.is_active
     and exists (
       select 1
         from jsonb_array_elements(p_remove_ids) item
        where btrim(item #>> '{}') = l.id
     );

  update public.location_labels l
     set is_active = false,
         updated_at = now()
   where l.tenant_id = tenant_uuid
     and l.team_id = p_team_id
     and l.is_active
     and exists (
       select 1
         from jsonb_array_elements(p_labels) item
        where btrim(item ->> 'id') = l.id
     );

  insert into public.location_labels (
    tenant_id, id, name, position, is_active, created_by, color, icon, team_id
  )
  select tenant_uuid,
         btrim(item.value ->> 'id'),
         btrim(item.value ->> 'name'),
         coalesce(
           (item.value ->> 'position')::integer,
           (item.ordinality - 1)::integer
         ),
         true,
         auth.uid(),
         nullif(btrim(coalesce(item.value ->> 'color', '')), ''),
         nullif(btrim(coalesce(item.value ->> 'icon', '')), ''),
         p_team_id
    from jsonb_array_elements(p_labels) with ordinality as item(value, ordinality)
  on conflict (tenant_id, id) do update
    set name = excluded.name,
        position = excluded.position,
        is_active = true,
        color = excluded.color,
        icon = excluded.icon,
        updated_at = now();

  return query
    select l.*
      from public.location_labels l
     where l.tenant_id = tenant_uuid
       and l.team_id = p_team_id
       and l.is_active
     order by l.position, l.created_at, l.id;
end;
$function$
;
grant execute on function public.apply_team_location_label_changes(p_team_id text, p_labels jsonb, p_remove_ids jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.appointment_link_answer(p_token text, p_answer text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  l public.appointment_links%rowtype;
  a record;
  start_at timestamptz;
begin
  if p_answer is null or p_answer not in ('confirmed', 'cancelled') then
    raise exception 'link: bad answer' using errcode = '22023';
  end if;
  select * into l from public.appointment_links where token = p_token for update;
  if not found then
    return jsonb_build_object('state', 'missing');
  end if;
  select ap.id, ap.status, ap.prepaid_amount, ap.paid_amount, ap.payment_status
    into a
    from public.appointments ap
   where ap.id = l.appointment_id
   for update;
  start_at := public.sms_appointment_start(l.appointment_id);
  if a.status = 'cancelled' then
    return public.appointment_link_lookup(p_token);
  end if;
  if a.status <> 'scheduled' or start_at is null or start_at <= now() then
    return public.appointment_link_lookup(p_token);
  end if;

  -- ЗАПИСЬ С ДЕНЬГАМИ ПО ССЫЛКЕ НЕ ОТМЕНЯЕТСЯ (аудит 04.10): отмена с
  -- деньгами = возврат, и сверка записала бы клиенту возврат, которого никто
  -- не делал. Такую запись клиент отменяет звонком.
  if p_answer = 'cancelled' and (
       coalesce(a.prepaid_amount, 0) > 0
       or coalesce(a.paid_amount, 0) > 0
       or a.payment_status in ('paid', 'partial')
       or exists (
         select 1 from public.finance_transactions f
          where f.appointment_id = a.id and f.type = 'income'
       )
     ) then
    raise exception 'Запись с оплатой отменяют по телефону'
      using errcode = 'P0001', hint = 'link:paid';
  end if;

  update public.appointment_links
     set answer = p_answer, answered_at = now()
   where appointment_id = l.appointment_id;
  if p_answer = 'cancelled' then
    update public.appointments
       set status = 'cancelled',
           cancel_reason = coalesce(nullif(cancel_reason, ''), 'Клиент отменил по ссылке из SMS')
     where id = l.appointment_id;
  end if;
  return public.appointment_link_lookup(p_token);
end;
$function$
;
grant execute on function public.appointment_link_answer(p_token text, p_answer text) to anon;
grant execute on function public.appointment_link_answer(p_token text, p_answer text) to authenticated;

CREATE OR REPLACE FUNCTION public.appointment_link_lookup(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  start_at timestamptz;
begin
  if p_token is null or length(p_token) not between 10 and 64 then
    return jsonb_build_object('state', 'missing');
  end if;
  select l.appointment_id, l.answer, l.answered_at,
         a.status, a.date, a.time_start, a.address, a.services,
         tn.name as business_name, tn.logo_url,
         coalesce(nullif(trim(cl.sms_name), ''), split_part(trim(coalesce(cl.full_name, '')), ' ', 1)) as first_name
    into r
    from public.appointment_links l
    join public.appointments a on a.id = l.appointment_id
    join public.tenants tn on tn.id = l.tenant_id
    left join public.clients cl on cl.id = a.client_id
   where l.token = p_token;
  if not found then
    return jsonb_build_object('state', 'missing');
  end if;
  start_at := public.sms_appointment_start(r.appointment_id);
  return jsonb_build_object(
    'state', case
      when r.status = 'cancelled' then 'cancelled'
      when r.answer = 'confirmed' then 'confirmed'
      when start_at is null or start_at <= now() or r.status <> 'scheduled' then 'past'
      else 'pending' end,
    'business_name', r.business_name,
    'logo_url', r.logo_url,
    'client_first_name', r.first_name,
    'date', r.date,
    'time', left(r.time_start, 5),
    'address', r.address,
    'services', coalesce((
      select jsonb_agg(line ->> 'serviceName')
        from jsonb_array_elements(case when jsonb_typeof(r.services) = 'array' then r.services else '[]'::jsonb end) line
       where coalesce(line ->> 'serviceName', '') <> ''
    ), '[]'::jsonb),
    'answered_at', r.answered_at
  );
end;
$function$
;
grant execute on function public.appointment_link_lookup(p_token text) to anon;
grant execute on function public.appointment_link_lookup(p_token text) to authenticated;

CREATE OR REPLACE FUNCTION public.appointment_link_token()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  alphabet constant text := '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  bytes bytea := gen_random_bytes(12);
  out text := '';
  i integer;
begin
  for i in 0..11 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % 62) + 1, 1);
  end loop;
  return out;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.appointment_link_url(p_appointment uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_token text;
  v_tenant uuid;
begin
  select token into v_token from public.appointment_links where appointment_id = p_appointment;
  if found then
    return 'babun.app/r/' || v_token;
  end if;
  select tenant_id into v_tenant from public.appointments where id = p_appointment;
  if not found then
    return null;
  end if;
  insert into public.appointment_links (appointment_id, tenant_id, token)
  values (p_appointment, v_tenant, public.appointment_link_token())
  on conflict (appointment_id) do nothing;
  select token into v_token from public.appointment_links where appointment_id = p_appointment;
  return 'babun.app/r/' || v_token;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.appointment_links_forget_on_client_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Ссылка из SMS адресована клиенту записи: сменили клиента — прежние
  -- ссылки больше не открывают запись.
  delete from public.appointment_links where appointment_id = new.id;
  return null;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.appointment_material_lines(p_tenant uuid, p_services jsonb, p_service_ids jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  qty jsonb := '{}'::jsonb;
  order_ids text[] := array[]::text[];
  snapshot_ids text[] := array[]::text[];
  item jsonb;
  sid text;
  q integer;
  svc record;
  rows_total numeric;
  unit numeric;
  tier record;
  lines jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_services) = 'array' then
    for item in select value from jsonb_array_elements(p_services)
    loop
      if jsonb_typeof(item) <> 'object'
         or jsonb_typeof(item -> 'serviceId') is distinct from 'string'
         or (item ->> 'serviceId') = '' then
        continue;
      end if;
      sid := item ->> 'serviceId';
      if not (sid = any(snapshot_ids)) then
        snapshot_ids := snapshot_ids || sid;
      end if;
      q := case
        when jsonb_typeof(item -> 'quantity') = 'number'
             and (item ->> 'quantity')::numeric > 0
          then greatest(1, floor((item ->> 'quantity')::numeric))::integer
        else 1
      end;
      if not (qty ? sid) then
        order_ids := order_ids || sid;
      end if;
      qty := qty || jsonb_build_object(sid, coalesce((qty ->> sid)::integer, 0) + q);
    end loop;
  end if;

  if jsonb_typeof(p_service_ids) = 'array' then
    for item in select value from jsonb_array_elements(p_service_ids)
    loop
      if jsonb_typeof(item) <> 'string' or (item #>> '{}') = '' then
        continue;
      end if;
      sid := item #>> '{}';
      if sid = any(snapshot_ids) then
        continue;
      end if;
      if not (qty ? sid) then
        order_ids := order_ids || sid;
      end if;
      qty := qty || jsonb_build_object(sid, coalesce((qty ->> sid)::integer, 0) + 1);
    end loop;
  end if;

  foreach sid in array order_ids
  loop
    select s.name, s.cost_per_unit, s.cost_tiers, s.material_costs
      into svc
      from public.services s
     where s.tenant_id = p_tenant
       and s.id = sid;
    if not found then
      continue;
    end if;
    q := (qty ->> sid)::integer;

    select coalesce(sum((r ->> 'amount')::numeric), 0)
      into rows_total
      from jsonb_array_elements(
        case when jsonb_typeof(svc.material_costs) = 'array' then svc.material_costs else '[]'::jsonb end
      ) r
     where jsonb_typeof(r) = 'object'
       and jsonb_typeof(r -> 'amount') = 'number'
       and (r ->> 'amount')::numeric >= 0;

    unit := case
      when svc.cost_per_unit is not null
           and svc.cost_per_unit >= 0
           and (svc.cost_per_unit > 0 or rows_total = 0)
        then svc.cost_per_unit
      else rows_total
    end;

    for tier in
      select distinct on (m) m, c
        from (
          select public._js_number(t -> 'min_qty') as m,
                 public._js_number(t -> 'cost_per_unit') as c,
                 ord
            from jsonb_array_elements(
              case when jsonb_typeof(svc.cost_tiers) = 'array' then svc.cost_tiers else '[]'::jsonb end
            ) with ordinality as x(t, ord)
           where jsonb_typeof(t) = 'object'
        ) parsed
       where m is not null
         and m = trunc(m)
         and m >= 2
         and m <= 9007199254740991
         and c is not null
         and c >= 0
       order by m, ord desc
    loop
      if q >= tier.m then
        unit := tier.c;
      end if;
    end loop;

    if unit * q > 0 then
      lines := lines || jsonb_build_array(jsonb_build_object(
        'serviceId', sid,
        'serviceName', coalesce(nullif(btrim(svc.name), ''), 'Услуга'),
        'quantity', q,
        'unitCost', unit,
        'totalCost', unit * q
      ));
    end if;
  end loop;

  return lines;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.appointment_payment_mirror(p_payments jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with rows as (
    select e.elem ->> 'method' as method,
           coalesce((e.elem ->> 'amount')::numeric, 0) as amount,
           e.elem ->> 'paid_at' as paid_at,
           e.ord
      from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb))
        with ordinality as e(elem, ord)
  ), sums as (
    select coalesce(sum(amount) filter (where method = 'cash'), 0) as cash,
           coalesce(sum(amount) filter (where method = 'card'), 0) as card,
           (select paid_at from rows order by ord desc limit 1) as last_paid_at
      from rows
  )
  select case
    when cash + card = 0 then null
    else jsonb_build_object(
      'method', case
        when cash > 0 and card > 0 then 'split'
        when cash > 0 then 'cash'
        else 'card'
      end,
      'cashAmount', cash,
      'cardAmount', card,
      'paid_at', coalesce(
        last_paid_at,
        to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    )
  end
  from sums;
$function$
;
grant execute on function public.appointment_payment_mirror(p_payments jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.appointments_master_column_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() is distinct from 'master' then
    return new;
  end if;
  -- Правка уже проверена дверью сотрудника поле за полем
  -- (`member_appointment_update`). Флага одного мало: `set_config` доступен
  -- любому, кто пишет SQL. Поэтому пропуск ещё и требует, чтобы запись шла
  -- изнутри definer-функции, а не от роли `authenticated`.
  if current_setting('babun.member_write', true) = 'on'
     and current_user <> 'authenticated' then
    return new;
  end if;

  if old.kind = 'work' then
    if new.id is distinct from old.id
      or new.tenant_id is distinct from old.tenant_id
      or new.client_id is distinct from old.client_id
      or new.team_id is distinct from old.team_id
      or new.master_id is distinct from old.master_id
      or new.location_id is distinct from old.location_id
      or new.date is distinct from old.date
      or new.time_start is distinct from old.time_start
      or new.time_end is distinct from old.time_end
      or new.kind is distinct from old.kind
      or new.total_amount is distinct from old.total_amount
      or new.custom_total is distinct from old.custom_total
      or new.discount_amount is distinct from old.discount_amount
      or new.prepaid_amount is distinct from old.prepaid_amount
      or new.paid_amount is distinct from old.paid_amount
      or new.payment_status is distinct from old.payment_status
      or new.payment_method is distinct from old.payment_method
      or new.address is distinct from old.address
      or new.address_note is distinct from old.address_note
      or new.address_lat is distinct from old.address_lat
      or new.address_lng is distinct from old.address_lng
      or new.cancel_reason is distinct from old.cancel_reason
      or new.source is distinct from old.source
      or new.is_online_booking is distinct from old.is_online_booking
      or new.consent_given is distinct from old.consent_given
      or new.color_override is distinct from old.color_override
      or new.reminder_enabled is distinct from old.reminder_enabled
      or new.reminder_offsets is distinct from old.reminder_offsets
      or new.reminder_template is distinct from old.reminder_template
      or new.service_ids is distinct from old.service_ids
      or new.services is distinct from old.services
      or new.service_price_overrides is distinct from old.service_price_overrides
      or new.expenses is distinct from old.expenses
      or new.payments is distinct from old.payments
      or new.payment is distinct from old.payment
      or new.global_discount is distinct from old.global_discount
      or new.total_duration is distinct from old.total_duration
      or new.event_all_day is distinct from old.event_all_day
      or new.event_notes is distinct from old.event_notes
      or new.event_url is distinct from old.event_url
      or new.event_push_enabled is distinct from old.event_push_enabled
      or new.event_push_offsets is distinct from old.event_push_offsets
      or new.event_push_at is distinct from old.event_push_at
      or new.event_repeat is distinct from old.event_repeat
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.updated_at is distinct from old.updated_at then
      raise exception 'master role can only update status and comment on work appointments'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.kind in ('event', 'personal') then
    if old.created_by is distinct from auth.uid()
      or new.id is distinct from old.id
      or new.tenant_id is distinct from old.tenant_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.kind is distinct from old.kind
      or new.client_id is distinct from old.client_id
      or new.team_id is distinct from old.team_id
      or new.master_id is distinct from old.master_id
      or new.location_id is distinct from old.location_id
      or new.total_amount is distinct from old.total_amount
      or new.custom_total is distinct from old.custom_total
      or new.discount_amount is distinct from old.discount_amount
      or new.prepaid_amount is distinct from old.prepaid_amount
      or new.paid_amount is distinct from old.paid_amount
      or new.payment_status is distinct from old.payment_status
      or new.payment_method is distinct from old.payment_method
      or new.service_ids is distinct from old.service_ids
      or new.services is distinct from old.services
      or new.service_price_overrides is distinct from old.service_price_overrides
      or new.expenses is distinct from old.expenses
      or new.payments is distinct from old.payments
      or new.payment is distinct from old.payment
      or new.global_discount is distinct from old.global_discount
      or new.source is distinct from old.source
      or new.is_online_booking is distinct from old.is_online_booking
      or new.consent_given is distinct from old.consent_given
      or new.reminder_enabled is distinct from old.reminder_enabled
      or new.reminder_offsets is distinct from old.reminder_offsets
      or new.reminder_template is distinct from old.reminder_template then
      raise exception 'master role cannot change assignment, client or finance fields on a personal event'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'unsupported appointment kind for master role'
    using errcode = '42501';
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.appointments_sms_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  queued boolean := false;
  t record;
  end_at timestamptz;
begin
  begin
    if tg_op = 'INSERT' then
      if new.kind = 'work' and new.status = 'scheduled' then
        queued := public.sms_enqueue_trigger(new.id, 'created');
      end if;
    elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
      -- Отмена: неотправленное «до визита» уже ни к чему.
      delete from public.sms_messages
       where appointment_id = new.id and status = 'queued'
         and trigger_type in ('new_appointment', 'reminder', 'reschedule');
      queued := public.sms_enqueue_trigger(new.id, 'cancelled');
    elsif new.status = 'completed' and old.status is distinct from 'completed' then
      end_at := public.sms_appointment_end(new.id);
      for t in
        select tpl.id, tpl.hours
          from public.sms_team_templates tpl
         where tpl.tenant_id = new.tenant_id and tpl.team_id = new.team_id
           and tpl.enabled and tpl.trigger = 'after'
      loop
        -- Отметили выполненной через сутки после срока — «спасибо» уже не к месту.
        if end_at is not null and end_at + make_interval(hours => t.hours) > now() - interval '1 day' then
          if public.sms_enqueue(new.id, t.id, end_at + make_interval(hours => t.hours)) then
            queued := true;
          end if;
        end if;
      end loop;
    elsif new.status = 'scheduled'
      and (new.date is distinct from old.date or new.time_start is distinct from old.time_start) then
      -- Перенос: напоминания о прежнем времени не нужны, новые поставит
      -- расписание. Неотправленное подтверждение или перенос уйдут с новой
      -- датой сами (текст собирается при отправке) — второй не нужен.
      delete from public.sms_messages
       where appointment_id = new.id and status = 'queued' and trigger_type = 'reminder';
      if not exists (
        select 1 from public.sms_messages m
         where m.appointment_id = new.id and m.status = 'queued'
           and m.trigger_type in ('new_appointment', 'reschedule')
      ) then
        queued := public.sms_enqueue_trigger(new.id, 'rescheduled');
      end if;
    end if;
    if queued then
      perform public.sms_wake();
    end if;
  exception when others then
    -- SMS не имеет права уронить запись.
    raise warning 'appointments_sms_trigger: %', sqlerrm;
  end;
  return null;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.assert_account_team_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  account_row public.accounts%rowtype;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Привязку команды нельзя изменить; отвяжите и привяжите заново';
  end if;
  select * into account_row
    from public.accounts
   where id = new.account_id
   for share;
  if not found or account_row.tenant_id <> new.tenant_id then
    raise exception 'Счёт не найден в этой компании';
  end if;
  if account_row.scope <> 'company' then
    raise exception 'Команды подключаются только к общему счёту компании';
  end if;
  if not exists (
    select 1 from public.teams
     where id = new.team_id and tenant_id = new.tenant_id
  ) then
    raise exception 'Команда не найдена в этой компании';
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.assert_finance_template_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  template_account public.accounts%rowtype;
  expected_kind text;
  expected_category_type text;
begin
  if tg_op = 'UPDATE'
     and not exists (select 1 from public.tenants where id = old.tenant_id) then
    return new;
  end if;
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
  ) then
    raise exception 'Компания и идентификатор шаблона неизменяемы';
  end if;
  if btrim(coalesce(new.name, '')) = '' then
    raise exception 'Укажите название шаблона';
  end if;
  if new.amount is null or new.amount = 'NaN'::numeric or new.amount <= 0 then
    raise exception 'Сумма шаблона должна быть больше нуля';
  end if;
  if new.kind not in ('income', 'expense') then
    raise exception 'Некорректный вид шаблона';
  end if;
  if new.brigade_id is null or btrim(new.brigade_id) = '' then
    raise exception 'Выберите команду шаблона';
  end if;
  if new.payment_method is null
     or new.payment_method not in ('cash', 'card', 'transfer', 'other') then
    raise exception 'Выберите способ оплаты шаблона';
  end if;
  if new.account_id is null then
    raise exception 'Выберите финансовый счёт шаблона';
  end if;

  select * into template_account
    from public.accounts
   where id = new.account_id
     and tenant_id = new.tenant_id
   for share;
  if not found or not template_account.is_active then
    raise exception 'Финансовый счёт шаблона не найден или закрыт';
  end if;
  if not public.account_serves_team(template_account.id, new.brigade_id) then
    raise exception 'Счёт шаблона недоступен этой команде';
  end if;
  expected_kind := case new.payment_method
    when 'cash' then 'cash'
    when 'card' then 'card'
    when 'transfer' then 'bank'
    when 'other' then 'other'
  end;
  if template_account.kind is distinct from expected_kind then
    raise exception 'Способ оплаты шаблона не соответствует выбранному счёту';
  end if;
  if not exists (
    select 1 from public.teams
     where id = new.brigade_id and tenant_id = new.tenant_id
  ) then
    raise exception 'Команда шаблона не найдена';
  end if;

  if new.category_id is not null then
    expected_category_type := case new.kind
      when 'income' then 'income'
      when 'expense' then 'expense'
    end;
    if not exists (
      select 1 from public.finance_categories category
       where category.id = new.category_id
         and (category.tenant_id is null or category.tenant_id = new.tenant_id) and (category.team_id is null or new.brigade_id is null or category.team_id = new.brigade_id)
         and category.type = expected_category_type
    ) then
      raise exception 'Категория не соответствует виду шаблона';
    end if;
  end if;
  if new.master_id is not null and not exists (
    select 1
      from public.masters master
      join public.teams team
        on team.id = new.brigade_id and team.tenant_id = new.tenant_id
     where master.id = new.master_id
       and master.tenant_id = new.tenant_id
       and (
         master.team_id = new.brigade_id
         or team.lead_id = master.id
         or coalesce(team.lead_ids, '[]'::jsonb) ? master.id
         or coalesce(team.helper_ids, '[]'::jsonb) ? master.id
         or exists (
           select 1
             from jsonb_array_elements(
               case when jsonb_typeof(team.members) = 'array'
                 then team.members else '[]'::jsonb end
             ) member
            where case jsonb_typeof(member)
              when 'string' then member #>> '{}'
              when 'object' then coalesce(member ->> 'master_id', member ->> 'id')
              else null
            end = master.id
         )
       )
  ) then
    raise exception 'Исполнитель не входит в команду шаблона';
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.assert_finance_transaction_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  account_row public.accounts%rowtype;
  old_account public.accounts%rowtype;
  appointment_row public.appointments%rowtype;
  original_income public.finance_transactions%rowtype;
  context_ok boolean := false;
  allow_auto_invoice_link boolean := false;
  expected_account_kind text;
  expected_category_type text;
  already_refunded numeric := 0;
begin
  -- Company deletion must be able to cascade through immutable history.
  if tg_op in ('UPDATE', 'DELETE')
     and not exists (select 1 from public.tenants where id = old.tenant_id) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' and new.source = 'auto' then
    select exists (
      select 1 from public._finance_write_context
       where transaction_id = txid_current()
         and kind = 'appointment_auto'
         and entity_id = new.appointment_id
         and tenant_id = new.tenant_id
    ) into context_ok;
    if not context_ok or new.appointment_id is null then
      raise exception 'Автоматическую операцию может создать только заявка';
    end if;
    if new.appointment_payment_kind is null then
      raise exception 'Не определён этап оплаты заявки';
    end if;
  elsif tg_op = 'INSERT' and new.appointment_payment_kind is not null then
    raise exception 'Этап оплаты доступен только автоматической операции заявки';
  end if;

  if tg_op = 'INSERT' and new.type = 'transfer' then
    select exists (
      select 1 from public._finance_write_context
       where transaction_id = txid_current()
         and kind = 'transfer_write'
         and entity_id = new.transfer_group_id
         and tenant_id = new.tenant_id
    ) into context_ok;
    if not context_ok or new.transfer_group_id is null then
      raise exception 'Перевод можно создать только целиком через форму перевода';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if old.source = 'auto' or new.source = 'auto' then
      -- issue_invoice() may attach an existing appointment income to a legal
      -- invoice. This is the only non-economic auto-row update. The following
      -- _005 trigger validates target invoice, tenant, sum and absence of
      -- payments/refunds; every other field must remain byte-for-byte equal.
      allow_auto_invoice_link := old.source = 'auto'
        and new.source = 'auto'
        and old.invoice_id is null
        and new.invoice_id is not null
        and row(
          new.id, new.tenant_id, new.type, new.amount, new.currency,
          new.category_id, new.account_id, new.appointment_id, new.client_id,
          new.team_id, new.master_id, new.payment_method, new.notes,
          new.occurred_on, new.receipt_url, new.transfer_group_id,
          new.refund_of_id, new.source, new.appointment_payment_kind,
          new.created_at, new.created_by
        ) is not distinct from row(
          old.id, old.tenant_id, old.type, old.amount, old.currency,
          old.category_id, old.account_id, old.appointment_id, old.client_id,
          old.team_id, old.master_id, old.payment_method, old.notes,
          old.occurred_on, old.receipt_url, old.transfer_group_id,
          old.refund_of_id, old.source, old.appointment_payment_kind,
          old.created_at, old.created_by
        );
      if allow_auto_invoice_link then return new; end if;
      raise exception 'Автоматическую операцию нельзя редактировать; измените связанную заявку';
    end if;
    if old.type = 'transfer' or new.type = 'transfer' then
      raise exception 'Перевод нельзя редактировать; отмените его целиком';
    end if;
    if new.id is distinct from old.id
       or new.tenant_id is distinct from old.tenant_id
       or new.type is distinct from old.type
       or new.source is distinct from old.source
       or new.transfer_group_id is distinct from old.transfer_group_id
       or new.refund_of_id is distinct from old.refund_of_id
       or new.appointment_payment_kind is distinct from old.appointment_payment_kind
       or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by then
      raise exception 'Системные поля финансовой операции нельзя изменять';
    end if;
    -- Сумму дохода нельзя опустить ниже уже возвращённого: иначе по леджеру
    -- вернули больше, чем получали.
    if old.type = 'income' and new.amount < old.amount then
      select coalesce(sum(abs(refund.amount)), 0)
        into already_refunded
        from public.finance_transactions refund
       where refund.refund_of_id = old.id
         and refund.type = 'refund';
      if already_refunded > new.amount then
        raise exception 'По этому доходу уже возвращено %; сумма не может стать меньше', already_refunded;
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' and old.source = 'auto' then
    select exists (
      select 1 from public._finance_write_context
       where transaction_id = txid_current()
         and kind = 'appointment_undo'
         and entity_id = old.appointment_id
         and tenant_id = old.tenant_id
    ) into context_ok;
    if not context_ok or old.appointment_id is null then
      raise exception 'Автоматическую операцию нельзя удалить; отмените оплату в заявке';
    end if;
  end if;

  if tg_op = 'DELETE' and old.type = 'transfer' then
    select exists (
      select 1 from public._finance_write_context
       where transaction_id = txid_current()
         and kind = 'transfer_write'
         and entity_id = old.transfer_group_id
         and tenant_id = old.tenant_id
    ) into context_ok;
    if not context_ok or old.transfer_group_id is null then
      raise exception 'Нельзя удалить одну часть перевода; отмените перевод целиком';
    end if;
  end if;

  -- Доход с возвратами не удаляется: FK on delete set null оставил бы
  -- возвраты-сироты, которые продолжают минусовать счёт без своего дохода.
  if tg_op = 'DELETE' and old.type = 'income' and exists (
    select 1 from public.finance_transactions refund
     where refund.refund_of_id = old.id and refund.type = 'refund'
  ) then
    raise exception 'У этого дохода есть возвраты; сначала удалите сами возвраты';
  end if;

  -- Deleting or moving money out of a closed account would silently make its
  -- supposedly final balance non-zero.
  if tg_op in ('UPDATE', 'DELETE') and old.account_id is not null then
    select * into old_account from public.accounts where id = old.account_id for share;
    if found and not old_account.is_active then
      raise exception 'Сначала снова откройте финансовый счёт';
    end if;
  end if;

  if tg_op <> 'DELETE' then
    if new.account_id is null then
      raise exception 'Выберите финансовый счёт';
    end if;
    select * into account_row
      from public.accounts
     where id = new.account_id
     for share;
    if not found or account_row.tenant_id <> new.tenant_id then
      raise exception 'Финансовый счёт не найден в этой компании';
    end if;
    if not account_row.is_active then
      raise exception 'Финансовый счёт закрыт';
    end if;
    if account_row.scope = 'team' then
      if new.team_id is null then
        new.team_id := account_row.brigade_id;
      elsif new.team_id <> account_row.brigade_id then
        raise exception 'Финансовый счёт относится к другой команде';
      end if;
    elsif new.type = 'transfer' and new.team_id is not null then
      -- A company transfer leg carries no team attribution.
      raise exception 'У перевода со счёта компании не бывает команды';
    end if;

    -- A refund is not a free-standing negative row: it is a contra-income
    -- tied to one locked original. Copy nullable context from that original
    -- before validating the appointment and payment route below.
    if new.type = 'refund' then
      if new.refund_of_id is null then
        raise exception 'Выберите исходный доход для возврата';
      end if;
      select * into original_income
        from public.finance_transactions
       where id = new.refund_of_id
         and tenant_id = new.tenant_id
         and type = 'income'
       for update;
      if not found then
        raise exception 'Исходный доход для возврата не найден';
      end if;
      if original_income.source = 'auto' and new.source <> 'auto' then
        raise exception 'Возврат автоматической оплаты оформляется в связанной заявке';
      end if;
      if new.team_id is null then
        new.team_id := original_income.team_id;
      end if;
      if new.account_id is distinct from original_income.account_id
         or new.team_id is distinct from original_income.team_id then
        raise exception 'Возврат должен пройти по исходному счёту и команде';
      end if;
      if new.appointment_id is null then
        new.appointment_id := original_income.appointment_id;
      elsif new.appointment_id is distinct from original_income.appointment_id then
        raise exception 'Заявка возврата не совпадает с исходным доходом';
      end if;
      if new.client_id is null then
        new.client_id := original_income.client_id;
      elsif new.client_id is distinct from original_income.client_id then
        raise exception 'Клиент возврата не совпадает с исходным доходом';
      end if;
      if new.master_id is null then
        new.master_id := original_income.master_id;
      elsif new.master_id is distinct from original_income.master_id then
        raise exception 'Исполнитель возврата не совпадает с исходным доходом';
      end if;
      if new.payment_method is null then
        new.payment_method := original_income.payment_method;
      elsif new.payment_method is distinct from original_income.payment_method then
        raise exception 'Возврат должен использовать способ исходного платежа';
      end if;
      if new.invoice_id is null then
        new.invoice_id := original_income.invoice_id;
      elsif new.invoice_id is distinct from original_income.invoice_id then
        raise exception 'Возврат относится к другому инвойсу';
      end if;
      new.currency := original_income.currency;
      if new.source = 'auto'
         and new.appointment_payment_kind is distinct from coalesce(
           original_income.appointment_payment_kind,
           'settlement'
         ) then
        raise exception 'Этап возврата не совпадает с исходным платежом';
      end if;

      select coalesce(sum(abs(refund.amount)), 0)
        into already_refunded
        from public.finance_transactions refund
       where refund.refund_of_id = original_income.id
         and refund.type = 'refund'
         and refund.id is distinct from new.id;
      if already_refunded + abs(new.amount) > greatest(original_income.amount, 0) then
        raise exception 'Возврат превышает остаток исходного дохода';
      end if;
    elsif new.refund_of_id is not null then
      raise exception 'Исходный доход указан не для возврата';
    end if;

    if new.type = 'transfer' then
      if new.payment_method is not null then
        raise exception 'У перевода между счетами не бывает способа оплаты';
      end if;
    else
      if new.payment_method is null
         or new.payment_method not in ('cash', 'card', 'transfer', 'other') then
        raise exception 'Выберите способ оплаты';
      end if;
      expected_account_kind := case new.payment_method
        when 'cash' then 'cash'
        when 'card' then 'card'
        when 'transfer' then 'bank'
        when 'other' then 'other'
      end;
      if account_row.kind is distinct from expected_account_kind then
        raise exception 'Способ оплаты не соответствует выбранному счёту';
      end if;
    end if;

    if new.appointment_id is not null then
      select * into appointment_row
        from public.appointments appointment
       where appointment.id = new.appointment_id
         and appointment.tenant_id = new.tenant_id
       for share;
      if not found then
        raise exception 'Заявка финансовой операции не найдена';
      end if;
      if new.team_id is null then
        new.team_id := appointment_row.team_id;
      elsif appointment_row.team_id is distinct from new.team_id then
        raise exception 'Заявка относится к другой команде';
      end if;
      if new.client_id is null then
        new.client_id := appointment_row.client_id;
      elsif new.client_id is distinct from appointment_row.client_id then
        raise exception 'Клиент финансовой операции не совпадает с заявкой';
      end if;
      if new.master_id is null then
        new.master_id := appointment_row.master_id;
      elsif new.master_id is distinct from appointment_row.master_id then
        raise exception 'Исполнитель финансовой операции не совпадает с заявкой';
      end if;
    end if;

    if new.team_id is not null and not exists (
      select 1 from public.teams
       where id = new.team_id and tenant_id = new.tenant_id
    ) then
      raise exception 'Команда финансовой операции не найдена';
    end if;

    -- The company-account lock (requirement: per-team inflow attribution).
    -- Refunds are exempt: they follow the original row even after the team
    -- was detached from the account.
    if account_row.scope = 'company' then
      if new.source = 'auto' and new.team_id is null then
        raise exception 'Не определена команда автоматической операции';
      end if;
      if new.type in ('income', 'expense')
         and new.team_id is not null
         and not exists (
           select 1 from public.account_teams att
            where att.account_id = account_row.id
              and att.team_id = new.team_id
         ) then
        raise exception 'Команда не привязана к этому счёту';
      end if;
    end if;

    if new.client_id is not null and not exists (
      select 1 from public.clients
       where id = new.client_id and tenant_id = new.tenant_id
    ) then
      raise exception 'Клиент финансовой операции не найден';
    end if;
    if new.master_id is not null and new.team_id is not null and not exists (
      select 1
        from public.masters master
        join public.teams team
          on team.id = new.team_id and team.tenant_id = new.tenant_id
       where master.id = new.master_id
         and master.tenant_id = new.tenant_id
         and (
           master.team_id = new.team_id
           or team.lead_id = master.id
           or coalesce(team.lead_ids, '[]'::jsonb) ? master.id
           or coalesce(team.helper_ids, '[]'::jsonb) ? master.id
           or exists (
             select 1
               from jsonb_array_elements(
                 case
                   when jsonb_typeof(team.members) = 'array' then team.members
                   else '[]'::jsonb
                 end
               ) member
              where case jsonb_typeof(member)
                when 'string' then member #>> '{}'
                when 'object' then coalesce(member ->> 'master_id', member ->> 'id')
                else null
              end = master.id
           )
           -- Historical attribution remains valid if the master was moved to
           -- another team after this authoritative appointment was created.
           or (
             appointment_row.id is not null
             and appointment_row.team_id = new.team_id
             and appointment_row.master_id = master.id
           )
         )
    ) then
      raise exception 'Исполнитель не входит в команду финансовой операции';
    end if;

    if new.type = 'transfer' then
      if new.category_id is not null then
        raise exception 'Переводу между счетами категория не нужна';
      end if;
    elsif new.category_id is not null then
      expected_category_type := case
        when new.type in ('income', 'refund') then 'income'
        when new.type = 'expense' then 'expense'
      end;
      if not exists (
        select 1 from public.finance_categories category
         where category.id = new.category_id
           and (category.tenant_id is null or category.tenant_id = new.tenant_id) and (category.team_id is null or new.team_id is null or category.team_id = new.team_id)
           and category.type = expected_category_type
      ) then
        raise exception 'Категория не соответствует виду финансовой операции';
      end if;
    end if;
    if new.amount = 'NaN'::numeric then
      raise exception 'Сумма операции некорректна';
    end if;
    if new.type in ('income', 'expense') and new.amount <= 0 then
      raise exception 'Сумма операции должна быть больше нуля';
    end if;
    if new.type = 'refund' and new.amount >= 0 then
      raise exception 'Возврат должен уменьшать остаток счёта';
    end if;
    if new.type <> 'transfer' and new.transfer_group_id is not null then
      raise exception 'Группа перевода указана для обычной операции';
    end if;
    if tg_op = 'INSERT' and new.created_by is null then
      new.created_by := auth.uid();
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.assert_invoice_account(p_tenant_id uuid, p_account_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_account_id is null then
    return;
  end if;
  if not exists (
    select 1 from public.accounts
     where id = p_account_id
       and tenant_id = p_tenant_id
  ) then
    raise exception 'Счёт не найден или недоступен';
  end if;
  if not exists (
    select 1 from public.accounts
     where id = p_account_id
       and tenant_id = p_tenant_id
       and is_active
  ) then
    raise exception 'Счёт закрыт — на него нельзя ждать оплату';
  end if;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.assert_invoice_lines_mutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  target_invoice_id uuid;
  target_status text;
begin
  for target_invoice_id in
    select distinct invoice_id
      from (
        values (
          case when tg_op = 'INSERT' then null else old.invoice_id end
        ), (
          case when tg_op = 'DELETE' then null else new.invoice_id end
        )
      ) as targets(invoice_id)
     where invoice_id is not null
  loop
    select status into target_status
      from public.invoices
     where id = target_invoice_id
     for update;
    if not found then
      -- Parent deletion cascades its line deletion after the parent row is
      -- no longer visible. Any insert/update still fails closed.
      if tg_op = 'DELETE' then
        continue;
      end if;
      raise exception 'Инвойс для позиции не найден или недоступен';
    end if;
    if target_status <> 'issued' or exists (
      select 1 from public.finance_transactions
       where invoice_id = target_invoice_id and type in ('income', 'refund')
    ) or exists (
      select 1
        from public.finance_transactions refund
        join public.finance_transactions original on original.id = refund.refund_of_id
       where original.invoice_id = target_invoice_id and refund.type = 'refund'
    ) then
      raise exception 'Позиции инвойса с платежами нельзя изменять';
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.attach_invited_master_card(p_invitation invitations, p_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_master_id text;
  v_name text;
  v_phone text;
  v_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_stamp text := '';
begin
  if p_invitation.role is distinct from 'master'
     or p_invitation.master_id is not null
     or p_invitation.team_id is null
     or p_user_id is null then
    return p_invitation.master_id;
  end if;

  -- Имя и телефон, которые написал владелец в приглашении (15.09), сильнее
  -- того, что человек написал о себе при регистрации.
  select coalesce(
           nullif(btrim(p_invitation.full_name), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
           nullif(split_part(coalesce(u.email, ''), '@', 1), '')
         ),
         coalesce(
           nullif(btrim(p_invitation.phone), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'phone'), '')
         )
    into v_name, v_phone
    from auth.users u
   where u.id = p_user_id;

  select m.id
    into v_master_id
    from public.masters m
   where m.tenant_id = p_invitation.tenant_id
     and m.user_id = p_user_id
   for update;

  if v_master_id is null then
    -- Тот же вид номера, что у карточек из приложения: `generateId("master")`.
    while v_ms > 0 loop
      v_stamp := substr('0123456789abcdefghijklmnopqrstuvwxyz', (v_ms % 36)::int + 1, 1) || v_stamp;
      v_ms := v_ms / 36;
    end loop;
    v_master_id := 'master-' || v_stamp || '-' || substr(md5(gen_random_uuid()::text), 1, 5);

    -- Должность и цвет — из карточки, которую владелец заполнил до «Пригласить».
    insert into public.masters (
      id, tenant_id, full_name, phone, title, color, team_id, account_status, user_id, created_by
    ) values (
      v_master_id,
      p_invitation.tenant_id,
      coalesce(v_name, 'Мастер'),
      v_phone,
      nullif(btrim(p_invitation.master_title), ''),
      p_invitation.master_color,
      p_invitation.team_id,
      'active',
      p_user_id,
      p_invitation.invited_by_user_id
    );
  else
    -- Позвали снова: прежняя карточка берёт новое, но пустое в приглашении не
    -- стирает того, что уже было в карточке.
    update public.masters m
       set team_id = p_invitation.team_id,
           is_active = true,
           account_status = 'active',
           full_name = coalesce(nullif(btrim(p_invitation.full_name), ''), m.full_name),
           phone = coalesce(nullif(btrim(p_invitation.phone), ''), m.phone),
           title = coalesce(nullif(btrim(p_invitation.master_title), ''), m.title),
           color = coalesce(p_invitation.master_color, m.color)
     where m.tenant_id = p_invitation.tenant_id
       and m.id = v_master_id;
  end if;

  update public.tenant_members tm
     set master_id = v_master_id
   where tm.tenant_id = p_invitation.tenant_id
     and tm.user_id = p_user_id
     and tm.master_id is null;

  return v_master_id;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.build_invoice_client_snapshot(p_tenant_id uuid, p_client_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'schema_version', 1,
    'client_id', client.id,
    'full_name', nullif(btrim(client.full_name), ''),
    'legal_name', nullif(btrim(client.legal_name), ''),
    'vat_number', nullif(btrim(client.vat_number), ''),
    'reg_number', nullif(btrim(client.reg_number), ''),
    'billing_address', nullif(btrim(client.billing_address), ''),
    'phone', nullif(btrim(client.phone), ''),
    'phone_e164', nullif(btrim(client.phone_e164), ''),
    'whatsapp_phone', nullif(btrim(client.whatsapp_phone), ''),
    'email', nullif(btrim(client.email), ''),
    'address', nullif(btrim(client.address), ''),
    'city', nullif(btrim(client.city), ''),
    'primary_address', coalesce(
      location.address,
      nullif(
        concat_ws(
          ', ',
          nullif(btrim(client.address), ''),
          nullif(btrim(client.city), '')
        ),
        ''
      )
    ),
    'archived', client.deleted_at is not null,
    'deleted_at', client.deleted_at
  )
    from public.clients client
    left join lateral (
      select nullif(btrim(entry.value ->> 'address'), '') as address
        from jsonb_array_elements(
          case
            when jsonb_typeof(client.locations) = 'array' then client.locations
            else '[]'::jsonb
          end
        ) with ordinality as entry(value, position)
       where nullif(btrim(entry.value ->> 'address'), '') is not null
       order by
         case when lower(coalesce(entry.value ->> 'isPrimary', 'false')) = 'true'
           then 0 else 1
         end,
         entry.position
       limit 1
    ) location on true
   where client.id = p_client_id
     and client.tenant_id = p_tenant_id
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.build_invoice_client_snapshot_for(p_tenant_id uuid, p_client_id uuid, p_requisites_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  base jsonb;
  chosen jsonb;
begin
  base := public.build_invoice_client_snapshot(p_tenant_id, p_client_id);
  if base is null or nullif(btrim(p_requisites_id), '') is null then
    return base;
  end if;
  -- Без реквизитов — на имя: поля набора пустые, имя остаётся.
  if btrim(p_requisites_id) = 'none' then
    return base || jsonb_build_object(
      'legal_name', null,
      'vat_number', null,
      'reg_number', null,
      'billing_address', null
    );
  end if;
  select entry into chosen
    from public.clients client
   cross join lateral jsonb_array_elements(client.requisites) entry
   where client.id = p_client_id
     and client.tenant_id = p_tenant_id
     and entry ->> 'id' = btrim(p_requisites_id)
   limit 1;
  -- Набор не найден (удалён после выбора) — основной, то есть зеркало.
  if chosen is null then
    return base;
  end if;
  return base || jsonb_build_object(
    'legal_name', chosen -> 'legal_name',
    'vat_number', chosen -> 'vat_number',
    'reg_number', chosen -> 'reg_number',
    'billing_address', chosen -> 'billing_address'
  );
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.build_invoice_client_snapshot_with_object(p_tenant_id uuid, p_client_id uuid, p_location_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  base jsonb;
  object jsonb;
begin
  base := public.build_invoice_client_snapshot(p_tenant_id, p_client_id);
  if base is null then
    return null;
  end if;
  if p_location_id is null then
    return base || jsonb_build_object('object', null);
  end if;
  object := public.invoice_object_snapshot(p_tenant_id, p_client_id, p_location_id);
  if object is null then
    raise exception 'Объект не найден у клиента инвойса';
  end if;
  return base || jsonb_build_object('object', object);
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.build_invoice_seller_snapshot(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.build_seller_snapshot(
    p_tenant_id,
    public.resolve_company_id(p_tenant_id, null)
  )
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.build_seller_snapshot(p_tenant_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when company.id is null then
      jsonb_build_object(
        'schema_version', 1,
        'tenant_id', tenant.id,
        'company_id', null,
        'name', coalesce(nullif(btrim(tenant.legal_name), ''), nullif(btrim(tenant.name), '')),
        'display_name', nullif(btrim(tenant.name), ''),
        'legal_name', nullif(btrim(tenant.legal_name), ''),
        'vat_number', nullif(btrim(tenant.vat_number), ''),
        'reg_number', null,
        'business_address', nullif(btrim(tenant.business_address), ''),
        'address', coalesce(
          nullif(btrim(tenant.business_address), ''),
          nullif(concat_ws(', ', nullif(btrim(tenant.address), ''), nullif(btrim(tenant.city), '')), '')
        ),
        'city', nullif(btrim(tenant.city), ''),
        'country', nullif(btrim(tenant.country), ''),
        'contact_email', nullif(btrim(tenant.contact_email), ''),
        'contact_phone', nullif(btrim(tenant.contact_phone), ''),
        'iban', nullif(btrim(tenant.iban), ''),
        'bank_name', nullif(btrim(tenant.bank_name), ''),
        'logo_url', nullif(btrim(tenant.logo_url), ''),
        'currency', nullif(btrim(tenant.currency), ''),
        'vat_mode', tenant.vat_mode
      )
    else
      jsonb_build_object(
        'schema_version', 1,
        'tenant_id', tenant.id,
        'company_id', company.id,
        'name', coalesce(nullif(btrim(company.legal_name), ''), nullif(btrim(company.name), '')),
        'display_name', nullif(btrim(company.name), ''),
        'legal_name', nullif(btrim(company.legal_name), ''),
        'vat_number', nullif(btrim(company.vat_number), ''),
        'reg_number', nullif(btrim(company.reg_number), ''),
        'business_address', nullif(btrim(company.business_address), ''),
        'address', coalesce(
          nullif(btrim(company.business_address), ''),
          nullif(concat_ws(', ', nullif(btrim(tenant.address), ''), nullif(btrim(tenant.city), '')), '')
        ),
        'city', nullif(btrim(tenant.city), ''),
        'country', nullif(btrim(tenant.country), ''),
        'contact_email', coalesce(nullif(btrim(company.contact_email), ''), nullif(btrim(tenant.contact_email), '')),
        'contact_phone', coalesce(nullif(btrim(company.contact_phone), ''), nullif(btrim(tenant.contact_phone), '')),
        'iban', nullif(btrim(company.iban), ''),
        'bank_name', nullif(btrim(company.bank_name), ''),
        'logo_url', coalesce(nullif(btrim(company.logo_url), ''), nullif(btrim(tenant.logo_url), '')),
        'currency', nullif(btrim(tenant.currency), ''),
        'vat_mode', tenant.vat_mode
      )
  end
    from public.tenants tenant
    left join public.legal_entities company
      on company.id = p_company_id
     and company.tenant_id = tenant.id
   where tenant.id = p_tenant_id
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.bump_sms_balance(p_tenant_id uuid, p_amount_cents integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_balance integer;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    return json_build_object('error', 'amount_must_be_positive');
  end if;
  v_balance := public.sms_ledger_post(p_tenant_id, 'adjust', p_amount_cents, null, 'Ручное зачисление');
  return json_build_object('balance_cents', v_balance);
end;
$function$
;
grant execute on function public.bump_sms_balance(p_tenant_id uuid, p_amount_cents integer) to service_role;

CREATE OR REPLACE FUNCTION public.cabinet_tariff_payments(p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant uuid := public.current_tenant_id();
  result jsonb;
begin
  if auth.uid() is null or active_tenant is null
     or not (public.current_user_role() = 'owner' or public.access_company('cabinet.tariff_payments', 'read')) then
    raise exception 'Оплаты тарифа открывает владелец аккаунта'
      using errcode = '42501', hint = 'access:not_owner';
  end if;

  select coalesce(jsonb_agg(row_json order by processed_at desc), '[]'::jsonb)
    into result
    from (
      select e.processed_at,
             jsonb_build_object(
               'id', e.id,
               'event_type', e.event_type,
               'processed_at', e.processed_at,
               'payload', jsonb_build_object(
                 'created', e.payload -> 'created',
                 'data', jsonb_build_object(
                   'object', jsonb_build_object(
                     'id', inv -> 'id',
                     'amount_due', inv -> 'amount_due',
                     'amount_paid', inv -> 'amount_paid',
                     'total', inv -> 'total',
                     'currency', inv -> 'currency',
                     'created', inv -> 'created',
                     'status_transitions', jsonb_build_object('paid_at', inv -> 'status_transitions' -> 'paid_at'),
                     'hosted_invoice_url', inv -> 'hosted_invoice_url',
                     'invoice_pdf', inv -> 'invoice_pdf',
                     'subscription_details', jsonb_build_object('metadata', inv -> 'subscription_details' -> 'metadata'),
                     'parent', jsonb_build_object(
                       'subscription_details', jsonb_build_object(
                         'metadata', inv -> 'parent' -> 'subscription_details' -> 'metadata'
                       )
                     ),
                     'lines', jsonb_build_object(
                       'data', coalesce((
                         select jsonb_agg(jsonb_build_object(
                                  'amount', l -> 'amount',
                                  'description', l -> 'description',
                                  'period', l -> 'period',
                                  'metadata', l -> 'metadata',
                                  'price', jsonb_build_object(
                                    'metadata', l -> 'price' -> 'metadata',
                                    'lookup_key', l -> 'price' -> 'lookup_key',
                                    'nickname', l -> 'price' -> 'nickname'
                                  )
                                ))
                           from jsonb_array_elements(
                             case when jsonb_typeof(inv -> 'lines' -> 'data') = 'array'
                                  then inv -> 'lines' -> 'data' else '[]'::jsonb end
                           ) l
                       ), '[]'::jsonb)
                     )
                   )
                 )
               )
             ) as row_json
        from public.billing_events e
        cross join lateral (select e.payload -> 'data' -> 'object' as inv) x
       where e.tenant_id = active_tenant
         and e.event_type in ('invoice.payment_succeeded', 'invoice.payment_failed')
       order by e.processed_at desc
       limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) rows;

  return result;
end;
$function$
;
grant execute on function public.cabinet_tariff_payments(p_limit integer) to authenticated;

CREATE OR REPLACE FUNCTION public.calendar_delete_in_progress()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public._calendar_delete_context
     where transaction_id = txid_current()
  );
$function$
;
grant execute on function public.calendar_delete_in_progress() to anon;
grant execute on function public.calendar_delete_in_progress() to authenticated;
grant execute on function public.calendar_delete_in_progress() to service_role;

CREATE OR REPLACE FUNCTION public.cancel_appointment_payment(p_appointment_id uuid, p_payment_id text, p_request_id uuid)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  appt public.appointments%rowtype;
  result_row public.appointments%rowtype;
  income public.finance_transactions%rowtype;
  entry jsonb;
  entry_kind text;
  entry_amount numeric(12,2);
  entry_account uuid;
  refund_category_id uuid;
  business_today date;
  remaining_payments jsonb;
  remaining_prepayments jsonb;
  new_paid numeric(12,2);
  new_prepaid numeric(12,2);
  received numeric(12,2);
  new_payment_status text;
  last_entry jsonb;
  candidates integer := 0;
  -- 04.10: остаток дохода после частичного возврата клиенту.
  income_left numeric(12,2);
begin
  -- Пропуск сторожа колонок записи (03.10): право на деньги проверяет
  -- сама дверь ниже, а сторож пускает партнёра только с этим флагом.
  perform set_config('babun.member_write', 'on', true);
  if auth.uid() is null or tenant_uuid is null then
    raise exception 'Войдите в приложение, чтобы снять оплату';
  end if;
  if p_request_id is null then
    raise exception 'Не указан идентификатор операции';
  end if;
  if p_payment_id is null or btrim(p_payment_id) = '' then
    raise exception 'Не указан платёж';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_appointment_id::text, 0));
  select * into appt
    from public.appointments
   where id = p_appointment_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Заявка не найдена';
  end if;
  if not public.current_user_can_pay_appointment(appt.team_id, appt.master_id) then
    raise exception 'Снять оплату по этой заявке может владелец, диспетчер или её команда';
  end if;

  if exists (
    select 1 from public.finance_transactions
     where id = p_request_id and tenant_id = tenant_uuid
  ) then
    return appt;
  end if;
  if appt.status = 'cancelled' or appt.payment_status = 'refunded' then
    raise exception 'Оплата по заявке уже закрыта возвратом';
  end if;

  select e.elem into entry
    from jsonb_array_elements(coalesce(appt.payments, '[]'::jsonb)) as e(elem)
   where e.elem ->> 'id' = p_payment_id;
  if found then
    entry_kind := 'settlement';
  else
    select e.elem into entry
      from jsonb_array_elements(coalesce(appt.prepayments, '[]'::jsonb)) as e(elem)
     where e.elem ->> 'id' = p_payment_id;
    if not found then
      raise exception 'Платёж не найден в заявке';
    end if;
    entry_kind := 'prepayment';
  end if;
  entry_amount := round((entry ->> 'amount')::numeric, 2);
  entry_account := nullif(entry ->> 'account_id', '')::uuid;
  if entry_amount is null or entry_amount <= 0 then
    raise exception 'Сумма платежа некорректна';
  end if;

  select * into income
    from public.finance_transactions
   where appointment_id = appt.id
     and tenant_id = tenant_uuid
     and source = 'auto'
     and type = 'income'
     and appointment_payment_id = p_payment_id
   for update;
  if not found then
    select count(*) into candidates
      from public.finance_transactions f
     where f.appointment_id = appt.id
       and f.tenant_id = tenant_uuid
       and f.source = 'auto'
       and f.type = 'income'
       and f.appointment_payment_id is null
       and coalesce(f.appointment_payment_kind, 'settlement') = entry_kind
       and round(f.amount, 2) = entry_amount
       and (entry_account is null or f.account_id = entry_account)
       and not exists (
         select 1 from public.finance_transactions r
          where r.refund_of_id = f.id and r.type = 'refund'
       );
    if candidates <> 1 then
      raise exception 'Проводка этого платежа не определена однозначно; снимите оплату целиком через «Отменить оплату»';
    end if;
    select * into income
      from public.finance_transactions f
     where f.appointment_id = appt.id
       and f.tenant_id = tenant_uuid
       and f.source = 'auto'
       and f.type = 'income'
       and f.appointment_payment_id is null
       and coalesce(f.appointment_payment_kind, 'settlement') = entry_kind
       and round(f.amount, 2) = entry_amount
       and (entry_account is null or f.account_id = entry_account)
       and not exists (
         select 1 from public.finance_transactions r
          where r.refund_of_id = f.id and r.type = 'refund'
       )
     for update;
  end if;
  -- 04.10: частичный возврат клиенту не запирает платёж — сторно идёт на
  -- остаток дохода. Раньше «По этому платежу уже есть возврат».
  select round(income.amount, 2) - coalesce(sum(round(abs(r.amount), 2)), 0)
    into income_left
    from public.finance_transactions r
   where r.refund_of_id = income.id and r.type = 'refund';
  if income_left <= 0 then
    raise exception 'По этому платежу уже всё возвращено';
  end if;
  if income.invoice_id is not null then
    raise exception 'Платёж связан с инвойсом — снимайте его на странице инвойса';
  end if;
  if not exists (
    select 1 from public.accounts a where a.id = income.account_id and a.is_active
  ) then
    raise exception 'Счёт платежа закрыт; снова откройте его, чтобы снять оплату';
  end if;

  select id into refund_category_id
    from public.finance_categories
   where slug = 'refund'
     and type = 'income'
     and (tenant_id is null or tenant_id = tenant_uuid)
   order by tenant_id nulls last
   limit 1;
  business_today := public.tenant_business_date(tenant_uuid);

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (txid_current(), 'appointment_auto', appt.id, tenant_uuid)
  on conflict do nothing;
  insert into public.finance_transactions (
    id, tenant_id, type, amount, currency, category_id, account_id,
    appointment_id, client_id, team_id, master_id, payment_method,
    occurred_on, source, refund_of_id, invoice_id, appointment_payment_kind,
    appointment_payment_id, reversal_kind, notes
  ) values (
    p_request_id, tenant_uuid, 'refund', -least(income_left, entry_amount), income.currency,
    refund_category_id, income.account_id,
    appt.id, income.client_id, income.team_id, income.master_id, income.payment_method,
    business_today, 'auto', income.id, null,
    coalesce(income.appointment_payment_kind, 'settlement'),
    p_payment_id, 'not_received', 'Оплата снята: деньги не поступили'
  );
  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'appointment_auto'
     and entity_id = appt.id;

  if entry_kind = 'settlement' then
    select coalesce(jsonb_agg(e.elem order by e.ord), '[]'::jsonb)
      into remaining_payments
      from jsonb_array_elements(coalesce(appt.payments, '[]'::jsonb))
        with ordinality as e(elem, ord)
     where e.elem ->> 'id' <> p_payment_id;
    remaining_prepayments := coalesce(appt.prepayments, '[]'::jsonb);
    new_prepaid := round(coalesce(appt.prepaid_amount, 0), 2);
  else
    remaining_payments := coalesce(appt.payments, '[]'::jsonb);
    select coalesce(jsonb_agg(e.elem order by e.ord), '[]'::jsonb)
      into remaining_prepayments
      from jsonb_array_elements(coalesce(appt.prepayments, '[]'::jsonb))
        with ordinality as e(elem, ord)
     where e.elem ->> 'id' <> p_payment_id;
    new_prepaid := greatest(round(coalesce(appt.prepaid_amount, 0) - entry_amount, 2), 0);
  end if;
  select coalesce(sum(round((e.elem ->> 'amount')::numeric, 2)), 0)
    into new_paid
    from jsonb_array_elements(remaining_payments) as e(elem);
  received := new_prepaid + new_paid;
  new_payment_status := case
    when appt.total_amount > 0 and received >= appt.total_amount then 'paid'
    when new_paid > 0 then 'partial'
    else 'unpaid'
  end;
  select e.elem into last_entry
    from jsonb_array_elements(remaining_payments) with ordinality as e(elem, ord)
   order by e.ord desc
   limit 1;
  if last_entry is null then
    select e.elem into last_entry
      from jsonb_array_elements(remaining_prepayments) with ordinality as e(elem, ord)
     order by e.ord desc
     limit 1;
  end if;

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (txid_current(), 'appointment_payment_cancel', appt.id, tenant_uuid)
  on conflict do nothing;
  update public.appointments
     set payments = remaining_payments,
         prepayments = remaining_prepayments,
         payment = public.appointment_payment_mirror(remaining_payments),
         paid_amount = new_paid,
         prepaid_amount = new_prepaid,
         payment_status = new_payment_status,
         payment_method = case
           when last_entry is null then null
           else last_entry ->> 'method'
         end,
         payment_account_id = case
           when last_entry is null then null
           else nullif(last_entry ->> 'account_id', '')::uuid
         end
   where id = appt.id and tenant_id = tenant_uuid
   returning * into result_row;
  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'appointment_payment_cancel'
     and entity_id = appt.id;
  return result_row;
end;
$function$
;
grant execute on function public.cancel_appointment_payment(p_appointment_id uuid, p_payment_id text, p_request_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.cancel_invoice(p_invoice_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  original public.invoices%rowtype;
  note_row public.invoices%rowtype;
  note_id uuid;
  income_total numeric := 0;
  direct_refunds numeric := 0;
  linked_refunds numeric := 0;
begin
  if tenant_uuid is null or not public._documents_write_invoice(p_invoice_id) then
    raise exception 'Нужно право «Документы: Выставляет» в команде документа';
  end if;

  select * into original
    from public.invoices
   where id = p_invoice_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Инвойс не найден';
  end if;
  if original.kind <> 'invoice' then
    raise exception 'Кредит-нота не отменяется — она сама является сторно';
  end if;
  if original.status = 'cancelled' then
    -- Идемпотентность: повтор возвращает уже созданную ноту.
    select * into note_row from public.invoices
     where credit_note_of_id = original.id and tenant_id = tenant_uuid
     limit 1;
    if found then return note_row; end if;
  end if;
  if original.status = 'void' then
    raise exception 'Аннулированный инвойс уже не действует — отменять нечего';
  end if;

  -- Оплаченный документ сторнируется только вместе с возвратом денег:
  -- иначе бумага говорит «отменено», а деньги лежат в кассе. Возвраты
  -- вычитаются — и прямые, и старые, привязанные к доходу одной `refund_of_id`.
  select
    coalesce(sum(case when type = 'income' then greatest(amount, 0) else 0 end), 0),
    coalesce(sum(case when type = 'refund' then abs(amount) else 0 end), 0)
    into income_total, direct_refunds
    from public.finance_transactions
   where invoice_id = original.id
     and type in ('income', 'refund');
  select coalesce(sum(abs(refund.amount)), 0)
    into linked_refunds
    from public.finance_transactions refund
    join public.finance_transactions income on income.id = refund.refund_of_id
   where income.invoice_id = original.id
     and income.type = 'income'
     and refund.type = 'refund'
     and refund.invoice_id is null;
  if income_total - direct_refunds - linked_refunds > 0 then
    raise exception 'По инвойсу уже прошла оплата — сначала оформите возврат';
  end if;

  note_id := public._issue_credit_note(original.id, p_reason);

  update public.invoices
     set status = 'cancelled', updated_at = now()
   where id = original.id;

  select * into note_row
    from public.invoices
   where id = note_id;
  return note_row;
end;
$function$
;
grant execute on function public.cancel_invoice(p_invoice_id uuid, p_reason text) to authenticated;

CREATE OR REPLACE FUNCTION public.capture_invoice_document_snapshots()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  document_changed boolean := false;
  refresh_requested boolean := false;
  has_ledger boolean := false;
  source_invoice public.invoices%rowtype;
  source_receipt public.receipts%rowtype;
begin
  if tg_op = 'INSERT' then
    perform public.assert_invoice_account(new.tenant_id, new.account_id);

    -- Кредит-нота к ЧЕКУ (возврат, 04.10): стороны и реквизиты — его.
    if new.kind = 'credit_note' and new.credit_note_of_receipt_id is not null then
      select * into source_receipt
        from public.receipts receipt
       where receipt.id = new.credit_note_of_receipt_id
         and receipt.tenant_id = new.tenant_id;
      if not found then
        raise exception 'Кредит-нота должна ссылаться на чек этой компании';
      end if;
      if new.client_id is distinct from source_receipt.client_id then
        raise exception 'Клиент кредит-ноты не совпадает с клиентом чека';
      end if;
      new.seller_snapshot := source_receipt.seller_snapshot;
      new.client_snapshot := source_receipt.client_snapshot;
      new.company_id := source_receipt.company_id;
      return new;
    end if;

    if new.kind = 'credit_note' then
      select * into source_invoice
        from public.invoices invoice
       where invoice.id = new.credit_note_of_id
         and invoice.tenant_id = new.tenant_id
         and invoice.kind = 'invoice';
      if not found then
        raise exception 'Кредит-нота должна ссылаться на инвойс этой компании';
      end if;
      if new.client_id is distinct from source_invoice.client_id then
        raise exception 'Клиент кредит-ноты не совпадает с клиентом инвойса';
      end if;
      new.seller_snapshot := source_invoice.seller_snapshot;
      new.client_snapshot := source_invoice.client_snapshot;
      new.company_id := source_invoice.company_id;
      return new;
    end if;

    new.company_id := public.resolve_company_id(new.tenant_id, new.company_id);
    new.seller_snapshot := public.build_seller_snapshot(new.tenant_id, new.company_id);
    if new.seller_snapshot is null then
      raise exception 'Компания для инвойса не найдена';
    end if;
    new.client_snapshot := case
      when new.client_id is null then null
      else (public.build_invoice_client_snapshot_with_object(new.tenant_id, new.client_id, new.location_id) || public.build_invoice_client_snapshot_for(new.tenant_id, new.client_id, new.client_requisites_id))
    end;
    if new.client_id is not null and new.client_snapshot is null then
      raise exception 'Клиент для инвойса не найден в этой компании';
    end if;
    return new;
  end if;

  if not exists (
    select 1 from public.tenants tenant where tenant.id = old.tenant_id
  ) then
    new.seller_snapshot := old.seller_snapshot;
    new.client_snapshot := old.client_snapshot;
    return new;
  end if;

  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id then
    raise exception 'Компания и идентификатор инвойса неизменяемы';
  end if;

  document_changed := row(
    new.number, new.year, new.seq, new.issued_on, new.due_on, new.client_id,
    new.appointment_id, new.brigade_id, new.company_id, new.account_id, new.location_id, new.client_requisites_id,
    new.subtotal_net, new.vat_percent, new.vat_amount, new.total, new.currency,
    new.notes, new.created_at, new.created_by
  ) is distinct from row(
    old.number, old.year, old.seq, old.issued_on, old.due_on, old.client_id,
    old.appointment_id, old.brigade_id, old.company_id, old.account_id, old.location_id, old.client_requisites_id,
    old.subtotal_net, old.vat_percent, old.vat_amount, old.total, old.currency,
    old.notes, old.created_at, old.created_by
  );
  refresh_requested := document_changed
    or new.seller_snapshot is distinct from old.seller_snapshot
    or new.client_snapshot is distinct from old.client_snapshot;

  if not refresh_requested then
    new.seller_snapshot := old.seller_snapshot;
    new.client_snapshot := old.client_snapshot;
    return new;
  end if;

  if old.kind = 'credit_note' then
    -- Строки ноты (04.10) задевают снимок через триггер строк — стороны
    -- остаются прежними; менять реквизиты самой ноты по-прежнему нельзя.
    if document_changed then
      raise exception 'Стороны кредит-ноты не обновляются — это стороны её инвойса';
    end if;
    new.seller_snapshot := old.seller_snapshot;
    new.client_snapshot := old.client_snapshot;
    return new;
  end if;

  select exists (
    select 1 from public.finance_transactions tx
     where tx.tenant_id = old.tenant_id and tx.invoice_id = old.id
       and tx.type in ('income', 'refund')
  ) or exists (
    select 1 from public.finance_transactions refund
      join public.finance_transactions original on original.id = refund.refund_of_id
     where original.tenant_id = old.tenant_id and original.invoice_id = old.id
       and original.type = 'income' and refund.tenant_id = old.tenant_id
       and refund.type = 'refund'
  ) into has_ledger;

  if old.status <> 'issued' or has_ledger then
    raise exception 'Снимки сторон инвойса неизменяемы после первого платежа';
  end if;

  new.company_id := public.resolve_company_id(new.tenant_id, new.company_id);
  new.seller_snapshot := public.build_seller_snapshot(new.tenant_id, new.company_id);
  if new.seller_snapshot is null then
    raise exception 'Компания для инвойса не найдена';
  end if;
  perform public.assert_invoice_account(new.tenant_id, new.account_id);
  new.client_snapshot := case
    when new.client_id is null then null
    else (public.build_invoice_client_snapshot_with_object(new.tenant_id, new.client_id, new.location_id) || public.build_invoice_client_snapshot_for(new.tenant_id, new.client_id, new.client_requisites_id))
  end;
  if new.client_id is not null and new.client_snapshot is null then
    raise exception 'Клиент для инвойса не найден в этой компании';
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.change_log_array_diff(p_old jsonb, p_new jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  with o as (
    select e from jsonb_array_elements(case when jsonb_typeof(p_old) = 'array' then p_old else '[]'::jsonb end) e
  ),
  n as (
    select e from jsonb_array_elements(case when jsonb_typeof(p_new) = 'array' then p_new else '[]'::jsonb end) e
  ),
  added as (
    select public.change_log_item_label(n.e) as l from n where not exists (select 1 from o where o.e = n.e)
  ),
  removed as (
    select public.change_log_item_label(o.e) as l from o where not exists (select 1 from n where n.e = o.e)
  ),
  a as (select jsonb_agg(left(l, 80)) as v from (select l from added where l is not null limit 5) x),
  r as (select jsonb_agg(left(l, 80)) as v from (select l from removed where l is not null limit 5) y)
  select case
    when (select v from a) is null and (select v from r) is null then null
    else jsonb_strip_nulls(jsonb_build_object('+', (select v from a), '-', (select v from r)))
  end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.change_log_item_label(p_item jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case jsonb_typeof(p_item)
    when 'string' then nullif(btrim(p_item #>> '{}'), '')
    when 'number' then p_item #>> '{}'
    when 'object' then coalesce(
      nullif(btrim(p_item ->> 'text'), ''),
      nullif(btrim(p_item ->> 'serviceName'), ''),
      nullif(btrim(p_item ->> 'name'), ''),
      nullif(btrim(p_item ->> 'label'), ''),
      nullif(btrim(p_item ->> 'title'), ''),
      nullif(btrim(p_item ->> 'address'), ''),
      nullif(btrim(p_item ->> 'number'), ''),
      nullif(btrim(p_item ->> 'phone'), ''),
      p_item ->> 'amount'
    )
    else null
  end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.change_log_person_name(p_tenant uuid, p_user uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
           nullif(btrim(m.full_name), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
           split_part(u.email, '@', 1)
         )
    from auth.users u
    left join public.tenant_members tm on tm.tenant_id = p_tenant and tm.user_id = u.id
    left join public.masters m on m.tenant_id = p_tenant and m.id = tm.master_id
   where u.id = p_user
   limit 1;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.check_max_photos()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  perform 1 from public.appointments
    where id = new.appointment_id
    for update;
  if (
    select count(*) from public.appointment_photos
    where appointment_id = new.appointment_id
  ) >= 20 then
    raise exception 'В записи не больше 20 файлов'
      using errcode = '23514';
  end if;
  return new;
end $function$
;
grant execute on function public.check_max_photos() to anon;
grant execute on function public.check_max_photos() to authenticated;
grant execute on function public.check_max_photos() to service_role;

CREATE OR REPLACE FUNCTION public.choose_working_teams(p_team_ids text[])
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_limit integer;
  v_ids text[] := coalesce(p_team_ids, array[]::text[]);
begin
  if auth.uid() is null or v_tenant is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'Рабочие команды выбирает владелец аккаунта'
      using errcode = '42501', hint = 'plan:owner';
  end if;
  v_limit := public.tenant_tier_limit(v_tenant, 'teams');
  if cardinality(v_ids) = 0 or cardinality(v_ids) > v_limit then
    raise exception 'Выберите от 1 до % команд', v_limit
      using errcode = '22023', hint = 'plan:teams';
  end if;
  if exists (
    select 1
      from unnest(v_ids) as chosen(id)
     where not exists (
       select 1
         from public.teams tm
        where tm.tenant_id = v_tenant
          and tm.id = chosen.id
          and tm.is_active
     )
  ) then
    raise exception 'Команда не найдена' using errcode = '23503';
  end if;
  perform set_config('babun.billing_write', 'on', true);
  update public.tenants set working_team_ids = v_ids where id = v_tenant;
  perform set_config('babun.billing_write', 'off', true);
  return v_ids;
end;
$function$
;
grant execute on function public.choose_working_teams(p_team_ids text[]) to authenticated;

CREATE OR REPLACE FUNCTION public.claim_account_deletion_cleanup(p_limit integer DEFAULT 20)
 RETURNS TABLE(user_id uuid, status text, deleted_tenant_count integer, attempt_count integer, lease_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required for account cleanup claims'
      using errcode = '42501';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'cleanup claim limit must be between 1 and 50'
      using errcode = '22023';
  end if;

  return query
  with candidates as materialized (
    select cleanup.user_id
      from public.account_deletion_cleanup cleanup
     where cleanup.status in (
       'requested',
       'soft_delete_failed',
       'soft_deleted',
       'tenant_cleanup_failed',
       'tenant_data_deleted',
       'pending_auth_delete'
     )
       and cleanup.next_retry_at <= now()
       and cleanup.updated_at <= now() - interval '5 minutes'
       and (
         cleanup.lease_token is null
         or cleanup.lease_expires_at is null
         or cleanup.lease_expires_at <= now()
       )
     order by cleanup.next_retry_at, cleanup.updated_at, cleanup.user_id
     for update skip locked
     limit p_limit
  ), claimed as (
    update public.account_deletion_cleanup cleanup
       set lease_token = gen_random_uuid(),
           lease_expires_at = now() + interval '5 minutes',
           attempt_count = cleanup.attempt_count + 1,
           updated_at = now()
      from candidates
     where cleanup.user_id = candidates.user_id
    returning cleanup.user_id,
              cleanup.status,
              cleanup.deleted_tenant_count,
              cleanup.attempt_count,
              cleanup.lease_token
  )
  select claimed.user_id,
         claimed.status,
         claimed.deleted_tenant_count,
         claimed.attempt_count,
         claimed.lease_token
    from claimed;
end;
$function$
;
grant execute on function public.claim_account_deletion_cleanup(p_limit integer) to service_role;

CREATE OR REPLACE FUNCTION public.claim_invitation_email(p_invitation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant uuid := public.current_tenant_id();
  v_invitation public.invitations%rowtype;
  v_account text;
  v_inviter text;
  v_teams text[];
  v_sent_last_hour integer;
begin
  if auth.uid() is null
     or active_tenant is null
     or not (
       public.current_user_role() = 'owner'
       or public.access_company('company.partners', 'write')
     ) then
    raise exception 'письмо приглашения отправляет владелец или директор'
      using errcode = '42501', hint = 'invite_email:not_owner';
  end if;

  select * into v_invitation
    from public.invitations i
   where i.id = p_invitation_id
     and i.tenant_id = active_tenant
   for update;

  if not found then
    raise exception 'приглашение не найдено'
      using errcode = 'P0002', hint = 'invite_email:not_found';
  end if;

  if v_invitation.accepted_at is not null or v_invitation.expires_at <= now() then
    raise exception 'приглашение уже принято или истекло'
      using errcode = '55000', hint = 'invite_email:closed';
  end if;

  select coalesce(array_agg(t.name order by x.ord), array[]::text[])
    into v_teams
    from unnest(
           coalesce(v_invitation.team_ids, array[v_invitation.team_id])
         ) with ordinality as x(team_id, ord)
    join public.teams t
      on t.tenant_id = active_tenant
     and t.id = x.team_id
     and t.is_active;

  if v_invitation.team_id is not null and cardinality(v_teams) = 0 then
    raise exception 'команды приглашения в архиве'
      using errcode = '55000', hint = 'invite_email:calendar_archived';
  end if;

  if v_invitation.email_sent_at is not null
     and v_invitation.email_sent_at > now() - interval '60 seconds' then
    raise exception 'письмо уже отправлено, повторить можно через минуту'
      using errcode = '55000', hint = 'invite_email:too_soon';
  end if;

  select count(*) into v_sent_last_hour
    from public.invitations i
   where i.tenant_id = active_tenant
     and i.email_sent_at > now() - interval '1 hour';

  if v_sent_last_hour >= 30 then
    raise exception 'слишком много писем за час'
      using errcode = '55000', hint = 'invite_email:tenant_limit';
  end if;

  update public.invitations
     set email_sent_at = now()
   where id = v_invitation.id
  returning email_sent_at into v_invitation.email_sent_at;

  select t.name into v_account from public.tenants t where t.id = active_tenant;

  -- Зовёт тот, кто нажал: директор от своего имени, а не от владельца.
  select coalesce(
           nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
           split_part(u.email, '@', 1)
         )
    into v_inviter
    from auth.users u
   where u.id = auth.uid();

  return jsonb_build_object(
    'email', v_invitation.email,
    'token', v_invitation.token,
    'account', v_account,
    'inviter', v_inviter,
    'teams', to_jsonb(v_teams),
    'expires_at', v_invitation.expires_at,
    'claimed_at', v_invitation.email_sent_at
  );
end;
$function$
;
grant execute on function public.claim_invitation_email(p_invitation_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.clear_gone_membership_places()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.clients member
     set memberships = coalesce((
           select jsonb_agg(
                    case
                      when m.value ->> 'group_id' = new.id::text
                       and not exists (
                         select 1
                           from jsonb_array_elements(
                             case when jsonb_typeof(new.locations) = 'array'
                                  then new.locations else '[]'::jsonb end
                           ) l
                          where l.value ->> 'id' = m.value ->> 'location_id'
                       )
                      then m.value - 'location_id'
                      else m.value
                    end order by m.pos)
             from jsonb_array_elements(member.memberships) with ordinality as m(value, pos)
         ), '[]'::jsonb)
   where member.tenant_id = new.tenant_id
     and member.memberships @> jsonb_build_array(jsonb_build_object('group_id', new.id::text))
     -- Правим ровно тех, у кого место И СТОИТ, И ПРОПАЛО: иначе каждая правка
     -- объектов карточки переписывала бы связи всех её людей впустую.
     and exists (
       select 1
         from jsonb_array_elements(member.memberships) m
        where m.value ->> 'group_id' = new.id::text
          and m.value ? 'location_id'
          and not exists (
            select 1
              from jsonb_array_elements(
                case when jsonb_typeof(new.locations) = 'array'
                     then new.locations else '[]'::jsonb end
              ) l
             where l.value ->> 'id' = m.value ->> 'location_id'
          )
     );
  return null;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.client_contacts_of(p_client jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'phone', coalesce(p_client -> 'phone', to_jsonb(''::text)),
    'whatsapp_phone', coalesce(p_client -> 'whatsapp_phone', to_jsonb(''::text)),
    'email', coalesce(p_client -> 'email', to_jsonb(''::text)),
    'telegram_username', coalesce(p_client -> 'telegram_username', to_jsonb(''::text)),
    'instagram_username', coalesce(p_client -> 'instagram_username', to_jsonb(''::text)),
    'phones', coalesce(p_client -> 'phones', '[]'::jsonb),
    'phone_e164', coalesce(p_client -> 'phone_e164', 'null'::jsonb),
    'memberships', coalesce(p_client -> 'memberships', '[]'::jsonb)
  )
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.client_history_never_purges()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Та же история, что у `guard_client_hard_delete_history` и
  -- `purge_expired_clients`: записи, инвойсы, деньги. Читается мимо RLS
  -- того, кто удаляет, — партнёр видит не все записи клиента.
  if new.purge_at is not null
     and (
       exists (select 1 from public.appointments a where a.client_id = new.id)
       or exists (select 1 from public.invoices i where i.client_id = new.id)
       or exists (select 1 from public.finance_transactions f where f.client_id = new.id)
     ) then
    new.purge_at := null;
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.client_masked_for_member(p_client jsonb, p_blocks jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  with b as (
    select coalesce(p_blocks, '{}'::jsonb) as v
  )
  -- 03.10: блок «Клиент» с «Видит» — номер и мессенджеры целиком; «Скрыт» —
  -- без контактов (точек и двери больше нет).
  select case
           when coalesce(b.v ->> 'clients.client', 'off') = 'off'
             then public.client_without_contacts(p_client)
                  -- 03.10: фото — тоже блок «Клиент»; имя для SMS остаётся,
                  -- только когда открыт блок «SMS» (он его показывает и правит).
                  || jsonb_build_object('avatar_url', null)
                  || case when coalesce(b.v ->> 'clients.sms', 'off') = 'off'
                       then jsonb_build_object('sms_name', '') else '{}'::jsonb end
           else p_client
         end
    || case when coalesce(b.v ->> 'clients.note', 'off') = 'off'
         then jsonb_build_object('comment', '', 'notes', '[]'::jsonb) else '{}'::jsonb end
    -- Связи — блок «Люди»: закрыт — связей нет, открыт — связи строки.
    || case when coalesce(b.v ->> 'clients.people', 'off') = 'off'
         then jsonb_build_object('memberships', '[]'::jsonb)
         else jsonb_build_object('memberships', coalesce(p_client -> 'memberships', '[]'::jsonb)) end
    || case when coalesce(b.v ->> 'clients.objects', 'off') = 'off'
         then jsonb_build_object('locations', '[]'::jsonb, 'equipment', '[]'::jsonb,
                                 'address', '', 'property_type', '')
         else '{}'::jsonb end
    || case when coalesce(b.v ->> 'clients.labels', 'off') = 'off'
         then jsonb_build_object('city', '', 'city_manual', false)
         else '{}'::jsonb end
    -- 03.10: тег — своё право «Тег» (`clients.tags`), метка — «Метка».
    || case when coalesce(b.v ->> 'clients.tags', 'off') = 'off'
         then jsonb_build_object('tag_ids', '[]'::jsonb)
         else '{}'::jsonb end
    || case when coalesce(b.v ->> 'clients.personal', 'off') = 'off'
         then jsonb_build_object('birthday', '', 'language', null, 'acquisition_source', 'unknown',
                                 'referred_by_client_id', null, 'first_contact_date', null)
         else '{}'::jsonb end
    || case when coalesce(b.v ->> 'clients.requisites', 'off') = 'off'
         then jsonb_build_object('legal_name', null, 'vat_number', null, 'reg_number', null,
                                 'billing_address', null, 'requisites', '[]'::jsonb)
         else '{}'::jsonb end
    -- 03.10: «Долг и деньги» ушли в «Историю»: видит историю — видит деньги.
    || case when coalesce(b.v ->> 'clients.history', 'off') = 'off'
         then jsonb_build_object('balance', 0, 'discount', 0)
         else '{}'::jsonb end
    || jsonb_build_object('blocks', b.v)
  from b
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.client_seen_by_caller(p_client jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when public.current_user_role() = 'owner' then p_client
    else public.client_masked_for_member(
      p_client,
      (select b.blocks from public.access_client_blocks() b
        where b.client_id = (p_client ->> 'id')::uuid)
    )
  end
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.client_without_contacts(p_client jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select p_client || jsonb_build_object(
    'phone', '',
    'whatsapp_phone', '',
    'email', '',
    'telegram_username', '',
    'instagram_username', '',
    'phones', '[]'::jsonb,
    'phone_e164', null,
    'memberships', '[]'::jsonb
  )
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.client_without_money(p_client jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select p_client || jsonb_build_object(
    'balance', 0,
    'discount', 0,
    'legal_name', null,
    'vat_number', null,
    'reg_number', null,
    'billing_address', null,
    'requisites', '[]'::jsonb
  )
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.clients_member_legal_name_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() is distinct from 'master' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.legal_name := null;
  elsif new.legal_name is distinct from old.legal_name
        -- 03.10: «Реквизиты» с «Видит и меняет» правят и юрлицо основного
        -- набора — приложение шлёт его вместе с `requisites`.
        and (old.id = any(public.access_block_client_ids('clients.requisites', 'write'))) is not true then
    raise exception 'access:field:legal_name' using errcode = '42501';
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.companies_blocking_account_delete(p_user uuid DEFAULT NULL::uuid)
 RETURNS TABLE(tenant_id uuid, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select t.id, t.name
    from public.tenants t
    join public.tenant_members own
      on own.tenant_id = t.id and own.role = 'owner'
   where own.user_id = case
           when auth.role() = 'service_role' then coalesce(p_user, auth.uid())
           else auth.uid()
         end
     and t.kind = 'company'
     and not exists (
       select 1 from public.tenant_members o2
        where o2.tenant_id = t.id and o2.role = 'owner' and o2.user_id <> own.user_id
     )
     and exists (
       select 1 from public.tenant_members m
        where m.tenant_id = t.id and m.user_id <> own.user_id
     )
   order by t.name
$function$
;
grant execute on function public.companies_blocking_account_delete(p_user uuid) to authenticated;
grant execute on function public.companies_blocking_account_delete(p_user uuid) to service_role;

CREATE OR REPLACE FUNCTION public.consume_rating_token()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if NEW.token is not null then
    update public.master_rating_tokens
       set used_at = now()
     where token = NEW.token
       and used_at is null;
  end if;
  return NEW;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.create_client_with_tags(p_tenant_id uuid, p_client_id uuid, p_client jsonb, p_tag_ids uuid[] DEFAULT ARRAY[]::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant_id uuid := public.current_tenant_id();
  active_role text := public.current_user_role();
  input_row public.clients%rowtype;
  saved_row public.clients%rowtype;
  normalized_tag_ids uuid[];
  effective_client_id uuid := coalesce(p_client_id, gen_random_uuid());
  labels_open boolean := true;
begin
  if auth.uid() is null
     or active_tenant_id is null
     or active_role is null
     or not (active_role = 'owner'
             or cardinality(public.access_calendars('clients.create', 'write')) > 0) then
    -- 02.10: заводит клиентов право «Создание клиента», а не «База».
    raise exception 'only an owner or an employee who can create clients can create a client'
      using errcode = '42501', hint = 'block:clients.create';
  end if;

  if p_tenant_id is null
     or p_tenant_id is distinct from active_tenant_id then
    raise exception 'client tenant does not match the active tenant'
      using errcode = '42501';
  end if;

  if p_client is null or jsonb_typeof(p_client) <> 'object' then
    raise exception 'client payload must be an object'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_object_keys(p_client) key
     where key not in (
       'full_name',
       'phone',
       'whatsapp_phone',
       'email',
       'sms_name',
       'telegram_username',
       'instagram_username',
       'balance',
       'discount',
       'comment',
       'acquisition_source',
       'referred_by_client_id',
       'first_contact_date',
       'address',
       'city',
       'city_manual',
       'property_type',
       'language',
       'birthday',
       'blacklisted',
       'pinned_at',
       'reminder_at',
       'phones',
       'locations',
       'notes',
       'equipment',
       'phone_e164',
       'avatar_url',
       'deleted_at',
       'favorite_master_id',
       'created_at',
       'legal_name',
       'vat_number',
       'reg_number',
       'billing_address',
       'memberships',
       'requisites',
       'team_id'
     )
  ) then
    raise exception 'client payload contains a protected or unknown field'
      using errcode = '22023';
  end if;

  input_row := jsonb_populate_record(null::public.clients, p_client);

  -- Деньги клиента, корзина и общие пометки — дело владельца.
  if active_role <> 'owner' then
    input_row.balance := 0;
    input_row.discount := 0;
    input_row.deleted_at := null;
    input_row.blacklisted := false;
    input_row.pinned_at := null;
    input_row.favorite_master_id := null;
  end if;

  if nullif(btrim(input_row.full_name), '') is null then
    raise exception 'client name is required'
      using errcode = '23514';
  end if;

  if jsonb_typeof(coalesce(input_row.phones, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(input_row.locations, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(input_row.notes, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(input_row.equipment, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(input_row.memberships, '[]'::jsonb)) <> 'array' then
    raise exception 'client nested collections must be arrays'
      using errcode = '22023';
  end if;

  if input_row.referred_by_client_id = effective_client_id then
    raise exception 'client cannot refer itself'
      using errcode = '23514';
  end if;

  if input_row.referred_by_client_id is not null
     and not exists (
       select 1
         from public.clients referrer
        where referrer.tenant_id = active_tenant_id
          and referrer.id = input_row.referred_by_client_id
     ) then
    raise exception 'referring client does not belong to the active tenant'
      using errcode = '23503';
  end if;

  if input_row.favorite_master_id is not null
     and not exists (
       select 1
         from public.masters master
        where master.tenant_id = active_tenant_id
          and master.id = input_row.favorite_master_id
     ) then
    raise exception 'favorite master does not belong to the active tenant'
      using errcode = '23503';
  end if;

  -- КОМАНДА КЛИЕНТА (30.09). Чужая компании команда — ошибка; команда, где
  -- сотруднику нельзя заводить клиентов («Создание клиента», 02.10), —
  -- заменяется его первой; пусто — первая живая команда, доступная создающему.
  if input_row.team_id is not null
     and not exists (
       select 1
         from public.teams team
        where team.tenant_id = active_tenant_id
          and team.id = input_row.team_id
     ) then
    raise exception 'client team does not belong to the active tenant'
      using errcode = '23503';
  end if;
  if active_role <> 'owner'
     and input_row.team_id is not null
     and (input_row.team_id = any(public.access_calendars('clients.create', 'write'))) is not true then
    input_row.team_id := null;
  end if;
  if input_row.team_id is null then
    input_row.team_id := (
      select team.id
        from public.teams team
       where team.tenant_id = active_tenant_id
         and team.is_active
         and (active_role = 'owner'
              or team.id = any(public.access_calendars('clients.create', 'write')))
       order by team.position, team.created_at
       limit 1
    );
  end if;

  -- БЛОКИ КАРТОЧКИ (30.09): сотрудник заводит только то, что в команде
  -- клиента может менять; поля остальных блоков ложатся пустыми, без отказа —
  -- экран этих блоков ему не показывает.
  if active_role <> 'owner' then
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.note', input_row.team_id) is distinct from 'write' then
      input_row.comment := '';
      input_row.notes := '[]'::jsonb;
    end if;
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.people', input_row.team_id) is distinct from 'write' then
      input_row.memberships := '[]'::jsonb;
    end if;
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.objects', input_row.team_id) is distinct from 'write' then
      input_row.locations := '[]'::jsonb;
      input_row.equipment := '[]'::jsonb;
      input_row.address := '';
      input_row.property_type := '';
    end if;
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.labels', input_row.team_id) is distinct from 'write' then
      input_row.city := '';
      input_row.city_manual := false;
    end if;
    -- 03.10: теги — своё право «Тег» (`clients.tags`), отдельно от «Метки».
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.tags', input_row.team_id) is distinct from 'write' then
      labels_open := false;
    end if;
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.personal', input_row.team_id) is distinct from 'write' then
      input_row.birthday := '';
      input_row.language := null;
      input_row.acquisition_source := 'unknown';
      input_row.referred_by_client_id := null;
      input_row.first_contact_date := null;
    end if;
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.requisites', input_row.team_id) is distinct from 'write' then
      input_row.legal_name := null;
      input_row.vat_number := null;
      input_row.reg_number := null;
      input_row.billing_address := null;
      input_row.requisites := '[]'::jsonb;
    end if;
  end if;

  normalized_tag_ids := public.normalize_client_tag_ids(
    active_tenant_id,
    case when labels_open then p_tag_ids else array[]::uuid[] end
  );

  -- 03.10: сотрудник ставит новому клиенту только теги его команды.
  if active_role <> 'owner' and exists (
    select 1
      from unnest(normalized_tag_ids) supplied(tag_id)
      join public.client_tags tag
        on tag.tenant_id = active_tenant_id
       and tag.id = supplied.tag_id
     where tag.team_id is not null
       and tag.team_id is distinct from input_row.team_id
  ) then
    raise exception 'client tag belongs to another team'
      using errcode = '23503', hint = 'client:tag_other_team';
  end if;

  insert into public.clients (
    id,
    tenant_id,
    full_name,
    phone,
    whatsapp_phone,
    email,
    sms_name,
    telegram_username,
    instagram_username,
    balance,
    discount,
    comment,
    acquisition_source,
    referred_by_client_id,
    first_contact_date,
    address,
    city,
    city_manual,
    property_type,
    language,
    birthday,
    blacklisted,
    pinned_at,
    reminder_at,
    phones,
    locations,
    notes,
    equipment,
    phone_e164,
    avatar_url,
    deleted_at,
    favorite_master_id,
    created_at,
    legal_name,
    vat_number,
    reg_number,
    billing_address,
    memberships,
    requisites,
    team_id
  ) values (
    effective_client_id,
    active_tenant_id,
    input_row.full_name,
    coalesce(input_row.phone, ''),
    coalesce(input_row.whatsapp_phone, ''),
    coalesce(input_row.email, ''),
    coalesce(input_row.sms_name, ''),
    coalesce(input_row.telegram_username, ''),
    coalesce(input_row.instagram_username, ''),
    coalesce(input_row.balance, 0),
    coalesce(input_row.discount, 0),
    coalesce(input_row.comment, ''),
    coalesce(input_row.acquisition_source, 'unknown'),
    input_row.referred_by_client_id,
    input_row.first_contact_date,
    coalesce(input_row.address, ''),
    coalesce(input_row.city, ''),
    coalesce(input_row.city_manual, false),
    coalesce(input_row.property_type, ''),
    input_row.language,
    coalesce(input_row.birthday, ''),
    coalesce(input_row.blacklisted, false),
    input_row.pinned_at,
    input_row.reminder_at,
    coalesce(input_row.phones, '[]'::jsonb),
    coalesce(input_row.locations, '[]'::jsonb),
    coalesce(input_row.notes, '[]'::jsonb),
    coalesce(input_row.equipment, '[]'::jsonb),
    input_row.phone_e164,
    input_row.avatar_url,
    input_row.deleted_at,
    input_row.favorite_master_id,
    coalesce(input_row.created_at, now()),
    nullif(btrim(input_row.legal_name), ''),
    nullif(btrim(input_row.vat_number), ''),
    nullif(btrim(input_row.reg_number), ''),
    nullif(btrim(input_row.billing_address), ''),
    coalesce(input_row.memberships, '[]'::jsonb),
    coalesce(input_row.requisites, '[]'::jsonb),
    input_row.team_id
  )
  returning * into saved_row;

  insert into public.client_tag_assignments (
    tenant_id,
    client_id,
    tag_id
  )
  select active_tenant_id, saved_row.id, supplied.tag_id
    from unnest(normalized_tag_ids) supplied(tag_id);

  -- Теги — внутрь маски: закрытые «Метка и тег» сотруднику не вернутся.
  return public.client_seen_by_caller(
    to_jsonb(saved_row) || jsonb_build_object('tag_ids', to_jsonb(normalized_tag_ids))
  );
end;
$function$
;
grant execute on function public.create_client_with_tags(p_tenant_id uuid, p_client_id uuid, p_client jsonb, p_tag_ids uuid[]) to authenticated;

CREATE OR REPLACE FUNCTION public.create_company(p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_personal public.tenants%rowtype;
  v_tenant uuid;
  v_team text := 'team-' || replace(gen_random_uuid()::text, '-', '');
  v_trial boolean;
begin
  if v_uid is null then
    raise exception 'Войдите в приложение' using errcode = '42501', hint = 'company:auth';
  end if;
  if v_name = '' then
    raise exception 'Нет названия компании' using errcode = '22023', hint = 'company:name';
  end if;
  if length(v_name) > 80 then
    raise exception 'Слишком длинное название' using errcode = '22023', hint = 'company:name';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('create_company:' || v_uid::text, 0));

  if (select count(*) from public.tenants t
       where t.created_by = v_uid and t.kind = 'company'
         and t.created_at > now() - interval '1 day') >= 5 then
    raise exception 'Слишком много компаний за день' using errcode = '54000', hint = 'company:rate';
  end if;

  select * into v_personal from public.tenants t where t.personal_of = v_uid;

  v_trial := not exists (
    select 1 from public.tenants t
     where t.created_by = v_uid and t.kind = 'company' and t.trial_started_at is not null
  );

  insert into public.tenants (
    name, vertical, onboarded_at, kind, created_by, country, currency,
    trial_tier, trial_started_at, trial_ends_at
  ) values (
    v_name, 'other', now(), 'company', v_uid,
    coalesce(v_personal.country, 'CY'), coalesce(v_personal.currency, 'EUR'),
    case when v_trial then 'max' end,
    case when v_trial then now() end,
    case when v_trial then now() + interval '14 days' end
  )
  returning id into v_tenant;

  insert into public.tenant_members (tenant_id, user_id, role, joined_at)
  values (v_tenant, v_uid, 'owner', now());

  insert into public.calendar_settings (tenant_id)
  values (v_tenant)
  on conflict (tenant_id) do nothing;

  insert into public.teams (id, tenant_id, name, payout_percentage)
  values (v_team, v_tenant, v_name, 30);

  perform public.sync_tenant_claims(v_uid);

  return jsonb_build_object('tenant_id', v_tenant, 'team_id', v_team, 'trial', v_trial);
end;
$function$
;
grant execute on function public.create_company(p_name text) to authenticated;

CREATE OR REPLACE FUNCTION public.create_first_calendar(p_id text, p_name text, p_color text DEFAULT NULL::text)
 RETURNS teams
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_row public.teams;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Войдите в приложение, чтобы завести календарь'
      using errcode = '42501', hint = 'calendar:auth';
  end if;
  if public.current_user_role() is distinct from 'owner' then
    raise exception 'Создавать календари может только владелец'
      using errcode = '42501', hint = 'calendar:owner';
  end if;
  if coalesce(btrim(p_id), '') = '' or coalesce(btrim(p_name), '') = '' then
    raise exception 'Нет имени календаря' using errcode = '22023';
  end if;

  -- Два устройства на пустом аккаунте: второе ждёт первое и видит его
  -- календарь, а не заводит свой.
  perform pg_advisory_xact_lock(hashtextextended('first_calendar:' || v_tenant::text, 0));

  -- Живой — как у экрана (`pickLiveTeams`): архив календарём не считается.
  if exists (
    select 1 from public.teams t
     where t.tenant_id = v_tenant and t.is_active
  ) then
    return null;
  end if;

  insert into public.teams (id, tenant_id, name, color, payout_percentage)
  values (btrim(p_id), v_tenant, btrim(p_name), nullif(btrim(coalesce(p_color, '')), ''), 30)
  returning * into v_row;
  return v_row;
end;
$function$
;
grant execute on function public.create_first_calendar(p_id text, p_name text, p_color text) to authenticated;

CREATE OR REPLACE FUNCTION public.create_invitation(p_email text, p_role text, p_master_id text DEFAULT NULL::text, p_team_id text DEFAULT NULL::text, p_full_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_team_ids text[] DEFAULT NULL::text[], p_master_title text DEFAULT NULL::text, p_master_color text DEFAULT NULL::text, p_access jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_team_id text := nullif(btrim(coalesce(p_team_id, '')), '');
  v_master_id text := nullif(btrim(coalesce(p_master_id, '')), '');
  v_full_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_master_title text := nullif(btrim(coalesce(p_master_title, '')), '');
  v_master_color text := nullif(btrim(coalesce(p_master_color, '')), '');
  v_access jsonb := coalesce(p_access, '[]'::jsonb);
  v_team_ids text[];
  v_bad_team text;
  v_token text;
  v_invitation public.invitations%rowtype;
begin
  if auth.uid() is null
     or v_tenant_id is null
     or not (public.current_user_role() = 'owner' or public.access_company('company.partners', 'write')) then
    raise exception 'only an owner can create invitations'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.tenants t
     where t.id = v_tenant_id and t.onboarded_at is not null
  ) then
    raise exception 'finish company setup before inviting employees'
      using errcode = '55000';
  end if;

  if p_role not in ('dispatcher', 'master') then
    raise exception 'invitation role must be dispatcher or master'
      using errcode = '22023';
  end if;

  -- 03.10: приглашают только партнёра (`master`). «Диспетчер» — наследие:
  -- политики до сих пор считают его всевидящим, а приложение зовёт только
  -- мастера. Прежняя проверка выше остаётся ради её текста отказа.
  if p_role is distinct from 'master' then
    raise exception 'invitation role must be master'
      using errcode = '22023', hint = 'invite:role_master';
  end if;

  -- Календари приглашения (15.09): `p_team_id` старых сборок и `p_team_ids`
  -- карточки сливаются без повторов; домашний — `p_team_id`, если он назван,
  -- иначе первый из `p_team_ids`.
  select coalesce(array_agg(x.team_id order by x.first_ord), array[]::text[])
    into v_team_ids
    from (
      select s.team_id, min(s.ord) as first_ord
        from (
          select nullif(btrim(coalesce(src.team_id, '')), '') as team_id, src.ord
            from unnest(array[v_team_id] || coalesce(p_team_ids, array[]::text[]))
                 with ordinality as src(team_id, ord)
        ) s
       where s.team_id is not null
       group by s.team_id
    ) x;
  v_team_id := v_team_ids[1];
  -- Директор зовёт только в свои команды (04.10).
  perform public.partners_check_teams(v_team_ids, array[]::text[]);

  select x.team_id
    into v_bad_team
    from unnest(v_team_ids) as x(team_id)
   where not exists (
     select 1 from public.teams t
      where t.tenant_id = v_tenant_id
        and t.id = x.team_id
        and t.is_active
   )
   limit 1;

  -- Текст отказа прежний — по нему приложение подбирает понятную фразу;
  -- какой именно календарь не подошёл, называет `detail`.
  if v_bad_team is not null then
    raise exception 'calendar not found or archived'
      using errcode = '22023', hint = 'invite:bad_calendar', detail = v_bad_team;
  end if;

  -- Мастер без карточки — только в календарь: иначе аккаунту нечего показать.
  if p_role = 'master' and v_master_id is null and v_team_id is null then
    raise exception 'master invitation requires a calendar or an employee card'
      using errcode = '22023', hint = 'invite:needs_calendar';
  end if;

  if p_role = 'dispatcher' and p_master_id is not null then
    raise exception 'dispatcher invitation cannot link an employee card'
      using errcode = '22023';
  end if;

  if p_role = 'master' and v_master_id is not null and not exists (
    select 1 from public.masters m
     where m.tenant_id = v_tenant_id and m.id = v_master_id and m.is_active
  ) then
    raise exception 'employee card not found or inactive'
      using errcode = '22023';
  end if;

  if p_role = 'master' and v_master_id is not null and exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = v_tenant_id and tm.master_id = v_master_id
  ) then
    raise exception 'employee card already linked to an account'
      using errcode = '23505';
  end if;

  if length(v_email) > 320
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid invitation email'
      using errcode = '22023';
  end if;

  -- Мини-карточка человека (15.09): имя и телефон необязательны.
  if v_full_name is not null and char_length(v_full_name) > 120 then
    raise exception 'invitation name is too long'
      using errcode = '22023';
  end if;

  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'invalid invitation phone'
      using errcode = '22023';
  end if;

  -- Должность и цвет карточки мастера (15.09): тоже необязательны.
  if v_master_title is not null and char_length(v_master_title) > 120 then
    raise exception 'invitation job title is too long'
      using errcode = '22023';
  end if;

  if v_master_color is not null and v_master_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'invalid invitation colour'
      using errcode = '22023';
  end if;

  -- Должность и цвет существующей карточки правятся в самой карточке: приём по
  -- номеру карточки их не переносит, и молча сохранить их значило бы потерять.
  if p_role = 'master' and v_master_id is not null
     and (v_master_title is not null or v_master_color is not null) then
    raise exception 'job title and colour belong to the linked employee card'
      using errcode = '22023', hint = 'invite:card_fields_on_card';
  end if;

  -- Права проверяются против календарей ЭТОГО приглашения: уровень в
  -- календаре, куда человека не зовут, при приёме было бы некуда положить.
  perform public.access_validate_changes(v_tenant_id, v_team_ids, v_access);
  -- Ступени директора — не выше его собственных (04.10).
  perform public.partners_check_caps(v_tenant_id, null, v_access);

  if exists (
    select 1 from public.tenant_members tm
      join auth.users u on u.id = tm.user_id
     where tm.tenant_id = v_tenant_id
       and lower(coalesce(u.email, '')) = v_email
  ) then
    raise exception 'this account already has access to the tenant'
      using errcode = '23505';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_tenant_id::text || ':' || v_email, 0)
  );

  if exists (
    select 1 from public.tenant_members tm
      join auth.users u on u.id = tm.user_id
     where tm.tenant_id = v_tenant_id
       and lower(coalesce(u.email, '')) = v_email
  ) then
    raise exception 'this account already has access to the tenant'
      using errcode = '23505';
  end if;

  if p_role = 'master' and v_master_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(v_tenant_id::text || ':master:' || v_master_id, 1)
    );
    if exists (
      select 1 from public.tenant_members tm
       where tm.tenant_id = v_tenant_id and tm.master_id = v_master_id
    ) then
      raise exception 'employee card already linked to an account'
        using errcode = '23505';
    end if;
    if exists (
      select 1 from public.invitations i
       where i.tenant_id = v_tenant_id
         and i.master_id = v_master_id
         and i.accepted_at is null
         and i.expires_at > now()
         and lower(i.email) <> v_email
    ) then
      raise exception 'employee card already has a pending invitation'
        using errcode = '23505';
    end if;
  end if;

  delete from public.invitations
   where tenant_id = v_tenant_id
     and lower(email) = v_email
     and accepted_at is null;

  v_token := translate(
    encode(
      substring(
        sha256(
          convert_to(
            gen_random_uuid()::text || gen_random_uuid()::text ||
            gen_random_uuid()::text,
            'UTF8'
          )
        )
        from 1 for 24
      ),
      'base64'
    ),
    '+/',
    '-_'
  );

  insert into public.invitations (
    tenant_id, email, role, master_id, team_id, invited_by_user_id, token, expires_at,
    full_name, phone, team_ids, master_title, master_color, access_changes
  ) values (
    v_tenant_id,
    v_email,
    p_role,
    case when p_role = 'master' then v_master_id else null end,
    v_team_id,
    auth.uid(),
    v_token,
    now() + interval '7 days',
    v_full_name,
    v_phone,
    case when cardinality(v_team_ids) > 0 then v_team_ids else null end,
    -- Должность и цвет живут в карточке мастера; у диспетчера карточки нет.
    case when p_role = 'master' then v_master_title else null end,
    case when p_role = 'master' then v_master_color else null end,
    v_access
  )
  returning * into v_invitation;

  return jsonb_build_object(
    'id', v_invitation.id,
    'tenant_id', v_invitation.tenant_id,
    'email', v_invitation.email,
    'role', v_invitation.role,
    'master_id', v_invitation.master_id,
    'team_id', v_invitation.team_id,
    'team_ids', coalesce(v_invitation.team_ids, array[]::text[]),
    'full_name', v_invitation.full_name,
    'phone', v_invitation.phone,
    'master_title', v_invitation.master_title,
    'master_color', v_invitation.master_color,
    'access_changes', v_invitation.access_changes,
    'token', v_invitation.token,
    'expires_at', v_invitation.expires_at,
    'created_at', v_invitation.created_at
  );
end;
$function$
;
grant execute on function public.create_invitation(p_email text, p_role text, p_master_id text, p_team_id text, p_full_name text, p_phone text, p_team_ids text[], p_master_title text, p_master_color text, p_access jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_header text;
  v_asked  uuid;
begin
  begin
    v_header := nullif(
      current_setting('request.headers', true)::json ->> 'x-babun-tenant',
      ''
    );
  exception when others then
    v_header := null;
  end;

  if v_header is not null then
    begin
      v_asked := v_header::uuid;
    exception when others then
      return null;
    end;
    return (
      select tm.tenant_id
        from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.tenant_id = v_asked
       limit 1
    );
  end if;

  -- БЕЗ ЗАГОЛОВКА: claim из токена ТОЖЕ подтверждается членством. Раньше он
  -- читался напрямую, и уволенный работал до истечения токена — членство
  -- проверяла только заголовочная ветка.
  v_asked := nullif(((auth.jwt() -> 'app_metadata') ->> 'tenant_id'), '')::uuid;
  if v_asked is not null then
    return (
      select tm.tenant_id
        from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.tenant_id = v_asked
       limit 1
    );
  end if;

  return (
    select tenant_id from public.tenant_members
     where user_id = auth.uid()
     order by joined_at asc, tenant_id asc
     limit 1
  );
end;
$function$
;
grant execute on function public.current_tenant_id() to anon;
grant execute on function public.current_tenant_id() to authenticated;

CREATE OR REPLACE FUNCTION public.current_tenant_profile_safe()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when public.current_user_role() = 'owner' then
      to_jsonb(t) || jsonb_build_object('tier', public.tenant_effective_plan(t.id))
    when public.current_user_role() in ('dispatcher', 'master') then
      jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'vertical', t.vertical,
        'city', t.city,
        'country', t.country,
        'address', t.address,
        'logo_url', t.logo_url,
        'contact_phone', t.contact_phone,
        'contact_email', t.contact_email,
        'contact_whatsapp', t.contact_whatsapp,
        'contact_telegram', t.contact_telegram,
        'contact_instagram', t.contact_instagram,
        'onboarded_at', t.onboarded_at,
        'personal_calendar_enabled', t.personal_calendar_enabled,
        'track_units', t.track_units,
        'currency', t.currency,
        'created_at', t.created_at,
        'tier', public.tenant_effective_plan(t.id),
        'vat_mode', t.vat_mode,
        'vat_rate', t.vat_rate
      )
      || case
        when cardinality(public.access_calendars('finance.documents', 'write')) > 0 then
          jsonb_build_object(
            'invoice_due_days', t.invoice_due_days,
            'invoice_line_source', t.invoice_line_source,
            'invoice_default_line_title', t.invoice_default_line_title,
            'invoice_footer_note', t.invoice_footer_note
          )
        else '{}'::jsonb
      end
      || case
        when public.access_company('cabinet.tariff', 'read') then
          jsonb_build_object(
            'plan', t.plan,
            'plan_override', t.plan_override,
            'trial_tier', t.trial_tier,
            'trial_started_at', t.trial_started_at,
            'trial_ends_at', t.trial_ends_at,
            'subscription_status', t.subscription_status,
            'current_period_end', t.current_period_end,
            'working_team_ids', t.working_team_ids
          )
        else '{}'::jsonb
      end
    else null
  end
    from public.tenants t
   where t.id = public.current_tenant_id()
   limit 1
$function$
;
grant execute on function public.current_tenant_profile_safe() to authenticated;

CREATE OR REPLACE FUNCTION public.current_user_calendar_ids(p_grant text DEFAULT NULL::text)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    array_agg(cm.team_id order by cm.team_id),
    array[]::text[]
  )
    from public.calendar_members cm
   where cm.user_id = auth.uid()
     and cm.tenant_id = public.current_tenant_id()
     and (p_grant is null or cm.grants @> array[p_grant])
$function$
;
grant execute on function public.current_user_calendar_ids(p_grant text) to authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_access_appointment(p_appointment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
      from public.appointments a
     where a.id = p_appointment_id
       and a.tenant_id = public.current_tenant_id()
       and (
         (
           public.current_user_role() in ('owner', 'dispatcher')
           and (
             a.kind = 'work'
             or (
               a.kind in ('event', 'personal')
               and (
                 a.team_id is not null
                 or a.created_by = auth.uid()
               )
             )
           )
         )
         or (
           public.current_user_role() = 'master'
           -- «Ограничения» записей (03.10): старая работа — как чужая.
           and not public.member_record_hidden(a.kind, a.team_id, a.date)
           and (
             (
               a.kind = 'work'
               and (
                 a.master_id = public.current_user_master_id()
                 or a.team_id = any(public.current_user_team_ids())
               )
             )
             or (
               a.kind in ('event', 'personal')
               and a.team_id is not null
               and a.team_id = any(public.current_user_team_ids())
             )
           )
         )
       )
  )
$function$
;
grant execute on function public.current_user_can_access_appointment(p_appointment_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_access_client(p_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
      from public.clients c
     where c.id = p_client_id
       and c.tenant_id = public.current_tenant_id()
       and (
         public.current_user_role() in ('owner', 'dispatcher')
         or (
           public.current_user_role() = 'master'
           and exists (
             select 1
               from public.appointments a
              where a.tenant_id = c.tenant_id
                and a.client_id = c.id
                and a.kind = 'work'
                and (
                  a.master_id = public.current_user_master_id()
                  or a.team_id = any(public.current_user_team_ids())
                )
           )
         )
       )
  )
$function$
;
grant execute on function public.current_user_can_access_client(p_client_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_access_client_tag(p_tag_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.current_user_role() in ('owner', 'dispatcher')
    or (
      public.current_user_role() = 'master'
      and exists (
        select 1
          from public.client_tag_assignments cta
         where cta.tenant_id = public.current_tenant_id()
           and cta.tag_id = p_tag_id
           and public.current_user_can_access_client(cta.client_id)
      )
    )
$function$
;
grant execute on function public.current_user_can_access_client_tag(p_tag_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_add_record_attachment(p_id uuid, p_client_id uuid, p_appointment_id uuid, p_storage_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select p_id is not null
       and p_client_id is not null
       and p_storage_path ~ ('^' || a.tenant_id::text || '/' || p_client_id::text || '/' || p_id::text || '\.[^/]+$')
       and public.current_user_can_mutate_appointment_photo(a.id)
       and not exists (
         select 1
           from storage.objects o
          where o.bucket_id = 'client-attachments'
            and o.name = p_storage_path
       )
      from public.appointments a
     where a.id = p_appointment_id
       and a.tenant_id = public.current_tenant_id()
       and a.kind = 'work'
       and a.client_id = p_client_id
  ), false)
$function$
;
grant execute on function public.current_user_can_add_record_attachment(p_id uuid, p_client_id uuid, p_appointment_id uuid, p_storage_path text) to authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_delete_appointment_blob(p_appointment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.current_user_can_mutate_appointment_photo(p_appointment_id)
      or (
        public.current_user_role() in ('owner', 'dispatcher')
        and p_appointment_id is not null
        and not exists (
          select 1 from public.appointments a where a.id = p_appointment_id
        )
      )
$function$
;
grant execute on function public.current_user_can_delete_appointment_blob(p_appointment_id uuid) to anon;
grant execute on function public.current_user_can_delete_appointment_blob(p_appointment_id uuid) to authenticated;
grant execute on function public.current_user_can_delete_appointment_blob(p_appointment_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.current_user_can_drop_record_attachment_object(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select not exists (
           select 1 from public.client_attachments ca
            where ca.storage_path = p_name
         )
     and exists (
           select 1 from public.appointments a
            where a.tenant_id = public.current_tenant_id()
              and a.kind = 'work'
              and a.client_id = public.try_uuid((storage.foldername(p_name))[2])
              and public.current_user_can_mutate_appointment_photo(a.id)
         );
$function$
;
grant execute on function public.current_user_can_drop_record_attachment_object(p_name text) to authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_edit_client(p_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when auth.uid() is null then false
    when not exists (
      select 1
        from public.clients c
       where c.id = p_client_id
         and c.tenant_id = public.current_tenant_id()
    ) then false
    when public.current_user_role() = 'owner' then true
    else p_client_id = any(public.access_client_ids_in(public.access_calendars('clients', 'write')))
  end
$function$
;
grant execute on function public.current_user_can_edit_client(p_client_id uuid) to authenticated;
grant execute on function public.current_user_can_edit_client(p_client_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.current_user_can_edit_work_appointment(p_team_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when auth.uid() is null then false
    when public.current_user_role() = 'owner' then true
    when public.current_user_role() = 'dispatcher'
         and not public.current_user_has_calendar_grants() then true
    else p_team_id is not null
         and p_team_id = any(public.current_user_calendar_ids('edit_all'))
  end
$function$
;
grant execute on function public.current_user_can_edit_work_appointment(p_team_id text) to authenticated;
grant execute on function public.current_user_can_edit_work_appointment(p_team_id text) to service_role;

CREATE OR REPLACE FUNCTION public.current_user_can_mutate_appointment_photo(p_appointment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
      from public.appointments a
     where a.id = p_appointment_id
       and a.tenant_id = public.current_tenant_id()
       and (
         -- Владелец — всегда; событие — его автор, как и было.
         (public.current_user_role() = 'owner'
           and (a.kind = 'work' or (a.kind in ('event','personal') and a.created_by = auth.uid())))
         -- Событие — его автор; сотруднику — ещё и по «Файлам» события
         -- (30.09).
         or (a.kind in ('event','personal') and a.created_by = auth.uid()
             and (public.current_user_role() is distinct from 'master'
                  or a.team_id in (select unnest(public.access_calendars('event.files', 'write')))))
         -- Запись — по уровню блока в её календаре. Прежняя пара
         -- «моя карточка ИЛИ моя команда» и была тем, что уровень не решал.
         or (a.kind = 'work'
             and a.team_id in (select unnest(public.access_calendars('record.files', 'write'))))
       )
  )
$function$
;
grant execute on function public.current_user_can_mutate_appointment_photo(p_appointment_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_pay_appointment(p_team_id text, p_master_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
      declare
        role_name text := coalesce(public.current_user_role(), '');
      begin
        if auth.uid() is null then
          return false;
        end if;
        if role_name = 'owner' then
          return true;
        end if;
        return p_team_id is not null
           and p_team_id = any(public.access_calendars('record.payment', 'write'));
      end;
      $function$
;
grant execute on function public.current_user_can_pay_appointment(p_team_id text, p_master_id text) to authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_reach_record_attachment_object(p_name text, p_write boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select bool_or(
             case
               when p_write is true then
                 exists (
                   select 1
                     from public.appointments a
                    where a.id = ca.appointment_id
                      and a.tenant_id = ca.tenant_id
                      and a.kind = 'work'
                      and a.client_id = ca.client_id
                 )
                 and public.current_user_can_mutate_appointment_photo(ca.appointment_id)
               else
                 public.current_user_can_access_appointment(ca.appointment_id)
                 and public.current_user_can_see_appointment_files(ca.appointment_id)
             end
           )
      from public.client_attachments ca
     where ca.tenant_id = public.current_tenant_id()
       and ca.client_id = public.try_uuid((storage.foldername(p_name))[2])
       and ca.storage_path = p_name
       and ca.appointment_id is not null
       and p_name ~ ('^' || ca.tenant_id::text || '/' || ca.client_id::text || '/' || ca.id::text || '\.[^/]+$')
  ), false)
$function$
;
grant execute on function public.current_user_can_reach_record_attachment_object(p_name text, p_write boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_see_appointment_blob(p_appointment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select (
           public.current_user_can_access_appointment(p_appointment_id)
           and public.current_user_can_see_appointment_files(p_appointment_id)
         )
      or (
        public.current_user_role() in ('owner', 'dispatcher')
        and p_appointment_id is not null
        and not exists (
          select 1 from public.appointments a where a.id = p_appointment_id
        )
      )
$function$
;
grant execute on function public.current_user_can_see_appointment_blob(p_appointment_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_see_appointment_files(p_appointment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.current_user_role() = 'owner'
      or exists (
        select 1 from public.appointments a
         where a.id = p_appointment_id
           and (a.team_id is null
                -- Файлы записи — «Файлы» записи; файлы события — «Файлы»
                -- события (30.09).
                or (a.kind = 'work'
                    and a.team_id = any(public.access_calendars('record.files', 'read')))
                or (a.kind <> 'work'
                    and a.team_id = any(public.access_calendars('event.files', 'read'))))
      )
$function$
;
grant execute on function public.current_user_can_see_appointment_files(p_appointment_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.current_user_has_calendar_grants()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.calendar_members cm
     where cm.tenant_id = public.current_tenant_id()
       and cm.user_id = auth.uid()
  )
$function$
;
grant execute on function public.current_user_has_calendar_grants() to anon;
grant execute on function public.current_user_has_calendar_grants() to authenticated;
grant execute on function public.current_user_has_calendar_grants() to service_role;

CREATE OR REPLACE FUNCTION public.current_user_master_id()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select tm.master_id
    from public.tenant_members tm
   where tm.tenant_id = public.current_tenant_id()
     and tm.user_id = auth.uid()
   limit 1
$function$
;
grant execute on function public.current_user_master_id() to anon;
grant execute on function public.current_user_master_id() to authenticated;

CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role
    from public.tenant_members
   where user_id = auth.uid()
     and tenant_id = public.current_tenant_id()
   limit 1;
$function$
;
grant execute on function public.current_user_role() to authenticated;

CREATE OR REPLACE FUNCTION public.current_user_team_ids()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with identity as (
    select public.current_user_master_id() as master_id,
           public.current_tenant_id() as tenant_id
  ), assigned as (
    select m.team_id as team_id
      from public.masters m
      join identity i on i.tenant_id = m.tenant_id and i.master_id = m.id
     where m.team_id is not null
    union
    select t.id
      from public.teams t
      cross join identity i
     where t.tenant_id = i.tenant_id
       and i.master_id is not null
       and (
         coalesce(t.lead_ids, '[]'::jsonb) ? i.master_id
         or coalesce(t.helper_ids, '[]'::jsonb) ? i.master_id
         or exists (
           select 1
             from jsonb_array_elements(
               case
                 when jsonb_typeof(t.members) = 'array' then t.members
                 else '[]'::jsonb
               end
             ) member
            where case jsonb_typeof(member)
              when 'string' then member #>> '{}'
              when 'object' then coalesce(member ->> 'master_id', member ->> 'id')
              else null
            end = i.master_id
         )
       )
  ), legacy as (
    select team_id
      from assigned
     where team_id is not null
       and (
         public.current_user_role() is distinct from 'master'
         or team_id in (
           select mc.team_id
             from public.member_calendars mc
             join public.teams t on t.tenant_id = mc.tenant_id and t.id = mc.team_id and t.is_active
            where mc.tenant_id = public.current_tenant_id()
              and mc.user_id = auth.uid()
         )
       )
  ), granted as (
    select t.id as team_id
      from public.teams t
     where public.current_user_role() = 'master'
       and t.tenant_id = public.current_tenant_id()
       and t.is_active
       and t.id = any(public.current_user_calendar_ids('view'))
  )
  select coalesce(array_agg(distinct team_id order by team_id), array[]::text[])
    from (select team_id from legacy union select team_id from granted) s
$function$
;
grant execute on function public.current_user_team_ids() to anon;
grant execute on function public.current_user_team_ids() to authenticated;

CREATE OR REPLACE FUNCTION public.debts_client_same_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.client_id is not null and not exists (
    select 1 from public.clients c where c.id = new.client_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'клиент не из этого аккаунта' using errcode = '42501', hint = 'debt:foreign_client';
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.debts_direction_locked()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.direction is distinct from old.direction
     and exists (select 1 from public.finance_transactions f where f.debt_id = old.id) then
    raise exception 'По долгу уже есть платежи — направление не меняется'
      using errcode = '23514', hint = 'debt:direction_locked';
  end if;
  return new;
end;
$function$
;
grant execute on function public.debts_direction_locked() to authenticated;

CREATE OR REPLACE FUNCTION public.decline_invitation(p_invitation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to decline an invitation'
      using errcode = '42501';
  end if;

  v_token := public.inbox_invitation_token(p_invitation_id);

  delete from public.invitations i
   where v_token is not null
     and i.token = v_token
     and i.accepted_at is null;

  if not found then
    raise exception 'invitation not found'
      using errcode = 'P0002', hint = 'invite:not_found';
  end if;
end;
$function$
;
grant execute on function public.decline_invitation(p_invitation_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.delete_account_transfer(p_transfer_group_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  request_row public.finance_transfer_requests%rowtype;
  destination_balance numeric(14,2);
  caller_is_owner boolean;
  writable_accounts uuid[];
begin
  if auth.uid() is null or tenant_uuid is null then
    raise exception 'Отменить перевод может только участник компании';
  end if;
  caller_is_owner := coalesce(public.current_user_role() = 'owner', false);
  if p_transfer_group_id is null then raise exception 'Перевод не найден'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_transfer_group_id::text, 0));
  select * into request_row
    from public.finance_transfer_requests
   where id = p_transfer_group_id
   for update;
  if not found then
    if exists (
      select 1 from public.finance_transactions
       where transfer_group_id = p_transfer_group_id
         and tenant_id = tenant_uuid
    ) then
      raise exception 'Перевод повреждён; данные не изменены';
    end if;
    return false;
  end if;
  if request_row.tenant_id <> tenant_uuid then raise exception 'Перевод не найден'; end if;
  if not caller_is_owner then
    writable_accounts := public.access_accounts_for('finance.accounts', 'write');
    if not (request_row.from_account_id = any(writable_accounts)
            and request_row.to_account_id = any(writable_accounts)) then
      raise exception 'Отменить перевод между этими счетами вам не открыто'
        using errcode = '42501', hint = 'block:finance.accounts';
    end if;
  end if;
  if request_row.status = 'deleted' then return false; end if;

  perform 1 from public.accounts
   where id in (request_row.from_account_id, request_row.to_account_id)
   order by id for update;
  if (select count(*) from public.accounts
       where id in (request_row.from_account_id, request_row.to_account_id)
         and tenant_id = tenant_uuid and is_active = true) <> 2 then
    raise exception 'Один из счетов закрыт или недоступен';
  end if;
  perform 1 from public.finance_transactions
   where transfer_group_id = p_transfer_group_id
   order by id for update;
  if (select count(*) from public.finance_transactions
       where transfer_group_id = p_transfer_group_id and type = 'transfer') <> 2
     or not exists (
       select 1 from public.finance_transactions
        where transfer_group_id = p_transfer_group_id
          and tenant_id = tenant_uuid and account_id = request_row.from_account_id
          and amount = -request_row.amount
     ) or not exists (
       select 1 from public.finance_transactions
        where transfer_group_id = p_transfer_group_id
          and tenant_id = tenant_uuid and account_id = request_row.to_account_id
          and amount = request_row.amount
     ) then
    raise exception 'Перевод повреждён; данные не изменены';
  end if;

  select round(
    account.opening_balance + coalesce(sum(
      case
        when tx.type = 'expense' then -tx.amount
        when tx.type = 'refund' then -abs(tx.amount)
        else tx.amount
      end
    ), 0),
    2
  ) into destination_balance
  from public.accounts account
  left join public.finance_transactions tx on tx.account_id = account.id
  where account.id = request_row.to_account_id
  group by account.opening_balance;
  if destination_balance < request_row.amount then
    raise exception 'На счёте назначения уже недостаточно средств для отмены перевода';
  end if;

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (txid_current(), 'transfer_write', p_transfer_group_id, tenant_uuid)
  on conflict do nothing;
  delete from public.finance_transactions
   where transfer_group_id = p_transfer_group_id and tenant_id = tenant_uuid;
  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'transfer_write' and entity_id = p_transfer_group_id;
  update public.finance_transfer_requests
     set status = 'deleted', deleted_at = now(), deleted_by = auth.uid()
   where id = p_transfer_group_id;
  return true;
end;
$function$
;
grant execute on function public.delete_account_transfer(p_transfer_group_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.delete_calendar(p_team_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_team public.teams%rowtype;
  v_live integer;
  v_accounts uuid[];
  n_appointments integer := 0;
  n_accounts integer := 0;
  n_operations integer := 0;
  n_services integer := 0;
  n_documents integer := 0;
  n_debts integer := 0;
begin
  if v_tenant is null then
    raise exception 'Компания не определена';
  end if;
  if public.current_user_role() is distinct from 'owner' then
    raise exception 'Удалить календарь может только владелец';
  end if;

  select * into v_team
    from public.teams
   where id = p_team_id and tenant_id = v_tenant
   for update;
  if not found then
    raise exception 'Календарь не найден';
  end if;

  select count(*) into v_live
    from public.teams
   where tenant_id = v_tenant and is_active and id <> p_team_id;
  if v_live = 0 and v_team.is_active then
    raise exception 'Последний календарь удалить нельзя';
  end if;

  insert into public._calendar_delete_context (transaction_id, tenant_id, team_id)
  values (txid_current(), v_tenant, p_team_id)
  on conflict (transaction_id) do update
    set tenant_id = excluded.tenant_id,
        team_id = excluded.team_id,
        started_at = now();

  select coalesce(array_agg(id), '{}') into v_accounts
    from public.accounts
   where tenant_id = v_tenant and brigade_id = p_team_id;

  update public.invoices
     set status = 'void'
   where tenant_id = v_tenant
     and brigade_id = p_team_id
     and status <> 'void';
  get diagnostics n_documents = row_count;

  update public.receipts
     set status = 'void'
   where tenant_id = v_tenant
     and status <> 'void'
     and (
       account_id = any (v_accounts)
       or transaction_id in (
         select id from public.finance_transactions
          where tenant_id = v_tenant and account_id = any (v_accounts)
       )
       or appointment_id in (
         select id from public.appointments
          where tenant_id = v_tenant and team_id = p_team_id
       )
     );

  delete from public.finance_transactions
   where tenant_id = v_tenant and account_id = any (v_accounts);
  get diagnostics n_operations = row_count;

  update public.finance_transactions
     set team_id = null
   where tenant_id = v_tenant and team_id = p_team_id;

  -- Корзина: стёртые выше операции триггер положил в «Удалённые операции»,
  -- а вернуть их некуда — счета календаря уходят следом.
  delete from public.deleted_operations
   where tenant_id = v_tenant and team_id = p_team_id;

  -- Ждущие отправки SMS календаря: после удаления записи они ушли бы
  -- клиенту с пустой датой и временем.
  delete from public.sms_messages
   where tenant_id = v_tenant
     and status = 'queued'
     and (
       team_id = p_team_id
       or appointment_id in (
         select id from public.appointments
          where tenant_id = v_tenant and team_id = p_team_id
       )
     );

  -- ЗАПИСИ — ДО СЧЕТОВ: иначе удаление счёта обновляет оплаченные записи
  -- (`payment_account_id` SET NULL), и сверка денег пытается провести
  -- стёртые доходы заново.
  delete from public.appointments
   where tenant_id = v_tenant and team_id = p_team_id;
  get diagnostics n_appointments = row_count;

  -- Шаблоны и долги команды — удаляются: команда у них обязательна.
  delete from public.finance_templates
   where tenant_id = v_tenant and brigade_id = p_team_id;
  delete from public.debts
   where tenant_id = v_tenant and team_id = p_team_id;
  get diagnostics n_debts = row_count;

  delete from public.accounts
   where tenant_id = v_tenant and brigade_id = p_team_id;
  get diagnostics n_accounts = row_count;

  update public.masters set team_id = null
   where tenant_id = v_tenant and team_id = p_team_id;

  delete from public.finance_transfer_requests
   where tenant_id = v_tenant and team_id = p_team_id;
  delete from public.account_teams where team_id = p_team_id;
  delete from public.member_access
   where tenant_id = v_tenant and team_id = p_team_id;
  delete from public.team_finance_settings
   where tenant_id = v_tenant and team_id = p_team_id;
  delete from public.team_schedules
   where tenant_id = v_tenant and team_id = p_team_id;
  delete from public.day_cities
   where tenant_id = v_tenant and team_id = p_team_id;
  delete from public.day_extras
   where tenant_id = v_tenant and team_id = p_team_id;
  delete from public.recurring_reminders
   where tenant_id = v_tenant and team_id = p_team_id;

  delete from public.services
   where tenant_id = v_tenant and team_id = p_team_id;
  get diagnostics n_services = row_count;

  delete from public.teams
   where id = p_team_id and tenant_id = v_tenant;

  delete from public._calendar_delete_context
   where transaction_id = txid_current();

  return jsonb_build_object(
    'team_id', p_team_id,
    'name', v_team.name,
    'appointments', n_appointments,
    'accounts', n_accounts,
    'operations', n_operations,
    'services', n_services,
    'documents_voided', n_documents,
    'debts', n_debts
  );
end;
$function$
;
grant execute on function public.delete_calendar(p_team_id text) to authenticated;

CREATE OR REPLACE FUNCTION public.delete_credit_note(p_note_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  note public.invoices%rowtype;
  original public.invoices%rowtype;
  receipt_row public.receipts%rowtype;
  last_seq integer;
  moved numeric(12,2) := 0;
  paid_total numeric(12,2);
begin
  if tenant_uuid is null or not public._documents_write_invoice(p_note_id) then
    raise exception 'Нужно право «Документы: Выставляет» в команде документа'
      using errcode = '42501', hint = 'access:owner_only';
  end if;
  select * into note
    from public.invoices
   where id = p_note_id and tenant_id = tenant_uuid
   for update;
  if not found or note.kind <> 'credit_note' then
    raise exception 'Кредит-нота не найдена';
  end if;

  if note.credit_note_of_id is not null then
    select coalesce(sum(abs(tx.amount)), 0) into moved
      from public.finance_transactions tx
     where tx.tenant_id = tenant_uuid
       and tx.type = 'refund'
       and tx.invoice_id = note.credit_note_of_id
       and tx.created_at = note.created_at;
  elsif note.credit_note_of_receipt_id is not null then
    select * into receipt_row from public.receipts where id = note.credit_note_of_receipt_id;
    select coalesce(sum(abs(tx.amount)), 0) into moved
      from public.finance_transactions tx
     where tx.tenant_id = tenant_uuid
       and tx.type = 'refund'
       and tx.refund_of_id = receipt_row.transaction_id
       and tx.created_at = note.created_at;
  end if;
  if moved > 0 then
    raise exception 'Кредит-нота вернула клиенту % % — её не удалить: документ на эти деньги остаётся', moved, note.currency;
  end if;

  perform 1 from public.document_sequences s
   where s.tenant_id = tenant_uuid
     and s.legal_entity_id is not distinct from note.company_id
     and s.doc_type = 'credit_note'
     and s.year = note.year
   for update;
  select max(i.seq) into last_seq
    from public.invoices i
   where i.tenant_id = tenant_uuid
     and i.kind = 'credit_note'
     and i.company_id is not distinct from note.company_id
     and i.year = note.year;
  if last_seq is distinct from note.seq then
    raise exception 'Удалить можно только последнюю кредит-ноту серии (%) — после неё уже выписаны другие', last_seq;
  end if;

  perform set_config('babun.invoice_delete', note.id::text, true);
  delete from public.invoices where id = note.id;
  perform set_config('babun.invoice_delete', '', true);

  update public.document_sequences s
     set last_number = note.seq - 1,
         updated_at = now()
   where s.tenant_id = tenant_uuid
     and s.legal_entity_id is not distinct from note.company_id
     and s.doc_type = 'credit_note'
     and s.year = note.year
     and s.last_number = note.seq;

  if note.credit_note_of_id is not null then
    select * into original
      from public.invoices
     where id = note.credit_note_of_id and tenant_id = tenant_uuid
     for update;
    if note.credit_partial then
      update public.invoices
         set credited_amount = greatest(0, credited_amount + note.total)
       where id = original.id;
      select * into original from public.invoices where id = original.id;
    end if;
    select greatest(0,
             coalesce(sum(case when tx.type = 'income' then greatest(tx.amount, 0) else 0 end), 0)
           - coalesce(sum(case when tx.type = 'refund' then abs(tx.amount) else 0 end), 0))
      into paid_total
      from public.finance_transactions tx
     where tx.tenant_id = tenant_uuid
       and tx.invoice_id = original.id
       and tx.type in ('income', 'refund');
    perform set_config('babun.credit_note_undo', original.id::text, true);
    update public.invoices
       set status = case
         when paid_total >= original.total - original.credited_amount then 'paid'
         else 'issued'
       end,
           updated_at = now()
     where id = original.id
       and status is distinct from case
         when paid_total >= original.total - original.credited_amount then 'paid'
         else 'issued'
       end;
    perform set_config('babun.credit_note_undo', '', true);
  end if;
end;
$function$
;
grant execute on function public.delete_credit_note(p_note_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.delete_invoice(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  target public.invoices%rowtype;
  last_seq integer;
begin
  if tenant_uuid is null or not public._documents_write_invoice(p_invoice_id) then
    raise exception 'Нужно право «Документы: Выставляет» в команде документа'
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
  update public.document_sequences s
     set last_number = target.seq - 1,
         updated_at = now()
   where s.tenant_id = tenant_uuid
     and s.legal_entity_id is not distinct from target.company_id
     and s.doc_type = 'invoice'
     and s.year = target.year
     and s.last_number = target.seq;
end;
$function$
;
grant execute on function public.delete_invoice(p_invoice_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.delete_operation(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  removed uuid;
begin
  perform set_config('babun.operation_trash', 'on', true);
  delete from public.finance_transactions
   where id = p_id
     and source = 'manual'
     and type <> 'transfer'
     and invoice_id is null
  returning id into removed;
  perform set_config('babun.operation_trash', 'off', true);
  if removed is null then
    raise exception 'Операция недоступна или связана с инвойсом'
      using errcode = 'P0002', hint = 'operation:not_found';
  end if;
  return removed;
end;
$function$
;
grant execute on function public.delete_operation(p_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.delete_receipt(p_receipt_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  target public.receipts%rowtype;
  last_seq integer;
begin
  if tenant_uuid is null or not public._documents_write_receipt(p_receipt_id) then
    raise exception 'Нужно право «Документы: Выставляет» в команде документа'
      using errcode = '42501', hint = 'access:owner_only';
  end if;
  select * into target
    from public.receipts
   where id = p_receipt_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Чек не найден';
  end if;
  if target.status <> 'issued' then
    raise exception 'Погашенный чек не удаляется — его номер уже в истории';
  end if;
  if exists (
    select 1 from public.invoices note
     where note.tenant_id = tenant_uuid and note.credit_note_of_receipt_id = target.id
  ) then
    raise exception 'По чеку выписана кредит-нота — его не удалить';
  end if;
  if target.transaction_id is not null and exists (
    select 1 from public.finance_transactions refund
     where refund.tenant_id = tenant_uuid
       and refund.refund_of_id = target.transaction_id
       and refund.type = 'refund'
  ) then
    raise exception 'По чеку был возврат — его не удалить';
  end if;

  -- Серия — замком, чтобы параллельная выдача не встала между проверкой и
  -- возвратом номера.
  perform 1 from public.document_sequences s
   where s.tenant_id = tenant_uuid
     and s.legal_entity_id is not distinct from target.company_id
     and s.doc_type = 'receipt'
     and s.year = target.year
   for update;
  select max(r.seq) into last_seq
    from public.receipts r
   where r.tenant_id = tenant_uuid
     and r.company_id is not distinct from target.company_id
     and r.year = target.year;
  if last_seq is distinct from target.seq then
    raise exception 'Удалить можно только последний чек серии (%) — этот исправьте или оформите возврат', last_seq;
  end if;

  delete from public.receipts where id = target.id;

  update public.document_sequences s
     set last_number = target.seq - 1,
         updated_at = now()
   where s.tenant_id = tenant_uuid
     and s.legal_entity_id is not distinct from target.company_id
     and s.doc_type = 'receipt'
     and s.year = target.year
     and s.last_number = target.seq;
end;
$function$
;
grant execute on function public.delete_receipt(p_receipt_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.delete_sole_owned_tenants_for_account(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_deleted_count integer := 0;
  v_fk record;
begin
  -- Grant checks are the first wall; the JWT-role assertion is a second wall
  -- against an accidental future EXECUTE grant.
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required for account cleanup'
      using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'account id is required'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('account-delete:' || p_user_id::text, 0)
  );

  -- Soft deletion is intentionally irreversible and blocks sign-in. Refuse
  -- to touch business data while the account is still active.
  if not exists (
    select 1
      from auth.users u
     where u.id = p_user_id
       and u.deleted_at is not null
  ) then
    raise exception 'account must be soft-deleted before tenant cleanup'
      using errcode = '55000';
  end if;

  -- Parent rows first, then every existing membership row in deterministic
  -- order. This stabilises sole-owner checks against role changes and keeps
  -- the lock order compatible with tenant cascades.
  perform t.id
    from public.tenants t
   where exists (
     select 1
       from public.tenant_members own
      where own.tenant_id = t.id
        and own.user_id = p_user_id
   )
   order by t.id
   for update of t;

  perform tm.user_id
    from public.tenant_members tm
   where tm.tenant_id in (
     select own.tenant_id
       from public.tenant_members own
      where own.user_id = p_user_id
   )
   order by tm.tenant_id, tm.user_id
   for update of tm;

  with doomed as materialized (
    select own.tenant_id
      from public.tenant_members own
     where own.user_id = p_user_id
       and own.role = 'owner'
       and not exists (
         select 1
           from public.tenant_members other_owner
          where other_owner.tenant_id = own.tenant_id
            and other_owner.role = 'owner'
            and other_owner.user_id <> p_user_id
       )
  ), deleted as (
    delete from public.tenants t
     using doomed d
     where t.id = d.tenant_id
    returning t.id
  )
  select count(*)::integer into v_deleted_count from deleted;

  -- A surviving co-owned tenant keeps its legal and financial history, but
  -- private calendar records authored by the deleted account do not belong
  -- to the remaining company members.
  delete from public.personal_event_types pet
   where pet.created_by = p_user_id;

  delete from public.appointments a
   where a.created_by = p_user_id
     and a.kind in ('event', 'personal');

  -- Nullable legacy attribution FKs were created with NO ACTION. Clear all
  -- such public-schema references generically so a later hard auth deletion
  -- cannot fail merely because the user created an invoice, account, master
  -- card, transaction, or work appointment in a surviving co-owned tenant.
  for v_fk in
    select ns.nspname as schema_name,
           child.relname as table_name,
           attr.attname as column_name
      from pg_constraint con
      join pg_class child on child.oid = con.conrelid
      join pg_namespace ns on ns.oid = child.relnamespace
      join pg_attribute attr
        on attr.attrelid = con.conrelid
       and attr.attnum = con.conkey[1]
     where con.contype = 'f'
       and con.confrelid = 'auth.users'::regclass
       and con.confdeltype in ('a', 'r')
       and array_length(con.conkey, 1) = 1
       and array_length(con.confkey, 1) = 1
       and ns.nspname = 'public'
       and not attr.attnotnull
  loop
    -- Attribution cleanup must not recalculate ledgers, reschedule pushes or
    -- run appointment finance sync. ACCESS EXCLUSIVE is held while USER
    -- triggers are disabled, so no concurrent writer can pass through the
    -- table during this short maintenance update. Constraint triggers remain
    -- enabled; any error aborts the transaction and rolls the DDL back.
    execute format(
      'alter table %I.%I disable trigger user',
      v_fk.schema_name,
      v_fk.table_name
    );
    execute format(
      'update %I.%I set %I = null where %I = $1',
      v_fk.schema_name,
      v_fk.table_name,
      v_fk.column_name,
      v_fk.column_name
    ) using p_user_id;
    execute format(
      'alter table %I.%I enable trigger user',
      v_fk.schema_name,
      v_fk.table_name
    );
  end loop;

  insert into public.account_deletion_cleanup (
    user_id,
    status,
    deleted_tenant_count,
    last_error_code,
    updated_at
  ) values (
    p_user_id,
    'tenant_data_deleted',
    v_deleted_count,
    null,
    now()
  )
  on conflict (user_id) do update
    set status = excluded.status,
        deleted_tenant_count = excluded.deleted_tenant_count,
        last_error_code = null,
        updated_at = excluded.updated_at;

  return v_deleted_count;
end;
$function$
;
grant execute on function public.delete_sole_owned_tenants_for_account(p_user_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.deleted_operation_ready(p_operation jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ready jsonb := p_operation;
  account uuid := nullif(p_operation->>'account_id', '')::uuid;
begin
  if account is not null and not exists (
    select 1 from public.accounts a where a.id = account and a.deleted_at is null
  ) then
    raise exception 'Счёт этой операции удалён — сначала верните его из «Удалённых счетов»'
      using errcode = '23503', hint = 'operation:account_deleted';
  end if;
  if ready->>'category_id' is not null and not exists (
    select 1 from public.finance_categories c where c.id = (ready->>'category_id')::uuid
  ) then
    ready := jsonb_set(ready, '{category_id}', 'null');
  end if;
  if ready->>'client_id' is not null and not exists (
    select 1 from public.clients c where c.id = (ready->>'client_id')::uuid
  ) then
    ready := jsonb_set(ready, '{client_id}', 'null');
  end if;
  if ready->>'appointment_id' is not null and not exists (
    select 1 from public.appointments a where a.id = (ready->>'appointment_id')::uuid
  ) then
    ready := jsonb_set(ready, '{appointment_id}', 'null');
  end if;
  if ready->>'debt_id' is not null and not exists (
    select 1 from public.debts d where d.id = (ready->>'debt_id')::uuid
  ) then
    ready := jsonb_set(ready, '{debt_id}', 'null');
  end if;
  -- Налога в снимке не было — и не будет: иначе триггер VAT навесил бы его
  -- по сегодняшним настройкам счёта, команды и компании.
  if ready->>'vat_amount' is null then
    ready := jsonb_set(ready, '{vat_mode}', '"none"');
  end if;
  return ready;
end;
$function$
;
grant execute on function public.deleted_operation_ready(p_operation jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.detach_client_memberships()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.clients member
     set memberships = coalesce((
           select jsonb_agg(m.value order by m.pos)
             from jsonb_array_elements(member.memberships) with ordinality as m(value, pos)
            where m.value ->> 'group_id' <> old.id::text
         ), '[]'::jsonb)
   where member.tenant_id = old.tenant_id
     and member.id <> old.id
     and member.memberships @> jsonb_build_array(jsonb_build_object('group_id', old.id::text));
  return null;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.document_prefix(p_entity legal_entities, p_doc_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case p_doc_type
    when 'invoice' then p_entity.invoice_prefix
    when 'receipt' then p_entity.receipt_prefix
    when 'credit_note' then p_entity.credit_note_prefix
  end
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.document_series_max_seq(p_tenant_id uuid, p_legal_entity_id uuid, p_doc_type text, p_year integer)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(case p_doc_type
    when 'receipt' then (
      select max(receipt.seq) from public.receipts receipt
       where receipt.tenant_id = p_tenant_id
         and receipt.company_id = p_legal_entity_id
         and receipt.year = p_year
    )
    else (
      select max(invoice.seq) from public.invoices invoice
       where invoice.tenant_id = p_tenant_id
         and invoice.company_id = p_legal_entity_id
         and invoice.kind = case p_doc_type when 'credit_note' then 'credit_note' else 'invoice' end
         and invoice.year = p_year
    )
  end, 0)
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.document_series_started(p_tenant_id uuid, p_legal_entity_id uuid, p_doc_type text, p_year integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case p_doc_type
    when 'receipt' then exists (
      select 1 from public.receipts receipt
       where receipt.tenant_id = p_tenant_id
         and receipt.company_id = p_legal_entity_id
         and receipt.year = p_year
    )
    else exists (
      select 1 from public.invoices invoice
       where invoice.tenant_id = p_tenant_id
         and invoice.company_id = p_legal_entity_id
         and invoice.kind = case p_doc_type when 'credit_note' then 'credit_note' else 'invoice' end
         and invoice.year = p_year
    )
  end
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.effective_vat_settings(p_team_id text)
 RETURNS TABLE(vat_mode text, vat_rate numeric, vat_exemption_note text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    coalesce(s.vat_mode, t.vat_mode) as vat_mode,
    coalesce(s.vat_rate, t.vat_rate) as vat_rate,
    coalesce(s.vat_exemption_note, t.vat_exemption_note) as vat_exemption_note
  from public.tenants t
  left join public.team_finance_settings s
    on s.tenant_id = t.id
   and s.team_id = p_team_id
  where t.id = public.current_tenant_id();
$function$
;
grant execute on function public.effective_vat_settings(p_team_id text) to anon;
grant execute on function public.effective_vat_settings(p_team_id text) to authenticated;
grant execute on function public.effective_vat_settings(p_team_id text) to service_role;

CREATE OR REPLACE FUNCTION public.enforce_appointment_event_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'UPDATE'
     and auth.uid() is not null
     and (
       (old.kind in ('event', 'personal'))
       is distinct from
       (new.kind in ('event', 'personal'))
     ) then
    raise exception 'appointment kind cannot cross the work/event boundary'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and auth.uid() is not null
     and old.kind in ('event', 'personal')
     and new.created_by is distinct from old.created_by then
    raise exception 'event creator is immutable'
      using errcode = '42501';
  end if;

  -- The legacy schema used globally-unconstrained client UUIDs and tenant-local
  -- text ids for teams/masters. RLS protects the appointment row itself, but a
  -- caller could otherwise attach an active-tenant row to a foreign-tenant
  -- client UUID or to an orphan team/master id. Validate every non-null
  -- reference in this SECURITY DEFINER trigger so direct PostgREST writes and
  -- RPC writes have the same tenant boundary.
  if new.client_id is not null and not exists (
    select 1
      from public.clients c
     where c.tenant_id = new.tenant_id
       and c.id = new.client_id
  ) then
    raise exception 'appointment client belongs to another tenant or is missing'
      using errcode = '23503';
  end if;

  if new.team_id is not null then
    if nullif(btrim(new.team_id), '') is null then
      raise exception 'appointment team id cannot be empty'
        using errcode = '22023';
    end if;
    if not exists (
      select 1
        from public.teams t
       where t.tenant_id = new.tenant_id
         and t.id = new.team_id
    ) then
      raise exception 'appointment team belongs to another tenant or is missing'
        using errcode = '23503';
    end if;
  end if;

  if new.master_id is not null then
    if nullif(btrim(new.master_id), '') is null then
      raise exception 'appointment master id cannot be empty'
        using errcode = '22023';
    end if;
    if not exists (
      select 1
        from public.masters m
       where m.tenant_id = new.tenant_id
         and m.id = new.master_id
    ) then
      raise exception 'appointment master belongs to another tenant or is missing'
        using errcode = '23503';
    end if;
  end if;

  if new.kind in ('event', 'personal') then
    -- trg_appointments_set_created_by runs first (trigger names are ordered),
    -- so an authenticated event always reaches this guard with its real author.
    if auth.uid() is not null
       and new.created_by is distinct from auth.uid() then
      raise exception 'event creator must match the authenticated user'
        using errcode = '42501';
    end if;

  end if;

  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.enforce_client_memberships()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller_role text;
  kept text[];
  fresh text[];
  seen_ids text[];
begin
  if new.memberships is null or jsonb_typeof(new.memberships) <> 'array' then
    raise exception 'client memberships must be an array'
      using errcode = '22023';
  end if;

  -- Связь — объект с id карточки; на себя и на карточку чужой компании — нет.
  if exists (
    select 1
      from jsonb_array_elements(new.memberships) m
     where jsonb_typeof(m.value) <> 'object'
        or coalesce(m.value ->> 'group_id', '')
           !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or m.value ->> 'group_id' = new.id::text
        or exists (
          select 1 from public.clients other
           where other.id::text = m.value ->> 'group_id'
             and other.tenant_id <> new.tenant_id
        )
  ) then
    raise exception 'client memberships must point to other clients of the same company'
      using errcode = '22023';
  end if;

  -- ЦЕЛЬ СВЯЗИ — ВНУТРИ НАБОРА СОТРУДНИКА (STORY-086, дыра 8 критика).
  -- Право править спрашивается по ПРАВИМОЙ строке, а карточка-группа — строка
  -- чужая: зная uuid, сотрудник привязал бы своего клиента к карточке, которую
  -- ему не показывает уровень «Какие клиенты», и обратный список владельца
  -- пополнился бы чужой рукой. Судим только НОВЫЕ цели: уже стоящую связь
  -- сотрудник обязан уметь пронести через правку имени или заметки, иначе один
  -- запрет запер бы всю карточку. Владельца и внутренние ходы (миграции, чистка
  -- корзины — там `auth.uid()` пуст) правило не касается.
  caller_role := case when auth.uid() is null then null else public.current_user_role() end;
  if caller_role is not null and caller_role <> 'owner'
     and jsonb_array_length(new.memberships) > 0 then
    if tg_op = 'UPDATE' then
      select coalesce(array_agg(distinct m.value ->> 'group_id'), array[]::text[])
        into kept
        from jsonb_array_elements(coalesce(old.memberships, '[]'::jsonb)) m;
    else
      kept := array[]::text[];
    end if;

    select coalesce(array_agg(distinct m.value ->> 'group_id'), array[]::text[])
      into fresh
      from jsonb_array_elements(new.memberships) m
     where not (m.value ->> 'group_id' = any(kept));

    if cardinality(fresh) > 0 then
      select coalesce(array_agg(seen.id::text), array[]::text[])
        into seen_ids
        from unnest(public.access_client_ids()) as seen(id);
      if exists (select 1 from unnest(fresh) f where not (f = any(seen_ids))) then
        raise exception 'client memberships must point to clients this employee can see'
          using errcode = '42501', hint = 'block:clients.scope';
      end if;
    end if;
  end if;

  -- Одна связь на карточку И МЕСТО, роль — обрезанный текст, лишних ключей нет;
  -- карточка, которой больше нет, из списка уходит.
  --
  -- МЕСТО СВЕРЯЕТСЯ С ОБЪЕКТАМИ САМОЙ КАРТОЧКИ-ГРУППЫ: чужое или уже стёртое —
  -- `null`, а САМА СВЯЗЬ ЖИВЁТ: человек не перестал быть жильцом Натальи
  -- оттого, что виллу стёрли. Эта же сверка держит ключ узким — свободного
  -- текста в связи не бывает, и контакт мимо маскировки в ней не провезти.
  -- Дедуп идёт по ПАРЕ (карточка, место): один человек законно жилец двух
  -- вилл одной управляющей, и это не дубль.
  new.memberships := coalesce((
    select jsonb_agg(
             jsonb_strip_nulls(jsonb_build_object(
               'group_id', d.group_id,
               'role', d.role,
               'location_id', d.location_id
             )) order by d.pos)
      from (
        select distinct on (v.group_id, v.location_id)
               v.group_id, v.role, v.location_id, v.pos
          from (
            select m.value ->> 'group_id' as group_id,
                   btrim(coalesce(m.value ->> 'role', '')) as role,
                   (
                     select l.value ->> 'id'
                       from public.clients g
                       cross join lateral jsonb_array_elements(
                         case when jsonb_typeof(g.locations) = 'array'
                              then g.locations else '[]'::jsonb end
                       ) l
                      where g.id::text = m.value ->> 'group_id'
                        and g.tenant_id = new.tenant_id
                        and l.value ->> 'id' = m.value ->> 'location_id'
                      limit 1
                   ) as location_id,
                   m.pos
              from jsonb_array_elements(new.memberships) with ordinality as m(value, pos)
             where exists (
               select 1 from public.clients g
                where g.id::text = m.value ->> 'group_id'
                  and g.tenant_id = new.tenant_id
             )
          ) v
         order by v.group_id, v.location_id, v.pos
      ) d
  ), '[]'::jsonb);
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.enforce_client_reference_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.referred_by_client_id is not null then
    if new.referred_by_client_id = new.id then
      raise exception 'client cannot refer itself'
        using errcode = '23514';
    end if;
    if not exists (
      select 1
        from public.clients referrer
       where referrer.tenant_id = new.tenant_id
         and referrer.id = new.referred_by_client_id
    ) then
      raise exception 'referring client does not belong to the client tenant'
        using errcode = '23503';
    end if;
  end if;

  if new.favorite_master_id is not null and not exists (
    select 1
      from public.masters master
     where master.tenant_id = new.tenant_id
       and master.id = new.favorite_master_id
  ) then
    raise exception 'favorite master does not belong to the client tenant'
      using errcode = '23503';
  end if;

  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.enforce_client_tag_assignment_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1
      from public.clients client
     where client.tenant_id = new.tenant_id
       and client.id = new.client_id
  ) then
    raise exception 'assigned client does not belong to the assignment tenant'
      using errcode = '23503';
  end if;

  if not exists (
    select 1
      from public.client_tags tag
     where tag.tenant_id = new.tenant_id
       and tag.id = new.tag_id
  ) then
    raise exception 'assigned tag does not belong to the assignment tenant'
      using errcode = '23503';
  end if;

  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.enforce_plan_limits()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_plan text;
  v_limit integer;
  v_count integer;
begin
  if new.tenant_id is null then
    raise exception 'ограничение тарифа требует tenant_id' using errcode = '22023';
  end if;

  v_plan := public.tenant_effective_plan(new.tenant_id);

  -- Календари: новый или возвращённый из архива — в пределах лимита.
  if tg_table_name = 'teams' then
    if not new.is_active then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.is_active then
      return new;
    end if;
    v_limit := public.tenant_tier_limit(new.tenant_id, 'teams');
    select count(*)::integer into v_count
      from public.teams tm
     where tm.tenant_id = new.tenant_id
       and tm.is_active
       and tm.id <> new.id;
    if v_count >= v_limit then
      raise exception '%', case v_plan
          when 'pro' then 'В пробном Про — до 5 календарей'
          else 'Новые календари — после оплаты'
        end
        using errcode = 'P0001', hint = 'plan:teams';
    end if;
    return new;
  end if;

  -- Партнёры: приглашение — в пределах лимита (люди и ждущие приглашения).
  if tg_table_name = 'invitations' then
    if new.accepted_at is not null or new.expires_at <= statement_timestamp() then
      return new;
    end if;
    -- Тот же человек ещё раз (повтор ссылки, другая команда) — не новый партнёр.
    if exists (
      select 1
        from public.invitations i
       where i.tenant_id = new.tenant_id
         and lower(i.email) = lower(new.email)
         and i.id is distinct from new.id
         and i.accepted_at is null
         and i.expires_at > statement_timestamp()
    ) then
      return new;
    end if;
    v_limit := public.tenant_tier_limit(new.tenant_id, 'partners');
    select count(*)::integer into v_count
      from (
        select m.user_id::text as who
          from public.tenant_members m
         where m.tenant_id = new.tenant_id
           and m.role <> 'owner'
        union
        select lower(i.email)
          from public.invitations i
         where i.tenant_id = new.tenant_id
           and i.accepted_at is null
           and i.expires_at > statement_timestamp()
      ) people;
    if v_count >= v_limit then
      raise exception '%', case v_plan
          when 'pro' then 'В пробном Про — до 5 партнёров'
          else 'Партнёры — после оплаты календарей'
        end
        using errcode = 'P0001', hint = 'plan:partners';
    end if;
    return new;
  end if;

  -- Команда сверх лимита — только для просмотра.
  -- `team_id` есть не у каждой таблицы этого сторожа (у инвойса команда —
  -- `brigade_id`): PL/pgSQL разбирает выражение целиком до проверки имени
  -- таблицы, и `new.team_id` ронял любую вставку инвойса (аудит 03.10).
  if tg_table_name in ('appointments', 'clients')
     and (to_jsonb(new) ->> 'team_id') is not null
     and not public.team_is_working(new.tenant_id, to_jsonb(new) ->> 'team_id') then
    raise exception 'Эта команда сверх тарифа — только для просмотра'
      using errcode = 'P0001', hint = 'plan:team-frozen';
  end if;

  if v_plan is distinct from 'free' then
    return new;
  end if;

  if tg_table_name = 'appointments' then
    if new.kind = 'work' then
      raise exception 'Записывать клиентов можно после оплаты календаря'
        using errcode = 'P0001', hint = 'plan:book-clients';
    end if;
    return new;
  end if;

  if tg_table_name = 'clients' then
    raise exception 'Клиенты — после оплаты календаря'
      using errcode = 'P0001', hint = 'plan:clients';
  end if;

  if tg_table_name = 'services' then
    raise exception 'Услуги доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:services';
  end if;

  if tg_table_name = 'masters' then
    raise exception 'Мастера доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:masters';
  end if;

  if tg_table_name = 'invoices' then
    -- Сторно уже выписанного инвойса своей компании проходит на любом тарифе.
    if new.kind = 'credit_note' and exists (
      select 1
        from public.invoices original
       where original.id = new.credit_note_of_id
         and original.tenant_id = new.tenant_id
         and original.kind = 'invoice'
    ) then
      return new;
    end if;
    raise exception 'Документы доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:documents';
  end if;

  if tg_table_name = 'receipts' then
    raise exception 'Документы доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:documents';
  end if;

  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.enforce_tenant_insert_quota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_limit integer;
  v_current integer;
  v_pending integer;
  v_projected integer;
  v_has_reserved_invitation boolean := false;
  v_month_start timestamptz;
begin
  if new.tenant_id is null then
    raise exception 'quota guard requires tenant_id'
      using errcode = '22023';
  end if;

  if tg_table_schema <> 'public' then
    raise exception 'quota guard attached outside public schema'
      using errcode = '55000';
  end if;

  if tg_table_name = 'clients' then
    perform pg_advisory_xact_lock(
      hashtextextended('tenant-quota:clients:' || new.tenant_id::text, 0)
    );

    v_limit := public.tenant_quota_clients(new.tenant_id);
    select count(*)::integer
      into v_current
      from public.clients client
     where client.tenant_id = new.tenant_id;

    if v_current >= v_limit then
      raise exception 'quota_exceeded: clients %/%', v_current, v_limit
        using errcode = 'P0001',
              detail = 'quota_exceeded:clients';
    end if;
    return new;
  end if;

  if tg_table_name = 'appointments' then
    if tg_op = 'UPDATE' then
      if new.created_at is distinct from old.created_at then
        raise exception 'appointment created_at is server-owned and immutable'
          using errcode = '22023';
      end if;
      return new;
    end if;

    -- Match the billing UI/repository contract: usage belongs to the UTC
    -- calendar month in which the server received the row, not the scheduled
    -- date. Stamping + immutability closes the direct-PostgREST backdating
    -- bypass while leaving the operational appointment date untouched.
    new.created_at := statement_timestamp();
    -- Личное событие квоту не тратит (аудит 2026-09-29).
    if new.kind is distinct from 'work' then
      return new;
    end if;
    v_month_start := date_trunc(
      'month',
      timezone('UTC', new.created_at)
    ) at time zone 'UTC';

    perform pg_advisory_xact_lock(
      hashtextextended(
        'tenant-quota:appointments-month:' || new.tenant_id::text,
        0
      )
    );

    v_limit := public.tenant_quota_appointments_month(new.tenant_id);
    select count(*)::integer
      into v_current
      from public.appointments appointment
     where appointment.tenant_id = new.tenant_id
       and appointment.created_at >= v_month_start
       and appointment.kind = 'work'
       and appointment.created_at < v_month_start + interval '1 month';

    if v_current >= v_limit then
      raise exception 'quota_exceeded: appointments_month %/%',
        v_current, v_limit
        using errcode = 'P0001',
              detail = 'quota_exceeded:appointments_month';
    end if;
    return new;
  end if;

  if tg_table_name = 'invitations' then
    -- Accepted or already-expired audit rows do not reserve a team slot.
    if new.accepted_at is not null or new.expires_at <= statement_timestamp() then
      return new;
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('tenant-quota:team-members:' || new.tenant_id::text, 0)
    );

    v_limit := public.tenant_quota_team_members(new.tenant_id);
    select count(*)::integer
      into v_current
      from public.tenant_members member
     where member.tenant_id = new.tenant_id;
    select count(*)::integer
      into v_pending
      from public.invitations invitation
     where invitation.tenant_id = new.tenant_id
       and invitation.accepted_at is null
       and invitation.expires_at > statement_timestamp();

    v_projected := v_current + v_pending + 1;
    if v_projected > v_limit then
      raise exception 'quota_exceeded: team_members %/%',
        v_current + v_pending, v_limit
        using errcode = 'P0001',
              detail = 'quota_exceeded:team_members';
    end if;
    return new;
  end if;

  if tg_table_name = 'tenant_members' then
    perform pg_advisory_xact_lock(
      hashtextextended('tenant-quota:team-members:' || new.tenant_id::text, 0)
    );

    v_limit := public.tenant_quota_team_members(new.tenant_id);
    select count(*)::integer
      into v_current
      from public.tenant_members member
     where member.tenant_id = new.tenant_id;
    select count(*)::integer
      into v_pending
      from public.invitations invitation
     where invitation.tenant_id = new.tenant_id
       and invitation.accepted_at is null
       and invitation.expires_at > statement_timestamp();

    -- accept_invitation() and invited handle_new_user() insert membership
    -- before stamping accepted_at. Match that user's active bearer row so the
    -- pending reservation is converted, not double-counted. Ordinary owner
    -- bootstrap has no reservation and naturally consumes the Free slot 1/1.
    select exists (
      select 1
        from auth.users account
        join public.invitations invitation
          on invitation.tenant_id = new.tenant_id
         and lower(invitation.email) = lower(coalesce(account.email, ''))
       where account.id = new.user_id
         and invitation.accepted_at is null
         and invitation.expires_at > statement_timestamp()
         and invitation.role = new.role
         and invitation.master_id is not distinct from new.master_id
    ) into v_has_reserved_invitation;

    v_projected := v_current + v_pending
      + case when v_has_reserved_invitation then 0 else 1 end;
    if v_projected > v_limit then
      raise exception 'quota_exceeded: team_members %/%',
        v_current + v_pending, v_limit
        using errcode = 'P0001',
              detail = 'quota_exceeded:team_members';
    end if;
    return new;
  end if;

  raise exception 'quota guard attached to unsupported table %', tg_table_name
    using errcode = '55000';
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.ensure_personal_space(p_user uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_meta jsonb;
  v_email text;
  v_name text;
begin
  select t.id into v_tenant from public.tenants t where t.personal_of = p_user;
  if v_tenant is not null then
    return v_tenant;
  end if;

  select coalesce(u.raw_user_meta_data, '{}'::jsonb), u.email
    into v_meta, v_email
    from auth.users u
   where u.id = p_user;
  if not found then
    raise exception 'нет такого человека' using errcode = '22023';
  end if;

  v_name := coalesce(
    nullif(btrim(v_meta ->> 'full_name'), ''),
    nullif(btrim(v_meta ->> 'business_name'), ''),
    nullif(split_part(coalesce(v_email, ''), '@', 1), ''),
    'Личное'
  );

  insert into public.tenants (name, vertical, onboarded_at, kind, personal_of, created_by)
  values (v_name, 'other', now(), 'personal', p_user, p_user)
  returning id into v_tenant;

  insert into public.tenant_members (tenant_id, user_id, role, joined_at)
  values (v_tenant, p_user, 'owner', now());

  insert into public.calendar_settings (tenant_id)
  values (v_tenant)
  on conflict (tenant_id) do nothing;

  insert into public.teams (id, tenant_id, name, payout_percentage)
  values (
    'team-' || replace(gen_random_uuid()::text, '-', ''),
    v_tenant,
    public.personal_calendar_name(v_meta ->> 'locale'),
    30
  );

  return v_tenant;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.fill_money_team()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  found_team text;
begin
  if tg_table_name = 'finance_transactions' then
    if new.team_id is null then
      select a.brigade_id into found_team from public.accounts a where a.id = new.account_id and a.tenant_id = new.tenant_id;
      if found_team is null and new.invoice_id is not null then
        select i.brigade_id into found_team from public.invoices i where i.id = new.invoice_id and i.tenant_id = new.tenant_id;
      end if;
      if found_team is null and new.appointment_id is not null then
        select ap.team_id into found_team from public.appointments ap where ap.id = new.appointment_id and ap.tenant_id = new.tenant_id;
      end if;
      if found_team is null and new.debt_id is not null then
        select d.team_id into found_team from public.debts d where d.id = new.debt_id and d.tenant_id = new.tenant_id;
      end if;
      new.team_id := found_team;
    end if;
    if new.team_id is null then
      raise exception using errcode = '23502', message = 'Операция без команды не записывается: выберите команду или счёт команды';
    end if;
  elsif tg_table_name = 'invoices' then
    if new.brigade_id is null then
      if new.credit_note_of_id is not null then
        select i.brigade_id into found_team from public.invoices i where i.id = new.credit_note_of_id and i.tenant_id = new.tenant_id;
      end if;
      if found_team is null and new.account_id is not null then
        select a.brigade_id into found_team from public.accounts a where a.id = new.account_id and a.tenant_id = new.tenant_id;
      end if;
      if found_team is null and new.appointment_id is not null then
        select ap.team_id into found_team from public.appointments ap where ap.id = new.appointment_id and ap.tenant_id = new.tenant_id;
      end if;
      new.brigade_id := found_team;
    end if;
    if new.brigade_id is null then
      raise exception using errcode = '23502', message = 'Инвойс без команды не выставляется: выберите команду';
    end if;
  elsif tg_table_name = 'receipts' then
    if new.team_id is null then
      if new.transaction_id is not null then
        select f.team_id into found_team from public.finance_transactions f where f.id = new.transaction_id and f.tenant_id = new.tenant_id;
      end if;
      if found_team is null and new.invoice_id is not null then
        select i.brigade_id into found_team from public.invoices i where i.id = new.invoice_id and i.tenant_id = new.tenant_id;
      end if;
      if found_team is null and new.account_id is not null then
        select a.brigade_id into found_team from public.accounts a where a.id = new.account_id and a.tenant_id = new.tenant_id;
      end if;
      if found_team is null and new.appointment_id is not null then
        select ap.team_id into found_team from public.appointments ap where ap.id = new.appointment_id and ap.tenant_id = new.tenant_id;
      end if;
      new.team_id := found_team;
    end if;
    if new.team_id is null then
      raise exception using errcode = '23502', message = 'Чек без команды не выписывается: у денег нет команды';
    end if;
  elsif tg_table_name = 'finance_templates' then
    if new.brigade_id is null and new.account_id is not null then
      select a.brigade_id into new.brigade_id from public.accounts a where a.id = new.account_id and a.tenant_id = new.tenant_id;
    end if;
    if new.brigade_id is null then
      raise exception using errcode = '23502', message = 'Шаблон без команды не сохраняется: выберите команду';
    end if;
  elsif tg_table_name = 'finance_transfer_requests' then
    if new.team_id is null then
      select a.brigade_id into new.team_id from public.accounts a where a.id = new.from_account_id and a.tenant_id = new.tenant_id;
    end if;
    if new.team_id is null then
      raise exception using errcode = '23502', message = 'Перевод без команды не записывается: выберите счёт команды';
    end if;
  elsif tg_table_name = 'debts' then
    if new.team_id is null then
      raise exception using errcode = '23502', message = 'Долг без команды не записывается: выберите команду';
    end if;
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.fill_transaction_vat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_mode text;
  mode text;
  rate numeric;
  original public.finance_transactions%rowtype;
  snapshot_sent boolean := false;
begin
  -- Перевод — не событие для налога: деньги не пришли и не ушли, они просто
  -- сменили карман.
  if new.type = 'transfer' then
    new.vat_rate := null;
    new.vat_amount := null;
    return new;
  end if;

  -- «Без НДС» сказано вслух — молчим, даже если у компании налог включён и
  -- даже если пришёл готовый снимок. Это самое сильное правило в функции.
  if new.vat_mode = 'none' then
    new.vat_rate := null;
    new.vat_amount := null;
    return new;
  end if;

  -- Возврат зеркалит исходный доход: та же ставка, пропорциональная доля
  -- налога. Знаки сходятся сами: сумма возврата отрицательная.
  if new.type = 'refund' and new.refund_of_id is not null then
    select * into original
      from public.finance_transactions
     where id = new.refund_of_id;
    if found then
      if original.vat_amount is null or coalesce(original.amount, 0) = 0 then
        new.vat_rate := null;
        new.vat_amount := null;
      else
        new.vat_rate := original.vat_rate;
        new.vat_amount := round(original.vat_amount * new.amount / original.amount, 2);
      end if;
      return new;
    end if;
  end if;

  -- ЦЕЛЫЙ СНИМОК СТРОКИ БЕЗ ИНВОЙСА: режим «в цене» или «сверху», ставка и
  -- налог. Налог всегда выделен из суммы — «сверху» к этому моменту уже
  -- поднял сумму до брутто, и выделение возвращает тот же цент (A10).
  -- Инвойсная строка сюда не заходит: её налог — доля напечатанного на бумаге.
  if new.invoice_id is null
     and new.vat_mode in ('inclusive', 'exclusive')
     and new.vat_rate is not null
     and new.vat_amount is not null then
    -- Прислан — значит вставка или правка, сменившая ставку или налог. Иначе
    -- это снимок, перенесённый со старой строки.
    if tg_op = 'INSERT' then
      snapshot_sent := true;
    else
      snapshot_sent := new.vat_rate is distinct from old.vat_rate
        or new.vat_amount is distinct from old.vat_amount;
    end if;

    -- Ставку проверяем отдельной веткой и первой: при ставке −100 формула
    -- ниже делила бы на ноль.
    if new.vat_rate <= 0 or new.vat_rate >= 100 then
      if snapshot_sent then
        raise exception 'Ставка VAT должна быть больше 0 и меньше 100'
          using hint = 'vat:snapshot';
      end if;
    elsif snapshot_sent and round(new.vat_rate, 2) <> new.vat_rate then
      raise exception 'Ставка VAT — не больше двух знаков после запятой'
        using hint = 'vat:snapshot';
    elsif new.vat_amount = round(new.amount * new.vat_rate / (100 + new.vat_rate), 2) then
      -- Сходится — храним, присланный он или перенесённый: это налог по
      -- ставке самой строки, и сменой режима или суммы его не отменить.
      return new;
    elsif snapshot_sent then
      raise exception 'VAT % не сходится с суммой %: при ставке % %% налог — %',
        new.vat_amount, new.amount, new.vat_rate,
        round(new.amount * new.vat_rate / (100 + new.vat_rate), 2)
        using hint = 'vat:snapshot';
    end if;
    -- Перенесённый снимок не сходится с новой суммой — это обычная правка
    -- суммы: дальше как всегда.
  end if;

  if tg_op = 'UPDATE' then
    -- Клиент прислал НОВЫЙ снимок сознательно — уважаем его.
    if new.vat_amount is not null
       and new.vat_amount is distinct from old.vat_amount then
      return new;
    end if;
    -- Инвойсная строка напечатана на бумаге; экономические правки таких
    -- строк и так запрещены защитными триггерами.
    if new.invoice_id is not null then
      return new;
    end if;
    -- СТАРАЯ СТРОКА БЕЗ РЕЖИМА (A9). Режим пришёл, сумма та же, а ставку или
    -- налог правка обнулила — прежний снимок остаётся, если он сходится с
    -- суммой. Несходящийся налог под новым режимом не замораживаем: он
    -- пересобирается по настройкам ниже, как раньше.
    if old.vat_mode is null
       and new.vat_mode in ('inclusive', 'exclusive')
       and new.amount is not distinct from old.amount
       and old.vat_rate > 0 and old.vat_rate < 100
       and old.vat_amount = round(old.amount * old.vat_rate / (100 + old.vat_rate), 2) then
      new.vat_rate := old.vat_rate;
      new.vat_amount := old.vat_amount;
      return new;
    end if;
    if new.vat_mode is not distinct from old.vat_mode then
      -- Изменилась сумма: пересчитываем налог по ставке самой операции.
      if old.vat_rate is not null then
        new.vat_rate := old.vat_rate;
        new.vat_amount := round(new.amount * old.vat_rate / (100 + old.vat_rate), 2);
      else
        new.vat_rate := null;
        new.vat_amount := null;
      end if;
      return new;
    end if;
    -- Режим сменили явно — снимок пересобирается по настройкам ниже.
    new.vat_rate := null;
    new.vat_amount := null;
  end if;

  -- Явно переданный снимок уважаем: инвойс печатает свою ставку и она уже
  -- напечатана на бумаге — пересчитывать её задним числом нельзя.
  if new.vat_amount is not null then
    return new;
  end if;

  -- Режим: счёт → команда → компания. Ставка: команда → компания (у счёта
  -- своей ставки нет — её задаёт страна работы команды).
  -- «С НДС» у счёта (`on`) включает налог, но не выбирает, как его считать:
  -- режим берётся у команды, а выключенный у команды — у компании.
  select t.vat_mode,
         case
           when a.vat_mode = 'on' then coalesce(nullif(s.vat_mode, 'off'), t.vat_mode)
           else coalesce(a.vat_mode, s.vat_mode, t.vat_mode)
         end,
         coalesce(s.vat_rate, t.vat_rate)
    into tenant_mode, mode, rate
    from public.tenants t
    left join public.team_finance_settings s
      on s.tenant_id = t.id and s.team_id = new.team_id
    left join public.accounts a
      on a.id = new.account_id and a.tenant_id = t.id
   where t.id = new.tenant_id;

  if tenant_mode is null or tenant_mode = 'off'
     or mode is null or mode = 'off' or coalesce(rate, 0) <= 0 then
    new.vat_rate := null;
    new.vat_amount := null;
    return new;
  end if;

  new.vat_rate := rate;
  -- Из ВАЛОВОЙ суммы: в кассу пришло 480, налог внутри — 80.
  -- Знак сохраняем (возврат уносит и налог).
  new.vat_amount := round(new.amount * rate / (100 + rate), 2);
  return new;
end;
$function$
;
grant execute on function public.fill_transaction_vat() to anon;
grant execute on function public.fill_transaction_vat() to authenticated;
grant execute on function public.fill_transaction_vat() to service_role;

CREATE OR REPLACE FUNCTION public.format_document_number(p_prefix text, p_year integer, p_seq integer, p_padding integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select p_prefix || '-' || p_year::text || '-'
      || lpad(p_seq::text, greatest(coalesce(p_padding, 4), length(p_seq::text)), '0')
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.freeze_appointment_materials()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Колонка сервера: присланное приложением не принимается.
  if tg_op = 'INSERT' then
    new.material_lines := null;
  elsif new.material_lines is distinct from old.material_lines then
    new.material_lines := old.material_lines;
  end if;

  if new.status = 'completed' then
    if tg_op = 'INSERT'
       or old.status is distinct from 'completed'
       or new.services is distinct from old.services
       or new.service_ids is distinct from old.service_ids
       or new.material_lines is null then
      new.material_lines := public.appointment_material_lines(
        new.tenant_id, new.services, new.service_ids
      );
    end if;
  else
    new.material_lines := null;
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.grant_full_company_access(p_tenant uuid, p_user uuid, p_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.member_calendars (tenant_id, user_id, team_id, attached_by, attached_at)
  select p_tenant, p_user, t.id, p_by, now()
    from public.teams t
   where t.tenant_id = p_tenant and t.is_active
  on conflict (tenant_id, user_id, team_id) do nothing;

  delete from public.member_access ma
   where ma.tenant_id = p_tenant and ma.user_id = p_user;

  insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
  select p_tenant, p_user, b.key, t.id, b.levels[array_length(b.levels, 1)], p_by, now()
    from public.access_blocks b
    join public.teams t on t.tenant_id = p_tenant and t.is_active
   where b.live and not b.owner_only and b.scope = 'calendar';

  insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
  select p_tenant, p_user, b.key, null, b.levels[array_length(b.levels, 1)], p_by, now()
    from public.access_blocks b
   where b.live and not b.owner_only and b.scope = 'company';
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.grant_invitation_calendar(p_invitation invitations, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_master_id text := p_invitation.master_id;
  v_team_ids text[];
  v_changes jsonb;
begin
  if p_user_id is null then
    return;
  end if;

  -- create_invitation отказывает архивным календарям, но календарь могут
  -- заархивировать или удалить между приглашением и приёмом: такой календарь
  -- пропускается, остальное приглашение применяется.
  select coalesce(array_agg(x.team_id order by x.ord), array[]::text[])
    into v_team_ids
    from unnest(coalesce(p_invitation.team_ids, array[p_invitation.team_id]))
         with ordinality as x(team_id, ord)
   where x.team_id is not null
     and exists (
       select 1 from public.teams t
        where t.tenant_id = p_invitation.tenant_id
          and t.id = x.team_id
          and t.is_active
     );

  if cardinality(v_team_ids) > 0 then
    -- Домашний календарь могли заархивировать: карточка мастера получает
    -- первый ЖИВОЙ календарь приглашения, а не архивный.
    p_invitation.team_id := v_team_ids[1];

    -- 1. Прикрепление ко ВСЕМ календарям приглашения (права по блокам): без
    --    него владелец не видит человека в людях календаря, а уровни
    --    календарных блоков некуда положить.
    insert into public.member_calendars (tenant_id, user_id, team_id, attached_by)
    select p_invitation.tenant_id, p_user_id, x.team_id, p_invitation.invited_by_user_id
      from unnest(v_team_ids) as x(team_id)
    on conflict (tenant_id, user_id, team_id) do nothing;

    -- 2. Мастер без карточки получает свою карточку (15.09): без неё его не
    --    назначить в запись, а статус и фото сервер пускает по карточке.
    if p_invitation.role = 'master' and p_invitation.master_id is null then
      v_master_id := public.attach_invited_master_card(p_invitation, p_user_id);
    end if;

    -- 3. Сегодняшние права календаря — после карточки: строка несёт её номер.
    insert into public.calendar_members (tenant_id, team_id, user_id, master_id, grants)
    select p_invitation.tenant_id,
           x.team_id,
           p_user_id,
           v_master_id,
           case p_invitation.role
             when 'dispatcher' then array['view','book','edit_all','clients','phones']::text[]
             else array['view']::text[]
           end
      from unnest(v_team_ids) as x(team_id)
    on conflict (tenant_id, team_id, user_id) do nothing;

    perform public.seed_records_level(p_invitation.tenant_id, p_user_id, p_invitation.invited_by_user_id);
  end if;

  -- 4. Уровни, выставленные владельцем до «Пригласить» (15.09), — тем же
  --    писателем, что у экрана прав. Только для прикреплённых календарей и
  --    блоков, которые ещё есть в реестре: исчезнувшее пропускается, приём
  --    не ломается.
  select coalesce(jsonb_agg(c.change order by c.ord), '[]'::jsonb)
    into v_changes
    from jsonb_array_elements(
           case when jsonb_typeof(p_invitation.access_changes) = 'array'
                then p_invitation.access_changes
                else '[]'::jsonb
           end
         ) with ordinality as c(change, ord)
    join public.access_blocks b
      on b.key = c.change ->> 'block'
     and not b.owner_only
   where jsonb_typeof(c.change) = 'object'
     and coalesce((c.change ->> 'level') = any(b.levels), false)
     and case b.scope
           when 'calendar' then coalesce(nullif(c.change ->> 'team_id', '') = any(v_team_ids), false)
           else nullif(c.change ->> 'team_id', '') is null
         end;

  if jsonb_array_length(v_changes) > 0 then
    perform public.access_apply_changes(
      p_invitation.tenant_id, p_user_id, v_changes, p_invitation.invited_by_user_id
    );
  end if;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.guard_account_delete_with_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tx_count integer;
  receipt_count integer;
  template_count integer;
  appointment_count integer;
begin
  -- Каскад от удаления самого тенанта пропускаем: там уносится всё вместе.
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;

  select count(*) into tx_count
    from public.finance_transactions where account_id = old.id;
  -- Операции в «Удалённых операциях» вернутся на этот счёт — тоже история.
  tx_count := tx_count + (
    select count(*) from public.deleted_operations d
     where d.operation->>'account_id' = old.id::text
  );
  select count(*) into receipt_count
    from public.receipts where account_id = old.id;
  select count(*) into template_count
    from public.finance_templates where account_id = old.id;
  select count(*) into appointment_count
    from public.appointments where payment_account_id = old.id;

  if tx_count > 0 or receipt_count > 0 or appointment_count > 0 then
    raise exception
      'Счёт «%» нельзя удалить: на нём % операц., % чек(ов), % оплат по заявкам. Закройте счёт — история останется целой.',
      old.name, tx_count, receipt_count, appointment_count;
  end if;

  -- Шаблон операции — не деньги, его можно просто отвязать.
  if template_count > 0 then
    update public.finance_templates set account_id = null where account_id = old.id;
  end if;

  return old;
end;
$function$
;
grant execute on function public.guard_account_delete_with_history() to anon;
grant execute on function public.guard_account_delete_with_history() to authenticated;
grant execute on function public.guard_account_delete_with_history() to service_role;

CREATE OR REPLACE FUNCTION public.guard_account_financial_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ledger_balance numeric(14,2);
  legacy_conversion boolean := false;
begin
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return new;
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'Компания финансового счёта неизменяема';
  end if;

  -- Единственный легальный переход охвата: общий счёт становится счётом
  -- бригады, к которой он и был подключён.
  legacy_conversion := old.scope = 'company'
    and new.scope = 'team'
    and new.brigade_id is not null
    and exists (
      select 1 from public.account_teams at
       where at.account_id = old.id and at.team_id = new.brigade_id
    );

  if new.scope is distinct from old.scope
     and not legacy_conversion
     and exists (
       select 1 from public.finance_transactions where account_id = old.id
     ) then
    raise exception 'Тип охвата счёта с операциями нельзя изменить';
  end if;
  if new.brigade_id is distinct from old.brigade_id
     and not legacy_conversion
     and exists (
       select 1 from public.finance_transactions where account_id = old.id
     ) then
    raise exception 'Команду счёта с операциями нельзя изменить';
  end if;
  if new.kind is distinct from old.kind and exists (
    select 1 from public.finance_transactions where account_id = old.id
  ) then
    raise exception 'Тип счёта с операциями нельзя изменить';
  end if;
  if new.opening_balance is distinct from old.opening_balance and exists (
    select 1 from public.finance_transactions where account_id = old.id
  ) then
    raise exception 'Начальный баланс счёта с операциями нельзя изменить';
  end if;
  if old.is_active and not new.is_active then
    select round(
      old.opening_balance + coalesce(sum(
        case
          when type = 'expense' then -amount
          when type = 'refund' then -abs(amount)
          else amount
        end
      ), 0),
      2
    ) into ledger_balance
    from public.finance_transactions
    where account_id = old.id;
    if ledger_balance <> 0 then
      raise exception 'Счёт с остатком % нельзя закрыть; сначала обнулите его', ledger_balance;
    end if;
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.guard_appointment_history_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  has_nonempty_payments boolean := false;
begin
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;

  has_nonempty_payments := case
    when old.payments is null then false
    when jsonb_typeof(old.payments) = 'array' then jsonb_array_length(old.payments) > 0
    when jsonb_typeof(old.payments) = 'object' then old.payments <> '{}'::jsonb
    else old.payments <> 'null'::jsonb
  end;
  if old.payment_status is distinct from 'unpaid'
     or coalesce(old.paid_amount, 0) > 0
     or coalesce(old.prepaid_amount, 0) > 0
     or has_nonempty_payments
     or old.payment is not null
     or old.payment_method is not null
     or exists (
       select 1 from public.finance_transactions
        where appointment_id = old.id
     )
     or exists (
       select 1 from public.invoices
        where appointment_id = old.id
     ) then
    raise exception 'Заявку с оплатой или финансовой историей нельзя удалить';
  end if;
  return old;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.guard_client_hard_delete_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from public.tenants t where t.id = old.tenant_id
  ) then
    return old;
  end if;

  if exists (
       select 1 from public.appointments a where a.client_id = old.id
     )
     or exists (
       select 1 from public.invoices i where i.client_id = old.id
     )
     or exists (
       select 1
         from public.finance_transactions ft
        where ft.client_id = old.id
     ) then
    raise exception 'client with history must be archived, not deleted'
      using errcode = '23503';
  end if;

  return old;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.guard_client_history_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;
  if exists (
       select 1 from public.appointments where client_id = old.id
     )
     or exists (
       select 1 from public.finance_transactions where client_id = old.id
     )
     or exists (
       select 1 from public.invoices where client_id = old.id
     ) then
    raise exception 'Клиента с заявками или финансовой историей нельзя удалить';
  end if;
  return old;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.guard_finance_category_history_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.tenant_id is not null
     and not exists (select 1 from public.tenants where id = old.tenant_id) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' and (
    exists (select 1 from public.finance_transactions where category_id = old.id)
    or exists (select 1 from public.finance_templates where category_id = old.id)
    or exists (select 1 from public.debts where category_id = old.id)
  ) then
    raise exception 'Категория используется в финансовой истории и не может быть удалена';
  end if;
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.type is distinct from old.type
  ) and (
    exists (select 1 from public.finance_transactions where category_id = old.id)
    or exists (select 1 from public.finance_templates where category_id = old.id)
  ) then
    raise exception 'Тип и компания используемой категории неизменяемы';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.guard_future_dated_finance_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid;
  new_date date;
  business_today date;
begin
  tenant_uuid := new.tenant_id;
  new_date := new.occurred_on;

  -- Во время каскадного удаления компании её строка уже не видна дочернему
  -- триггеру. Отказ здесь превратил бы восстановимое удаление компании в
  -- оборванную половину — пропуск перенесён из прежнего сторожа как есть.
  if not exists (select 1 from public.tenants t where t.id = tenant_uuid) then
    return new;
  end if;

  -- Дата компании, текст и код отказа (P0001) — те же, что у прежнего сторожа.
  -- Замка нет: сравнение даты строки с датой компании ни с кем не гоняется.
  business_today := public.tenant_business_date(tenant_uuid);
  if new_date is not null and new_date > business_today then
    raise exception 'Финансовую операцию нельзя датировать будущим числом';
  end if;

  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.guard_income_with_refunds()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.type is distinct from 'income'
     or new.account_id is not distinct from old.account_id then
    return new;
  end if;
  if exists (
    select 1
      from public.finance_transactions r
     where r.refund_of_id = old.id
       and r.tenant_id = old.tenant_id
  ) then
    raise exception 'По доходу есть возврат — счёт не сменить: сначала удалите возврат'
      using errcode = '23514';
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.guard_team_delete_with_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n_appointments integer;
  n_accounts integer;
  n_transactions integer;
  used_services text;
begin
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;

  select count(*) into n_appointments
    from public.appointments where team_id = old.id;
  select count(*) into n_accounts
    from public.accounts where brigade_id = old.id;
  select count(*) into n_transactions
    from public.finance_transactions where team_id = old.id;

  if n_appointments > 0 or n_accounts > 0 or n_transactions > 0 then
    raise exception
      'У команды есть история: записей %, счетов %, операций %. Такую команду выключают, а не удаляют.',
      n_appointments, n_accounts, n_transactions
      using errcode = '23503';
  end if;

  select string_agg(s.name, ', ' order by s.name) into used_services
    from public.services s
   where s.tenant_id = old.tenant_id
     and s.team_id = old.id
     and exists (
       select 1 from public.appointments a
        where a.tenant_id = old.tenant_id
          and coalesce(a.service_ids, '[]'::jsonb) ? s.id
     );

  if used_services is not null then
    raise exception
      'Услуги команды стоят в записях: %. Такую команду выключают, а не удаляют — иначе записи потеряют название услуги.',
      used_services
      using errcode = '23503';
  end if;

  delete from public.services
   where tenant_id = old.tenant_id and team_id = old.id;

  return old;
end;
$function$
;
grant execute on function public.guard_team_delete_with_history() to anon;
grant execute on function public.guard_team_delete_with_history() to authenticated;
grant execute on function public.guard_team_delete_with_history() to service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant_id uuid;
  v_invitation public.invitations%rowtype;
  v_invite_token text := coalesce(
    new.raw_user_meta_data ->> 'pending_invitation_token',
    ''
  );
begin
  -- A signup that explicitly carries an invitation token must either consume
  -- that invitation or fail atomically. Falling through to ordinary signup on
  -- an expired/mismatched/raced token created an unrelated owner tenant.
  -- ПОЧТА ЕЩЁ НЕ ПОДТВЕРЖДЕНА — ПРИГЛАШЕНИЕ ЖДЁТ (аудит 03.10): принять
  -- его без подтверждённой почты не даёт сторож 24.09, и регистрация по
  -- ссылке падала целиком. Без подтверждения — обычная регистрация, а
  -- приглашение примет accept_invitation после подтверждения и входа.
  if v_invite_token <> '' and new.email_confirmed_at is not null then
    if v_invite_token !~ '^[A-Za-z0-9_-]{32,128}$' then
      raise exception 'invalid invitation token'
        using errcode = '22023';
    end if;

    select *
      into v_invitation
      from public.invitations i
     where i.token = v_invite_token;

    if not found then
      raise exception 'invitation not found'
        using errcode = 'P0002';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(
        v_invitation.tenant_id::text || ':' || lower(v_invitation.email),
        0
      )
    );
    if v_invitation.master_id is not null then
      perform pg_advisory_xact_lock(
        hashtextextended(
          v_invitation.tenant_id::text || ':master:' || v_invitation.master_id,
          1
        )
      );
    end if;

    select *
      into v_invitation
      from public.invitations i
     where i.token = v_invite_token
       and i.accepted_at is null
       and i.expires_at > now()
       and i.role in ('dispatcher', 'master')
       and lower(i.email) = lower(coalesce(new.email, ''))
     for update;

    if not found then
      raise exception 'invitation is expired, consumed, or belongs to another email'
        using errcode = '42501';
    end if;

    if not exists (
      select 1
        from public.tenants t
       where t.id = v_invitation.tenant_id
         and t.onboarded_at is not null
    ) then
      raise exception 'finish company setup before inviting employees'
        using errcode = '55000';
    end if;

    if exists (
      select 1
        from public.tenant_members tm
        join auth.users u on u.id = tm.user_id
       where tm.tenant_id = v_invitation.tenant_id
         and lower(coalesce(u.email, '')) = lower(v_invitation.email)
    ) then
      raise exception 'this account already has access to the tenant'
        using errcode = '23505';
    end if;

    if v_invitation.team_id is not null and not exists (
      select 1
        from unnest(coalesce(v_invitation.team_ids, array[v_invitation.team_id])) as x(team_id)
        join public.teams t
          on t.tenant_id = v_invitation.tenant_id
         and t.id = x.team_id
         and t.is_active
    ) then
      raise exception 'invitation calendar is archived'
        using errcode = '42501';
    end if;

    if v_invitation.role = 'master'
       and v_invitation.master_id is null
       and v_invitation.team_id is null then
      raise exception 'master invitation requires a calendar or an employee card'
        using errcode = '22023';
    end if;

    if v_invitation.role = 'master'
       and v_invitation.master_id is not null
       and (
         not exists (
           select 1 from public.masters m
            where m.tenant_id = v_invitation.tenant_id
              and m.id = v_invitation.master_id
              and m.is_active
         )
         or exists (
           select 1 from public.tenant_members tm
            where tm.tenant_id = v_invitation.tenant_id
              and tm.master_id = v_invitation.master_id
         )
       ) then
      raise exception 'employee card is unavailable'
        using errcode = '23505';
    end if;

    insert into public.tenant_members (
      tenant_id,
      user_id,
      role,
      invited_by_user_id,
      master_id,
      joined_at
    ) values (
      v_invitation.tenant_id,
      new.id,
      v_invitation.role,
      v_invitation.invited_by_user_id,
      v_invitation.master_id,
      now()
    );

    perform public.grant_invitation_calendar(v_invitation, new.id);

    update public.invitations
       set accepted_at = now(),
           accepted_by_user_id = new.id
     where id = v_invitation.id;

    update auth.users u
       set raw_app_meta_data =
             coalesce(u.raw_app_meta_data, '{}'::jsonb)
             || jsonb_build_object(
               'tenant_id', v_invitation.tenant_id::text,
               'tenant_role', v_invitation.role,
               'available_tenants',
                 jsonb_build_array(v_invitation.tenant_id::text)
             ),
           raw_user_meta_data =
             coalesce(u.raw_user_meta_data, '{}'::jsonb)
             - 'pending_invitation_token'
     where u.id = new.id;

    -- ЛИЧНОЕ — У КАЖДОГО (11.10), и у пришедшего по приглашению: телефон
    -- открывает компанию, Личное стоит в ленте первым.
    return new;
  end if;

  -- ОБЫЧНАЯ РЕГИСТРАЦИЯ — ЛИЧНОЕ (11.10): аккаунт с именем человека и
  -- календарь «Личный». Компанию человек заводит сам, когда понадобится.
  v_tenant_id := public.ensure_personal_space(new.id);

  update auth.users u
     set raw_app_meta_data =
           coalesce(u.raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object(
             'tenant_id', v_tenant_id::text,
             'tenant_role', 'owner',
             'available_tenants', jsonb_build_array(v_tenant_id::text)
           ),
         raw_user_meta_data =
           coalesce(u.raw_user_meta_data, '{}'::jsonb)
           - 'pending_invitation_token'
   where u.id = new.id;

  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.hidden_account_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(a.id), array[]::uuid[])
    from public.accounts a
   where a.tenant_id = public.current_tenant_id()
     and a.is_hidden;
$function$
;
grant execute on function public.hidden_account_ids() to authenticated;

CREATE OR REPLACE FUNCTION public.import_schedule(p_schedules jsonb DEFAULT '{}'::jsonb, p_calendar_settings jsonb DEFAULT NULL::jsonb, p_day_cities jsonb DEFAULT '{}'::jsonb, p_day_extras jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  t_id   uuid := public.current_tenant_id();
  k      text;
  v      jsonb;
  v_text text;
  parts  text[];
  team   text;
  d      text;
  extra  jsonb;
begin
  if t_id is null then
    raise exception 'no tenant_id in JWT' using errcode = '42501';
  end if;

  for k, v in select * from jsonb_each(coalesce(p_schedules, '{}'::jsonb)) loop
    insert into public.team_schedules (tenant_id, team_id, schedule)
    values (t_id, k, v)
    on conflict (tenant_id, team_id) do update set
      schedule = excluded.schedule, updated_at = now();
  end loop;

  if p_calendar_settings is not null and p_calendar_settings <> 'null'::jsonb then
    insert into public.calendar_settings (
      tenant_id, start_hour, end_hour, grid_step, week_start, timezone,
      buffer_minutes, hide_cancelled, allow_overtime
    )
    values (
      t_id,
      coalesce((p_calendar_settings->>'startHour')::integer, 9),
      coalesce((p_calendar_settings->>'endHour')::integer, 20),
      coalesce((p_calendar_settings->>'gridStep')::integer, 30),
      coalesce(p_calendar_settings->>'weekStart', 'monday'),
      coalesce(p_calendar_settings->>'timezone', 'Europe/Nicosia'),
      coalesce((p_calendar_settings->>'bufferMinutes')::integer, 0),
      coalesce((p_calendar_settings->>'hideCancelled')::boolean, false),
      coalesce((p_calendar_settings->>'allowOvertime')::boolean, false)
    )
    on conflict (tenant_id) do update set
      start_hour     = case when p_calendar_settings ? 'startHour'     then excluded.start_hour     else calendar_settings.start_hour end,
      end_hour       = case when p_calendar_settings ? 'endHour'       then excluded.end_hour       else calendar_settings.end_hour end,
      grid_step      = case when p_calendar_settings ? 'gridStep'      then excluded.grid_step      else calendar_settings.grid_step end,
      week_start     = case when p_calendar_settings ? 'weekStart'     then excluded.week_start     else calendar_settings.week_start end,
      timezone       = case when p_calendar_settings ? 'timezone'      then excluded.timezone       else calendar_settings.timezone end,
      buffer_minutes = case when p_calendar_settings ? 'bufferMinutes' then excluded.buffer_minutes else calendar_settings.buffer_minutes end,
      hide_cancelled = case when p_calendar_settings ? 'hideCancelled' then excluded.hide_cancelled else calendar_settings.hide_cancelled end,
      allow_overtime = case when p_calendar_settings ? 'allowOvertime' then excluded.allow_overtime else calendar_settings.allow_overtime end,
      updated_at     = now();
  end if;

  -- FIX: day_cities loop now uses v_text (text) not v (jsonb).
  for k, v_text in select * from jsonb_each_text(coalesce(p_day_cities, '{}'::jsonb)) loop
    parts := string_to_array(k, ':');
    if array_length(parts, 1) <> 2 then continue; end if;
    team := parts[1];
    d    := parts[2];
    insert into public.day_cities (tenant_id, team_id, date, city)
    values (t_id, team, d, v_text)
    on conflict (tenant_id, team_id, date) do update set
      city = excluded.city, updated_at = now();
  end loop;

  for k, v in select * from jsonb_each(coalesce(p_day_extras, '{}'::jsonb)) loop
    parts := string_to_array(k, ':');
    if array_length(parts, 1) <> 2 then continue; end if;
    team := parts[1];
    d    := parts[2];
    delete from public.day_extras
      where tenant_id = t_id and team_id = team and date = d;
    for extra in select * from jsonb_array_elements(v) loop
      insert into public.day_extras (tenant_id, team_id, date, name, amount, kind, category)
      values (t_id, team, d, extra->>'name', (extra->>'amount')::numeric, extra->>'kind', extra->>'category');
    end loop;
  end loop;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.inbox_invitation_token(p_invitation_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_token text;
begin
  select i.token
    into v_token
    from public.invitations i
    join auth.users u on u.id = auth.uid()
   where i.id = p_invitation_id
     and lower(i.email) = lower(coalesce(u.email, ''))
     and i.created_at > u.created_at;
  return v_token;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.inherit_refund_from_calendar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.refund_of_id is not null then
    select coalesce(t.from_calendar, false) into new.from_calendar
      from public.finance_transactions t
     where t.id = new.refund_of_id;
    new.from_calendar := coalesce(new.from_calendar, false);
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.invitation_accept_needs_confirmed_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.accepted_at is not null
     and old.accepted_at is null
     and new.accepted_by_user_id is not null
     and not exists (
       select 1 from auth.users u
        where u.id = new.accepted_by_user_id
          and u.email_confirmed_at is not null
     ) then
    raise exception 'invite:email_not_confirmed'
      using errcode = 'P0001',
            hint = 'Подтвердите почту, чтобы принять приглашение';
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.invitation_preview(p_token text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'tenant_name', t.name,
    'team_name', tm.name,
    'role', i.role,
    'email_hint',
      case
        when position('@' in i.email) > 1 then
          left(i.email, 1) || '***@' || split_part(i.email, '@', 2)
        else '***'
      end,
    'expires_at', i.expires_at,
    'state', case
      when i.accepted_at is not null then 'accepted'
      when i.expires_at <= now() then 'expired'
      else 'active'
    end
  )
    from public.invitations i
    join public.tenants t on t.id = i.tenant_id
    left join public.teams tm
      on tm.tenant_id = i.tenant_id and tm.id = i.team_id
   where i.token = p_token
     and p_token ~ '^[A-Za-z0-9_-]{32,128}$'
   limit 1
$function$
;
grant execute on function public.invitation_preview(p_token text) to anon;
grant execute on function public.invitation_preview(p_token text) to authenticated;

CREATE OR REPLACE FUNCTION public.invitations_changed_signal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.invitations%rowtype;
  v_invitee uuid;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  -- Правка открытого приглашения (15.09) меняет то, что входящие показывают до
  -- «Принять», и то, что приём применит. Без сигнала открытые входящие
  -- показывают одни календари, а принимаются другие. Молчим, только когда не
  -- изменилось ничего из этого: update_invitation пишет все поля даже без правки.
  if tg_op = 'UPDATE'
     and (new.accepted_at, new.team_id, new.team_ids, new.access_changes,
          new.master_title, new.master_color, new.full_name, new.phone)
         is not distinct from
         (old.accepted_at, old.team_id, old.team_ids, old.access_changes,
          old.master_title, old.master_color, old.full_name, old.phone) then
    return null;
  end if;

  -- Тот же круг, что у входящих: аккаунт, существовавший до приглашения.
  select u.id
    into v_invitee
    from auth.users u
   where lower(coalesce(u.email, '')) = lower(v_row.email)
     and u.created_at < v_row.created_at
   limit 1;

  if v_invitee is not null then
    perform realtime.send(
      jsonb_build_object('tenant_id', v_row.tenant_id),
      'invitations_changed',
      'access:' || v_invitee::text,
      true
    );
  end if;

  if v_row.invited_by_user_id is not null
     and v_row.invited_by_user_id is distinct from v_invitee then
    perform realtime.send(
      jsonb_build_object('tenant_id', v_row.tenant_id),
      'invitations_changed',
      'access:' || v_row.invited_by_user_id::text,
      true
    );
  end if;

  return null;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.invitations_forget_deleted_calendar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Компанию удаляют целиком: приглашения уйдут её каскадом.
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;

  -- Удалённым был единственный календарь: приглашение уходит, как при
  -- прежнем каскаде. Диспетчер без календарей видел бы всю компанию.
  delete from public.invitations i
   where i.tenant_id = old.tenant_id
     and i.accepted_at is null
     and old.id = any(coalesce(i.team_ids, array[i.team_id]))
     and cardinality(array_remove(coalesce(i.team_ids, array[i.team_id]), old.id)) = 0;

  -- SET видит прежнюю строку, поэтому `team_ids[1] = team_id` держится.
  -- Если сторож истории откажет удалению, откатится и эта правка.
  update public.invitations i
     set team_ids = array_remove(i.team_ids, old.id),
         team_id = (array_remove(i.team_ids, old.id))[1],
         access_changes = coalesce((
           select jsonb_agg(c.v order by c.ord)
             from jsonb_array_elements(i.access_changes) with ordinality as c(v, ord)
            where c.v ->> 'team_id' is distinct from old.id
         ), '[]'::jsonb)
   where i.tenant_id = old.tenant_id
     and i.accepted_at is null
     and old.id = any(i.team_ids);

  return old;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.invoice_object_snapshot(p_tenant_id uuid, p_client_id uuid, p_location_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', entry.value ->> 'id',
    'label', nullif(btrim(entry.value ->> 'label'), ''),
    'address_parts', case
      when coalesce(
        nullif(btrim(entry.value -> 'addressParts' ->> 'complex'), ''),
        nullif(btrim(entry.value -> 'addressParts' ->> 'entrance'), ''),
        nullif(btrim(entry.value -> 'addressParts' ->> 'floor'), ''),
        nullif(btrim(entry.value -> 'addressParts' ->> 'apartment'), ''),
        nullif(btrim(entry.value -> 'addressParts' ->> 'city'), ''),
        nullif(btrim(entry.value -> 'addressParts' ->> 'zip'), '')
      ) is null then null
      else jsonb_strip_nulls(jsonb_build_object(
        'street', nullif(btrim(entry.value -> 'addressParts' ->> 'street'), ''),
        'complex', nullif(btrim(entry.value -> 'addressParts' ->> 'complex'), ''),
        'entrance', nullif(btrim(entry.value -> 'addressParts' ->> 'entrance'), ''),
        'floor', nullif(btrim(entry.value -> 'addressParts' ->> 'floor'), ''),
        'apartment', nullif(btrim(entry.value -> 'addressParts' ->> 'apartment'), ''),
        'city', nullif(btrim(entry.value -> 'addressParts' ->> 'city'), ''),
        'zip', nullif(btrim(entry.value -> 'addressParts' ->> 'zip'), '')
      ))
    end
  )
    from public.clients client
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(client.locations) = 'array' then client.locations else '[]'::jsonb end
    ) as entry(value)
   where client.id = p_client_id
     and client.tenant_id = p_tenant_id
     and p_location_id is not null
     and entry.value ->> 'id' = p_location_id
   limit 1;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.invoices_member_columns_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  -- Мерится только прямая правка из приложения (роль `authenticated`):
  -- выпуск, оплата и отмена пишут инвойс изнутри своих функций и этим
  -- сторожем не меряются. Владелец правит без ограничений.
  if current_user <> 'authenticated'
     or auth.uid() is null
     or public.current_user_role() is not distinct from 'owner' then
    return new;
  end if;
  if (to_jsonb(new) - 'language' - 'updated_at')
     is distinct from (to_jsonb(old) - 'language' - 'updated_at') then
    raise exception 'В выставленном документе партнёр меняет только язык'
      using errcode = '42501', hint = 'block:finance.documents';
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.is_platform_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.platform_admins where user_id = auth.uid()
  );
$function$
;
grant execute on function public.is_platform_admin() to authenticated;

CREATE OR REPLACE FUNCTION public.issue_invoice(p_request_id uuid, p_issued_on date, p_due_on date, p_client_id uuid, p_appointment_id uuid, p_brigade_id text, p_vat_mode text, p_vat_percent numeric, p_lines jsonb, p_notes text, p_link_to_tx_id uuid, p_company_id uuid DEFAULT NULL::uuid, p_account_id uuid DEFAULT NULL::uuid, p_location_id text DEFAULT NULL::text, p_client_requisites_id text DEFAULT NULL::text)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  invoice_row public.invoices%rowtype;
  transaction_row public.finance_transactions%rowtype;
  line_item jsonb;
  line_title text;
  qty_value numeric;
  unit_price_value numeric;
  line_total numeric;
  base_total numeric := 0;
  vat_rate numeric := 0;
  vat_total numeric := 0;
  invoice_total numeric := 0;
  line_count integer := 0;
  discount_lines integer := 0;
  affected integer := 0;
  invoice_year integer;
  invoice_seq integer;
  invoice_prefix text;
  invoice_number text;
  invoice_currency text := 'EUR';
  tenant_currency text;
  resolved_client_id uuid := p_client_id;
  resolved_appointment_id uuid := p_appointment_id;
  resolved_brigade_id text := p_brigade_id;
  appointment_client_id uuid;
  appointment_team_id text;
  invoice_vat_mode text;
  resolved_company_id uuid;
  resolved_location_id text := nullif(btrim(p_location_id), '');
  appointment_location_id text;
  resolved_requisites_id text := nullif(btrim(p_client_requisites_id), '');
begin
  -- 03.10: выставляет и партнёр с «Документы: Выставляет» — в команде, где у
  -- него это право (команда документа проверяется ниже, когда она известна).
  if tenant_uuid is null or (
    public.current_user_role() is distinct from 'owner'
    and cardinality(public.access_calendars('finance.documents', 'write')) = 0
  ) then
    raise exception 'Недостаточно прав для создания инвойса';
  end if;
  if p_request_id is null then
    raise exception 'Не указан идентификатор запроса';
  end if;

  select * into invoice_row
    from public.invoices
   where id = p_request_id
     and tenant_id = tenant_uuid;
  if found then
    -- 03.10: повтор запроса партнёра отдаёт только документ его команды.
    if public.current_user_role() is distinct from 'owner'
       and (invoice_row.brigade_id = any(public.access_calendars('finance.documents', 'write'))) is not true then
      raise exception 'Недостаточно прав для создания инвойса';
    end if;
    return invoice_row;
  end if;
  if p_issued_on is null then
    raise exception 'Не указана дата выставления';
  end if;
  if p_due_on is not null and p_due_on < p_issued_on then
    raise exception 'Срок оплаты не может быть раньше даты выставления';
  end if;
  if p_vat_mode is null or p_vat_mode not in ('off', 'inclusive', 'exclusive') then
    raise exception 'Некорректный режим VAT';
  end if;
  if p_vat_percent is null
     or p_vat_percent = 'NaN'::numeric
     or p_vat_percent < 0
     or p_vat_percent > 100
     or round(p_vat_percent, 2) is distinct from p_vat_percent then
    raise exception 'VAT должен быть от 0 до 100%%';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Позиции инвойса должны быть списком';
  end if;
  line_count := jsonb_array_length(p_lines);
  if line_count < 1 or line_count > 100 then
    raise exception 'В инвойсе должно быть от 1 до 100 позиций';
  end if;

  for line_item in select value from jsonb_array_elements(p_lines)
  loop
    if jsonb_typeof(line_item) <> 'object'
       or jsonb_typeof(line_item -> 'title') <> 'string'
       or jsonb_typeof(line_item -> 'qty') <> 'number'
       or jsonb_typeof(line_item -> 'unit_price') <> 'number' then
      raise exception 'Позиция инвойса имеет неверный формат';
    end if;
    line_title := btrim(coalesce(line_item->>'title', ''));
    if line_title = '' or char_length(line_title) > 500 then
      raise exception 'Некорректное название позиции';
    end if;
    qty_value := (line_item->>'qty')::numeric;
    unit_price_value := (line_item->>'unit_price')::numeric;
    if qty_value is null or qty_value <= 0 or qty_value > 100000 then
      raise exception 'Некорректное количество: %', line_title;
    end if;
    if (line_item->>'discount') = 'true' then
      -- Скидка: одна строка, количество 1, цена меньше нуля.
      if unit_price_value is null or unit_price_value >= 0
         or unit_price_value < -999999999 or qty_value <> 1 then
        raise exception 'Некорректная скидка';
      end if;
      discount_lines := discount_lines + 1;
      if discount_lines > 1 then
        raise exception 'Скидка в инвойсе может быть только одна';
      end if;
    elsif unit_price_value is null or unit_price_value < 0 or unit_price_value > 999999999 then
      raise exception 'Некорректная цена: %', line_title;
    end if;
    if round(qty_value, 3) is distinct from qty_value
       or round(unit_price_value, 2) is distinct from unit_price_value then
      raise exception 'Слишком много знаков после запятой: %', line_title;
    end if;
    line_total := round(qty_value * unit_price_value, 2);
    if line_total > 9999999999.99 then
      raise exception 'Сумма позиции слишком большая: %', line_title;
    end if;
    base_total := base_total + line_total;
  end loop;

  base_total := round(base_total, 2);
  vat_rate := case when p_vat_mode = 'off' then 0 else round(p_vat_percent, 2) end;
  if p_vat_mode = 'inclusive' and vat_rate > 0 then
    invoice_total := base_total;
    vat_total := round(base_total - (base_total / (1 + vat_rate / 100)), 2);
    base_total := round(invoice_total - vat_total, 2);
  elsif p_vat_mode = 'exclusive' and vat_rate > 0 then
    vat_total := round(base_total * vat_rate / 100, 2);
    invoice_total := round(base_total + vat_total, 2);
  else
    vat_total := 0;
    invoice_total := base_total;
  end if;
  if invoice_total <= 0 then
    raise exception 'Итог инвойса должен быть больше нуля';
  end if;
  if invoice_total > 9999999999.99 then
    raise exception 'Итог инвойса слишком большой';
  end if;
  invoice_vat_mode := case when vat_rate > 0 then p_vat_mode else 'off' end;

  if p_link_to_tx_id is not null then
    select * into transaction_row
      from public.finance_transactions
     where id = p_link_to_tx_id
       and tenant_id = tenant_uuid
     for update;
    if not found or transaction_row.type <> 'income' then
      raise exception 'Инвойс можно привязать только к операции дохода';
    end if;
    if transaction_row.invoice_id is not null then
      raise exception 'У этой операции уже есть инвойс';
    end if;
    if round(greatest(transaction_row.amount, 0), 2) <> invoice_total then
      raise exception 'Итог инвойса должен совпадать с доходом';
    end if;
    if exists (
      select 1 from public.finance_transactions
       where refund_of_id = transaction_row.id and type = 'refund'
    ) then
      raise exception 'Доход с оформленным возвратом нельзя привязать к инвойсу';
    end if;
    invoice_currency := transaction_row.currency;
    if transaction_row.appointment_id is not null then
      if resolved_appointment_id is not null
         and resolved_appointment_id is distinct from transaction_row.appointment_id then
        raise exception 'Заявка инвойса не совпадает с заявкой дохода';
      end if;
      resolved_appointment_id := transaction_row.appointment_id;
    end if;
    if transaction_row.client_id is not null then
      if resolved_client_id is not null
         and resolved_client_id is distinct from transaction_row.client_id then
        raise exception 'Клиент инвойса не совпадает с клиентом дохода';
      end if;
      resolved_client_id := transaction_row.client_id;
    end if;
    if transaction_row.team_id is not null then
      if resolved_brigade_id is not null
         and resolved_brigade_id is distinct from transaction_row.team_id then
        raise exception 'Команда инвойса не совпадает с командой дохода';
      end if;
      resolved_brigade_id := transaction_row.team_id;
    end if;
  end if;

  if resolved_appointment_id is not null then
    select client_id, team_id, location_id
      into appointment_client_id, appointment_team_id, appointment_location_id
      from public.appointments
     where id = resolved_appointment_id
       and tenant_id = tenant_uuid;
    if not found then
      raise exception 'Заявка не найдена или недоступна';
    end if;
    if resolved_client_id is not null
       and resolved_client_id is distinct from appointment_client_id then
      raise exception 'Клиент инвойса не совпадает с клиентом заявки';
    end if;
    if resolved_brigade_id is not null
       and resolved_brigade_id is distinct from appointment_team_id then
      raise exception 'Команда инвойса не совпадает с командой заявки';
    end if;
    resolved_client_id := appointment_client_id;
    resolved_brigade_id := appointment_team_id;
  end if;
  -- Объект — объект клиента; у счёта из записи по умолчанию объект записи.
  if resolved_location_id is null and appointment_location_id is not null then
    resolved_location_id := appointment_location_id;
  end if;
  if resolved_location_id is not null and resolved_client_id is null then
    raise exception 'Объект выбирают у клиента — сначала клиент';
  end if;
  if resolved_client_id is not null and not exists (
    select 1 from public.clients where id = resolved_client_id and tenant_id = tenant_uuid
  ) then
    raise exception 'Клиент не найден или недоступен';
  end if;
  -- Реквизиты клиента — набор этого клиента; чужой или удалённый — основной.
  if resolved_requisites_id is not null and resolved_requisites_id <> 'none' and not exists (
    select 1 from public.clients client
     cross join lateral jsonb_array_elements(client.requisites) entry
     where client.id = resolved_client_id and client.tenant_id = tenant_uuid
       and entry ->> 'id' = resolved_requisites_id
  ) then
    resolved_requisites_id := null;
  end if;
  if resolved_brigade_id is not null and not exists (
    select 1 from public.teams where id = resolved_brigade_id and tenant_id = tenant_uuid
  ) then
    raise exception 'Команда не найдена или недоступна';
  end if;
  -- 03.10: партнёр с «Документы: Выставляет» — только в команде, где у него
  -- это право, и от юрлица этой команды (у команды без своего юрлица — от
  -- основного). Клиент без записи и без дохода — из его базы клиентов; доход
  -- для привязки — который он видит («Доходы»); счёт оплаты — счёт команды
  -- документа.
  if public.current_user_role() is distinct from 'owner' then
    if (resolved_brigade_id = any(public.access_calendars('finance.documents', 'write'))) is not true then
      raise exception 'Нет права выставлять документы этой команды'
        using errcode = '42501', hint = 'block:finance.documents';
    end if;
    if p_company_id is not null
       and p_company_id is distinct from coalesce(
         public.legal_entity_of_team(tenant_uuid, resolved_brigade_id),
         public.resolve_company_id(tenant_uuid, null)
       ) then
      raise exception 'Документ команды выставляется от реквизитов этой команды'
        using errcode = '42501', hint = 'block:finance.documents';
    end if;
    if p_link_to_tx_id is not null
       and (transaction_row.team_id = any(public.access_calendars('finance.income', 'read'))) is not true then
      raise exception 'Нет права видеть этот доход'
        using errcode = '42501', hint = 'block:finance.income';
    end if;
    if resolved_client_id is not null
       and resolved_appointment_id is null
       and (p_link_to_tx_id is null or transaction_row.client_id is null)
       and (resolved_client_id = any(
         public.access_client_ids_in(public.access_calendars('clients', 'read'))
       )) is not true then
      raise exception 'Клиент не найден или недоступен'
        using errcode = '42501', hint = 'block:clients';
    end if;
    if p_account_id is not null and not exists (
      select 1
        from public.accounts acc
       where acc.id = p_account_id
         and acc.tenant_id = tenant_uuid
         and acc.brigade_id = resolved_brigade_id
    ) then
      raise exception 'Оплату по документу команды ждут на счёт этой команды'
        using errcode = '42501', hint = 'block:finance.documents';
    end if;
  end if;

  -- Серия номеров — у юрлица (STORY-101): выбранного в документе, иначе
  -- юрлица команды, иначе основного. Замок — на юрлицо: выпуски разных
  -- юрлиц друг друга не ждут.
  resolved_company_id := public.resolve_own_company_id(
    coalesce(p_company_id, public.legal_entity_of_team(tenant_uuid, resolved_brigade_id))
  );
  if resolved_company_id is null then
    raise exception 'Сначала добавьте реквизиты: Кабинет → Реквизиты';
  end if;
  -- Плательщик VAT — юрлицо с VAT-номером: без номера VAT не начисляется.
  if vat_rate > 0 and not exists (
    select 1 from public.legal_entities entity
     where entity.id = resolved_company_id
       and entity.tenant_id = tenant_uuid
       and nullif(btrim(entity.vat_number), '') is not null
  ) then
    raise exception 'Чтобы начислять VAT, впишите VAT-номер юрлица в реквизитах';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(tenant_uuid::text || ':' || coalesce(resolved_company_id::text, ''), 0)
  );
  select * into invoice_row
    from public.invoices
   where id = p_request_id
     and tenant_id = tenant_uuid;
  if found then
    -- 03.10: повтор запроса партнёра отдаёт только документ его команды.
    if public.current_user_role() is distinct from 'owner'
       and (invoice_row.brigade_id = any(public.access_calendars('finance.documents', 'write'))) is not true then
      raise exception 'Недостаточно прав для создания инвойса';
    end if;
    return invoice_row;
  end if;

  invoice_year := extract(year from p_issued_on)::integer;
  select tenant.currency
    into tenant_currency
    from public.tenants as tenant
   where tenant.id = tenant_uuid;
  if p_link_to_tx_id is null then
    invoice_currency := coalesce(nullif(btrim(tenant_currency), ''), 'EUR');
  end if;
  -- Номер — из серии юрлица (`document_sequences`): строка серии заперта до
  -- конца транзакции, и откат выпуска откатывает номер вместе с ним.
  select numbering.seq, numbering.number
    into invoice_seq, invoice_number
    from public.next_document_number(
      tenant_uuid, resolved_company_id, 'invoice', invoice_year
    ) as numbering;

  insert into public.invoices (
    id, tenant_id, number, year, seq, issued_on, due_on, client_id,
    appointment_id, brigade_id, subtotal_net, vat_percent, vat_amount,
    total, currency, status, notes, created_by, vat_mode,
    company_id, account_id, location_id, client_requisites_id
  ) values (
    p_request_id,
    tenant_uuid,
    invoice_number,
    invoice_year,
    invoice_seq,
    p_issued_on,
    p_due_on,
    resolved_client_id,
    resolved_appointment_id,
    resolved_brigade_id,
    base_total,
    vat_rate,
    vat_total,
    invoice_total,
    invoice_currency,
    'issued',
    nullif(btrim(p_notes), ''),
    auth.uid(),
    invoice_vat_mode,
    resolved_company_id,
    p_account_id,
    resolved_location_id,
    resolved_requisites_id
  )
  returning * into invoice_row;

  insert into public.invoice_lines (
    invoice_id, position, title, description, unit, qty, unit_price, total
  )
  select
    invoice_row.id,
    ordinality::integer - 1,
    btrim(value->>'title'),
    nullif(btrim(coalesce(value->>'description', '')), ''),
    nullif(btrim(coalesce(value->>'unit', '')), ''),
    round((value->>'qty')::numeric, 3),
    round((value->>'unit_price')::numeric, 2),
    round(
      round((value->>'qty')::numeric, 3) *
      round((value->>'unit_price')::numeric, 2),
      2
    )
  from jsonb_array_elements(p_lines) with ordinality as entries(value, ordinality);
  get diagnostics affected = row_count;
  if affected <> line_count then
    raise exception 'Не все позиции инвойса сохранены';
  end if;

  if p_link_to_tx_id is not null then
    update public.finance_transactions
       set invoice_id = invoice_row.id
     where id = transaction_row.id
       and tenant_id = tenant_uuid
       and invoice_id is null;
    get diagnostics affected = row_count;
    if affected <> 1 then
      raise exception 'Доход не привязан к инвойсу';
    end if;
  end if;

  select * into invoice_row
    from public.invoices
   where id = p_request_id
     and tenant_id = tenant_uuid;
  if not found then
    raise exception 'Созданный инвойс не подтверждён';
  end if;
  return invoice_row;
end;
$function$
;
grant execute on function public.issue_invoice(p_request_id uuid, p_issued_on date, p_due_on date, p_client_id uuid, p_appointment_id uuid, p_brigade_id text, p_vat_mode text, p_vat_percent numeric, p_lines jsonb, p_notes text, p_link_to_tx_id uuid, p_company_id uuid, p_account_id uuid, p_location_id text, p_client_requisites_id text) to authenticated;

CREATE OR REPLACE FUNCTION public.issue_partial_credit_note(p_invoice_id uuid, p_request_id uuid, p_amount numeric, p_reason text DEFAULT NULL::text, p_language text DEFAULT 'en'::text)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  invoice_row public.invoices%rowtype;
  note_row public.invoices%rowtype;
  amount_value numeric(12,2);
  effective numeric(12,2);
  income_total numeric(12,2);
  refunds_total numeric(12,2);
  paid_total numeric(12,2);
  to_refund numeric(12,2);
  note_vat numeric(12,2);
  business_date date;
  note_year integer;
  note_seq integer;
  note_number text;
  note_id uuid;
  full_cancel boolean;
  reason_text text := nullif(btrim(p_reason), '');
  language_value text := coalesce(nullif(btrim(p_language), ''), 'en');
begin
  if tenant_uuid is null or not public._documents_write_invoice(p_invoice_id) then
    raise exception 'Нужно право «Документы: Выставляет» в команде документа'
      using errcode = '42501', hint = 'access:owner_only';
  end if;
  if p_request_id is null then
    raise exception 'Не указан идентификатор кредит-ноты';
  end if;

  select * into invoice_row
    from public.invoices
   where id = p_invoice_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Инвойс не найден';
  end if;

  select * into note_row from public.invoices where id = p_request_id and tenant_id = tenant_uuid;
  if found then
    return note_row;
  end if;

  if invoice_row.kind <> 'invoice' then
    raise exception 'Кредит-нота не сторнируется — она сама является сторно';
  end if;
  if invoice_row.status not in ('issued', 'paid') then
    raise exception 'Инвойс уже отменён — сторнировать нечего';
  end if;

  amount_value := round(p_amount, 2);
  if amount_value is null or amount_value = 'NaN'::numeric or amount_value <= 0 then
    raise exception 'Сумма кредит-ноты должна быть больше нуля';
  end if;
  if amount_value is distinct from p_amount then
    raise exception 'Укажите не больше двух знаков после запятой';
  end if;
  effective := invoice_row.total - invoice_row.credited_amount;
  if amount_value > effective then
    raise exception 'Больше суммы инвойса сторнировать нельзя: % %', effective, invoice_row.currency;
  end if;
  full_cancel := amount_value = effective;

  select
    coalesce(sum(case when tx.type = 'income' then greatest(tx.amount, 0) else 0 end), 0),
    coalesce(sum(case when tx.type = 'refund' then abs(tx.amount) else 0 end), 0)
    into income_total, refunds_total
    from public.finance_transactions tx
   where tx.tenant_id = tenant_uuid
     and tx.invoice_id = invoice_row.id
     and tx.type in ('income', 'refund');
  paid_total := greatest(0, income_total - refunds_total);
  to_refund := greatest(0, paid_total - (effective - amount_value));
  business_date := public.tenant_business_date(tenant_uuid);

  if full_cancel then
    perform public._refund_invoice_money(invoice_row, to_refund, business_date, 'Возврат по отмене инвойса ' || invoice_row.number);
    note_id := public._issue_credit_note(invoice_row.id, reason_text);
    update public.invoices set status = 'cancelled', updated_at = now() where id = invoice_row.id;
    update public.invoices
       set language = case when language_value in ('ru', 'en', 'bg', 'el', 'uk', 'de', 'es') then language_value else language end
     where id = note_id and language is distinct from language_value;
    select * into note_row from public.invoices where id = note_id;
    return note_row;
  end if;

  note_year := extract(year from business_date)::integer;
  select numbering.seq, numbering.number
    into note_seq, note_number
    from public.next_document_number(
      tenant_uuid, invoice_row.company_id, 'credit_note', note_year
    ) as numbering;
  note_vat := case
    when coalesce(invoice_row.vat_amount, 0) > 0 and invoice_row.total > 0
      then round(invoice_row.vat_amount * amount_value / invoice_row.total, 2)
    else 0
  end;

  insert into public.invoices (
    id, tenant_id, number, year, seq, issued_on, client_id, appointment_id,
    brigade_id, subtotal_net, vat_percent, vat_amount, total, currency,
    status, kind, credit_note_of_id, credit_partial, notes, created_by,
    language, vat_mode, seller_snapshot, client_snapshot
  ) values (
    p_request_id, tenant_uuid, note_number, note_year, note_seq, business_date,
    invoice_row.client_id, invoice_row.appointment_id, invoice_row.brigade_id,
    -(amount_value - note_vat), invoice_row.vat_percent, -note_vat,
    -amount_value, invoice_row.currency, 'issued', 'credit_note',
    invoice_row.id, true,
    coalesce(reason_text, 'Частичная отмена инвойса ' || invoice_row.number),
    auth.uid(),
    case when language_value in ('ru', 'en', 'bg', 'el', 'uk', 'de', 'es')
      then language_value else 'en' end,
    invoice_row.vat_mode,
    invoice_row.seller_snapshot,
    invoice_row.client_snapshot
  )
  returning * into note_row;

  update public.invoices
     set credited_amount = credited_amount + amount_value
   where id = invoice_row.id;

  perform public._refund_invoice_money(invoice_row, to_refund, business_date, 'Возврат по кредит-ноте ' || note_number);

  select greatest(0,
           coalesce(sum(case when tx.type = 'income' then greatest(tx.amount, 0) else 0 end), 0)
         - coalesce(sum(case when tx.type = 'refund' then abs(tx.amount) else 0 end), 0))
    into paid_total
    from public.finance_transactions tx
   where tx.tenant_id = tenant_uuid
     and tx.invoice_id = invoice_row.id
     and tx.type in ('income', 'refund');
  update public.invoices
     set status = case
       when paid_total >= total - credited_amount then 'paid'
       else 'issued'
     end
   where id = invoice_row.id
     and status is distinct from case
       when paid_total >= total - credited_amount then 'paid'
       else 'issued'
     end;

  return note_row;
end;
$function$
;
grant execute on function public.issue_partial_credit_note(p_invoice_id uuid, p_request_id uuid, p_amount numeric, p_reason text, p_language text) to authenticated;

CREATE OR REPLACE FUNCTION public.issue_receipt(p_transaction_id uuid, p_lines jsonb DEFAULT NULL::jsonb, p_company_id uuid DEFAULT NULL::uuid, p_issued_on date DEFAULT NULL::date, p_location_id text DEFAULT NULL::text, p_client_requisites_id text DEFAULT NULL::text)
 RETURNS receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
grant execute on function public.issue_receipt(p_transaction_id uuid, p_lines jsonb, p_company_id uuid, p_issued_on date, p_location_id text, p_client_requisites_id text) to authenticated;

CREATE OR REPLACE FUNCTION public.issue_receipt_credit_note(p_receipt_id uuid, p_reason text DEFAULT NULL::text, p_language text DEFAULT 'en'::text)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  receipt_row public.receipts%rowtype;
  refunded numeric(12,2);
  covered numeric(12,2);
  uncovered numeric(12,2);
begin
  if tenant_uuid is null or not public._documents_write_receipt(p_receipt_id) then
    raise exception 'Нужно право «Документы: Выставляет» в команде документа'
      using errcode = '42501', hint = 'access:owner_only';
  end if;
  select * into receipt_row
    from public.receipts
   where id = p_receipt_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Чек не найден';
  end if;
  if receipt_row.invoice_id is not null then
    raise exception 'Чек оплаты инвойса отменяется кредит-нотой к инвойсу — на странице инвойса';
  end if;
  if receipt_row.transaction_id is null then
    raise exception 'У чека нет платежа — возвращать нечего';
  end if;

  select coalesce(sum(abs(amount)), 0) into refunded
    from public.finance_transactions
   where tenant_id = tenant_uuid
     and refund_of_id = receipt_row.transaction_id
     and type = 'refund';
  select coalesce(sum(-total), 0) into covered
    from public.invoices
   where tenant_id = tenant_uuid
     and kind = 'credit_note'
     and credit_note_of_receipt_id = receipt_row.id;
  if refunded <= 0 then
    raise exception 'По чеку ничего не возвращали — кредит-нота не нужна';
  end if;
  uncovered := round(least(refunded, receipt_row.amount) - covered, 2);
  if uncovered <= 0 then
    raise exception 'Каждый возврат по этому чеку уже с кредит-нотой';
  end if;

  return public._issue_receipt_credit_note(receipt_row.id, uncovered, p_reason, p_language);
end;
$function$
;
grant execute on function public.issue_receipt_credit_note(p_receipt_id uuid, p_reason text, p_language text) to authenticated;

CREATE OR REPLACE FUNCTION public.leave_calendar(p_tenant_id uuid, p_team_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := (select auth.uid());
  my_role text;
  left_account boolean := false;
begin
  if uid is null then
    raise exception 'нужен вход' using errcode = '42501', hint = 'leave:anon';
  end if;

  select tm.role into my_role
    from public.tenant_members tm
   where tm.tenant_id = p_tenant_id and tm.user_id = uid;
  if my_role is null then
    raise exception 'вы не состоите в этом аккаунте' using errcode = '42501', hint = 'leave:not_member';
  end if;
  if my_role = 'owner' then
    raise exception 'из своей команды не выходят — её можно удалить' using errcode = '42501', hint = 'leave:owner';
  end if;

  delete from public.member_calendars mc
   where mc.tenant_id = p_tenant_id and mc.user_id = uid and mc.team_id = p_team_id;
  if not found then
    raise exception 'вас нет в этой команде' using errcode = '22023', hint = 'leave:not_attached';
  end if;

  delete from public.member_access ma
   where ma.tenant_id = p_tenant_id and ma.user_id = uid and ma.team_id = p_team_id;
  delete from public.team_notification_prefs np
   where np.tenant_id = p_tenant_id and np.user_id = uid and np.team_id = p_team_id;

  if not exists (
    select 1 from public.member_calendars mc
     where mc.tenant_id = p_tenant_id and mc.user_id = uid
  ) then
    delete from public.tenant_members tm
     where tm.tenant_id = p_tenant_id and tm.user_id = uid;
    left_account := true;
  end if;

  return jsonb_build_object('left_account', left_account);
end;
$function$
;
grant execute on function public.leave_calendar(p_tenant_id uuid, p_team_id text) to authenticated;

CREATE OR REPLACE FUNCTION public.leave_company(p_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception 'Войдите в приложение' using errcode = '42501', hint = 'leave:anon';
  end if;
  select tm.role into v_role
    from public.tenant_members tm
   where tm.tenant_id = p_tenant and tm.user_id = v_uid;
  if v_role is null then
    raise exception 'Вы не в этой компании' using errcode = '42501', hint = 'leave:not_member';
  end if;
  if v_role = 'owner' then
    raise exception 'Владелец не выходит из компании — сначала передайте владение'
      using errcode = '42501', hint = 'leave:owner';
  end if;

  delete from public.member_access where tenant_id = p_tenant and user_id = v_uid;
  delete from public.team_notification_prefs where tenant_id = p_tenant and user_id = v_uid;
  delete from public.member_calendars where tenant_id = p_tenant and user_id = v_uid;
  delete from public.calendar_members where tenant_id = p_tenant and user_id = v_uid;
  delete from public.tenant_members where tenant_id = p_tenant and user_id = v_uid;
end;
$function$
;
grant execute on function public.leave_company(p_tenant uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.legal_entity_of_team(p_tenant_id uuid, p_team_id text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select team.legal_entity_id
    from public.teams team
   where team.tenant_id = p_tenant_id
     and team.id = p_team_id
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.list_client_members(p_group_id uuid)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant uuid := public.current_tenant_id();
  caller_role text := public.current_user_role();
  visible uuid[] := array[]::uuid[];
begin
  if auth.uid() is null or active_tenant is null or caller_role is null
     or p_group_id is null then
    return;
  end if;

  if caller_role <> 'owner' then
    visible := public.access_client_ids();
    if not (p_group_id = any(visible)) then
      return;
    end if;
    if coalesce((
      select b.blocks ->> 'clients.people'
        from public.access_client_blocks() b
       where b.client_id = p_group_id
    ), 'off') = 'off' then
      return;
    end if;
  end if;

  return query
    with card_blocks as (
      select * from public.access_client_blocks()
    )
    select case
             when caller_role = 'owner' then r.row_json
             else public.client_masked_for_member(r.row_json, cb.blocks)
           end
      from (
        select c.id,
               c.full_name,
               to_jsonb(c) || jsonb_build_object(
                 'tag_ids',
                 coalesce((
                   select jsonb_agg(ta.tag_id order by ta.tag_id)
                     from public.client_tag_assignments ta
                    where ta.tenant_id = c.tenant_id
                      and ta.client_id = c.id
                 ), '[]'::jsonb)
               ) as row_json
          from public.clients c
         where c.tenant_id = active_tenant
           and c.deleted_at is null
           and c.memberships @> jsonb_build_array(
                 jsonb_build_object('group_id', p_group_id::text))
           and (caller_role = 'owner' or c.id = any(visible))
      ) r
      left join card_blocks cb on cb.client_id = r.id
     order by r.full_name, r.id;
end;
$function$
;
grant execute on function public.list_client_members(p_group_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.list_dispatcher_services_safe()
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', s.id,
    'tenant_id', s.tenant_id,
    'team_id', s.team_id,
    'name', s.name,
    'color', s.color,
    'description', s.description,
    'price', s.price,
    'duration_minutes', s.duration_minutes,
    'price_tiers', s.price_tiers,
    'duration_tiers', s.duration_tiers,
    'bulk_threshold', s.bulk_threshold,
    'bulk_price', s.bulk_price,
    'unit', s.unit,
    'price_entry', s.price_entry,
    'available_weekdays', s.available_weekdays,
    'is_active', s.is_active,
    'position', s.position,
    'created_at', s.created_at,
    'updated_at', s.updated_at
  )
    from public.services s
   where public.current_user_role() = 'dispatcher'
     and s.tenant_id = public.current_tenant_id()
     and s.is_active
   order by s.position, s.name, s.id
$function$
;
grant execute on function public.list_dispatcher_services_safe() to authenticated;

CREATE OR REPLACE FUNCTION public.list_master_appointments_safe(p_offset integer DEFAULT 0, p_limit integer DEFAULT 1000)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as materialized (
    select public.current_user_role()                        as role,
           public.current_tenant_id()                        as tenant_id,
           public.current_user_master_id()                   as master_id,
           public.current_user_team_ids()                    as legacy_team_ids,
           public.current_user_calendar_ids('view')          as granted_team_ids,
           public.access_calendars('record.client', 'read')   as client_teams,
           public.access_calendars('record.object', 'read')   as object_teams,
           public.access_calendars('record.services', 'read') as services_teams,
           public.access_calendars('record.amount', 'read')   as amount_teams,
           public.access_calendars('record.payment', 'read')  as payment_teams,
           public.access_calendars('calendar.events', 'read') as event_teams,
           -- «Ограничения» записей (03.10): с какого дня видна прошедшая работа.
           public.member_record_window_starts()               as window_starts,
           public.access_calendars('record.label', 'read')    as label_teams,
           -- «Записи клиентов» (30.09): команды, где он видит записи.
           public.access_calendars('calendar.records', 'read') as record_teams,
           -- БЛОКИ ЗАПИСИ И СОБЫТИЯ (30.09): «Заметка» записи — своё право;
           -- у события — свои блоки.
           public.access_calendars('record.note', 'read')     as note_teams,
           public.access_calendars('event.label', 'read')    as ev_label_teams,
           public.access_calendars('event.client', 'read')   as ev_client_teams,
           public.access_calendars('event.object', 'read')   as ev_object_teams,
           public.access_calendars('event.type', 'read')     as ev_type_teams,
           public.access_calendars('event.note', 'read')     as ev_note_teams,
           -- МЕТКА ЗАПИСИ И СОБЫТИЯ — ПОД «МЕТКОЙ ДНЯ» (30.09).
           public.access_calendars('calendar.day_labels', 'read') as day_label_teams,
           -- «ОКОЛО ЗАПИСИ» (защита базы 30.09): клиент и адрес давней записи —
           -- только если клиент открыт правом «Клиенты» или завёл его он сам.
           public.access_client_ids()                        as visible_clients,
           public.tenant_business_date(public.current_tenant_id()) as today
  )
  select jsonb_build_object(
    'id', a.id,
    'tenant_id', a.tenant_id,
    'client_id', case when v.see_client then a.client_id end,
    'team_id', a.team_id,
    'master_id', a.master_id,
    'location_id', case when v.see_object then a.location_id end,
    'date', a.date,
    'time_start', a.time_start,
    'time_end', a.time_end,
    'kind', a.kind,
    'status', a.status,
    -- У записи «comment» — её заметка; у события — его название (тип).
    'comment', case when v.see_comment then a.comment else '' end,
    'address', case when v.see_object then a.address else '' end,
    'address_note', case when v.see_object then a.address_note else '' end,
    'address_lat', case when v.see_object then a.address_lat end,
    'address_lng', case when v.see_object then a.address_lng end,
    'cancel_reason', a.cancel_reason,
    'source', a.source,
    'is_online_booking', a.is_online_booking,
    'consent_given', a.consent_given,
    'color_override', a.color_override,
    -- Метка записи — по «Метка записи: Видит» (аудит 24.09: поле не
    -- приходило вовсе, и строка права ничего не открывала).
    'city', case
      when not coalesce(a.team_id = any(me.day_label_teams), false) then null
      when a.kind = 'work' and a.team_id = any(me.label_teams) then a.city
      when a.kind <> 'work' and a.team_id = any(me.ev_label_teams) then a.city
    end,
    'reminder_enabled', a.reminder_enabled,
    'reminder_offsets', a.reminder_offsets,
    'reminder_template', a.reminder_template,
    'service_ids', case
      when v.see_services then coalesce(a.service_ids, '[]'::jsonb)
      else '[]'::jsonb
    end,
    'total_duration', a.total_duration,
    'created_by', a.created_by,
    'created_at', a.created_at,
    'updated_at', a.updated_at,
    'event_all_day', a.event_all_day,
    'event_notes', case when v.see_event_note then a.event_notes else '' end,
    'event_url', case when v.see_event_note then a.event_url else '' end,
    'event_push_enabled', a.event_push_enabled,
    'event_push_offsets', a.event_push_offsets,
    'event_push_at', a.event_push_at,
    'event_repeat', a.event_repeat,
    'total_amount', case when v.see_amount then coalesce(a.total_amount, 0) else 0 end,
    'custom_total', case when v.see_amount then coalesce(a.custom_total, false) else false end,
    'discount_amount', case when v.see_amount then coalesce(a.discount_amount, 0) else 0 end,
    -- Предоплата — по тому же правилу, что доплата (повторный аудит 03.10):
    -- нулём она превращалась в долг на экране партнёра.
    'prepaid_amount', case
      when v.see_payment and v.see_amount then coalesce(a.prepaid_amount, 0)
      else 0
    end,
    'paid_amount', case
      when v.see_payment and v.see_amount then coalesce(a.paid_amount, 0)
      else 0
    end,
    'payment_status', case
      when v.see_payment then coalesce(a.payment_status, 'unpaid')
      else 'unpaid'
    end,
    'payment_method', null,
    'payments', '[]'::jsonb,
    'payment', null,
    'expenses', '[]'::jsonb,
    'services', case
      when not v.see_services or jsonb_typeof(a.services) is distinct from 'array'
        then '[]'::jsonb
      when v.see_amount then a.services
      else (
        select coalesce(jsonb_agg(
                 jsonb_strip_nulls(jsonb_build_object(
                   'serviceId', line -> 'serviceId',
                   'serviceName', line -> 'serviceName',
                   'quantity', line -> 'quantity',
                   'unit', line -> 'unit',
                   'duration', line -> 'duration',
                   'variantId', line -> 'variantId'
                 )) || '{"pricePerUnit": 0, "originalPrice": 0, "totalPrice": 0}'::jsonb
                 order by ord), '[]'::jsonb)
          from jsonb_array_elements(a.services) with ordinality as l(line, ord)
      )
    end,
    -- Скидка, цены услуг и VAT — по тому же правилу, что сумма (03.10):
    -- пустыми они расходились с «Итого», а сохранение стирало скидку.
    'service_price_overrides', case
      when v.see_amount then coalesce(a.service_price_overrides, '{}'::jsonb)
      else '{}'::jsonb
    end,
    'global_discount', case when v.see_amount then a.global_discount end
  -- VAT — второй сборкой: в первой уже 100 аргументов, больше Postgres не
  -- принимает (прогон в откате 03.10).
  ) || jsonb_build_object(
    'vat_mode', case when v.see_amount then a.vat_mode end,
    'vat_rate', case when v.see_amount then a.vat_rate end
  )
    from public.appointments a
    cross join me
    cross join lateral (
      select
        a.client_id is null
          or a.client_id = any(me.visible_clients)
          or a.created_by = auth.uid()
          or (a.status is distinct from 'cancelled'
              and a.date between (me.today - 7)::text and (me.today + 1)::text) as near_ok
    ) w
    cross join lateral (
      select
        coalesce(case when a.kind = 'work' then a.team_id = any(me.client_teams)
                      else a.team_id = any(me.ev_client_teams) end, false) and w.near_ok as see_client,
        coalesce(case when a.kind = 'work' then a.team_id = any(me.object_teams)
                      else a.team_id = any(me.ev_object_teams) end, false) and w.near_ok as see_object,
        coalesce(case when a.kind = 'work' then a.team_id = any(me.note_teams)
                      else a.team_id = any(me.ev_type_teams) end, false)            as see_comment,
        coalesce(a.kind <> 'work' and a.team_id = any(me.ev_note_teams), false)    as see_event_note,
        coalesce(a.kind <> 'work' or a.team_id = any(me.services_teams), false) as see_services,
        coalesce(a.kind <> 'work' or a.team_id = any(me.amount_teams), false)   as see_amount,
        coalesce(a.kind <> 'work' or a.team_id = any(me.payment_teams), false)  as see_payment
    ) v
   where me.role = 'master'
     and a.tenant_id = me.tenant_id
     -- «Записи клиентов: Скрыты» (30.09) — ни работы, ни событий команды:
     -- её календарь у него пустой.
     and a.team_id = any(me.record_teams)
     -- «Ограничения» записей (03.10): прошедшая работа старше окна не видна.
     and (a.kind <> 'work' or a.date >= coalesce(me.window_starts ->> a.team_id, ''))
     -- Архивный календарь сотруднику не показывается (аудит 24.09).
     and exists (
       select 1 from public.teams t
        where t.tenant_id = a.tenant_id and t.id = a.team_id and t.is_active
     )
     and (
       (
         a.kind = 'work'
         -- Только прикреплённые календари (аудит 24.09): ветка «мастер записи»
         -- пускала к работе в календаре, от которого человека открепили.
         and (
           a.team_id = any(me.legacy_team_ids)
           or a.team_id = any(me.granted_team_ids)
         )
       )
       or (
         a.kind in ('event', 'personal')
         and a.team_id is not null
         -- STORY-088: события команды — по «События: Видит».
         and a.team_id = any(me.event_teams)
         and (
           a.team_id = any(me.legacy_team_ids)
           or a.team_id = any(me.granted_team_ids)
         )
       )
     )
   order by a.date, a.time_start, a.id
   offset greatest(coalesce(p_offset, 0), 0)
   limit greatest(1, least(coalesce(p_limit, 1000), 1000))
$function$
;
grant execute on function public.list_master_appointments_safe(p_offset integer, p_limit integer) to authenticated;

CREATE OR REPLACE FUNCTION public.list_master_clients_safe(p_client_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with client_teams as (
    select public.access_calendars('record.client', 'read') as ids
  ),
  contact_sets as (
    select public.access_contact_client_ids() || public.access_day_contact_client_ids() as open_ids,
           public.access_client_ids_in(public.access_day_contact_teams()) as day_ids,
           public.access_client_ids() as visible_ids,
           public.tenant_business_date(public.current_tenant_id()) as today
  )
  select jsonb_build_object(
    'id', c.id,
    'tenant_id', c.tenant_id,
    'full_name', c.full_name,
    -- 03.10: номер открыт сразу, когда блок «Клиент» он видит; иначе пусто.
    'phone', case when c.id = any(cs.open_ids) then c.phone else '' end,
    'created_at', c.created_at,
    'contacts_hidden', case
      when c.id = any(cs.open_ids) then null
      when c.id = any(cs.day_ids) then 'day'
      else 'right'
    end
  )
    from public.clients c
   cross join client_teams ct
   cross join contact_sets cs
   where public.current_user_role() = 'master'
     and c.tenant_id = public.current_tenant_id()
     and c.deleted_at is null
     and (p_client_id is null or c.id = p_client_id)
     and public.current_user_can_access_client(c.id)
     -- Клиент записи, которую он видит (02.10: «Карточка из записи» убрано —
     -- из видимой записи карточка открывается всегда).
     and exists (
       select 1
         from public.appointments a
        where a.tenant_id = c.tenant_id
          and a.client_id = c.id
          and a.kind = 'work'
          and a.team_id = any(ct.ids)
     )
     -- «Около записи» (защита базы 30.09): имя клиента мастер видит, пока
     -- клиент в окне записи этой команды, либо если клиент открыт ему правом
     -- «Клиенты» (набор `access_client_ids`), либо он завёл его сам.
     and (
       c.id = any(cs.visible_ids)
       or c.created_by = auth.uid()
       or exists (
         select 1
           from public.appointments a
          where a.tenant_id = c.tenant_id
            and a.client_id = c.id
            and a.kind = 'work'
            and a.team_id = any(ct.ids)
            and a.status is distinct from 'cancelled'
            and a.date between (cs.today - 7)::text and (cs.today + 1)::text
       )
     )
   order by c.full_name, c.id
$function$
;
grant execute on function public.list_master_clients_safe(p_client_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.list_master_services_safe()
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', s.id,
    'tenant_id', s.tenant_id,
    'team_id', s.team_id,
    'name', s.name,
    'color', s.color,
    'unit', s.unit
  )
    from public.services s
   where public.current_user_role() = 'master'
     and s.tenant_id = public.current_tenant_id()
     and s.is_active
     and exists (
       select 1
         from public.appointments a
        where a.tenant_id = s.tenant_id
          and a.kind = 'work'
          and (
            a.master_id = public.current_user_master_id()
            or a.team_id = any(public.current_user_team_ids())
          )
          and (
            coalesce(a.service_ids, '[]'::jsonb) ? s.id
            or exists (
              select 1
                from jsonb_array_elements(
                  case
                    when jsonb_typeof(a.services) = 'array' then a.services
                    else '[]'::jsonb
                  end
                ) line
               where line ->> 'serviceId' = s.id
            )
          )
     )
   order by s.position, s.name, s.id
$function$
;
grant execute on function public.list_master_services_safe() to authenticated;

CREATE OR REPLACE FUNCTION public.list_member_access(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant uuid := public.current_tenant_id();
  result jsonb;
begin
  if auth.uid() is null or active_tenant is null
     or not public.access_company('company.partners', 'read') then
    raise exception 'права сотрудников видит владелец' using errcode = '42501', hint = 'access:not_owner';
  end if;
  result := public.access_map_for(active_tenant, p_user_id, true);
  if result is null then
    raise exception 'человек не состоит в компании' using errcode = '22023', hint = 'access:not_member';
  end if;
  return result;
end;
$function$
;
grant execute on function public.list_member_access(p_user_id uuid) to authenticated;
grant execute on function public.list_member_access(p_user_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.list_member_clients(p_client_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant uuid := public.current_tenant_id();
  caller_role text := public.current_user_role();
  visible uuid[] := array[]::uuid[];
  open_ids uuid[] := array[]::uuid[];
  day_ids uuid[] := array[]::uuid[];
begin
  if auth.uid() is null or active_tenant is null or caller_role is null then
    return;
  end if;

  if caller_role = 'owner' then
    return query
      select to_jsonb(c) || jsonb_build_object(
               'tag_ids',
               coalesce((
                 select jsonb_agg(ta.tag_id order by ta.tag_id)
                   from public.client_tag_assignments ta
                  where ta.tenant_id = c.tenant_id
                    and ta.client_id = c.id
               ), '[]'::jsonb)
             )
        from public.clients c
       where c.tenant_id = active_tenant
         and c.deleted_at is null
         and (p_client_id is null or c.id = p_client_id)
       order by c.full_name, c.id;
    return;
  end if;

  visible := public.access_client_ids();
  if cardinality(visible) = 0 then
    return;
  end if;
  open_ids := public.access_contact_client_ids() || public.access_day_contact_client_ids();
  day_ids := public.access_client_ids_in(public.access_day_contact_teams());

  -- Контактов в списке нет НИКОГДА (номер — дверью), закрытые блоки — пустые.
  return query
    with card_blocks as (
      select * from public.access_client_blocks()
    )
    select public.client_masked_for_member(
             to_jsonb(c) || jsonb_build_object(
               'tag_ids',
               coalesce((
                 select jsonb_agg(ta.tag_id order by ta.tag_id)
                   from public.client_tag_assignments ta
                  where ta.tenant_id = c.tenant_id
                    and ta.client_id = c.id
               ), '[]'::jsonb)
             ),
             cb.blocks
           ) || jsonb_build_object(
             'contacts_hidden',
             case
               when c.id = any(open_ids) then null
               when c.id = any(day_ids) then 'day'
               else 'right'
             end
           )
      from public.clients c
      left join card_blocks cb on cb.client_id = c.id
     where c.tenant_id = active_tenant
       and c.deleted_at is null
       and (p_client_id is null or c.id = p_client_id)
       and c.id = any(visible)
     order by c.full_name, c.id;
end;
$function$
;
grant execute on function public.list_member_clients(p_client_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.list_members(p_team_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant uuid := public.current_tenant_id();
  result jsonb;
begin
  if auth.uid() is null or active_tenant is null
     or not public.access_company('company.partners', 'read') then
    raise exception 'людей компании видит владелец' using errcode = '42501', hint = 'access:not_owner';
  end if;
  if p_team_id is not null and not exists (
    select 1 from public.teams t where t.tenant_id = active_tenant and t.id = p_team_id
  ) then
    raise exception 'календарь не из этой компании' using errcode = '22023', hint = 'access:bad_team';
  end if;

  -- Имя и телефон — сперва из карточки сотрудника (15.09): владелец видит того,
  -- кого сам назвал в приглашении; без карточки — из регистрации, как было.
  select coalesce(jsonb_agg(person order by person->>'name'), '[]'::jsonb)
    into result
    from (
      select jsonb_build_object(
               'user_id', tm.user_id,
               'role', tm.role,
               'name', coalesce(
                 nullif(btrim(m.full_name), ''),
                 nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                 nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
                 split_part(u.email, '@', 1)
               ),
               'email', u.email,
               'phone', coalesce(
                 nullif(btrim(m.phone), ''),
                 nullif(u.phone, ''),
                 nullif(btrim(u.raw_user_meta_data ->> 'phone'), '')
               ),
               'phone_verified', u.phone_confirmed_at is not null
                 and coalesce(u.phone, '') <> ''
                 and u.phone = coalesce(nullif(btrim(m.phone), ''), u.phone),
               'calendars', coalesce((
                 select jsonb_agg(mc.team_id order by mc.team_id)
                   from public.member_calendars mc
                  where mc.tenant_id = tm.tenant_id and mc.user_id = tm.user_id
               ), '[]'::jsonb),
               'joined_at', tm.joined_at,
               'last_seen_at', greatest(
                 u.last_sign_in_at,
                 (select max(greatest(s.refreshed_at::timestamptz, s.updated_at))
                    from auth.sessions s
                   where s.user_id = tm.user_id)
               )
             ) as person
        from public.tenant_members tm
        join auth.users u on u.id = tm.user_id
        left join public.masters m on m.tenant_id = tm.tenant_id and m.id = tm.master_id
       where tm.tenant_id = active_tenant
         and (
           p_team_id is null
           or exists (
             select 1 from public.member_calendars mc
              where mc.tenant_id = tm.tenant_id and mc.user_id = tm.user_id and mc.team_id = p_team_id
           )
         )
    ) people;

  return result;
end;
$function$
;
grant execute on function public.list_members(p_team_id text) to authenticated;
grant execute on function public.list_members(p_team_id text) to service_role;

CREATE OR REPLACE FUNCTION public.list_my_accounts()
 RETURNS TABLE(tenant_id uuid, name text, kind text, role text, joined_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select tm.tenant_id, tn.name, tn.kind, tm.role, tm.joined_at
    from public.tenant_members tm
    join public.tenants tn on tn.id = tm.tenant_id
   where tm.user_id = auth.uid()
   order by (tn.kind = 'personal') desc, tn.name, tm.tenant_id
$function$
;
grant execute on function public.list_my_accounts() to authenticated;

CREATE OR REPLACE FUNCTION public.list_my_calendars()
 RETURNS TABLE(tenant_id uuid, tenant_name text, team_id text, team_name text, team_color text, role text, grants text[], is_active boolean, onboarded boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as materialized (
    select auth.uid() as user_id, public.current_tenant_id() as tenant_id
  )
  select t.tenant_id,
         tn.name,
         t.id,
         t.name,
         t.color,
         tm.role,
         case
           -- Владелец получает все права календаря; «Закрытие дня» удалено.
           when tm.role = 'owner' then array[
             'view','book','edit_all','clients','phones','finance','settings'
           ]::text[]
           when cm.user_id is not null then coalesce(cm.grants, array[]::text[])
           when tm.role = 'dispatcher' then array[
             'view','book','edit_all','clients','phones'
           ]::text[]
           else array['view']::text[]
         end,
         t.tenant_id = me.tenant_id,
         tn.onboarded_at is not null
    from public.tenant_members tm
    cross join me
    join public.tenants tn on tn.id = tm.tenant_id
    join public.teams t on t.tenant_id = tm.tenant_id
    left join public.calendar_members cm
      on cm.tenant_id = t.tenant_id
     and cm.team_id = t.id
     and cm.user_id = tm.user_id
   where tm.user_id = me.user_id
     and t.is_active
     and (
       tm.role = 'owner'
       or cm.user_id is not null
       or (
         not exists (
           select 1 from public.calendar_members c2
            where c2.tenant_id = tm.tenant_id
              and c2.user_id = tm.user_id
         )
         and (
           tm.role = 'dispatcher'
           or (
             tm.master_id is not null
             and (
               exists (
                 select 1 from public.masters m
                  where m.tenant_id = tm.tenant_id
                    and m.id = tm.master_id
                    and m.team_id = t.id
               )
               or coalesce(t.lead_ids, '[]'::jsonb) ? tm.master_id
               or coalesce(t.helper_ids, '[]'::jsonb) ? tm.master_id
               or exists (
                 select 1
                   from jsonb_array_elements(
                     case when jsonb_typeof(t.members) = 'array'
                          then t.members else '[]'::jsonb end
                   ) member
                  where case jsonb_typeof(member)
                          when 'string' then member #>> '{}'
                          when 'object' then coalesce(member ->> 'master_id', member ->> 'id')
                          else null
                        end = tm.master_id
               )
             )
           )
         )
       )
     )
   order by tn.name, t.position, t.name
$function$
;
grant execute on function public.list_my_calendars() to authenticated;

CREATE OR REPLACE FUNCTION public.list_operational_masters_safe()
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', m.id,
    'tenant_id', m.tenant_id,
    'full_name', m.full_name,
    'phone', m.phone,
    'avatar_url', m.avatar_url,
    'team_id', m.team_id,
    'role', m.role,
    'title', m.title,
    'color', m.color,
    'account_status', m.account_status,
    'is_active', m.is_active,
    'position', m.position,
    'created_at', m.created_at,
    'updated_at', m.updated_at
  )
    from public.masters m
   where public.current_user_role() in ('dispatcher', 'master')
     and m.tenant_id = public.current_tenant_id()
     and (
       public.current_user_role() = 'dispatcher'
       or m.id = public.current_user_master_id()
     )
   order by m.position, m.full_name, m.id
$function$
;
grant execute on function public.list_operational_masters_safe() to authenticated;

CREATE OR REPLACE FUNCTION public.list_operational_teams_safe()
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as materialized (
    select public.current_user_role()               as role,
           public.current_tenant_id()               as tenant_id,
           public.current_user_team_ids()           as legacy_team_ids,
           public.current_user_calendar_ids('view') as granted_team_ids,
           exists (
             select 1
               from public.calendar_members cm
              where cm.tenant_id = public.current_tenant_id()
                and cm.user_id = auth.uid()
           ) as has_explicit_grants
  )
  select jsonb_build_object(
    'id', t.id,
    'tenant_id', t.tenant_id,
    'name', t.name,
    'region', t.region,
    'color', t.color,
    'is_active', t.is_active,
    'position', t.position,
    'timezone', t.timezone,
    'default_city', t.default_city,
    'cities', t.cities,
    'tint_days_by_label', t.tint_days_by_label,
    'hide_cancelled', t.hide_cancelled,
    'allow_overtime', t.allow_overtime,
    'appointment_blocks', t.appointment_blocks,
    'buffer_minutes', t.buffer_minutes,
    'calendar_window_start', t.calendar_window_start,
    'calendar_window_end', t.calendar_window_end,
    'default_scroll_time', t.default_scroll_time,
    'default_slot_minutes', t.default_slot_minutes,
    'created_at', t.created_at,
    'updated_at', t.updated_at
  )
    from public.teams t
    cross join me
   where me.role in ('dispatcher', 'master')
     and t.tenant_id = me.tenant_id
     and (
       t.id = any(me.granted_team_ids)
       or (
         not me.has_explicit_grants
         and (
           me.role = 'dispatcher'
           or t.id = any(me.legacy_team_ids)
         )
       )
     )
   order by t.position, t.name, t.id
$function$
;
grant execute on function public.list_operational_teams_safe() to authenticated;

CREATE OR REPLACE FUNCTION public.list_payment_accounts_safe(p_team_id text)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', a.id,
    'name', a.name,
    'kind', a.kind,
    'scope', a.scope,
    'icon', a.icon,
    'color', a.color,
    'position', a.position
  )
    from public.accounts a
   where p_team_id is not null
     and btrim(p_team_id) <> ''
     and a.tenant_id = public.current_tenant_id()
     and a.is_active = true
     and a.show_in_payments = true
     -- Пикер кассы держится того же права, что и сама оплата: «видно, но при
     -- нажатии ошибка» не бывает (AGENTS, правило 10). Остаток кассы
     -- по-прежнему закрыт блоком «Счета и остатки» — здесь только имя.
     and (select public.current_user_can_pay_appointment(p_team_id, null))
     and (
       (a.scope = 'team' and a.brigade_id = p_team_id)
       or (a.scope = 'company' and exists (
         select 1 from public.account_teams att
          where att.account_id = a.id and att.team_id = p_team_id
       ))
     )
   order by (a.scope = 'team') desc, a.position, a.name, a.id
$function$
;
grant execute on function public.list_payment_accounts_safe(p_team_id text) to authenticated;

CREATE OR REPLACE FUNCTION public.location_request_coord(p numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select rtrim(rtrim(to_char(round(p, 6), 'FM999990.999999'), '0'), '.');
$function$
;
grant execute on function public.location_request_coord(p numeric) to anon;
grant execute on function public.location_request_coord(p numeric) to authenticated;

CREATE OR REPLACE FUNCTION public.location_request_create(p_client_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_token text;
begin
  if auth.uid() is null or v_tenant is null
     or public.current_user_role() not in ('owner', 'dispatcher') then
    raise exception 'Ссылку выписывает владелец или диспетчер'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.clients c where c.id = p_client_id and c.tenant_id = v_tenant
  ) then
    raise exception 'Клиент не найден' using errcode = '23503';
  end if;
  delete from public.location_requests
   where client_id = p_client_id and tenant_id = v_tenant and used_at is null;
  -- 24 байта → 32 символа base64url, без «=». pgcrypto живёт в схеме
  -- extensions, поэтому она в search_path выше.
  v_token := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.location_requests (tenant_id, client_id, token, created_by)
  values (v_tenant, p_client_id, v_token, auth.uid());
  return v_token;
end $function$
;
grant execute on function public.location_request_create(p_client_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.location_request_lookup(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_labels jsonb;
begin
  if p_token is null or length(p_token) not between 32 and 128 then
    return jsonb_build_object('state', 'missing');
  end if;
  select lr.tenant_id, lr.used_at, lr.expires_at,
         t.name as business_name, t.logo_url,
         split_part(coalesce(c.full_name, ''), ' ', 1) as first_name,
         c.team_id as client_team_id
    into r
    from public.location_requests lr
    join public.tenants t on t.id = lr.tenant_id
    join public.clients c on c.id = lr.client_id
   where lr.token = p_token;
  if not found then
    return jsonb_build_object('state', 'missing');
  end if;
  -- ТИПЫ ОБЪЕКТОВ — КОМАНДЫ КЛИЕНТА (30.09); у клиента без команды — все
  -- имена компании без повторов.
  select coalesce(jsonb_agg(x.name order by x.pos), '[]'::jsonb)
    into v_labels
    from (
      select l.name, min(l.position) as pos
        from public.location_labels l
       where l.tenant_id = r.tenant_id
         and l.is_active
         and (r.client_team_id is null or l.team_id = r.client_team_id)
       group by l.name
    ) x;
  return jsonb_build_object(
    'state', case
      when r.used_at is not null then 'used'
      when r.expires_at < now() then 'expired'
      else 'pending' end,
    'business_name', r.business_name,
    'logo_url', r.logo_url,
    'client_first_name', r.first_name,
    'labels', v_labels,
    'expires_at', r.expires_at
  );
end $function$
;
grant execute on function public.location_request_lookup(p_token text) to anon;
grant execute on function public.location_request_lookup(p_token text) to authenticated;

CREATE OR REPLACE FUNCTION public.location_request_submit(p_token text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.location_requests%rowtype;
  v_street    text := left(btrim(coalesce(p_payload->>'street', '')), 200);
  v_complex   text := left(btrim(coalesce(p_payload->>'complex', '')), 120);
  v_entrance  text := left(btrim(coalesce(p_payload->>'entrance', '')), 20);
  v_floor     text := left(btrim(coalesce(p_payload->>'floor', '')), 20);
  v_apartment text := left(btrim(coalesce(p_payload->>'apartment', '')), 20);
  v_city      text := left(btrim(coalesce(p_payload->>'city', '')), 80);
  v_zip       text := left(btrim(coalesce(p_payload->>'zip', '')), 16);
  v_note      text := left(btrim(coalesce(p_payload->>'note', '')), 500);
  v_label     text := left(btrim(coalesce(p_payload->>'label', '')), 40);
  v_map       text := left(btrim(coalesce(p_payload->>'map_url', '')), 600);
  v_lat numeric;
  v_lng numeric;
  v_parts jsonb;
  v_addr text;
  v_loc jsonb;
  v_id uuid := gen_random_uuid();
  v_first boolean;
begin
  if p_token is null or length(p_token) not between 32 and 128 then
    return jsonb_build_object('ok', false, 'state', 'missing');
  end if;
  select * into r from public.location_requests where token = p_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'state', 'missing');
  end if;
  if r.used_at is not null then
    return jsonb_build_object('ok', false, 'state', 'used');
  end if;
  if r.expires_at < now() then
    return jsonb_build_object('ok', false, 'state', 'expired');
  end if;

  begin
    v_lat := nullif(p_payload->>'lat', '')::numeric;
    v_lng := nullif(p_payload->>'lng', '')::numeric;
  exception when others then
    v_lat := null;
    v_lng := null;
  end;
  if v_lat is null or v_lng is null
     or v_lat < -90 or v_lat > 90 or v_lng < -180 or v_lng > 180
     or (v_lat = 0 and v_lng = 0) then
    v_lat := null;
    v_lng := null;
  end if;
  if v_map <> '' and v_map !~* '^https?://' then
    v_map := '';
  end if;
  if v_map = '' and v_lat is not null then
    v_map := format('https://www.google.com/maps/search/?api=1&query=%s,%s',
                    public.location_request_coord(v_lat), public.location_request_coord(v_lng));
  end if;
  if v_label = '' then
    v_label := 'Дом';
  end if;

  v_parts := jsonb_strip_nulls(jsonb_build_object(
    'street', nullif(v_street, ''),
    'complex', nullif(v_complex, ''),
    'entrance', nullif(v_entrance, ''),
    'floor', nullif(v_floor, ''),
    'apartment', nullif(v_apartment, ''),
    'city', nullif(v_city, ''),
    'zip', nullif(v_zip, '')
  ));
  if v_street <> '' or v_complex <> '' or v_city <> '' then
    v_addr := array_to_string(array_remove(array[
      nullif(v_street, ''),
      nullif(v_complex, ''),
      case when v_entrance <> '' then 'подъезд ' || v_entrance end,
      case when v_floor <> '' then 'эт. ' || v_floor end,
      case when v_apartment <> '' then 'кв. ' || v_apartment end,
      nullif(btrim(concat_ws(' ', nullif(v_city, ''), nullif(v_zip, ''))), '')
    ], null), ', ');
  elsif v_lat is not null then
    v_addr := format('%s, %s', public.location_request_coord(v_lat), public.location_request_coord(v_lng));
  else
    v_addr := '';
  end if;
  if v_addr = '' and v_map = '' then
    raise exception 'Нужен адрес, точка на карте или ссылка'
      using errcode = '22023';
  end if;

  select coalesce(jsonb_array_length(coalesce(c.locations, '[]'::jsonb)) = 0, true)
    into v_first
    from public.clients c
   where c.id = r.client_id;

  v_loc := jsonb_strip_nulls(jsonb_build_object(
    'id', v_id,
    'label', v_label,
    'address', v_addr,
    'mapUrl', nullif(v_map, ''),
    'addressParts', case when v_parts = '{}'::jsonb then null else v_parts end,
    'note', nullif(v_note, ''),
    'isPrimary', coalesce(v_first, true),
    'source', 'client_link'
  ));

  update public.clients
     set locations = coalesce(locations, '[]'::jsonb) || jsonb_build_array(v_loc)
   where id = r.client_id and tenant_id = r.tenant_id;
  update public.location_requests
     set used_at = now(), location_id = v_id
   where id = r.id;

  return jsonb_build_object('ok', true, 'address', coalesce(nullif(v_addr, ''), v_map));
end $function$
;
grant execute on function public.location_request_submit(p_token text, p_payload jsonb) to anon;
grant execute on function public.location_request_submit(p_token text, p_payload jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.log_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_before jsonb;
  v_after jsonb;
  v_action text := lower(tg_op);
  v_tenant uuid;
  v_team text;
  v_entity_id text;
  v_label text;
  v_meta jsonb;
  v_actor uuid := auth.uid();
  v_ignore constant text[] := array[
    'updated_at', 'created_at', 'purge_at', 'access_version', 'set_at', 'set_by',
    'attached_at', 'attached_by', 'pinned_at', 'phone_e164', 'position'
  ];
begin
  -- Верхний уровень — кроме денег: доход и возврат от оплаты в записи
  -- создаёт триггер записи, и без них фильтр «Деньги» не видел бы главного
  -- пути дохода.
  if pg_trigger_depth() > 1 and tg_table_name <> 'finance_transactions' then
    return null;
  end if;
  -- Удаление календаря стирает его записи и настройки по одной — в журнале
  -- остаётся только сам «Календарь удалён».
  if tg_table_name <> 'teams' and public.calendar_delete_in_progress() then
    return null;
  end if;

  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new, v_old);

  if tg_op = 'UPDATE' then
    -- Мягкое удаление и возврат — отдельные действия, а не «изменено».
    if v_new ? 'deleted_at'
       and (v_old ->> 'deleted_at') is null and (v_new ->> 'deleted_at') is not null then
      v_action := 'delete';
    elsif v_new ? 'deleted_at'
       and (v_old ->> 'deleted_at') is not null and (v_new ->> 'deleted_at') is null then
      v_action := 'restore';
    -- «Удалить» календаря, услуги, метки, типа объекта — это is_active=false
    -- (уходит в архив): в истории это «удалён», а не «Активность да → нет».
    elsif v_new ? 'is_active'
       and (v_old ->> 'is_active')::boolean is true and (v_new ->> 'is_active')::boolean is false then
      v_action := 'delete';
    elsif v_new ? 'is_active'
       and (v_old ->> 'is_active')::boolean is false and (v_new ->> 'is_active')::boolean is true then
      v_action := 'restore';
    else
      for v_key in select jsonb_object_keys(v_new) loop
        continue when v_key = any(v_ignore) or v_key = 'deleted_at';
        v_before := v_old -> v_key;
        v_after := v_new -> v_key;
        continue when v_before is not distinct from v_after;
        if coalesce(jsonb_typeof(v_before), 'null') in ('array', 'null')
           and coalesce(jsonb_typeof(v_after), 'null') in ('array', 'null')
           and (jsonb_typeof(v_before) = 'array' or jsonb_typeof(v_after) = 'array') then
          -- Список (заметки, услуги, оплаты, телефоны, объекты): что
          -- добавили и что убрали — именами; без имён — просто «изменено».
          v_changes := v_changes || jsonb_build_object(
            v_key,
            coalesce(public.change_log_array_diff(v_before, v_after), '"*"'::jsonb)
          );
        elsif jsonb_typeof(v_before) in ('object', 'array') or jsonb_typeof(v_after) in ('object', 'array') then
          v_changes := v_changes || jsonb_build_object(v_key, '"*"'::jsonb);
        else
          if jsonb_typeof(v_before) = 'string' then v_before := to_jsonb(left(v_before #>> '{}', 120)); end if;
          if jsonb_typeof(v_after) = 'string' then v_after := to_jsonb(left(v_after #>> '{}', 120)); end if;
          v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_array(v_before, v_after));
        end if;
      end loop;
      if v_changes = '{}'::jsonb then
        return null;
      end if;
    end if;
  end if;

  v_tenant := (v_row ->> 'tenant_id')::uuid;
  -- Личное событие без команды видит только автор — в журнал, который читает
  -- владелец, оно не идёт.
  if tg_table_name = 'appointments'
     and coalesce(v_row ->> 'kind', 'work') <> 'work'
     and v_row ->> 'team_id' is null then
    return null;
  end if;
  v_team := coalesce(
    v_row ->> 'team_id',
    v_row ->> 'brigade_id',
    case when tg_table_name = 'teams' then v_row ->> 'id' end
  );
  v_entity_id := coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'team_id');

  -- Имя предмета на тот момент и короткая подпись (дата, сумма).
  case tg_table_name
    when 'appointments' then
      v_label := coalesce(
        (select c.full_name from public.clients c
          where c.id = (v_row ->> 'client_id')::uuid and c.tenant_id = v_tenant),
        nullif(btrim(v_row ->> 'comment'), '')
      );
      v_meta := jsonb_build_object(
        'kind', v_row ->> 'kind',
        'date', v_row ->> 'date',
        'time', v_row ->> 'time_start'
      );
    when 'finance_transactions' then
      v_label := coalesce(
        (select fc.name from public.finance_categories fc
          where fc.id = (v_row ->> 'category_id')::uuid
            and (fc.tenant_id = v_tenant or fc.tenant_id is null)),
        nullif(btrim(v_row ->> 'notes'), '')
      );
      v_meta := jsonb_build_object('type', v_row ->> 'type', 'amount', v_row -> 'amount', 'date', v_row ->> 'occurred_on');
    when 'debts' then
      v_label := coalesce(
        (select c.full_name from public.clients c
          where c.id = (v_row ->> 'client_id')::uuid and c.tenant_id = v_tenant),
        nullif(btrim(v_row ->> 'counterparty'), '')
      );
      v_meta := jsonb_build_object('direction', v_row ->> 'direction', 'amount', v_row -> 'amount');
    when 'invoices' then
      v_label := v_row ->> 'number';
      v_meta := jsonb_build_object('kind', v_row ->> 'kind', 'amount', v_row -> 'total');
    when 'receipts' then
      v_label := v_row ->> 'number';
      v_meta := jsonb_build_object('amount', v_row -> 'amount');
    when 'member_access', 'member_calendars', 'tenant_members' then
      v_label := public.change_log_person_name(v_tenant, (v_row ->> 'user_id')::uuid);
      v_meta := jsonb_strip_nulls(jsonb_build_object(
        'block', v_row ->> 'block',
        'block_title', (select b.title_ru from public.access_blocks b where b.key = v_row ->> 'block'),
        'level', v_row ->> 'level',
        'role', v_row ->> 'role'
      ));
    when 'invitations' then
      v_label := coalesce(nullif(btrim(v_row ->> 'full_name'), ''), v_row ->> 'email', v_row ->> 'phone');
    when 'team_design', 'team_schedules' then
      v_label := (select t.name from public.teams t where t.tenant_id = v_tenant and t.id = v_team);
    when 'personal_event_types' then
      v_label := v_row ->> 'label';
    when 'client_tag_assignments' then
      -- Тег у клиента: кому поставили и какой; команда — у тега.
      v_entity_id := v_row ->> 'client_id';
      v_label := (select c.full_name from public.clients c
                   where c.id = (v_row ->> 'client_id')::uuid and c.tenant_id = v_tenant);
      select tg.team_id, jsonb_build_object('tag', tg.name)
        into v_team, v_meta
        from public.client_tags tg
       where tg.id = (v_row ->> 'tag_id')::uuid and tg.tenant_id = v_tenant;
    when 'client_attachments' then
      v_label := v_row ->> 'filename';
      select c.team_id, jsonb_build_object('client', c.full_name, 'client_id', c.id)
        into v_team, v_meta
        from public.clients c
       where c.id = (v_row ->> 'client_id')::uuid and c.tenant_id = v_tenant;
    when 'appointment_photos' then
      v_entity_id := v_row ->> 'appointment_id';
      select coalesce(c.full_name, nullif(btrim(a.comment), '')), a.team_id,
             jsonb_build_object('date', a.date, 'time', a.time_start, 'kind', a.kind)
        into v_label, v_team, v_meta
        from public.appointments a
        left join public.clients c on c.id = a.client_id and c.tenant_id = v_tenant
       where a.id = (v_row ->> 'appointment_id')::uuid and a.tenant_id = v_tenant;
    when 'day_cities' then
      v_label := v_row ->> 'city';
      v_meta := jsonb_build_object('date', v_row ->> 'date');
    when 'calendar_settings' then
      v_label := null;
    else
      v_label := coalesce(v_row ->> 'name', v_row ->> 'full_name', v_row ->> 'label', v_row ->> 'number');
  end case;

  insert into public.change_log (
    tenant_id, team_id, actor_id, actor_name, entity, entity_id, action, label, meta, changes
  ) values (
    v_tenant,
    v_team,
    v_actor,
    case when v_actor is null then null else public.change_log_person_name(v_tenant, v_actor) end,
    tg_table_name,
    v_entity_id,
    v_action,
    left(v_label, 120),
    v_meta,
    case when v_changes = '{}'::jsonb then null else v_changes end
  );
  return null;
exception when others then
  -- Журнал не имеет права уронить правку.
  return null;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.lookup_rating_token(p_token text)
 RETURNS TABLE(token text, tenant_id uuid, master_id text, appointment_id uuid, used_at timestamp with time zone, expires_at timestamp with time zone, brand_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    t.token,
    t.tenant_id,
    t.master_id,
    t.appointment_id,
    t.used_at,
    t.expires_at,
    tn.name as brand_name
  from public.master_rating_tokens t
  left join public.tenants tn on tn.id = t.tenant_id
  where t.token = p_token
    and length(p_token) between 16 and 200
$function$
;
grant execute on function public.lookup_rating_token(p_token text) to anon;
grant execute on function public.lookup_rating_token(p_token text) to authenticated;

CREATE OR REPLACE FUNCTION public.member_access_bump()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  row_tenant uuid := coalesce(new.tenant_id, old.tenant_id);
  row_user uuid := coalesce(new.user_id, old.user_id);
  next_version bigint;
begin
  update public.tenant_members
     set access_version = access_version + 1
   where tenant_id = row_tenant and user_id = row_user
  returning access_version into next_version;
  -- Строка членства уже удаляется (каскад увольнения) — сигнал даёт её триггер.
  if next_version is not null then
    perform realtime.send(
      jsonb_build_object('tenant_id', row_tenant, 'version', next_version),
      'access_changed',
      'access:' || row_user::text,
      true
    );
  end if;
  return null;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.member_access_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  b public.access_blocks%rowtype;
begin
  select * into b from public.access_blocks where key = new.block;
  if not found then
    raise exception 'неизвестный блок %', new.block using errcode = '22023', hint = 'access:bad_block';
  end if;
  if b.owner_only then
    raise exception 'блок % выдаётся только владельцу', new.block using errcode = '42501', hint = 'access:owner_only';
  end if;
  if b.scope = 'calendar' and new.team_id is null then
    raise exception 'у блока % нужен календарь', new.block using errcode = '22023', hint = 'access:bad_team';
  end if;
  if b.scope = 'company' and new.team_id is not null then
    raise exception 'блок % действует на всю компанию', new.block using errcode = '22023', hint = 'access:bad_team';
  end if;
  if b.scope = 'calendar' and not exists (
    select 1 from public.member_calendars mc
     where mc.tenant_id = new.tenant_id and mc.user_id = new.user_id and mc.team_id = new.team_id
  ) then
    raise exception 'человек не прикреплён к календарю %', new.team_id using errcode = '22023', hint = 'access:not_attached';
  end if;
  if not (new.level = any(b.levels)) then
    raise exception 'у блока % нет положения %', new.block, new.level using errcode = '22023', hint = 'access:bad_level';
  end if;
  if exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = new.tenant_id and tm.user_id = new.user_id and tm.role = 'owner'
  ) then
    raise exception 'владелец не ограничивается' using errcode = '42501', hint = 'access:target_owner';
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.member_appointment_copy(p_source uuid, p_date text, p_time_start text, p_time_end text, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.appointments%rowtype;
  v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'master' then
    raise exception 'only an employee can use this appointment copy' using errcode = '42501';
  end if;
  if p_source is null or p_date is null or p_time_start is null or p_time_end is null then
    raise exception 'source, date and time are required' using errcode = '22023';
  end if;

  -- ПОВТОР ПОСЛЕ ПОТЕРЯННОГО ОТВЕТА: копия с этим номером уже встала — её же
  -- и возвращаем. Только свою и только в своей компании: чужой номер так не
  -- подсмотреть (ответ — тот же номер, что и прислан).
  if p_id is not null and exists (
       select 1 from public.appointments x
        where x.id = p_id
          and x.tenant_id = public.current_tenant_id()
          and x.created_by = auth.uid()
     ) then
    return jsonb_build_object('id', p_id);
  end if;

  select * into s
    from public.appointments x
   where x.id = p_source
     and x.tenant_id = public.current_tenant_id();
  if not found
     or s.team_id is null
     or s.kind <> 'work'
     or not public.member_sees_calendar(s.team_id) then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;
  -- «Ограничения» записей (03.10): старую работу он не видит и не копирует.
  if public.member_record_hidden(s.kind, s.team_id, s.date) then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;
  -- «Перенос записей: Может» — всё меню записи, копия в том числе.
  if not public.member_can('calendar.move', 'write', s.team_id) then
    raise exception 'access:block:calendar.move' using errcode = '42501';
  end if;
  -- Клиента копия несёт, только если он виден человеку в этой команде (защита
  -- базы 30.09): копия давней записи на сегодня не возвращает давнего клиента
  -- в окно «Около записи».
  if s.client_id is not null and not public.member_client_in_team(s.client_id, s.team_id) then
    raise exception 'access:client' using errcode = '42501';
  end if;

  -- КОПИЯ — В ТУ ЖЕ КОМАНДУ: команды в вызове нет, она берётся у оригинала.
  -- Оплата, статус, отмена, фото и напоминания не копируются — как у копии
  -- владельца (`duplicateAppointment`).
  insert into public.appointments (id, tenant_id, team_id, kind, date, time_start, time_end,
                                   total_duration, status, created_by)
  values (v_id, s.tenant_id, s.team_id, 'work', p_date, p_time_start, p_time_end,
          greatest(0, (extract(epoch from (p_time_end::time - p_time_start::time)) / 60)::integer),
          'scheduled', auth.uid());

  perform set_config('babun.member_write', 'on', true);
  update public.appointments x
     set (client_id, location_id, comment, address, address_note, address_lat, address_lng,
          services, service_ids, total_amount, custom_total, discount_amount, global_discount,
          service_price_overrides, vat_mode, vat_rate, city, color_override, master_id)
       = (s.client_id, s.location_id, s.comment, s.address, s.address_note, s.address_lat,
          s.address_lng, s.services, s.service_ids, s.total_amount, s.custom_total,
          s.discount_amount, s.global_discount, s.service_price_overrides, s.vat_mode,
          s.vat_rate, s.city, s.color_override, s.master_id)
   where x.id = v_id;
  perform set_config('babun.member_write', 'off', true);

  return jsonb_build_object('id', v_id);
end;
$function$
;
grant execute on function public.member_appointment_copy(p_source uuid, p_date text, p_time_start text, p_time_end text, p_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.member_appointment_create(p_row jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_kind text := coalesce(p_row ->> 'kind', 'work');
  v_team text := p_row ->> 'team_id';
  v_id uuid;
  v_rest jsonb;
  k text;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'master' then
    raise exception 'only an employee can use this appointment create' using errcode = '42501';
  end if;
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    raise exception 'appointment row must be an object' using errcode = '22023';
  end if;
  if v_kind not in ('work', 'event') then
    raise exception 'unsupported appointment kind' using errcode = '22023';
  end if;
  if v_team is null or (p_row ->> 'date') is null
     or (p_row ->> 'time_start') is null or (p_row ->> 'time_end') is null then
    raise exception 'team, date and time are required' using errcode = '22023';
  end if;
  if v_kind = 'work' and not public.member_can('calendar.create', 'write', v_team) then
    raise exception 'access:block:calendar.create' using errcode = '42501';
  end if;
  if v_kind = 'event' and not public.member_can('calendar.events', 'write', v_team) then
    raise exception 'access:block:calendar.events' using errcode = '42501';
  end if;

  v_id := coalesce(nullif(p_row ->> 'id', '')::uuid, gen_random_uuid());
  -- НОВАЯ ЗАПИСЬ — ЦЕЛИКОМ ЕГО (20260924170000). «Новые записи: Может»
  -- значит: клиента, объект, услуги, метку, цвет и заметку своей новой
  -- записи сотрудник выбирает сам — запись клиента без клиента не бывает.
  -- Блоки записи решают ПРАВКУ созданной, а не её рождение. Незнакомое поле
  -- по-прежнему не принимается, клиент — только тот, кого он и так видит.
  -- Событие — прежним правилом: «События: Меняет», поля своего события.
  v_rest := p_row - array['id', 'kind', 'team_id', 'date', 'time_start', 'time_end',
                          'total_duration', 'status', 'tenant_id', 'created_by'];
  for k in select jsonb_object_keys(v_rest) loop
    if v_kind = 'work' then
      if k not in ('comment', 'client_id', 'location_id', 'address', 'address_note',
                   'address_lat', 'address_lng', 'services', 'service_ids', 'total_amount',
                   'custom_total', 'discount_amount', 'global_discount',
                   'service_price_overrides', 'vat_mode', 'vat_rate', 'city',
                   'color_override', 'master_id') then
        raise exception 'access:field:%', k using errcode = '42501';
      end if;
    elsif k in ('comment', 'color_override', 'event_notes', 'event_url') then
      -- НОВОЕ СОБЫТИЕ — ЕГО (повторный аудит 03.10): название, цвет и
      -- заметку своего нового события задаёт автор, как у новой рабочей
      -- записи; блоки события решают правку созданного.
      null;
    else
      perform public.member_check_appointment_field(
        k, v_rest -> k, v_kind, v_team, auth.uid(), 'scheduled'
      );
    end if;
  end loop;
  -- Клиент — только ЭТОЙ команды (30.09): клиент другой его команды сюда не
  -- встаёт (`member_client_in_team`).
  if v_rest ? 'client_id' and jsonb_typeof(v_rest -> 'client_id') <> 'null' then
    if not public.member_client_in_team((v_rest ->> 'client_id')::uuid, v_team) then
      raise exception 'access:client' using errcode = '42501';
    end if;
  end if;

  insert into public.appointments (id, tenant_id, team_id, kind, date, time_start, time_end,
                                   total_duration, status, created_by)
  values (v_id, public.current_tenant_id(), v_team, v_kind, p_row ->> 'date',
          p_row ->> 'time_start', p_row ->> 'time_end',
          coalesce(
            nullif(p_row ->> 'total_duration', '')::integer,
            greatest(0, (extract(epoch from ((p_row ->> 'time_end')::time
                                             - (p_row ->> 'time_start')::time)) / 60)::integer)
          ),
          'scheduled', auth.uid());

  if v_rest <> '{}'::jsonb then
    perform set_config('babun.member_write', 'on', true);
    update public.appointments x
       set (client_id, location_id, comment, address, address_note, address_lat, address_lng,
            services, service_ids, total_amount, custom_total, discount_amount, global_discount,
            service_price_overrides, vat_mode, vat_rate, city, color_override, master_id,
            event_all_day, event_notes, event_url, event_push_enabled, event_push_offsets,
            event_push_at, event_repeat)
         = (select r.client_id, r.location_id, r.comment, r.address, r.address_note, r.address_lat,
                   r.address_lng, r.services, r.service_ids, r.total_amount, r.custom_total,
                   r.discount_amount, r.global_discount, r.service_price_overrides, r.vat_mode,
                   r.vat_rate, r.city, r.color_override, r.master_id, r.event_all_day,
                   r.event_notes, r.event_url, r.event_push_enabled, r.event_push_offsets,
                   r.event_push_at, r.event_repeat
              from jsonb_populate_record(x, v_rest) r)
     where x.id = v_id;
    perform set_config('babun.member_write', 'off', true);
  end if;

  return jsonb_build_object('id', v_id);
end;
$function$
;
grant execute on function public.member_appointment_create(p_row jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.member_appointment_delete(p_appointment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a public.appointments%rowtype;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'master' then
    raise exception 'only an employee can use this appointment delete' using errcode = '42501';
  end if;
  select * into a
    from public.appointments x
   where x.id = p_appointment_id
     and x.tenant_id = public.current_tenant_id()
   for update;
  if not found or a.team_id is null then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;
  -- «Ограничения» записей (03.10): работу старше окна он не видит и не удаляет.
  if public.member_record_hidden(a.kind, a.team_id, a.date) then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;
  if a.kind = 'work' then
    if not public.member_can('calendar.cancel', 'write', a.team_id) then
      raise exception 'access:block:calendar.cancel' using errcode = '42501';
    end if;
  else
    if a.created_by is distinct from auth.uid()
       or not public.member_can('calendar.events', 'write', a.team_id) then
      raise exception 'access:block:calendar.events' using errcode = '42501';
    end if;
  end if;
  delete from public.appointments x where x.id = a.id;
end;
$function$
;
grant execute on function public.member_appointment_delete(p_appointment_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.member_appointment_update(p_appointment_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a public.appointments%rowtype;
  r public.appointments%rowtype;
  k text;
  v_new_team text;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'master' then
    raise exception 'only an employee can use this appointment update' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'appointment patch must be a non-empty object' using errcode = '22023';
  end if;

  select * into a
    from public.appointments x
   where x.id = p_appointment_id
     and x.tenant_id = public.current_tenant_id()
   for update;
  if not found
     or a.team_id is null
     or not public.member_sees_calendar(a.team_id) then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;
  -- «Ограничения» записей (03.10): работу старше окна он не видит и не правит.
  if public.member_record_hidden(a.kind, a.team_id, a.date) then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;

  for k in select jsonb_object_keys(p_patch) loop
    perform public.member_check_appointment_field(
      k, p_patch -> k, a.kind, a.team_id, a.created_by, a.status
    );
  end loop;

  if p_patch ? 'status'
     and (p_patch ->> 'status') not in ('scheduled', 'in_progress', 'completed', 'cancelled') then
    raise exception 'unsupported appointment status' using errcode = '22023';
  end if;

  -- ОТМЕНА ЗАПИСИ С ДЕНЬГАМИ — ЭТО ВОЗВРАТ (аудит 03.10): сверка финансов на
  -- отмене пишет возврат всех денег записи. Без права «Оплата в записи:
  -- Меняет» отмена такой записи не проходит.
  if p_patch ? 'status'
     and (p_patch ->> 'status') = 'cancelled'
     and a.status is distinct from 'cancelled'
     and (
       coalesce(a.prepaid_amount, 0) > 0
       or coalesce(a.paid_amount, 0) > 0
       or a.payment_status in ('paid', 'partial')
       or exists (
         select 1 from public.finance_transactions t
          where t.appointment_id = a.id and t.tenant_id = a.tenant_id and t.type = 'income'
       )
     )
     and public.member_can('record.payment', 'write', a.team_id) is not true then
    raise exception 'access:block:record.payment' using errcode = '42501';
  end if;

  -- Запись не уходит из своей команды (30.09): ни в его, ни в другую команду.
  if p_patch ? 'team_id' then
    v_new_team := p_patch ->> 'team_id';
    if v_new_team is distinct from a.team_id then
      raise exception 'access:team_move' using errcode = '42501';
    end if;
  end if;

  -- Клиент — только тот, кого человек видит в ЭТОЙ команде (30.09).
  -- Проверяется только СМЕНА клиента (30.09): окно «Около записи» не должно
  -- мешать править давнюю запись, где клиент тот же.
  if p_patch ? 'client_id' and jsonb_typeof(p_patch -> 'client_id') <> 'null'
     and (p_patch ->> 'client_id')::uuid is distinct from a.client_id then
    if not public.member_client_in_team((p_patch ->> 'client_id')::uuid, a.team_id) then
      raise exception 'access:client' using errcode = '42501';
    end if;
  end if;

  r := jsonb_populate_record(a, p_patch);

  perform set_config('babun.member_write', 'on', true);
  update public.appointments x
     set team_id = r.team_id,
         master_id = r.master_id,
         client_id = r.client_id,
         location_id = r.location_id,
         date = r.date,
         time_start = r.time_start,
         time_end = r.time_end,
         total_duration = r.total_duration,
         status = r.status,
         comment = r.comment,
         cancel_reason = r.cancel_reason,
         address = r.address,
         address_note = r.address_note,
         address_lat = r.address_lat,
         address_lng = r.address_lng,
         services = r.services,
         service_ids = r.service_ids,
         total_amount = r.total_amount,
         custom_total = r.custom_total,
         discount_amount = r.discount_amount,
         global_discount = r.global_discount,
         service_price_overrides = r.service_price_overrides,
         vat_mode = r.vat_mode,
         vat_rate = r.vat_rate,
         city = r.city,
         color_override = r.color_override,
         event_all_day = r.event_all_day,
         event_notes = r.event_notes,
         event_url = r.event_url,
         event_push_enabled = r.event_push_enabled,
         event_push_offsets = r.event_push_offsets,
         event_push_at = r.event_push_at,
         event_repeat = r.event_repeat
   where x.id = a.id;
  perform set_config('babun.member_write', 'off', true);

  return jsonb_build_object('id', a.id);
end;
$function$
;
grant execute on function public.member_appointment_update(p_appointment_id uuid, p_patch jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.member_can(p_block text, p_min text, p_team text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_team is not null and p_team = any(public.access_calendars(p_block, p_min));
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.member_check_appointment_field(p_key text, p_value jsonb, p_kind text, p_team text, p_created_by uuid, p_old_status text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_block text;
begin
  -- СОБЫТИЯ: своё событие правит автор при «Записи событий: Видит и создаёт»;
  -- что именно в нём — по блокам события (30.09): метка, клиент, объект,
  -- тип (название и цвет), заметка. Время, статус, «весь день», напоминания
  -- и повтор — вместе с самим событием.
  if p_kind in ('event', 'personal') then
    if p_created_by is distinct from auth.uid()
       or public.member_can('calendar.events', 'write', p_team) is not true then
      raise exception 'access:block:calendar.events' using errcode = '42501';
    end if;
    if p_key in ('date', 'time_start', 'time_end', 'total_duration', 'status', 'event_all_day',
                 'event_push_enabled', 'event_push_offsets', 'event_push_at', 'event_repeat',
                 'cancel_reason') then
      return;
    end if;
    v_block := case
      when p_key = 'city' then 'event.label'
      when p_key = 'client_id' then 'event.client'
      when p_key in ('location_id', 'address', 'address_note', 'address_lat', 'address_lng') then 'event.object'
      when p_key in ('comment', 'color_override') then 'event.type'
      when p_key in ('event_notes', 'event_url') then 'event.note'
      else null
    end;
    if v_block is null then
      raise exception 'access:field:%', p_key using errcode = '42501';
    end if;
    if public.member_can(v_block, 'write', p_team) is not true then
      raise exception 'access:block:%', v_block using errcode = '42501';
    end if;
    -- Метка события — только пока «Метка дня» не скрыта (30.09).
    if p_key = 'city' and public.member_can('calendar.day_labels', 'read', p_team) is not true then
      raise exception 'access:block:calendar.day_labels' using errcode = '42501';
    end if;
    return;
  end if;

  -- Тот же статус в правке — не правка (04.10): права на него не нужно.
  if p_key = 'status' and (p_value #>> '{}') is not distinct from p_old_status then
    return;
  end if;

  v_block := case
    when p_key in ('date', 'time_start', 'time_end', 'total_duration') then 'calendar.move'
    -- Заметка записи — своё право (30.09), раньше шла со статусом.
    when p_key = 'comment' then 'record.note'
    when p_key = 'cancel_reason' then 'calendar.cancel'
    when p_key = 'client_id' then 'record.client'
    when p_key in ('location_id', 'address', 'address_note', 'address_lat', 'address_lng') then 'record.object'
    when p_key in ('services', 'service_ids', 'total_amount', 'custom_total', 'discount_amount',
                   'global_discount', 'service_price_overrides', 'vat_mode', 'vat_rate') then 'record.amount'
    when p_key = 'city' then 'record.label'
    when p_key = 'color_override' then 'record.color'
    when p_key in ('team_id', 'master_id') then 'record.team'
    -- Статуса записи нет (03.10): сотрудник меняет его только отменой и
    -- возвратом из неё; «В работе» / «Выполнена» не ставит никто — визит
    -- закрывает оплата.
    when p_key = 'status' then
      case
        when (p_value #>> '{}') = 'cancelled' or p_old_status = 'cancelled' then 'calendar.cancel'
        else null
      end
    else null
  end;
  if v_block is null then
    raise exception 'access:field:%', p_key using errcode = '42501';
  end if;
  -- `is not true`, а не `not …`: пустой ответ проверки не пускает.
  if public.member_can(v_block, 'write', p_team) is not true then
    raise exception 'access:block:%', v_block using errcode = '42501';
  end if;
  -- Метка записи — только пока «Метка дня» не скрыта (30.09).
  if p_key = 'city' and public.member_can('calendar.day_labels', 'read', p_team) is not true then
    raise exception 'access:block:calendar.day_labels' using errcode = '42501';
  end if;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.member_client_contacts(p_client uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid := public.current_tenant_id();
  caller_role text := public.current_user_role();
  row_client public.clients%rowtype;
  state text;
  own_entry boolean;
  already boolean := false;
  opened_day integer := 0;
  opened_hour integer := 0;
  -- Умолчания владельца 30.09 (пункт 1 плана): 30 клиентов в сутки, тревога —
  -- больше 15 за час.
  daily_limit constant integer := 30;
  hourly_alert constant integer := 15;
begin
  if caller is null or active_tenant is null or caller_role is null then
    raise exception 'нет членства в компании'
      using errcode = '42501', hint = 'access:not_member';
  end if;

  select c.* into row_client
    from public.clients c
   where c.id = p_client
     and c.tenant_id = active_tenant
     and c.deleted_at is null;
  if not found then
    raise exception 'client not found' using errcode = 'P0002';
  end if;

  if caller_role = 'owner' then
    return jsonb_build_object('status', 'open') || public.client_contacts_of(to_jsonb(row_client));
  end if;

  -- Клиент вне набора — как будто его нет: ответ не подтверждает, что uuid жив.
  if not (p_client = any(public.access_client_ids())) then
    raise exception 'client not found' using errcode = 'P0002';
  end if;

  if p_client = any(public.access_contact_client_ids())
     or p_client = any(public.access_day_contact_client_ids()) then
    state := 'open';
  elsif p_client = any(public.access_client_ids_in(public.access_day_contact_teams())) then
    state := 'day';
  else
    state := 'right';
  end if;

  own_entry := coalesce(row_client.created_by = caller, false);

  -- Один человек — по очереди: два параллельных открытия не проскочат лимит.
  perform pg_advisory_xact_lock(
    hashtextextended('client-contacts:' || active_tenant::text || ':' || caller::text, 0)
  );

  if state = 'open' then
    select exists (
      select 1
        from public.client_contact_views v
       where v.tenant_id = active_tenant
         and v.user_id = caller
         and v.client_id = p_client
         and v.outcome = 'open'
         and v.opened_at > now() - interval '24 hours'
    ) into already;

    if not already and not own_entry then
      select count(distinct v.client_id) into opened_day
        from public.client_contact_views v
       where v.tenant_id = active_tenant
         and v.user_id = caller
         and v.counted
         and v.opened_at > now() - interval '24 hours';
      if opened_day >= daily_limit then
        state := 'limit';
      end if;
    end if;
  end if;

  -- Повтор того же ответа в пределах 5 минут журнал не множит.
  if not exists (
    select 1
      from public.client_contact_views v
     where v.tenant_id = active_tenant
       and v.user_id = caller
       and v.client_id = p_client
       and v.outcome = state
       and v.opened_at > now() - interval '5 minutes'
  ) then
    insert into public.client_contact_views (tenant_id, user_id, client_id, outcome, counted)
    values (active_tenant, caller, p_client, state, state = 'open' and not own_entry);
  end if;

  if state in ('open', 'limit') then
    select count(distinct v.client_id) into opened_hour
      from public.client_contact_views v
     where v.tenant_id = active_tenant
       and v.user_id = caller
       and v.outcome in ('open', 'limit')
       and not exists (
         select 1 from public.clients own
          where own.id = v.client_id
            and own.created_by = caller
       )
       and v.opened_at > now() - interval '1 hour';

    -- Одна тревога на человека в час.
    if (state = 'limit' or opened_hour > hourly_alert)
       and not exists (
         select 1
           from public.client_contact_alerts al
          where al.tenant_id = active_tenant
            and al.user_id = caller
            and al.created_at > now() - interval '1 hour'
       ) then
      insert into public.client_contact_alerts (tenant_id, user_id, kind, clients_count)
      values (
        active_tenant,
        caller,
        case when state = 'limit' then 'limit' else 'spike' end,
        greatest(opened_hour, opened_day)
      );
    end if;
  end if;

  if state <> 'open' then
    return jsonb_build_object('status', state);
  end if;
  -- Связи — блок «Люди» (30.09): закрыт — связей нет и в открытом номере.
  return jsonb_build_object('status', 'open') || public.client_contacts_of(to_jsonb(row_client))
    || case
         when coalesce((
           select b.blocks ->> 'clients.people'
             from public.access_client_blocks() b
            where b.client_id = p_client
         ), 'off') = 'off'
           then jsonb_build_object('memberships', '[]'::jsonb)
         else '{}'::jsonb
       end;
end;
$function$
;
grant execute on function public.member_client_contacts(p_client uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.member_client_history(p_client uuid DEFAULT NULL::uuid)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant uuid := public.current_tenant_id();
begin
  if auth.uid() is null or active_tenant is null
     or public.current_user_role() is distinct from 'master' then
    return;
  end if;

  return query
    with open_history as (
      select cb.client_id,
             -- 03.10: «Долг и деньги» ушли в «Историю»: видит историю — видит суммы.
             cb.blocks ->> 'clients.history' in ('read', 'write') as see_money,
             cb.blocks ->> 'clients.objects' in ('read', 'write') as see_object,
             -- 03.10: «История» — «Все команды» (write): записи всех команд
             -- компании; «Своя команда» (read): только записи его команд, где
             -- у него есть «История».
             cb.blocks ->> 'clients.history' = 'write' as all_teams
        from public.access_client_blocks() cb
       where cb.blocks ->> 'clients.history' in ('read', 'write')
         and (p_client is null or cb.client_id = p_client)
    ),
    history_teams as (
      select public.access_calendars('clients.history', 'read') as ids
    )
    select jsonb_build_object(
      'id', a.id,
      'tenant_id', a.tenant_id,
      'client_id', a.client_id,
      'team_id', a.team_id,
      'master_id', a.master_id,
      'location_id', case when h.see_object then a.location_id end,
      'date', a.date,
      'time_start', a.time_start,
      'time_end', a.time_end,
      'kind', a.kind,
      'status', a.status,
      'comment', '',
      'address', '',
      'address_note', '',
      'address_lat', null,
      'address_lng', null,
      'cancel_reason', null,
      'source', a.source,
      'is_online_booking', a.is_online_booking,
      'consent_given', a.consent_given,
      'color_override', null,
      'city', null,
      'reminder_enabled', false,
      'reminder_offsets', '[]'::jsonb,
      'reminder_template', null,
      'service_ids', coalesce(a.service_ids, '[]'::jsonb),
      'total_duration', a.total_duration,
      'created_by', a.created_by,
      'created_at', a.created_at,
      'updated_at', a.updated_at,
      'event_all_day', false,
      'event_notes', '',
      'event_url', '',
      'event_push_enabled', false,
      'event_push_offsets', '[]'::jsonb,
      'event_push_at', null,
      'event_repeat', null,
      'total_amount', case when h.see_money then coalesce(a.total_amount, 0) else 0 end,
      'custom_total', case when h.see_money then coalesce(a.custom_total, false) else false end,
      'discount_amount', case when h.see_money then coalesce(a.discount_amount, 0) else 0 end,
      'prepaid_amount', 0,
      'paid_amount', case when h.see_money then coalesce(a.paid_amount, 0) else 0 end,
      'payment_status', case when h.see_money then coalesce(a.payment_status, 'unpaid') else 'unpaid' end,
      'payment_method', null,
      'payments', '[]'::jsonb,
      'payment', null,
      'expenses', '[]'::jsonb,
      'services', case
        when jsonb_typeof(a.services) is distinct from 'array' then '[]'::jsonb
        else (
          select coalesce(jsonb_agg(
                   jsonb_strip_nulls(jsonb_build_object(
                     'serviceId', line -> 'serviceId',
                     'serviceName', line -> 'serviceName',
                     'quantity', line -> 'quantity',
                     'unit', line -> 'unit',
                     'duration', line -> 'duration',
                     'variantId', line -> 'variantId'
                   )) || case
                     when h.see_money then jsonb_strip_nulls(jsonb_build_object(
                       'pricePerUnit', line -> 'pricePerUnit',
                       'originalPrice', line -> 'originalPrice',
                       'totalPrice', line -> 'totalPrice'
                     ))
                     else '{"pricePerUnit": 0, "originalPrice": 0, "totalPrice": 0}'::jsonb
                   end
                   order by ord), '[]'::jsonb)
            from jsonb_array_elements(a.services) with ordinality as l(line, ord)
        )
      end,
      'service_price_overrides', '{}'::jsonb,
      'global_discount', null
    )
      from public.appointments a
      join open_history h on h.client_id = a.client_id
     cross join history_teams ht
     where a.tenant_id = active_tenant
       and a.kind = 'work'
       and (h.all_teams or a.team_id = any(ht.ids))
     order by a.date, a.time_start, a.id;
end;
$function$
;
grant execute on function public.member_client_history(p_client uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.member_client_in_team(p_client uuid, p_team text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_client is not null
     and p_team is not null
     and (
       -- у клиента есть работа этой команды
       exists (
         select 1 from public.appointments a
          where a.tenant_id = public.current_tenant_id()
            and a.client_id = p_client
            and a.team_id = p_team
            and a.kind = 'work'
            -- «Около записи» (защита базы 30.09): давний клиент команды сюда
            -- не проходит — только запись в окне (день до, неделя после); всю
            -- историю команды даёт «Своей команды» (ветка ниже).
            and a.status is distinct from 'cancelled'
            and a.date between (public.tenant_business_date(public.current_tenant_id()) - 7)::text
                           and (public.tenant_business_date(public.current_tenant_id()) + 1)::text
       )
       -- или ему открыта база клиентов этой команды («Какие клиенты: Все»)
       or (
         p_team = any(public.access_calendars('clients', 'read'))
         and p_client = any(public.access_client_ids_in(array[p_team]))
       )
       -- или клиента завёл он сам
       or exists (
         select 1 from public.clients c
          where c.id = p_client
            and c.tenant_id = public.current_tenant_id()
            and c.created_by = auth.uid()
            and c.deleted_at is null
       )
     );
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.member_day_money_window_starts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(t.team_id, t.start), '{}'::jsonb)
    from (
      select x.team_id, public.member_record_window_start(x.team_id) as start
        from (
          select distinct unnest(public.access_calendars('calendar.day_money', 'read')) as team_id
        ) x
       where auth.uid() is not null
         and public.current_user_role() = 'master'
    ) t
   where t.start is not null
$function$
;
grant execute on function public.member_day_money_window_starts() to authenticated;

CREATE OR REPLACE FUNCTION public.member_finance_window_starts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(t.team_id, t.start), '{}'::jsonb)
    from (
      select x.team_id,
             case l.level
               when 'own' then null
               when 'all' then null
               else (public.tenant_business_date(public.current_tenant_id()) - case l.level
                       when 'near' then interval '14 days'
                       when 'month' then interval '1 month'
                       when 'quarter' then interval '3 months'
                       when 'half' then interval '6 months'
                       else interval '7 days'
                     end)::date::text
             end as start
        from (
          select distinct unnest(
            public.access_calendars('finance.income', 'read')
            || public.access_calendars('finance.expense', 'read')
          ) as team_id
        ) x
        cross join lateral (
          select public.access_team_level(public.current_tenant_id(), auth.uid(), 'finance.window', x.team_id) as level
        ) l
       where auth.uid() is not null
         and public.current_user_role() = 'master'
    ) t
   where t.start is not null
$function$
;
grant execute on function public.member_finance_window_starts() to authenticated;

CREATE OR REPLACE FUNCTION public.member_record_hidden(p_kind text, p_team text, p_date text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(p_kind = 'work' and p_date < public.member_record_window_start(p_team), false)
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.member_record_window_start(p_team text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case l.level
           when 'own' then null
           when 'all' then null
           else (public.tenant_business_date(public.current_tenant_id()) - case l.level
                   when 'near' then interval '14 days'
                   when 'month' then interval '1 month'
                   when 'quarter' then interval '3 months'
                   when 'half' then interval '6 months'
                   else interval '7 days'
                 end)::date::text
         end
    from (
      select public.access_team_level(public.current_tenant_id(), auth.uid(), 'calendar.window', p_team) as level
    ) l
   where auth.uid() is not null
     and public.current_user_role() = 'master'
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.member_record_window_starts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(t.team_id, t.start), '{}'::jsonb)
    from (
      select x.team_id, public.member_record_window_start(x.team_id) as start
        from unnest(public.access_calendars('calendar.records', 'read')) as x(team_id)
    ) t
   where t.start is not null
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.member_rename_day_label(p_team text, p_from text, p_to text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n integer;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'master' then
    raise exception 'only an employee can use this label rename' using errcode = '42501';
  end if;
  if p_team is null or p_from is null or p_to is null or length(btrim(p_to)) = 0 then
    raise exception 'team, old and new label names are required' using errcode = '22023';
  end if;
  if public.member_can('calendar.labels', 'write', p_team) is not true then
    raise exception 'access:block:calendar.labels' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.cities c
     where c.tenant_id = public.current_tenant_id()
       and c.team_id = p_team
       and c.name = p_to
       and c.deleted_at is null
  ) then
    raise exception 'label not found in this team' using errcode = 'P0002';
  end if;

  update public.day_cities d
     set city = p_to
   where d.tenant_id = public.current_tenant_id()
     and d.team_id = p_team
     and d.city = p_from;
  get diagnostics n = row_count;
  return n;
end;
$function$
;
grant execute on function public.member_rename_day_label(p_team text, p_from text, p_to text) to authenticated;

CREATE OR REPLACE FUNCTION public.member_sees_calendar(p_team text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_team is not null
     and exists (
       select 1 from public.member_calendars mc
        where mc.tenant_id = public.current_tenant_id()
          and mc.user_id = auth.uid()
          and mc.team_id = p_team
     )
     and public.access_records_level(public.current_tenant_id(), auth.uid(), p_team) in ('read', 'write');
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.member_trash_client(p_client_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant uuid := public.current_tenant_id();
  base_level text;
begin
  if auth.uid() is null or active_tenant is null or p_client_id is null then
    raise exception 'sign in to delete a client'
      using errcode = '42501';
  end if;
  if public.current_user_role() is distinct from 'owner' then
    -- 03.10: «Удаление клиента: Может» (02.10 было в «Меню клиента»).
    select b.blocks ->> 'clients.delete' into base_level
      from public.access_client_blocks() b
     where b.client_id = p_client_id;
    if base_level is distinct from 'write' then
      raise exception 'only the owner or an employee who may delete clients deletes a client'
        using errcode = '42501', hint = 'block:clients.delete';
    end if;
  end if;
  update public.clients c
     set deleted_at = now(),
         purge_at = case
           when exists (
             select 1 from public.appointments a
              where a.tenant_id = c.tenant_id and a.client_id = c.id
           ) then null
           else now() + interval '30 days'
         end
   where id = p_client_id
     and tenant_id = active_tenant
     and deleted_at is null;
  if not found then
    raise exception 'client not found'
      using errcode = 'P0002';
  end if;
end;
$function$
;
grant execute on function public.member_trash_client(p_client_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.member_update_team(p_team text, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  k text;
  v_block text;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'master' then
    raise exception 'only an employee can use this team update' using errcode = '42501';
  end if;
  if p_team is null or p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'team and a non-empty patch are required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.teams t
     where t.tenant_id = public.current_tenant_id() and t.id = p_team and t.is_active
  ) then
    raise exception 'team not found' using errcode = 'P0002';
  end if;

  -- Каждое поле — по праву своей строки в «Настройках команды».
  for k in select jsonb_object_keys(p_patch) loop
    -- «Обычный цвет» на странице «Записи» — это цвет команды: его меняет и
    -- «Название и цвет», и «Записи» (владелец 30.09: «Видит и меняет» —
    -- всё на странице).
    if k = 'color'
       and (public.member_can('calendar.identity', 'write', p_team)
            or public.member_can('calendar.booking_form', 'write', p_team)) is true then
      continue;
    end if;
    v_block := case
      when k in ('name', 'color', 'icon') then 'calendar.identity'
      when k = 'timezone' then 'calendar.timezone'
      when k in ('calendar_window_start', 'calendar_window_end') then 'calendar.hours'
      when k = 'buffer_minutes' then 'calendar.schedule'
      when k = 'hide_cancelled' then 'calendar.booking_form'
      else null
    end;
    if v_block is null then
      raise exception 'access:field:%', k using errcode = '42501';
    end if;
    -- `is not true`, а не `not …`: пустой ответ проверки не пускает.
    if public.member_can(v_block, 'write', p_team) is not true then
      raise exception 'access:block:%', v_block using errcode = '42501';
    end if;
  end loop;

  -- Значения — той же формы, что пишет экран владельца.
  if p_patch ? 'name'
     and (jsonb_typeof(p_patch -> 'name') <> 'string'
          or length(btrim(p_patch ->> 'name')) = 0
          or length(p_patch ->> 'name') > 80) then
    raise exception 'team name must be non-empty text' using errcode = '22023';
  end if;
  if p_patch ? 'color'
     and jsonb_typeof(p_patch -> 'color') <> 'null'
     and (jsonb_typeof(p_patch -> 'color') <> 'string' or (p_patch ->> 'color') !~ '^#[0-9A-Fa-f]{6}$') then
    raise exception 'team color must be #RRGGBB' using errcode = '22023';
  end if;
  if p_patch ? 'icon'
     and jsonb_typeof(p_patch -> 'icon') <> 'null'
     and (jsonb_typeof(p_patch -> 'icon') <> 'string' or length(p_patch ->> 'icon') > 64) then
    raise exception 'team icon must be a short name' using errcode = '22023';
  end if;
  if p_patch ? 'timezone'
     and jsonb_typeof(p_patch -> 'timezone') <> 'null'
     and (jsonb_typeof(p_patch -> 'timezone') <> 'string'
          or not exists (select 1 from pg_timezone_names z where z.name = p_patch ->> 'timezone')) then
    raise exception 'unknown timezone' using errcode = '22023';
  end if;
  if (p_patch ? 'calendar_window_start'
      and jsonb_typeof(p_patch -> 'calendar_window_start') <> 'null'
      and (p_patch ->> 'calendar_window_start') !~ '^([01][0-9]|2[0-4]):[0-5][0-9]$')
     or (p_patch ? 'calendar_window_end'
      and jsonb_typeof(p_patch -> 'calendar_window_end') <> 'null'
      and (p_patch ->> 'calendar_window_end') !~ '^([01][0-9]|2[0-4]):[0-5][0-9]$') then
    raise exception 'calendar hours must be HH:MM' using errcode = '22023';
  end if;
  if p_patch ? 'buffer_minutes'
     and jsonb_typeof(p_patch -> 'buffer_minutes') <> 'null'
     and (jsonb_typeof(p_patch -> 'buffer_minutes') <> 'number'
          or (p_patch ->> 'buffer_minutes')::numeric <> floor((p_patch ->> 'buffer_minutes')::numeric)
          or (p_patch ->> 'buffer_minutes')::integer not between 0 and 1439) then
    raise exception 'buffer must be whole minutes within a day' using errcode = '22023';
  end if;
  if p_patch ? 'hide_cancelled' and jsonb_typeof(p_patch -> 'hide_cancelled') <> 'boolean' then
    raise exception 'hide_cancelled must be true or false' using errcode = '22023';
  end if;

  update public.teams t
     set name = case when p_patch ? 'name' then btrim(p_patch ->> 'name') else t.name end,
         color = case when p_patch ? 'color' then p_patch ->> 'color' else t.color end,
         icon = case when p_patch ? 'icon' then p_patch ->> 'icon' else t.icon end,
         timezone = case when p_patch ? 'timezone' then p_patch ->> 'timezone' else t.timezone end,
         calendar_window_start = case
           when p_patch ? 'calendar_window_start' then p_patch ->> 'calendar_window_start'
           else t.calendar_window_start
         end,
         calendar_window_end = case
           when p_patch ? 'calendar_window_end' then p_patch ->> 'calendar_window_end'
           else t.calendar_window_end
         end,
         buffer_minutes = case
           when p_patch ? 'buffer_minutes' then (p_patch ->> 'buffer_minutes')::integer
           else t.buffer_minutes
         end,
         hide_cancelled = case
           when p_patch ? 'hide_cancelled' then (p_patch ->> 'hide_cancelled')::boolean
           else t.hide_cancelled
         end
   where t.tenant_id = public.current_tenant_id()
     and t.id = p_team;

  return jsonb_build_object('id', p_team);
end;
$function$
;
grant execute on function public.member_update_team(p_team text, p_patch jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.mirror_member_calendar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_master_id text;
begin
  if tg_op = 'INSERT' then
    select tm.role, tm.master_id
      into v_role, v_master_id
      from public.tenant_members tm
     where tm.tenant_id = new.tenant_id
       and tm.user_id = new.user_id;
    if v_role is null or v_role = 'owner' then
      return new;
    end if;
    insert into public.calendar_members (tenant_id, team_id, user_id, master_id, grants, created_by)
    values (
      new.tenant_id,
      new.team_id,
      new.user_id,
      v_master_id,
      case v_role
        when 'dispatcher' then array['view','book','edit_all','clients','phones']::text[]
        else array['view']::text[]
      end,
      new.attached_by
    )
    on conflict (tenant_id, team_id, user_id) do nothing;
    return new;
  end if;

  delete from public.calendar_members cm
   where cm.tenant_id = old.tenant_id
     and cm.team_id = old.team_id
     and cm.user_id = old.user_id;
  return old;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.my_access_map()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant uuid := public.current_tenant_id();
  result jsonb;
begin
  if auth.uid() is null or active_tenant is null then
    raise exception 'нет членства в компании' using errcode = '42501', hint = 'access:not_member';
  end if;
  result := public.access_map_for(active_tenant, auth.uid(), false);
  if result is null then
    raise exception 'нет членства в компании' using errcode = '42501', hint = 'access:not_member';
  end if;
  return result;
end;
$function$
;
grant execute on function public.my_access_map() to authenticated;
grant execute on function public.my_access_map() to service_role;

CREATE OR REPLACE FUNCTION public.my_invitations()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text;
  v_account_created timestamptz;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to read invitations'
      using errcode = '42501', hint = 'invite:not_signed_in';
  end if;

  select lower(coalesce(u.email, '')), u.created_at
    into v_email, v_account_created
    from auth.users u
   where u.id = auth.uid();

  if coalesce(v_email, '') = '' then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'id', i.id,
               'tenant_id', i.tenant_id,
               'company', t.name,
               'inviter', coalesce(
                 nullif(btrim(iu.raw_user_meta_data ->> 'full_name'), ''),
                 nullif(btrim(iu.raw_user_meta_data ->> 'name'), ''),
                 split_part(iu.email, '@', 1)
               ),
               'role', i.role,
               -- Старые сборки читают один календарь: теперь это первый живой.
               'calendar', case
                 when tm.id is null then null
                 else jsonb_build_object('id', tm.id, 'name', tm.name, 'color', tm.color)
               end,
               -- Все живые календари приглашения (15.09), домашний первым:
               -- человек видит, куда именно его зовут, до «Принять».
               'calendars', coalesce((
                 select jsonb_agg(
                          jsonb_build_object('id', ct.id, 'name', ct.name, 'color', ct.color)
                          order by x.ord
                        )
                   from unnest(coalesce(i.team_ids, array[i.team_id]))
                        with ordinality as x(team_id, ord)
                   join public.teams ct
                     on ct.tenant_id = i.tenant_id
                    and ct.id = x.team_id
                    and ct.is_active
               ), '[]'::jsonb),
               'expires_at', i.expires_at,
               'created_at', i.created_at
             )
             order by i.created_at desc
           )
      from public.invitations i
      join public.tenants t
        on t.id = i.tenant_id and t.onboarded_at is not null
      -- Первый живой календарь приглашения: архив домашнего больше не прячет
      -- приглашение, в котором остались другие живые календари.
      left join lateral (
        select ct.id, ct.name, ct.color
          from unnest(coalesce(i.team_ids, array[i.team_id])) with ordinality as x(team_id, ord)
          join public.teams ct
            on ct.tenant_id = i.tenant_id and ct.id = x.team_id and ct.is_active
         order by x.ord
         limit 1
      ) tm on true
      left join auth.users iu
        on iu.id = i.invited_by_user_id
     where lower(i.email) = v_email
       and i.accepted_at is null
       and i.expires_at > now()
       and i.created_at > v_account_created
       and (i.team_id is null or tm.id is not null)
       and not exists (
         select 1 from public.tenant_members m
          where m.tenant_id = i.tenant_id and m.user_id = auth.uid()
       )
  ), '[]'::jsonb);
end;
$function$
;
grant execute on function public.my_invitations() to authenticated;

CREATE OR REPLACE FUNCTION public.next_document_number(p_tenant_id uuid, p_legal_entity_id uuid, p_doc_type text, p_year integer)
 RETURNS TABLE(seq integer, number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  entity public.legal_entities%rowtype;
  issued integer;
begin
  if p_doc_type is null or p_doc_type not in ('invoice', 'receipt', 'credit_note') then
    raise exception 'Неизвестный тип документа';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2999 then
    raise exception 'Некорректный год документа';
  end if;
  select * into entity
    from public.legal_entities
   where id = p_legal_entity_id
     and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Юрлицо документа не найдено в этой компании';
  end if;

  insert into public.document_sequences as series
         (tenant_id, legal_entity_id, doc_type, year, last_number)
  values (p_tenant_id, p_legal_entity_id, p_doc_type, p_year, 1)
  on conflict (tenant_id, legal_entity_id, doc_type, year)
  do update set last_number = series.last_number + 1,
                updated_at = now()
  returning series.last_number into issued;

  seq := issued;
  number := public.format_document_number(
    public.document_prefix(entity, p_doc_type), p_year, issued, entity.number_padding
  );
  return next;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.normalize_client_requisites(p_sets jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  entry jsonb;
  field text;
  result jsonb := '[]'::jsonb;
  seen_ids text[] := array[]::text[];
  default_taken boolean := false;
  set_id text;
  v_legal text;
  v_vat text;
  v_reg text;
  v_address text;
  v_default boolean;
begin
  if p_sets is null or jsonb_typeof(p_sets) = 'null' then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_sets) <> 'array' then
    raise exception 'client requisites must be an array'
      using errcode = '22023';
  end if;

  for entry in select value from jsonb_array_elements(p_sets)
  loop
    if jsonb_typeof(entry) <> 'object' then
      raise exception 'client requisites entry must be an object'
        using errcode = '22023';
    end if;
    foreach field in array array['id', 'legal_name', 'vat_number', 'reg_number', 'billing_address']
    loop
      if entry ? field and jsonb_typeof(entry -> field) not in ('string', 'number', 'null') then
        raise exception 'client requisites field % must be text', field
          using errcode = '22023';
      end if;
    end loop;

    v_legal := nullif(btrim(entry ->> 'legal_name'), '');
    v_vat := upper(nullif(btrim(entry ->> 'vat_number'), ''));
    v_reg := upper(nullif(btrim(entry ->> 'reg_number'), ''));
    v_address := nullif(btrim(entry ->> 'billing_address'), '');
    -- Пустой набор — не набор: печатать с него нечего.
    if v_legal is null and v_vat is null and v_reg is null and v_address is null then
      continue;
    end if;

    set_id := nullif(btrim(entry ->> 'id'), '');
    if set_id is null or set_id = any(seen_ids) then
      set_id := gen_random_uuid()::text;
    end if;
    seen_ids := seen_ids || set_id;

    v_default := not default_taken
      and lower(coalesce(entry ->> 'is_default', 'false')) = 'true';
    if v_default then
      default_taken := true;
    end if;

    result := result || jsonb_build_array(jsonb_build_object(
      'id', set_id,
      'legal_name', v_legal,
      'vat_number', v_vat,
      'reg_number', v_reg,
      'billing_address', v_address,
      'is_default', v_default
    ));
  end loop;

  if not default_taken and jsonb_array_length(result) > 0 then
    result := jsonb_set(result, '{0,is_default}', 'true'::jsonb);
  end if;
  return result;
end;
$function$
;
grant execute on function public.normalize_client_requisites(p_sets jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.normalize_client_tag_ids(p_tenant_id uuid, p_tag_ids uuid[])
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  normalized_ids uuid[];
begin
  if p_tenant_id is null then
    raise exception 'tenant id is required'
      using errcode = '22023';
  end if;

  if array_position(coalesce(p_tag_ids, array[]::uuid[]), null) is not null then
    raise exception 'client tag ids cannot contain null'
      using errcode = '22023';
  end if;

  select coalesce(
           array_agg(distinct supplied.tag_id order by supplied.tag_id),
           array[]::uuid[]
         )
    into normalized_ids
    from unnest(coalesce(p_tag_ids, array[]::uuid[])) supplied(tag_id);

  if exists (
    select 1
      from unnest(normalized_ids) supplied(tag_id)
     where not exists (
       select 1
         from public.client_tags tag
        where tag.tenant_id = p_tenant_id
          and tag.id = supplied.tag_id
     )
  ) then
    raise exception 'client tag does not belong to the active tenant'
      using errcode = '23503';
  end if;

  return normalized_ids;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.partner_files_stamp_author()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.created_by := auth.uid();
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.partners_card_manageable(p_master_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select auth.uid() is not null
     and public.current_tenant_id() is not null
     and (
       public.current_user_role() = 'owner'
       or (
         public.access_company('company.partners', 'write')
         and (
           exists (
             select 1 from public.tenant_members tm
              where tm.tenant_id = public.current_tenant_id()
                and tm.master_id = p_master_id
                and public.partners_manageable(tm.user_id)
           )
           or exists (
             select 1 from public.invitations i
              where i.tenant_id = public.current_tenant_id()
                and i.master_id = p_master_id
                and i.accepted_at is null
                and i.invited_by_user_id = auth.uid()
           )
         )
       )
     )
$function$
;
grant execute on function public.partners_card_manageable(p_master_id text) to authenticated;

CREATE OR REPLACE FUNCTION public.partners_check_caps(p_tenant uuid, p_user uuid, p_changes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  change jsonb;
  b public.access_blocks%rowtype;
  change_team text;
  change_level text;
  current_level text;
  my_level text;
begin
  if public.current_user_role() = 'owner' then
    return;
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    return;
  end if;
  for change in select value from jsonb_array_elements(p_changes) loop
    select * into b from public.access_blocks where key = change ->> 'block';
    if not found then
      continue;
    end if;
    change_team := nullif(change ->> 'team_id', '');
    change_level := change ->> 'level';

    if p_user is not null then
      select ma.level into current_level
        from public.member_access ma
       where ma.tenant_id = p_tenant
         and ma.user_id = p_user
         and ma.block = b.key
         and ma.team_id is not distinct from change_team;
      -- Неизменённая строка — не решение директора: её не проверяем.
      if change_level is not distinct from coalesce(current_level, b.levels[1]) then
        continue;
      end if;
    end if;

    if b.key = 'company.partners' then
      raise exception 'Право «Партнёры» выдаёт только владелец'
        using errcode = '42501', hint = 'access:partners_owner_only';
    end if;

    if b.scope = 'calendar' and not exists (
      select 1 from public.member_calendars mc
       where mc.tenant_id = p_tenant
         and mc.user_id = auth.uid()
         and mc.team_id = change_team
    ) then
      raise exception 'В этой команде вы не работаете — её права ставит владелец'
        using errcode = '42501', hint = 'access:not_your_calendar', detail = change_team;
    end if;

    select ma.level into my_level
      from public.member_access ma
     where ma.tenant_id = p_tenant
       and ma.user_id = auth.uid()
       and ma.block = b.key
       and ma.team_id is not distinct from change_team;
    my_level := coalesce(my_level, b.levels[1]);

    if coalesce(array_position(b.levels, change_level), 0) > coalesce(array_position(b.levels, my_level), 0) then
      raise exception 'Нельзя дать больше, чем есть у вас: «%»', b.title_ru
        using errcode = '42501', hint = 'access:above_own', detail = b.key;
    end if;
  end loop;
end;
$function$
;
grant execute on function public.partners_check_caps(p_tenant uuid, p_user uuid, p_changes jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.partners_check_teams(p_wanted text[], p_stored text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  bad text;
begin
  if public.current_user_role() = 'owner' then
    return;
  end if;
  select x.t into bad
    from (
      (select unnest(coalesce(p_wanted, array[]::text[])) as t
       except
       select unnest(coalesce(p_stored, array[]::text[])))
      union
      (select unnest(coalesce(p_stored, array[]::text[]))
       except
       select unnest(coalesce(p_wanted, array[]::text[])))
    ) x
   where not exists (
     select 1 from public.member_calendars mc
      where mc.tenant_id = public.current_tenant_id()
        and mc.user_id = auth.uid()
        and mc.team_id = x.t
   )
   limit 1;
  if bad is not null then
    raise exception 'В этой команде вы не работаете — её назначает владелец'
      using errcode = '42501', hint = 'access:not_your_calendar', detail = bad;
  end if;
end;
$function$
;
grant execute on function public.partners_check_teams(p_wanted text[], p_stored text[]) to authenticated;

CREATE OR REPLACE FUNCTION public.partners_manageable(p_user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant uuid := public.current_tenant_id();
  target_role text;
begin
  if auth.uid() is null or active_tenant is null or p_user is null or p_user = auth.uid() then
    return false;
  end if;
  select tm.role into target_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant and tm.user_id = p_user;
  if target_role is null or target_role = 'owner' then
    return false;
  end if;
  if public.current_user_role() = 'owner' then
    return true;
  end if;
  if not public.access_company('company.partners', 'write') then
    return false;
  end if;
  -- Директора ведёт только владелец.
  return not exists (
    select 1 from public.member_access ma
     where ma.tenant_id = active_tenant
       and ma.user_id = p_user
       and ma.block = 'company.partners'
       and ma.team_id is null
       and ma.level <> 'off'
  );
end;
$function$
;
grant execute on function public.partners_manageable(p_user uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.patch_master_profile(p_master_id text, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_profile jsonb;
begin
  if auth.uid() is null
     or public.current_tenant_id() is null
     or not public.partners_card_manageable(p_master_id) then
    raise exception 'only an owner can update a master profile'
      using errcode = '42501';
  end if;

  if p_master_id is null
     or nullif(btrim(p_master_id), '') is null
     or p_patch is null
     or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid master profile patch'
      using errcode = '22023';
  end if;

  update public.masters m
     set profile = coalesce(m.profile, '{}'::jsonb) || p_patch
   where m.tenant_id = public.current_tenant_id()
     and m.id = p_master_id
  returning m.profile into v_profile;

  if not found then
    raise exception 'master not found'
      using errcode = 'P0002';
  end if;

  return v_profile;
end;
$function$
;
grant execute on function public.patch_master_profile(p_master_id text, p_patch jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.peek_document_number(p_legal_entity_id uuid, p_doc_type text, p_year integer)
 RETURNS TABLE(seq integer, number text, can_set_start boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  entity public.legal_entities%rowtype;
  last_issued integer;
begin
  if tenant_uuid is null then
    raise exception 'Войдите в приложение'
      using errcode = '42501', hint = 'access:not_member';
  end if;
  if p_doc_type is null or p_doc_type not in ('invoice', 'receipt', 'credit_note') then
    raise exception 'Неизвестный тип документа';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2999 then
    raise exception 'Некорректный год документа';
  end if;
  select * into entity
    from public.legal_entities
   where id = public.resolve_company_id(tenant_uuid, p_legal_entity_id)
     and tenant_id = tenant_uuid;
  if not found then
    return;
  end if;

  select series.last_number into last_issued
    from public.document_sequences series
   where series.tenant_id = tenant_uuid
     and series.legal_entity_id = entity.id
     and series.doc_type = p_doc_type
     and series.year = p_year;

  seq := coalesce(last_issued, 0) + 1;
  number := public.format_document_number(
    public.document_prefix(entity, p_doc_type), p_year, seq, entity.number_padding
  );
  can_set_start := public.current_user_role() = 'owner';
  return next;
end;
$function$
;
grant execute on function public.peek_document_number(p_legal_entity_id uuid, p_doc_type text, p_year integer) to authenticated;

CREATE OR REPLACE FUNCTION public.personal_calendar_name(p_locale text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case lower(coalesce(left(p_locale, 2), ''))
    when 'en' then 'Personal'
    when 'es' then 'Personal'
    when 'de' then 'Persönlich'
    when 'uk' then 'Особистий'
    when 'bg' then 'Личен'
    when 'el' then 'Προσωπικό'
    else 'Личный'
  end
$function$
;
grant execute on function public.personal_calendar_name(p_locale text) to anon;
grant execute on function public.personal_calendar_name(p_locale text) to authenticated;
grant execute on function public.personal_calendar_name(p_locale text) to service_role;

CREATE OR REPLACE FUNCTION public.prevent_settled_invoice_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  -- Let tenant deletion cascade through its children.
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;
  -- Invoice numbers form a legal/audit sequence. Even an unpaid document is
  -- retained and marked void; hard deletion would create an unexplained gap
  -- and make an already shared PDF disappear from the ledger.
  -- Последний инвойс серии без оплат удаляет `delete_invoice` (04.10): номер
  -- возвращается в серию, дыры нет.
  if current_setting('babun.invoice_delete', true) = old.id::text then
    return old;
  end if;
  raise exception 'Инвойс нельзя удалить; аннулируйте документ';
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.prevent_settled_invoice_rewrite()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  income_total numeric := 0;
  direct_refunds numeric := 0;
  linked_refunds numeric := 0;
  net_paid numeric := 0;
  has_ledger boolean := false;
begin
  if auth.role() = 'service_role'
     and not exists (
    select 1 from public.tenants tenant where tenant.id = old.tenant_id
  ) then
    return new;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'void' then
      raise exception 'Аннулированный инвойс нельзя открыть повторно';
    end if;
    if old.status = 'cancelled'
       and current_setting('babun.credit_note_undo', true) is distinct from old.id::text then
      raise exception 'Отменённый инвойс нельзя открыть повторно — по нему выписана кредит-нота';
    end if;
    if old.kind = 'credit_note' then
      raise exception 'Кредит-нота не меняет статус — она сама является сторно';
    end if;

    select
      coalesce(sum(case when type = 'income' then greatest(amount, 0) else 0 end), 0),
      coalesce(sum(case when type = 'refund' then abs(amount) else 0 end), 0),
      count(*) > 0
      into income_total, direct_refunds, has_ledger
      from public.finance_transactions
     where invoice_id = old.id
       and type in ('income', 'refund');
    select coalesce(sum(abs(refund.amount)), 0)
      into linked_refunds
      from public.finance_transactions refund
      join public.finance_transactions original on original.id = refund.refund_of_id
     where original.invoice_id = old.id
       and original.type = 'income'
       and refund.type = 'refund'
       and refund.invoice_id is null;
    has_ledger := has_ledger or linked_refunds > 0;
    net_paid := greatest(0, income_total - direct_refunds - linked_refunds);

    if old.status = 'paid' and not has_ledger then
      raise exception 'Архивный оплаченный инвойс нельзя изменить без журнала платежей';
    elsif new.status = 'paid' and net_paid < new.total - new.credited_amount then
      raise exception 'Статус «Оплачен» требует подтверждённых платежей на всю сумму';
    elsif new.status = 'issued' and net_paid >= new.total - new.credited_amount then
      raise exception 'Полностью оплаченный инвойс нельзя отметить неоплаченным';
    elsif new.status = 'void' and not exists (
      select 1 from public._calendar_delete_context ctx
       where ctx.transaction_id = txid_current()
    ) then
      -- STORY-101: выпущенный документ отменяется только кредит-нотой.
      -- «void» без неё — лишь при стирании календаря (прежнее поведение).
      raise exception 'Инвойс отменяется только кредит-нотой';
    elsif new.status = 'void' and (old.status <> 'issued' or net_paid > 0) then
      raise exception 'Инвойс с полученной оплатой нельзя аннулировать — сначала верните деньги';
    elsif new.status = 'cancelled' and (old.status <> 'issued' or net_paid > 0) then
      raise exception 'Инвойс с полученной оплатой нельзя отменить — сначала верните деньги';
    elsif new.status = 'cancelled' and not exists (
      select 1
        from public.invoices note
       where note.credit_note_of_id = old.id
         and note.tenant_id = old.tenant_id
         and note.kind = 'credit_note'
    ) then
      raise exception 'Инвойс отменяется только вместе с кредит-нотой';
    elsif new.status not in ('issued', 'paid', 'void', 'cancelled') then
      raise exception 'Некорректный статус инвойса';
    end if;
  end if;

  if row(
    new.tenant_id, new.number, new.year, new.seq, new.issued_on, new.due_on,
    new.client_id, new.appointment_id, new.brigade_id,
    new.company_id, new.account_id,
    new.subtotal_net, new.vat_percent, new.vat_amount, new.total, new.currency,
    new.notes, new.created_by, new.vat_mode, new.payment_id, new.kind,
    new.credit_note_of_id
  ) is distinct from row(
    old.tenant_id, old.number, old.year, old.seq, old.issued_on, old.due_on,
    old.client_id, old.appointment_id, old.brigade_id,
    old.company_id, old.account_id,
    old.subtotal_net, old.vat_percent, old.vat_amount, old.total, old.currency,
    old.notes, old.created_by, old.vat_mode, old.payment_id, old.kind,
    old.credit_note_of_id
  ) then
    if old.kind = 'credit_note' then
      raise exception 'Кредит-нота неизменяема — она сама является сторно';
    end if;
    if old.status <> 'issued' or exists (
      select 1 from public.finance_transactions
       where invoice_id = old.id and type in ('income', 'refund')
    ) or exists (
      select 1 from public.finance_transactions refund
        join public.finance_transactions original on original.id = refund.refund_of_id
       where original.invoice_id = old.id and original.type = 'income'
         and refund.type = 'refund'
    ) then
      raise exception 'Инвойс с платежами нельзя редактировать';
    end if;
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.protect_invoice_payment_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  linked_invoice_id uuid;
  target_invoice public.invoices%rowtype;
begin
  -- Let company deletion cascade through all financial history.
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  linked_invoice_id := old.invoice_id;
  if linked_invoice_id is null and old.type = 'refund' and old.refund_of_id is not null then
    select invoice_id into linked_invoice_id
      from public.finance_transactions
     where id = old.refund_of_id;
  end if;
  if linked_invoice_id is not null and exists (
    select 1 from public.invoices where id = linked_invoice_id
  ) then
    raise exception 'Платёж инвойса нельзя изменить или удалить; оформите возврат';
  end if;

  if tg_op = 'UPDATE' and new.invoice_id is not null then
    if old.invoice_id is not null or old.type <> 'income' or new.type <> 'income' then
      raise exception 'Некорректная привязка операции к инвойсу';
    end if;
    if row(
      new.id, new.tenant_id, new.type, new.amount, new.currency,
      new.category_id, new.account_id, new.appointment_id, new.client_id,
      new.team_id, new.master_id, new.payment_method, new.notes,
      new.occurred_on, new.receipt_url, new.transfer_group_id,
      new.refund_of_id, new.source, new.created_at, new.created_by
    ) is distinct from row(
      old.id, old.tenant_id, old.type, old.amount, old.currency,
      old.category_id, old.account_id, old.appointment_id, old.client_id,
      old.team_id, old.master_id, old.payment_method, old.notes,
      old.occurred_on, old.receipt_url, old.transfer_group_id,
      old.refund_of_id, old.source, old.created_at, old.created_by
    ) then
      raise exception 'При привязке к инвойсу нельзя менять операцию';
    end if;

    select * into target_invoice
      from public.invoices
     where id = new.invoice_id
       and tenant_id = old.tenant_id
     for update;
    if not found or target_invoice.status <> 'issued' then
      raise exception 'Инвойс не найден или уже закрыт';
    end if;
    -- РУЧНОЙ ДОХОД ЗАЯВКИ В ИНВОЙС НЕ ПРИВЯЗЫВАЕТСЯ. Привязка — правка
    -- строки: settle (AFTER INSERT) её не видит и в заявку ничего не
    -- зачитывает. Заявка с таким доходом замёрзла бы на сверке («Деньги по
    -- заявке уже учтены»), а заявка только у инвойса приняла бы те же деньги
    -- второй раз плиткой. Деньги заявки попадают в инвойс только оплатой на
    -- его странице. Авто-доход плитки привязывается к инвойсу своей заявки,
    -- как раньше: его держит сверка.
    if old.source = 'manual'
       and (old.appointment_id is not null or target_invoice.appointment_id is not null) then
      raise exception 'Ручной доход не привязывается к инвойсу заявки — оплату заявки примите на странице инвойса';
    end if;
    if round(greatest(old.amount, 0), 2) <> round(target_invoice.total, 2) then
      raise exception 'Сумма дохода не совпадает с итогом инвойса';
    end if;
    if (old.appointment_id is not null
        and old.appointment_id is distinct from target_invoice.appointment_id)
       or (old.client_id is not null
        and old.client_id is distinct from target_invoice.client_id)
       or (old.team_id is not null
        and old.team_id is distinct from target_invoice.brigade_id) then
      raise exception 'Контекст дохода не совпадает с реквизитами инвойса';
    end if;
    if exists (
      select 1 from public.finance_transactions
       where invoice_id = target_invoice.id and id <> old.id
    ) or exists (
      select 1 from public.finance_transactions
       where refund_of_id = old.id and type = 'refund'
    ) then
      raise exception 'Операцию с платежами или возвратами нельзя привязать';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.protect_last_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  remaining int;
begin
  -- Skip protection when the parent tenant is gone (cascade case).
  if TG_OP = 'DELETE'
     and not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;

  if (TG_OP = 'DELETE' and old.role = 'owner')
     or (TG_OP = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    select count(*)
      into remaining
      from public.tenant_members
     where tenant_id = old.tenant_id
       and role      = 'owner'
       and user_id   <> old.user_id;
    if remaining = 0 then
      raise exception 'cannot remove or demote the last owner of tenant %', old.tenant_id
        using errcode = '23514',
              hint    = 'invite or promote another owner first';
    end if;
  end if;
  return case when TG_OP = 'DELETE' then old else new end;
end;
$function$
;
grant execute on function public.protect_last_owner() to anon;
grant execute on function public.protect_last_owner() to authenticated;
grant execute on function public.protect_last_owner() to service_role;

CREATE OR REPLACE FUNCTION public.protect_paid_appointment_finance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  has_any_auto_income boolean := false;
  has_linked_finance boolean := false;
  has_settlement boolean := false;
  undo_context boolean := false;
  prepayment_context boolean := false;
  payment_reset_context boolean := false;
  invoice_payment_context boolean := false;
  payment_cancel_context boolean := false;
  is_refund_transition boolean;
  is_cancel_transition boolean;
  financial_fields_changed boolean;
  received_amount numeric;
  old_settlement_target numeric := 0;
  new_settlement_target numeric := 0;
  settlement_growth boolean := false;
  -- Полученное по НОВОЙ строке, без оглядки на статус.
  received_now numeric := 0;
  -- Статус сам сходил за изменившимся итогом — эта смена разрешена.
  status_follows_total boolean := false;
  -- Работы и цену править можно: деньги получены, леджер не тронут, итог их
  -- покрывает.
  bill_edit_allowed boolean := false;
  -- Номер инвойса, деньги которого ещё лежат на заявке.
  invoice_money_number text;
begin
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return new;
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'Компания заявки неизменяема';
  end if;
  select exists (
    select 1 from public.finance_transactions
     where appointment_id = old.id and source = 'auto' and type = 'income'
  ) into has_any_auto_income;
  select exists (
    select 1 from public.finance_transactions where appointment_id = old.id
  ) into has_linked_finance;
  -- Доплата, возвращённая целиком («деньги не поступили»), доплатой больше не
  -- считается.
  select exists (
    select 1 from public.finance_transactions income
     where income.appointment_id = old.id
       and income.source = 'auto'
       and income.type = 'income'
       and coalesce(income.appointment_payment_kind, 'settlement') = 'settlement'
       and income.amount > coalesce((
         select sum(abs(refund.amount))
           from public.finance_transactions refund
          where refund.refund_of_id = income.id
            and refund.type = 'refund'
       ), 0)
  ) into has_settlement;
  -- КЛИЕНТ, КОМАНДА И ИСПОЛНИТЕЛЬ — ПОКА НА ЗАЯВКЕ ЖИВЫЕ ДЕНЬГИ (03.10).
  -- Раньше держала ЛЮБАЯ строка финансов, и снятая оплата («деньги не
  -- поступили» — доход и равный ему возврат) запирала клиента навсегда, хотя
  -- ответ обещает обратное: «Сначала верните оплату». Теперь держат доход,
  -- возвращённый не целиком, любая иная строка финансов заявки и инвойс.
  -- Сторно остаётся в истории со своим клиентом.
  if (
    exists (
      select 1 from public.finance_transactions income
       where income.appointment_id = old.id
         and income.type = 'income'
         and income.amount > coalesce((
           select sum(abs(refund.amount))
             from public.finance_transactions refund
            where refund.refund_of_id = income.id
              and refund.type = 'refund'
         ), 0)
    )
    or exists (
      select 1 from public.finance_transactions other
       where other.appointment_id = old.id
         and other.type not in ('income', 'refund')
    )
    or exists (select 1 from public.invoices where appointment_id = old.id)
  ) and (
    new.client_id is distinct from old.client_id
    or new.team_id is distinct from old.team_id
    or new.master_id is distinct from old.master_id
  ) then
    raise exception 'Сначала верните оплату; клиента, команду и исполнителя менять нельзя';
  end if;
  -- ОТМЕНА С ДЕНЬГАМИ ИНВОЙСА. Платёж инвойса — ручная строка: сверка его не
  -- вернёт, и заявка стала бы «возвращённой» с деньгами на счёте.
  if (old.status is distinct from 'cancelled' and new.status = 'cancelled')
     or (old.payment_status is distinct from 'refunded' and new.payment_status = 'refunded') then
    select i.number into invoice_money_number
      from public.invoices i
     where i.appointment_id = old.id
       and i.tenant_id = old.tenant_id
       and i.kind = 'invoice'
       and coalesce((
         select sum(tx.amount)
           from public.finance_transactions tx
           left join public.finance_transactions original
             on original.id = tx.refund_of_id
          where tx.tenant_id = old.tenant_id
            and tx.source = 'manual'
            and tx.type in ('income', 'refund')
            and coalesce(tx.invoice_id, original.invoice_id) = i.id
       ), 0) > 0
     order by i.issued_on, i.number
     limit 1;
    if invoice_money_number is not null then
      raise exception 'Сначала верните оплату инвойса %', invoice_money_number;
    end if;
  end if;
  select exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'appointment_undo'
       and entity_id = old.id
       and tenant_id = old.tenant_id
  ) into undo_context;
  select exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'appointment_prepayment'
       and entity_id = old.id
       and tenant_id = old.tenant_id
  ) into prepayment_context;
  select exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'appointment_payment_reset'
       and entity_id = old.id
       and tenant_id = old.tenant_id
  ) into payment_reset_context;
  -- Деньги уже проведены платежом (или возвратом) по инвойсу.
  select exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'invoice_payment'
       and entity_id = old.id
       and tenant_id = old.tenant_id
  ) into invoice_payment_context;
  -- Платёж снят RPC `cancel_appointment_payment`: сторно уже написано.
  select exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'appointment_payment_cancel'
       and entity_id = old.id
       and tenant_id = old.tenant_id
  ) into payment_cancel_context;
  if undo_context or payment_reset_context or invoice_payment_context
     or payment_cancel_context then
    return new;
  end if;
  if not has_settlement
     and new.status <> 'cancelled'
     and new.payment_status <> 'refunded'
     and new.prepaid_amount > 0
     and new.paid_amount = 0
     and new.total_amount is distinct from old.total_amount then
    new.payment_status := case
      when new.total_amount > 0 and new.prepaid_amount >= new.total_amount
        then 'paid'
      else 'unpaid'
    end;
  end if;
  -- СТАТУС ИДЁТ ЗА ИТОГОМ. Итог вырос выше полученного — заявка частично
  -- оплачена; опустился до полученного — оплачена. Деньги не трогаются: цель
  -- проводки у `partial` равна уже полученному.
  --
  -- Только когда деньги ДЕЙСТВИТЕЛЬНО получены: у заявки, помеченной
  -- оплаченной без единого платежа, полученное равно нулю, и падение в
  -- `unpaid` подсказало бы сверке вернуть несуществующий доход.
  received_now := coalesce(new.prepaid_amount, 0) + coalesce(new.paid_amount, 0);
  if new.status <> 'cancelled'
     and new.payment_status <> 'refunded'
     and old.payment_status in ('paid', 'partial')
     and new.payment_status is not distinct from old.payment_status
     and new.total_amount is distinct from old.total_amount
     and new.paid_amount is not distinct from old.paid_amount
     and new.prepaid_amount is not distinct from old.prepaid_amount
     and coalesce(new.paid_amount, 0) > 0
     and received_now > 0 then
    new.payment_status := case
      when new.total_amount > 0 and received_now >= new.total_amount then 'paid'
      else 'partial'
    end;
    status_follows_total := new.payment_status is distinct from old.payment_status;
  end if;
  bill_edit_allowed :=
    new.status <> 'cancelled'
    and new.payment_status <> 'refunded'
    and coalesce(new.paid_amount, 0) > 0
    and new.payment_status in ('paid', 'partial')
    and new.paid_amount is not distinct from old.paid_amount
    and new.prepaid_amount is not distinct from old.prepaid_amount
    and new.payment is not distinct from old.payment
    and new.payments is not distinct from old.payments
    and new.total_amount >= received_now;
  financial_fields_changed :=
    new.total_amount is distinct from old.total_amount
    or new.prepaid_amount is distinct from old.prepaid_amount
    or new.paid_amount is distinct from old.paid_amount
    or new.payment_status is distinct from old.payment_status
    or new.payment_method is distinct from old.payment_method
    or new.status is distinct from old.status
    or new.payment is distinct from old.payment
    or new.payments is distinct from old.payments;
  if financial_fields_changed then
    if new.total_amount = 'NaN'::numeric
       or new.prepaid_amount = 'NaN'::numeric
       or new.paid_amount = 'NaN'::numeric
       or new.total_amount < 0
       or new.prepaid_amount < 0
       or new.paid_amount < 0 then
      raise exception 'Суммы оплаты заявки некорректны';
    end if;
    if new.prepaid_amount > new.total_amount then
      raise exception 'Предоплата не может быть больше итоговой суммы';
    end if;
    if (
      new.prepaid_amount > 0
      or new.paid_amount > 0
      or (new.payment_status = 'paid' and new.total_amount > 0)
    ) and (
      new.payment_method is null
      or new.payment_method not in ('cash', 'card', 'transfer', 'other')
    ) then
      raise exception 'Выберите способ оплаты заявки';
    end if;
    received_amount := new.prepaid_amount + case
      when new.payment_status in ('partial', 'paid') then new.paid_amount
      else 0
    end;
    if new.status <> 'cancelled' and new.payment_status <> 'refunded' then
      if received_amount > new.total_amount then
        raise exception 'Полученная сумма больше итога заявки';
      end if;
      if new.payment_status = 'paid'
         and new.total_amount > 0
         and received_amount < new.total_amount then
        raise exception 'Для статуса «Оплачено» не хватает полученной суммы';
      end if;
      if new.payment_status = 'partial'
         and (received_amount <= 0 or received_amount >= new.total_amount) then
        raise exception 'Частичная оплата должна быть меньше итога заявки';
      end if;
      if new.payment_status = 'unpaid' and new.paid_amount > 0 then
        raise exception 'Сумма доплаты указана для неоплаченной заявки';
      end if;
    end if;
  end if;
  if old.status <> 'cancelled' and old.payment_status <> 'refunded' then
    old_settlement_target := case old.payment_status
      when 'paid' then greatest(old.total_amount - old.prepaid_amount, 0)
      when 'partial' then greatest(old.paid_amount, 0)
      else 0
    end;
  end if;
  if new.status <> 'cancelled' and new.payment_status <> 'refunded' then
    new_settlement_target := case new.payment_status
      when 'paid' then greatest(new.total_amount - new.prepaid_amount, 0)
      when 'partial' then greatest(new.paid_amount, 0)
      else 0
    end;
  end if;
  settlement_growth := old.status <> 'cancelled'
    and old.payment_status <> 'refunded'
    and new_settlement_target > old_settlement_target;
  if has_any_auto_income and not prepayment_context
     and new.prepaid_amount is distinct from old.prepaid_amount then
    raise exception 'Предоплату и её способ меняйте через действие «Изменить предоплату»';
  end if;
  if has_any_auto_income and not prepayment_context
     and new.payment_method is distinct from old.payment_method
     and not settlement_growth then
    raise exception 'Способ предоплаты меняйте через действие «Изменить предоплату»';
  end if;
  is_cancel_transition := old.status is distinct from 'cancelled'
    and new.status = 'cancelled'
    and (
      has_any_auto_income
      or old.prepaid_amount > 0
      or old.paid_amount > 0
      or old.payment_status in ('partial', 'paid')
    );
  if is_cancel_transition then
    new.payment_status := 'refunded';
    new.paid_amount := 0;
  end if;
  is_refund_transition := old.payment_status is distinct from 'refunded'
    and new.payment_status = 'refunded';
  if is_refund_transition then
    new.paid_amount := 0;
  end if;
  if prepayment_context and not has_settlement then
    return new;
  end if;
  if settlement_growth then
    if new.tenant_id is distinct from old.tenant_id
       or new.client_id is distinct from old.client_id
       or new.team_id is distinct from old.team_id
       or new.master_id is distinct from old.master_id
       or new.kind is distinct from old.kind
       or new.date is distinct from old.date
       or new.total_amount is distinct from old.total_amount
       or new.custom_total is distinct from old.custom_total
       or new.discount_amount is distinct from old.discount_amount
       or new.services is distinct from old.services
       or new.service_ids is distinct from old.service_ids
       or new.service_price_overrides is distinct from old.service_price_overrides
       or new.global_discount is distinct from old.global_discount
       or new.prepaid_amount is distinct from old.prepaid_amount
       or (
         new.status is distinct from old.status
         and new.status is distinct from 'completed'
       ) then
      raise exception 'При доплате можно изменить только оплату и завершить заявку';
    end if;
    return new;
  end if;
  if not has_settlement and not (
    old.status = 'completed' and old.payment_status = 'paid'
  ) then
    -- Заморожены только ДЕНЬГИ: возвращённая оплата и отменённая заявка, у
    -- которой были предоплата, доплата или проводки.
    if old.payment_status = 'refunded'
       or (old.status = 'cancelled' and (
         has_linked_finance
         or old.prepaid_amount > 0
         or old.paid_amount > 0
         or old.payment_status in ('partial', 'paid')
       )) then
      if financial_fields_changed and not is_cancel_transition then
        raise exception 'Возвращённую оплату нельзя изменить; создайте новую заявку';
      end if;
    end if;
    return new;
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.client_id is distinct from old.client_id
     or new.team_id is distinct from old.team_id
     or new.master_id is distinct from old.master_id
     or new.date is distinct from old.date
     or new.payment_method is distinct from old.payment_method
     or new.prepaid_amount is distinct from old.prepaid_amount
     or new.payment is distinct from old.payment
     or new.payments is distinct from old.payments
     or (new.status is distinct from old.status and not is_cancel_transition)
     or (new.paid_amount is distinct from old.paid_amount and not is_refund_transition)
     or (
       new.payment_status is distinct from old.payment_status
       and not is_refund_transition
       and not status_follows_total
     )
     or ((old.status = 'cancelled' or old.payment_status = 'refunded') and
       (new.status is distinct from old.status or new.payment_status is distinct from old.payment_status))
     -- РАБОТЫ И ЦЕНА: замораживаются только когда правка не разрешена.
     or (not bill_edit_allowed and (
       new.total_amount is distinct from old.total_amount
       or new.custom_total is distinct from old.custom_total
       or new.discount_amount is distinct from old.discount_amount
       or new.services is distinct from old.services
       or new.service_ids is distinct from old.service_ids
       or new.service_price_overrides is distinct from old.service_price_overrides
       or new.global_discount is distinct from old.global_discount
     )) then
    raise exception 'Сначала отмените оплату или оформите возврат по заявке';
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.purge_deleted_operations()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  removed integer;
begin
  delete from public.deleted_operations where purge_at <= now();
  get diagnostics removed = row_count;
  return removed;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.purge_expired_accounts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  removed integer;
begin
  delete from public.accounts a
   where a.deleted_at is not null
     and a.purge_at is not null
     and a.purge_at <= now()
     and not public.account_has_history(a.id);
  get diagnostics removed = row_count;
  return removed;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.purge_expired_clients()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  removed integer;
begin
  delete from public.clients c
   where c.purge_at is not null
     and c.purge_at <= now()
     and not exists (select 1 from public.appointments a where a.client_id = c.id)
     and not exists (select 1 from public.invoices i where i.client_id = c.id)
     and not exists (select 1 from public.finance_transactions f where f.client_id = c.id);
  get diagnostics removed = row_count;
  return removed;
end;
$function$
;
grant execute on function public.purge_expired_clients() to anon;
grant execute on function public.purge_expired_clients() to authenticated;
grant execute on function public.purge_expired_clients() to service_role;

CREATE OR REPLACE FUNCTION public.purge_unconfirmed_signups()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user record;
  v_count integer := 0;
begin
  for v_user in
    select u.id
      from auth.users u
     where u.email_confirmed_at is null
       and u.last_sign_in_at is null
       and u.created_at < now() - interval '7 days'
     order by u.created_at
     limit 500
  loop
    begin
      delete from public.tenants t
       where exists (
               select 1 from public.tenant_members m
                where m.tenant_id = t.id
                  and m.user_id = v_user.id
                  and m.role = 'owner'
             )
         and not exists (
               select 1 from public.tenant_members o
                where o.tenant_id = t.id
                  and o.user_id <> v_user.id
             );
      delete from auth.users where id = v_user.id;
      v_count := v_count + 1;
    exception when others then
      raise warning 'purge_unconfirmed_signups: % пропущен (%)', v_user.id, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.read_operational_calendar_settings_safe()
 RETURNS TABLE(start_hour integer, end_hour integer, grid_step integer, week_start text, timezone text, buffer_minutes integer, hide_cancelled boolean, allow_overtime boolean, work_start_hour integer, work_end_hour integer, scroll_open_hour integer, start_minute integer, end_minute integer, show_day_finance boolean, record_color_rule text, record_color_palette jsonb, record_color_fallback text, disabled_features text[], booking_block_order text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_role text := public.current_user_role();
begin
  if auth.uid() is null
     or v_tenant_id is null
     or v_role is null
     or v_role not in ('owner', 'master') then
    raise exception 'calendar settings are unavailable for this membership'
      using errcode = '42501';
  end if;

  return query
  select cs.start_hour, cs.end_hour, cs.grid_step, cs.week_start, cs.timezone,
         cs.buffer_minutes, cs.hide_cancelled, cs.allow_overtime,
         cs.work_start_hour, cs.work_end_hour, cs.scroll_open_hour,
         cs.start_minute, cs.end_minute, cs.show_day_finance,
         cs.record_color_rule, cs.record_color_palette, cs.record_color_fallback,
         cs.disabled_features, cs.booking_block_order
    from public.calendar_settings cs
   where cs.tenant_id = v_tenant_id
   limit 1;
end;
$function$
;
grant execute on function public.read_operational_calendar_settings_safe() to authenticated;

CREATE OR REPLACE FUNCTION public.read_tenant_sms_config_safe()
 RETURNS TABLE(tenant_id uuid, mode text, enabled boolean, remind_24h_before boolean, remind_2h_before boolean, template_24h text, template_2h text, twilio_account_sid text, twilio_phone_number text, twilio_auth_token_configured boolean, sent_this_month integer, free_quota_per_month integer, quota_period_start timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                                                                                                                                                                                                                                                                                                                                                                                            begin
                                                                                                                                                                                                                                                                                                                                                                                              if public.current_user_role() is distinct from 'owner' then
                                                                                                                                                                                                                                                                                                                                                                                                  raise exception 'unauthorized: owner role required for SMS config'
                                                                                                                                                                                                                                                                                                                                                                                                        using errcode = '42501';
                                                                                                                                                                                                                                                                                                                                                                                                          end if;

                                                                                                                                                                                                                                                                                                                                                                                                            return query
                                                                                                                                                                                                                                                                                                                                                                                                                select
                                                                                                                                                                                                                                                                                                                                                                                                                      t.tenant_id,
                                                                                                                                                                                                                                                                                                                                                                                                                            t.mode,
                                                                                                                                                                                                                                                                                                                                                                                                                                  t.enabled,
                                                                                                                                                                                                                                                                                                                                                                                                                                        t.remind_24h_before,
                                                                                                                                                                                                                                                                                                                                                                                                                                              t.remind_2h_before,
                                                                                                                                                                                                                                                                                                                                                                                                                                                    t.template_24h,
                                                                                                                                                                                                                                                                                                                                                                                                                                                          t.template_2h,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                t.twilio_account_sid,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                      t.twilio_phone_number,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                            (t.twilio_auth_token is not null and length(t.twilio_auth_token) > 0)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    as twilio_auth_token_configured,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          t.sent_this_month,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                t.free_quota_per_month,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      t.quota_period_start,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            t.created_at,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  t.updated_at
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      from public.tenant_sms_config t
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         where t.tenant_id = public.current_tenant_id();
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         end;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         $function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.receipts_client_snapshot_no_phone()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.client_snapshot is not null and jsonb_typeof(new.client_snapshot) = 'object' then
    new.client_snapshot := new.client_snapshot - 'phone';
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.reconcile_appointment_finance(p_appointment_id uuid, p_old_total numeric, p_old_prepaid numeric, p_old_paid numeric, p_old_payment_status text, p_old_status text, p_is_insert boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  appointment_row public.appointments%rowtype;
  services_category_id uuid;
  refund_category_id uuid;
  resolved_account_id uuid;
  new_prepayment_target numeric := 0;
  new_settlement_target numeric := 0;
  prepayment_delta numeric := 0;
  settlement_delta numeric := 0;
  total_delta numeric := 0;
  legacy_income_count integer := 0;
  received_amount numeric := 0;
  adjustment record;
  income_candidate record;
  remaining_refund numeric := 0;
  refund_piece numeric := 0;
  business_today date;
  meta_occurred_on date;
  meta_payment_id text;
  -- Деньги заявки, пришедшие НЕ через сверку: зачёт платежей инвойса и
  -- ручные доходы с этой заявкой без инвойса.
  held_invoice numeric := 0;
  held_manual numeric := 0;
  -- Чистые суммы авто-доходов (доход минус его возвраты).
  auto_prepayment_held numeric := 0;
  auto_settlement_held numeric := 0;
  auto_all_held numeric := 0;
  auto_settlement_target numeric := 0;
  meta_entry_amount numeric;
  meta_entry_kind text;
  meta_delta numeric;
  -- Открытый инвойс заявки, в котором уже лежат деньги.
  open_invoice_number text;
begin
  if exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'invoice_payment'
       and entity_id = p_appointment_id
  ) then
    return;
  end if;
  if exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'appointment_payment_cancel'
       and entity_id = p_appointment_id
  ) then
    return;
  end if;

  select * into appointment_row
    from public.appointments
   where id = p_appointment_id
   for share;
  if not found then
    raise exception 'Заявка для синхронизации оплаты не найдена';
  end if;
  business_today := public.tenant_business_date(appointment_row.tenant_id);
  select c.occurred_on, c.payment_id
    into meta_occurred_on, meta_payment_id
    from public._finance_write_context c
   where c.transaction_id = txid_current()
     and c.kind = 'appointment_payment_meta'
     and c.entity_id = p_appointment_id
   limit 1;

  -- ПЛИТКА ПРИ ОТКРЫТОМ ИНВОЙСЕ С ДЕНЬГАМИ. Платёж плитки (контекст
  -- `appointment_payment_meta` кладёт `record_appointment_payment`) занял бы
  -- остаток, который принадлежит инвойсу: сам инвойс после этого не принял
  -- бы ни цента, а аннулировать инвойс с деньгами нельзя. До шага 5, где
  -- плитка платит сам инвойс, — отказ. Снять платёж плитки можно всегда: в
  -- контексте `cancel_appointment_payment` сверка не работает.
  if meta_payment_id is not null then
    select i.number into open_invoice_number
      from public.invoices i
     where i.appointment_id = appointment_row.id
       and i.tenant_id = appointment_row.tenant_id
       and i.kind = 'invoice'
       and i.status = 'issued'
       and coalesce((
         select sum(tx.amount)
           from public.finance_transactions tx
           left join public.finance_transactions original
             on original.id = tx.refund_of_id
          where tx.tenant_id = appointment_row.tenant_id
            and tx.source = 'manual'
            and tx.type in ('income', 'refund')
            and coalesce(tx.invoice_id, original.invoice_id) = i.id
       ), 0) > 0
     order by i.issued_on, i.number
     limit 1;
    if open_invoice_number is not null then
      raise exception 'По заявке открыт инвойс % — оплату примите в нём', open_invoice_number;
    end if;
  end if;

  if appointment_row.total_amount = 'NaN'::numeric
     or appointment_row.prepaid_amount = 'NaN'::numeric
     or appointment_row.paid_amount = 'NaN'::numeric
     or appointment_row.total_amount < 0
     or appointment_row.prepaid_amount < 0
     or appointment_row.paid_amount < 0 then
    raise exception 'Суммы оплаты заявки некорректны';
  end if;
  if appointment_row.prepaid_amount > appointment_row.total_amount then
    raise exception 'Предоплата не может быть больше итоговой суммы';
  end if;
  if round(appointment_row.total_amount, 2) is distinct from appointment_row.total_amount
     or round(appointment_row.prepaid_amount, 2) is distinct from appointment_row.prepaid_amount
     or round(appointment_row.paid_amount, 2) is distinct from appointment_row.paid_amount then
    raise exception 'Укажите не больше двух знаков после запятой';
  end if;
  received_amount := appointment_row.prepaid_amount + case
    when appointment_row.payment_status in ('partial', 'paid')
      then appointment_row.paid_amount
    else 0
  end;
  if appointment_row.status <> 'cancelled'
     and appointment_row.payment_status <> 'refunded' then
    if received_amount > appointment_row.total_amount then
      raise exception 'Полученная сумма больше итога заявки';
    end if;
    if appointment_row.payment_status = 'paid'
       and appointment_row.total_amount > 0
       and received_amount < appointment_row.total_amount then
      raise exception 'Для статуса «Оплачено» не хватает полученной суммы';
    end if;
    if appointment_row.payment_status = 'partial'
       and (received_amount <= 0 or received_amount >= appointment_row.total_amount) then
      raise exception 'Частичная оплата должна быть меньше итога заявки';
    end if;
    if appointment_row.payment_status = 'unpaid'
       and appointment_row.paid_amount > 0 then
      raise exception 'Сумма доплаты указана для неоплаченной заявки';
    end if;
  end if;
  if received_amount > 0 and (
    appointment_row.payment_method is null
    or appointment_row.payment_method not in ('cash', 'card', 'transfer', 'other')
  ) then
    raise exception 'Выберите способ оплаты заявки';
  end if;

  if appointment_row.status <> 'cancelled'
     and appointment_row.payment_status <> 'refunded' then
    new_prepayment_target := greatest(appointment_row.prepaid_amount, 0);
    new_settlement_target := case appointment_row.payment_status
      when 'paid' then greatest(
        appointment_row.total_amount - appointment_row.prepaid_amount,
        0
      )
      when 'partial' then greatest(appointment_row.paid_amount, 0)
      else 0
    end;
  end if;

  -- ЗАЧЁТ ПЛАТЕЖЕЙ ИНВОЙСА. settle кладёт в `payments[]` элемент
  -- `pay-inv-<id дохода>` с суммой, которую он зачёл в заявку (не больше её
  -- остатка — «сверху» доход инвойса больше зачёта). Зачёт дохода — сумма
  -- его элементов, но не больше чистой суммы самого дохода: возвращённое в
  -- заявке не лежит. Элемент без своего ручного дохода не значит ничего.
  select coalesce(sum(least(credit.entry_sum, greatest(credit.net, 0))), 0)
    into held_invoice
    from (
      select income.amount - coalesce((
               select sum(abs(refund.amount))
                 from public.finance_transactions refund
                where refund.refund_of_id = income.id
                  and refund.type = 'refund'
             ), 0) as net,
             (
               select sum(round((e.elem ->> 'amount')::numeric, 2))
                 from jsonb_array_elements(coalesce(appointment_row.payments, '[]'::jsonb)) as e(elem)
                where e.elem ->> 'id' = 'pay-inv-' || income.id::text
             ) as entry_sum
        from public.finance_transactions income
       where income.appointment_id = appointment_row.id
         and income.type = 'income'
         and income.source = 'manual'
         and income.invoice_id is not null
    ) credit
   where credit.entry_sum > 0;

  -- РУЧНЫЕ ДОХОДЫ С ЗАЯВКОЙ БЕЗ ИНВОЙСА — тоже деньги этой работы.
  select coalesce(sum(greatest(income.amount - coalesce((
           select sum(abs(refund.amount))
             from public.finance_transactions refund
            where refund.refund_of_id = income.id
              and refund.type = 'refund'
         ), 0), 0)), 0)
    into held_manual
    from public.finance_transactions income
   where income.appointment_id = appointment_row.id
     and income.source = 'manual'
     and income.type = 'income'
     and income.invoice_id is null;

  -- ЧТО УЖЕ ПРОВЕЛА САМА СВЕРКА: чистые авто-доходы по видам.
  select
    count(*) filter (where held.payment_kind is null),
    coalesce(sum(held.net) filter (where held.payment_kind = 'prepayment'), 0),
    coalesce(sum(held.net) filter (where held.payment_kind = 'settlement'), 0),
    coalesce(sum(held.net), 0)
    into legacy_income_count, auto_prepayment_held, auto_settlement_held, auto_all_held
    from (
      select income.appointment_payment_kind as payment_kind,
             income.amount - coalesce((
               select sum(abs(refund.amount))
                 from public.finance_transactions refund
                where refund.refund_of_id = income.id
                  and refund.type = 'refund'
             ), 0) as net
        from public.finance_transactions income
       where income.appointment_id = appointment_row.id
         and income.source = 'auto'
         and income.type = 'income'
    ) held;

  -- ДЕЛЬТА = ЦЕЛЬ АВТО МИНУС УЖЕ ПРОВЕДЁННОЕ. Деньги инвойса и ручные доходы
  -- гасят только доплату: предоплата бывает лишь с плитки.
  auto_settlement_target := greatest(
    new_settlement_target - held_invoice - held_manual,
    0
  );
  if legacy_income_count > 0 then
    total_delta :=
      (new_prepayment_target + auto_settlement_target) - auto_all_held;
  else
    prepayment_delta := new_prepayment_target - auto_prepayment_held;
    settlement_delta := auto_settlement_target - auto_settlement_held;
  end if;

  -- ПЛАТЁЖ ПЛИТКИ ПРОВОДИТСЯ ЦЕЛИКОМ. `record_appointment_payment` уже положил
  -- элемент в заявку; если сверка может провести меньше его суммы, часть этих
  -- денег уже лежит в журнале — не пишем и не теряем молча.
  if meta_payment_id is not null then
    select round((e.elem ->> 'amount')::numeric, 2), 'settlement'
      into meta_entry_amount, meta_entry_kind
      from jsonb_array_elements(coalesce(appointment_row.payments, '[]'::jsonb)) as e(elem)
     where e.elem ->> 'id' = meta_payment_id
     limit 1;
    if meta_entry_amount is null then
      select round((e.elem ->> 'amount')::numeric, 2), 'prepayment'
        into meta_entry_amount, meta_entry_kind
        from jsonb_array_elements(coalesce(appointment_row.prepayments, '[]'::jsonb)) as e(elem)
       where e.elem ->> 'id' = meta_payment_id
       limit 1;
    end if;
    if meta_entry_amount is not null then
      meta_delta := case
        when legacy_income_count > 0 then total_delta
        when meta_entry_kind = 'prepayment' then prepayment_delta
        else settlement_delta
      end;
      if meta_delta < meta_entry_amount then
        raise exception 'Деньги по заявке уже учтены — сверка их не задвоит';
      end if;
    end if;
  end if;

  if prepayment_delta = 0 and settlement_delta = 0 and total_delta = 0 then
    return;
  end if;

  -- ДОПЛАТА ПРИ ПОТЕРЯННОМ ЗАЧЁТЕ ИНВОЙСА. Деньги инвойса дают заявке зачёт до
  -- меньшего из двух: их чистой суммы и суммы строк инвойса (работа; налог
  -- «сверху» — не работа). Зачёт меньше — значит, элементы `pay-inv-…` стёрла
  -- посторонняя правка `payments` (устаревший реплей старой сборки), и сколько
  -- денег инвойса уже в заявке, не знает никто. Доплатить поверх значило бы
  -- задвоить.
  if (settlement_delta > 0 or total_delta > 0) and exists (
    select 1
      from (
        select income.invoice_id,
               sum(greatest(credit.net, 0)) as net_money,
               sum(case
                 when credit.entry_sum > 0
                   then least(credit.entry_sum, greatest(credit.net, 0))
                 else 0
               end) as credited
          from public.finance_transactions income
          cross join lateral (
            select income.amount - coalesce((
                     select sum(abs(refund.amount))
                       from public.finance_transactions refund
                      where refund.refund_of_id = income.id
                        and refund.type = 'refund'
                   ), 0) as net,
                   (
                     select sum(round((e.elem ->> 'amount')::numeric, 2))
                       from jsonb_array_elements(coalesce(appointment_row.payments, '[]'::jsonb)) as e(elem)
                      where e.elem ->> 'id' = 'pay-inv-' || income.id::text
                   ) as entry_sum
          ) credit
         where income.appointment_id = appointment_row.id
           and income.type = 'income'
           and income.source = 'manual'
           and income.invoice_id is not null
         group by income.invoice_id
      ) per_invoice
     where per_invoice.credited < least(
             per_invoice.net_money,
             coalesce((
               select sum(line.total)
                 from public.invoice_lines line
                where line.invoice_id = per_invoice.invoice_id
             ), 0)
           )
  ) then
    raise exception 'Деньги по заявке уже учтены — сверка их не задвоит';
  end if;

  select id into services_category_id
    from public.finance_categories
   where slug = 'services'
     and (tenant_id is null or tenant_id = appointment_row.tenant_id)
   order by tenant_id nulls last
   limit 1;
  select id into refund_category_id
    from public.finance_categories
   where slug = 'refund'
     and type = 'income'
     and (tenant_id is null or tenant_id = appointment_row.tenant_id)
   order by tenant_id nulls last
   limit 1;

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (
    txid_current(), 'appointment_auto', appointment_row.id, appointment_row.tenant_id
  )
  on conflict do nothing;

  for adjustment in
    select * from (values
      ('prepayment'::text, prepayment_delta),
      ('settlement'::text, settlement_delta),
      ('all'::text, total_delta)
    ) changes(payment_kind, amount)
    where amount <> 0
  loop
    if adjustment.amount > 0 then
      resolved_account_id := public.resolve_appointment_payment_account(
        appointment_row.tenant_id,
        appointment_row.team_id,
        appointment_row.payment_method,
        appointment_row.payment_account_id
      );
      insert into public.finance_transactions (
        tenant_id, type, amount, category_id, account_id, appointment_id,
        client_id, team_id, master_id, payment_method, occurred_on, source,
        appointment_payment_kind, notes, appointment_payment_id,
        vat_mode, vat_rate, vat_amount
      ) values (
        appointment_row.tenant_id,
        'income',
        round(adjustment.amount, 2),
        services_category_id,
        resolved_account_id,
        appointment_row.id,
        appointment_row.client_id,
        appointment_row.team_id,
        appointment_row.master_id,
        appointment_row.payment_method,
        coalesce(meta_occurred_on, business_today),
        'auto',
        case
          when adjustment.payment_kind = 'prepayment' then 'prepayment'
          else 'settlement'
        end,
        case
          when adjustment.payment_kind = 'prepayment' then 'Предоплата по заявке'
          else 'Оплата по заявке'
        end,
        meta_payment_id,
        -- Налог записи — снимком на проводке (миграция 20260922040000).
        case
          when appointment_row.vat_mode in ('inclusive', 'exclusive')
           and appointment_row.vat_rate > 0 then appointment_row.vat_mode
          when appointment_row.vat_mode = 'none' then 'none'
        end,
        case
          when appointment_row.vat_mode in ('inclusive', 'exclusive')
           and appointment_row.vat_rate > 0 then appointment_row.vat_rate
        end,
        case
          when appointment_row.vat_mode in ('inclusive', 'exclusive')
           and appointment_row.vat_rate > 0 then
            round(round(adjustment.amount, 2) * appointment_row.vat_rate
                  / (100 + appointment_row.vat_rate), 2)
        end
      );
    else
      remaining_refund := abs(round(adjustment.amount, 2));
      for income_candidate in
        select
          income.id,
          income.account_id,
          income.client_id,
          income.team_id,
          income.master_id,
          income.payment_method,
          income.invoice_id,
          coalesce(income.appointment_payment_kind, 'settlement') as payment_kind,
          greatest(
            income.amount - coalesce((
              select sum(abs(refund.amount))
                from public.finance_transactions refund
               where refund.refund_of_id = income.id
                 and refund.type = 'refund'
            ), 0),
            0
          ) as refundable
        from public.finance_transactions income
        where income.appointment_id = appointment_row.id
          and income.source = 'auto'
          and income.type = 'income'
          and (
            adjustment.payment_kind = 'all'
            or coalesce(income.appointment_payment_kind, 'settlement') =
               adjustment.payment_kind
          )
        order by income.created_at desc, income.id desc
        for update of income
      loop
        exit when remaining_refund <= 0;
        if income_candidate.refundable <= 0 then continue; end if;
        refund_piece := least(remaining_refund, income_candidate.refundable);
        insert into public.finance_transactions (
          tenant_id, type, amount, category_id, account_id, appointment_id,
          client_id, team_id, master_id, payment_method, occurred_on, source,
          refund_of_id, invoice_id, appointment_payment_kind, notes
        ) values (
          appointment_row.tenant_id,
          'refund',
          -refund_piece,
          refund_category_id,
          income_candidate.account_id,
          appointment_row.id,
          income_candidate.client_id,
          income_candidate.team_id,
          income_candidate.master_id,
          income_candidate.payment_method,
          business_today,
          'auto',
          income_candidate.id,
          income_candidate.invoice_id,
          income_candidate.payment_kind,
          case
            when appointment_row.status = 'cancelled'
              then 'Возврат при отмене заявки'
            when appointment_row.payment_status = 'refunded'
              then 'Возврат оплаты заявки'
            else 'Изменение предоплаты по заявке'
          end
        );
        remaining_refund := remaining_refund - refund_piece;
      end loop;
      if remaining_refund > 0 then
        raise exception 'Не удалось вернуть всю сумму; финансовая история не изменена';
      end if;
    end if;
  end loop;

  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'appointment_auto'
     and entity_id = appointment_row.id;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.record_account_transfer(p_request_id uuid, p_from_account_id uuid, p_to_account_id uuid, p_amount numeric, p_occurred_on date DEFAULT NULL::date, p_notes text DEFAULT NULL::text)
 RETURNS SETOF finance_transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  request_row public.finance_transfer_requests%rowtype;
  from_account public.accounts%rowtype;
  to_account public.accounts%rowtype;
  normalized_amount numeric(12,2);
  normalized_notes text := nullif(btrim(p_notes), '');
  source_balance numeric(14,2);
  transfer_date date;
  caller_is_owner boolean;
  writable_accounts uuid[];
begin
  if auth.uid() is null or tenant_uuid is null then
    raise exception 'Переводы между счетами доступны только участникам компании';
  end if;
  caller_is_owner := coalesce(public.current_user_role() = 'owner', false);
  if p_request_id is null then raise exception 'Не удалось определить запрос перевода'; end if;
  if p_from_account_id is null or p_to_account_id is null then
    raise exception 'Выберите оба счёта';
  end if;
  if p_from_account_id = p_to_account_id then raise exception 'Выберите разные счета'; end if;
  if not caller_is_owner then
    writable_accounts := public.access_accounts_for('finance.accounts', 'write');
    if not (p_from_account_id = any(writable_accounts) and p_to_account_id = any(writable_accounts)) then
      raise exception 'Перевод между этими счетами вам не открыт'
        using errcode = '42501', hint = 'block:finance.accounts';
    end if;
  end if;
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount <= 0 then
    raise exception 'Введите сумму больше нуля';
  end if;
  normalized_amount := round(p_amount, 2);
  if normalized_amount <> p_amount then raise exception 'Укажите не больше двух знаков после запятой'; end if;
  transfer_date := coalesce(
    p_occurred_on,
    public.tenant_business_date(tenant_uuid)
  );
  if transfer_date > public.tenant_business_date(tenant_uuid) then
    raise exception 'Финансовую операцию нельзя записать будущей датой';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into request_row
    from public.finance_transfer_requests
   where id = p_request_id
   for update;
  if found then
    if request_row.tenant_id <> tenant_uuid then raise exception 'Запрос перевода уже использован'; end if;
    if request_row.from_account_id <> p_from_account_id
       or request_row.to_account_id <> p_to_account_id
       or request_row.amount <> normalized_amount
       or request_row.occurred_on <> transfer_date
       or request_row.notes is distinct from normalized_notes then
      raise exception 'Запрос перевода уже использован с другими данными';
    end if;
    if request_row.status = 'deleted' then raise exception 'Этот перевод уже отменён'; end if;
    if (select count(*) from public.finance_transactions
         where transfer_group_id = p_request_id and type = 'transfer') <> 2
       or not exists (
         select 1 from public.finance_transactions
          where transfer_group_id = p_request_id
            and tenant_id = tenant_uuid and account_id = p_from_account_id
            and amount = -normalized_amount
       ) or not exists (
         select 1 from public.finance_transactions
          where transfer_group_id = p_request_id
            and tenant_id = tenant_uuid and account_id = p_to_account_id
            and amount = normalized_amount
       ) then
      raise exception 'Перевод повреждён; данные не изменены';
    end if;
    return query
      select * from public.finance_transactions
       where transfer_group_id = p_request_id
       order by amount;
    return;
  end if;

  perform 1 from public.accounts
   where id in (p_from_account_id, p_to_account_id)
   order by id for update;
  select * into from_account from public.accounts where id = p_from_account_id;
  select * into to_account from public.accounts where id = p_to_account_id;
  if not found or from_account.id is null or to_account.id is null
     or from_account.tenant_id <> tenant_uuid or to_account.tenant_id <> tenant_uuid then
    raise exception 'Один из счетов не найден в этой компании';
  end if;
  if not from_account.is_active or not to_account.is_active then
    raise exception 'Перевод доступен только между активными счетами';
  end if;
  if from_account.brigade_id is not null and not exists (
    select 1 from public.teams
     where id = from_account.brigade_id and tenant_id = tenant_uuid
  ) then
    raise exception 'Команда счетов не найдена';
  end if;
  if to_account.brigade_id is not null and not exists (
    select 1 from public.teams
     where id = to_account.brigade_id and tenant_id = tenant_uuid
  ) then
    raise exception 'Команда счетов не найдена';
  end if;

  select round(
    from_account.opening_balance + coalesce(sum(
      case
        when type = 'expense' then -amount
        when type = 'refund' then -abs(amount)
        else amount
      end
    ), 0),
    2
  ) into source_balance
  from public.finance_transactions
  where account_id = from_account.id;
  if source_balance < normalized_amount then
    raise exception 'На исходном счёте недостаточно средств';
  end if;

  insert into public.finance_transfer_requests (
    id, tenant_id, from_account_id, to_account_id, team_id, amount,
    occurred_on, notes, created_by
  ) values (
    p_request_id, tenant_uuid, p_from_account_id, p_to_account_id,
    coalesce(from_account.brigade_id, to_account.brigade_id),
    normalized_amount, transfer_date, normalized_notes, auth.uid()
  );
  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (txid_current(), 'transfer_write', p_request_id, tenant_uuid)
  on conflict do nothing;
  insert into public.finance_transactions (
    tenant_id, type, amount, account_id, team_id, notes, occurred_on,
    transfer_group_id, source, created_by
  ) values
    (tenant_uuid, 'transfer', -normalized_amount, p_from_account_id,
     from_account.brigade_id, normalized_notes, transfer_date,
     p_request_id, 'manual', auth.uid()),
    (tenant_uuid, 'transfer', normalized_amount, p_to_account_id,
     to_account.brigade_id, normalized_notes, transfer_date,
     p_request_id, 'manual', auth.uid());
  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'transfer_write' and entity_id = p_request_id;
  return query
    select * from public.finance_transactions
     where transfer_group_id = p_request_id
     order by amount;
end;
$function$
;
grant execute on function public.record_account_transfer(p_request_id uuid, p_from_account_id uuid, p_to_account_id uuid, p_amount numeric, p_occurred_on date, p_notes text) to authenticated;

CREATE OR REPLACE FUNCTION public.record_appointment_payment(p_appointment_id uuid, p_account_id uuid, p_amount numeric, p_request_id uuid, p_kind text DEFAULT 'settlement'::text, p_paid_at timestamp with time zone DEFAULT now(), p_close_visit boolean DEFAULT false)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  appt public.appointments%rowtype;
  result_row public.appointments%rowtype;
  account_row public.accounts%rowtype;
  amount_value numeric(12,2);
  method text;
  tenant_timezone text;
  business_today date;
  paid_on date;
  paid_at_value timestamptz := coalesce(p_paid_at, now());
  outstanding_cents bigint;
  old_paid numeric(12,2);
  new_paid numeric(12,2);
  new_prepaid numeric(12,2);
  new_payment_status text;
  new_status text;
  payment_entry jsonb;
  has_settlement boolean := false;
begin
  -- Пропуск сторожа колонок записи (03.10): право на деньги проверяет
  -- сама дверь ниже, а сторож пускает партнёра только с этим флагом.
  perform set_config('babun.member_write', 'on', true);
  if auth.uid() is null or tenant_uuid is null then
    raise exception 'Войдите в приложение, чтобы записать оплату';
  end if;
  if p_request_id is null then
    raise exception 'Не указан идентификатор платежа';
  end if;
  if p_kind is null or p_kind not in ('settlement', 'prepayment') then
    raise exception 'Неизвестный вид платежа';
  end if;
  amount_value := round(p_amount, 2);
  if amount_value is null or amount_value <= 0 then
    raise exception 'Сумма платежа должна быть больше нуля';
  end if;
  if amount_value is distinct from p_amount then
    raise exception 'Укажите не больше двух знаков после запятой';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_appointment_id::text, 0));
  select * into appt
    from public.appointments
   where id = p_appointment_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Заявка не найдена';
  end if;
  if not public.current_user_can_pay_appointment(appt.team_id, appt.master_id) then
    raise exception 'Оплату по этой заявке записывает владелец, диспетчер или её команда';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(appt.payments, '[]'::jsonb)) p
     where p ->> 'id' = p_request_id::text
  ) or exists (
    select 1 from jsonb_array_elements(coalesce(appt.prepayments, '[]'::jsonb)) p
     where p ->> 'id' = p_request_id::text
  ) then
    return appt;
  end if;

  if appt.kind is distinct from 'work' then
    raise exception 'Деньги принимаются только по рабочей заявке';
  end if;
  if appt.status = 'cancelled' or appt.payment_status = 'refunded' then
    raise exception 'По отменённой заявке оплату не записать';
  end if;
  if exists (
    select 1 from public.invoices inv
     where inv.tenant_id = appt.tenant_id
       and inv.appointment_id = appt.id
       and coalesce(inv.kind, 'invoice') = 'invoice'
       and inv.status = 'issued'
  ) then
    raise exception 'По записи выставлен инвойс % — примите оплату по нему',
      (select inv.number from public.invoices inv
        where inv.tenant_id = appt.tenant_id
          and inv.appointment_id = appt.id
          and coalesce(inv.kind, 'invoice') = 'invoice'
          and inv.status = 'issued'
        order by inv.created_at desc
        limit 1);
  end if;
  if appt.team_id is null then
    raise exception 'У заявки нет команды — некуда положить деньги';
  end if;
  if appt.total_amount is null or appt.total_amount <= 0 then
    raise exception 'У заявки нет суммы — сначала укажите итог';
  end if;

  select * into account_row
    from public.accounts a
   where a.id = p_account_id
     and a.tenant_id = tenant_uuid
     and a.is_active = true
     and a.show_in_payments = true
     and (
       (a.scope = 'team' and a.brigade_id = appt.team_id)
       or (a.scope = 'company' and exists (
         select 1 from public.account_teams att
          where att.account_id = a.id and att.team_id = appt.team_id
       ))
     );
  if not found then
    raise exception 'Этот счёт не принимает оплату заявок этой команды';
  end if;
  method := case account_row.kind
    when 'cash' then 'cash'
    when 'card' then 'card'
    when 'bank' then 'transfer'
    else 'other'
  end;

  select cs.timezone into tenant_timezone
    from public.calendar_settings cs
   where cs.tenant_id = tenant_uuid;
  tenant_timezone := coalesce(nullif(btrim(tenant_timezone), ''), 'Europe/Nicosia');
  business_today := public.tenant_business_date(tenant_uuid);
  begin
    paid_on := (paid_at_value at time zone tenant_timezone)::date;
  exception when invalid_parameter_value then
    paid_on := (paid_at_value at time zone 'Europe/Nicosia')::date;
  end;
  if paid_on > business_today then
    paid_on := business_today;
    paid_at_value := now();
  end if;

  select exists (
    select 1 from public.finance_transactions
     where appointment_id = appt.id
       and source = 'auto'
       and type = 'income'
       and coalesce(appointment_payment_kind, 'settlement') = 'settlement'
  ) into has_settlement;

  payment_entry := jsonb_build_object(
    'id', p_request_id::text,
    'method', method,
    'amount', amount_value,
    'paid_at', to_char(paid_at_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'account_id', account_row.id
  );

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id, occurred_on, payment_id)
  values (
    txid_current(), 'appointment_payment_meta', appt.id, tenant_uuid,
    paid_on, p_request_id::text
  )
  on conflict do nothing;

  if p_kind = 'prepayment' then
    if appt.status = 'completed' then
      raise exception 'Визит уже выполнен — принимайте оплату, а не предоплату';
    end if;
    if has_settlement or coalesce(appt.paid_amount, 0) > 0 then
      raise exception 'После оплаты остатка предоплату добавить нельзя';
    end if;
    new_prepaid := round(coalesce(appt.prepaid_amount, 0) + amount_value, 2);
    if new_prepaid > appt.total_amount then
      raise exception 'Предоплата не может быть больше итоговой суммы';
    end if;
    new_payment_status := case
      when new_prepaid >= appt.total_amount then 'paid'
      else 'unpaid'
    end;
    insert into public._finance_write_context
      (transaction_id, kind, entity_id, tenant_id)
    values (txid_current(), 'appointment_prepayment', appt.id, tenant_uuid)
    on conflict do nothing;
    update public.appointments
       set prepaid_amount = new_prepaid,
           prepayments = coalesce(prepayments, '[]'::jsonb) || jsonb_build_array(payment_entry),
           payment_method = method,
           payment_account_id = account_row.id,
           paid_amount = 0,
           payment_status = new_payment_status
     where id = appt.id and tenant_id = tenant_uuid
     returning * into result_row;
    delete from public._finance_write_context
     where transaction_id = txid_current()
       and kind in ('appointment_prepayment', 'appointment_payment_meta')
       and entity_id = appt.id;
    return result_row;
  end if;

  old_paid := case
    when appt.payment_status in ('partial', 'paid') then coalesce(appt.paid_amount, 0)
    else 0
  end;
  outstanding_cents := round(appt.total_amount * 100)::bigint
    - round(coalesce(appt.prepaid_amount, 0) * 100)::bigint
    - round(old_paid * 100)::bigint;
  if outstanding_cents <= 0 then
    raise exception 'По заявке нечего оплачивать';
  end if;
  if round(amount_value * 100)::bigint > outstanding_cents then
    raise exception 'Сумма больше остатка по заявке';
  end if;
  new_paid := round(old_paid + amount_value, 2);
  new_payment_status := case
    when round(amount_value * 100)::bigint = outstanding_cents then 'paid'
    else 'partial'
  end;
  new_status := case
    when p_close_visit and appt.status in ('scheduled', 'in_progress') then 'completed'
    else appt.status
  end;
  update public.appointments
     set payments = coalesce(payments, '[]'::jsonb) || jsonb_build_array(payment_entry),
         payment = public.appointment_payment_mirror(
           coalesce(payments, '[]'::jsonb) || jsonb_build_array(payment_entry)
         ),
         paid_amount = new_paid,
         payment_status = new_payment_status,
         payment_method = method,
         payment_account_id = account_row.id,
         status = new_status
   where id = appt.id and tenant_id = tenant_uuid
   returning * into result_row;
  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'appointment_payment_meta'
     and entity_id = appt.id;
  return result_row;
end;
$function$
;
grant execute on function public.record_appointment_payment(p_appointment_id uuid, p_account_id uuid, p_amount numeric, p_request_id uuid, p_kind text, p_paid_at timestamp with time zone, p_close_visit boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.record_invoice_payment(p_invoice_id uuid, p_request_id uuid, p_amount numeric, p_account_id uuid, p_payment_method text, p_occurred_on date DEFAULT NULL::date, p_notes text DEFAULT NULL::text)
 RETURNS finance_transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  invoice_row public.invoices%rowtype;
  account_row public.accounts%rowtype;
  payment_row public.finance_transactions%rowtype;
  appointment_row public.appointments%rowtype;
  income_total numeric(12,2) := 0;
  direct_refunds numeric(12,2) := 0;
  linked_refunds numeric(12,2) := 0;
  paid_total numeric(12,2) := 0;
  remaining_total numeric(12,2) := 0;
  amount_value numeric(12,2);
  payment_date date;
  affected integer := 0;
  payment_vat_mode text;
  payment_vat_rate numeric;
  payment_vat_amount numeric;
  -- Деньги заявки вне этого инвойса и работа инвойса (сумма его строк).
  credited_here numeric := 0;
  other_money numeric := 0;
  invoice_work numeric := 0;
begin
  if tenant_uuid is null or not public._documents_write_invoice(p_invoice_id) then
    raise exception 'Нужно право «Документы: Выставляет» в команде документа';
  end if;
  if p_request_id is null then
    raise exception 'Не указан идентификатор платежа';
  end if;

  amount_value := round(p_amount, 2);
  if amount_value is null or amount_value <= 0 then
    raise exception 'Сумма платежа должна быть больше нуля';
  end if;
  if amount_value is distinct from p_amount then
    raise exception 'Укажите не больше двух знаков после запятой';
  end if;
  if amount_value > 999999999.99 then
    raise exception 'Сумма платежа слишком большая';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash', 'card', 'transfer', 'other') then
    raise exception 'Некорректный способ оплаты';
  end if;
  payment_date := coalesce(
    p_occurred_on,
    public.tenant_business_date(tenant_uuid)
  );
  if payment_date > public.tenant_business_date(tenant_uuid) then
    raise exception 'Платёж нельзя записать будущей датой';
  end if;

  -- Idempotent network retry: return the payment committed by this request.
  select * into payment_row
    from public.finance_transactions
   where id = p_request_id
     and tenant_id = tenant_uuid
     and invoice_id = p_invoice_id
     and type = 'income';
  if found then
    if payment_row.amount <> amount_value
       or payment_row.account_id is distinct from p_account_id
       or payment_row.payment_method is distinct from p_payment_method
       or payment_row.occurred_on <> payment_date
       or (
         nullif(btrim(p_notes), '') is not null
         and payment_row.notes is distinct from nullif(btrim(p_notes), '')
       ) then
      raise exception 'Идентификатор платежа уже использован с другими данными';
    end if;
    return payment_row;
  end if;

  select * into invoice_row
    from public.invoices
   where id = p_invoice_id
     and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Инвойс не найден или недоступен';
  end if;

  -- A concurrent retry can pass the optimistic lookup before the first
  -- request commits, then wait here on the invoice lock. Recheck after the
  -- lock so that retry returns the committed row instead of a UUID conflict.
  select * into payment_row
    from public.finance_transactions
   where id = p_request_id
     and tenant_id = tenant_uuid
     and invoice_id = p_invoice_id
     and type = 'income';
  if found then
    if payment_row.amount <> amount_value
       or payment_row.account_id is distinct from p_account_id
       or payment_row.payment_method is distinct from p_payment_method
       or payment_row.occurred_on <> payment_date
       or (
         nullif(btrim(p_notes), '') is not null
         and payment_row.notes is distinct from nullif(btrim(p_notes), '')
       ) then
      raise exception 'Идентификатор платежа уже использован с другими данными';
    end if;
    return payment_row;
  end if;

  if invoice_row.status = 'void' then
    raise exception 'Аннулированный инвойс нельзя оплачивать';
  end if;
  -- ОТМЕНЁННЫЙ КРЕДИТ-НОТОЙ — ТОЖЕ КОНЕЦ ПУТИ (статус `cancelled` из
  -- 20260915120000). Отказ явный, как у аннулированного, и не ждёт, пока
  -- статус пересчитается по журналу.
  if invoice_row.status = 'cancelled' then
    raise exception 'Инвойс отменён кредит-нотой — оплату по нему принять нельзя';
  end if;

  select * into account_row
    from public.accounts
   where id = p_account_id
     and tenant_id = tenant_uuid
     and is_active = true;
  if not found then
    raise exception 'Финансовый счёт не найден или закрыт';
  end if;
  if account_row.kind <> (case p_payment_method
       when 'cash' then 'cash'
       when 'card' then 'card'
       when 'transfer' then 'bank'
       else 'other'
     end) then
    raise exception 'Способ оплаты не соответствует выбранному счёту';
  end if;
  if invoice_row.brigade_id is not null
     and not public.account_serves_team(account_row.id, invoice_row.brigade_id) then
    raise exception 'Счёт должен принадлежать команде инвойса';
  end if;

  select
    coalesce(sum(case when type = 'income' then greatest(amount, 0) else 0 end), 0),
    coalesce(sum(case when type = 'refund' then abs(amount) else 0 end), 0)
    into income_total, direct_refunds
    from public.finance_transactions
   where tenant_id = tenant_uuid
     and invoice_id = p_invoice_id
     and type in ('income', 'refund');

  -- Older refund writers only set refund_of_id. Count those too, but not a
  -- refund already selected above through its own invoice_id.
  select coalesce(sum(abs(refund.amount)), 0)
    into linked_refunds
    from public.finance_transactions refund
    join public.finance_transactions original
      on original.id = refund.refund_of_id
   where original.tenant_id = tenant_uuid
     and original.invoice_id = p_invoice_id
     and original.type = 'income'
     and refund.tenant_id = tenant_uuid
     and refund.type = 'refund'
     and refund.invoice_id is null;

  paid_total := greatest(
    0,
    case
      when invoice_row.status = 'paid'
        then greatest(invoice_row.total - invoice_row.credited_amount, income_total)
      else income_total
    end - direct_refunds - linked_refunds
  );
  remaining_total := greatest(0, invoice_row.total - invoice_row.credited_amount - paid_total);

  if remaining_total <= 0 then
    raise exception 'Инвойс уже полностью оплачен';
  end if;
  if amount_value > remaining_total then
    raise exception 'Платёж превышает остаток % %', round(remaining_total, 2), invoice_row.currency;
  end if;

  -- ДЕНЬГИ ВНЕ ИНВОЙСА. Заявка уже держит деньги, пришедшие другой дорогой
  -- (предоплата, плитка, ручной доход, другой инвойс), и вместе с работой
  -- этого инвойса — суммой его строк, без налога «сверху» — они больше итога
  -- заявки: инвойс выставлен на уже оплаченную работу, и его деньги легли бы
  -- вторым доходом. Свой зачёт инвойса (элементы `pay-inv-…` его платежей)
  -- деньгами вне инвойса не считается: налог «сверху» после зачтённой работы
  -- принимается, settle зачтёт ноль. Проверка стоит после «Инвойс уже
  -- полностью оплачен» — у оплаченного инвойса ответ прежний. Отменённую
  -- заявку settle не трогает — здесь тоже. Заявка под замком: плитка,
  -- оплатившая её параллельно, дождётся или будет дождана.
  if invoice_row.appointment_id is not null then
    select * into appointment_row
      from public.appointments
     where id = invoice_row.appointment_id
       and tenant_id = tenant_uuid
     for update;
    if found
       and appointment_row.status <> 'cancelled'
       and appointment_row.payment_status <> 'refunded' then
      select coalesce(sum(least(credit.entry_sum, greatest(credit.net, 0))), 0)
        into credited_here
        from (
          select income.amount - coalesce((
                   select sum(abs(refund.amount))
                     from public.finance_transactions refund
                    where refund.refund_of_id = income.id
                      and refund.type = 'refund'
                 ), 0) as net,
                 (
                   select sum(round((e.elem ->> 'amount')::numeric, 2))
                     from jsonb_array_elements(coalesce(appointment_row.payments, '[]'::jsonb)) as e(elem)
                    where e.elem ->> 'id' = 'pay-inv-' || income.id::text
                 ) as entry_sum
            from public.finance_transactions income
           where income.appointment_id = appointment_row.id
             and income.invoice_id = invoice_row.id
             and income.type = 'income'
             and income.source = 'manual'
        ) credit
       where credit.entry_sum > 0;
      other_money := appointment_row.prepaid_amount + case
          when appointment_row.payment_status in ('partial', 'paid')
            then appointment_row.paid_amount
          else 0
        end - credited_here;
      select coalesce(sum(line.total), 0)
        into invoice_work
        from public.invoice_lines line
       where line.invoice_id = invoice_row.id;
      if other_money > 0
         and other_money + invoice_work > appointment_row.total_amount then
        if appointment_row.total_amount - other_money > 0 then
          raise exception 'По заявке уже есть оплата вне инвойса — аннулируйте инвойс и выставьте новый на остаток % %',
            round(appointment_row.total_amount - other_money, 2), invoice_row.currency;
        end if;
        raise exception 'По заявке уже есть оплата вне инвойса — аннулируйте инвойс';
      end if;
    end if;
  end if;

  -- Налог платежа — с бумаги, не из настроек: частичная оплата несёт
  -- пропорциональную долю напечатанного на инвойсе НДС.
  if coalesce(invoice_row.vat_amount, 0) <> 0 and coalesce(invoice_row.total, 0) <> 0 then
    payment_vat_mode := 'inclusive';
    payment_vat_rate := invoice_row.vat_percent;
    -- ПОСЛЕДНЯЯ ДОЛЯ ДОБИРАЕТ НАЛОГ БУМАГИ (аудит 03.10): доли, округлённые
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
    end if;
  else
    payment_vat_mode := 'none';
    payment_vat_rate := null;
    payment_vat_amount := null;
  end if;

  insert into public.finance_transactions (
    id,
    tenant_id,
    type,
    amount,
    currency,
    account_id,
    appointment_id,
    client_id,
    team_id,
    payment_method,
    notes,
    occurred_on,
    invoice_id,
    source,
    vat_mode,
    vat_rate,
    vat_amount
  ) values (
    p_request_id,
    tenant_uuid,
    'income',
    amount_value,
    invoice_row.currency,
    account_row.id,
    invoice_row.appointment_id,
    invoice_row.client_id,
    coalesce(invoice_row.brigade_id, account_row.brigade_id),
    p_payment_method,
    coalesce(nullif(btrim(p_notes), ''), 'Оплата инвойса ' || invoice_row.number),
    payment_date,
    invoice_row.id,
    'manual',
    payment_vat_mode,
    payment_vat_rate,
    payment_vat_amount
  )
  returning * into payment_row;

  update public.invoices
     set status = case
       when paid_total + amount_value >= invoice_row.total - invoice_row.credited_amount then 'paid'
       else 'issued'
     end
   where id = invoice_row.id
     and tenant_id = tenant_uuid;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Статус инвойса не обновлён';
  end if;

  return payment_row;
end;
$function$
;
grant execute on function public.record_invoice_payment(p_invoice_id uuid, p_request_id uuid, p_amount numeric, p_account_id uuid, p_payment_method text, p_occurred_on date, p_notes text) to authenticated;

CREATE OR REPLACE FUNCTION public.refresh_invoice_snapshots_from_line_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  target_invoice_id uuid := case
    when tg_op = 'DELETE' then old.invoice_id else new.invoice_id
  end;
begin
  update public.invoices invoice
     set seller_snapshot = '{}'::jsonb
   where invoice.id = target_invoice_id;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.refund_appointment_overpayment(p_appointment_id uuid, p_amount numeric, p_request_id uuid)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  appt public.appointments%rowtype;
  result_row public.appointments%rowtype;
  income public.finance_transactions%rowtype;
  entry record;
  entry_amount numeric(12,2);
  income_left numeric(12,2);
  piece numeric(12,2);
  remaining numeric(12,2);
  received numeric(12,2);
  refund_category_id uuid;
  business_today date;
  new_payments jsonb;
  new_prepayments jsonb;
  new_paid numeric(12,2);
  new_prepaid numeric(12,2);
  new_payment_status text;
  last_entry jsonb;
  first_piece boolean := true;
  invoice_money boolean := false;
begin
  perform set_config('babun.member_write', 'on', true);
  if auth.uid() is null or tenant_uuid is null then
    raise exception 'Войдите в приложение, чтобы вернуть деньги';
  end if;
  if p_request_id is null then
    raise exception 'Не указан идентификатор операции';
  end if;
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount <= 0 then
    raise exception 'Сумма возврата должна быть больше нуля';
  end if;
  if round(p_amount, 2) is distinct from p_amount then
    raise exception 'Укажите не больше двух знаков после запятой';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_appointment_id::text, 0));
  select * into appt
    from public.appointments
   where id = p_appointment_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Запись не найдена';
  end if;
  if not public.current_user_can_pay_appointment(appt.team_id, appt.master_id) then
    raise exception 'Вернуть деньги по этой записи может владелец, диспетчер или её команда';
  end if;

  -- Повтор после оборванного ответа: первая строка возврата несёт id попытки.
  if exists (
    select 1 from public.finance_transactions
     where id = p_request_id and tenant_id = tenant_uuid
  ) then
    return appt;
  end if;
  if appt.status = 'cancelled' or appt.payment_status = 'refunded' then
    raise exception 'Оплата по записи уже закрыта возвратом';
  end if;

  received := round(coalesce(appt.prepaid_amount, 0), 2) + round(coalesce(appt.paid_amount, 0), 2);
  if p_amount > received then
    raise exception 'Вернуть можно не больше полученного: %', received;
  end if;

  select id into refund_category_id
    from public.finance_categories
   where slug = 'refund'
     and type = 'income'
     and (tenant_id is null or tenant_id = tenant_uuid)
   order by tenant_id nulls last
   limit 1;
  business_today := public.tenant_business_date(tenant_uuid);

  new_payments := coalesce(appt.payments, '[]'::jsonb);
  new_prepayments := coalesce(appt.prepayments, '[]'::jsonb);
  remaining := p_amount;

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (txid_current(), 'appointment_auto', appt.id, tenant_uuid)
  on conflict do nothing;

  -- От последнего платежа к первому: сначала доплаты, потом предоплаты.
  for entry in
    select 'settlement'::text as kind, e.elem, e.ord
      from jsonb_array_elements(coalesce(appt.payments, '[]'::jsonb))
        with ordinality as e(elem, ord)
    union all
    select 'prepayment'::text as kind, e.elem, e.ord - 1000000
      from jsonb_array_elements(coalesce(appt.prepayments, '[]'::jsonb))
        with ordinality as e(elem, ord)
    order by 3 desc
  loop
    exit when remaining <= 0;
    entry_amount := round((entry.elem ->> 'amount')::numeric, 2);
    continue when entry_amount is null or entry_amount <= 0;
    -- Деньги инвойса здесь не возвращаются: их держит инвойс, и возврат
    -- оформляется на его странице. Плитки возвращаются, инвойс — мимо.
    if (entry.elem ->> 'id') like 'pay-inv-%' then
      invoice_money := true;
      continue;
    end if;

    select * into income
      from public.finance_transactions
     where appointment_id = appt.id
       and tenant_id = tenant_uuid
       and source = 'auto'
       and type = 'income'
       and appointment_payment_id = entry.elem ->> 'id'
     for update;
    if not found then
      raise exception 'Проводка платежа не найдена — верните деньги через «Финансы»';
    end if;
    if income.invoice_id is not null then
      invoice_money := true;
      continue;
    end if;
    if not exists (
      select 1 from public.accounts a where a.id = income.account_id and a.is_active
    ) then
      raise exception 'Счёт платежа закрыт; снова откройте его, чтобы вернуть деньги';
    end if;
    select round(income.amount, 2) - coalesce(sum(round(abs(r.amount), 2)), 0)
      into income_left
      from public.finance_transactions r
     where r.refund_of_id = income.id and r.type = 'refund';
    piece := least(remaining, entry_amount, greatest(income_left, 0));
    continue when piece <= 0;

    insert into public.finance_transactions (
      id, tenant_id, type, amount, currency, category_id, account_id,
      appointment_id, client_id, team_id, master_id, payment_method,
      occurred_on, source, refund_of_id, invoice_id, appointment_payment_kind,
      appointment_payment_id, reversal_kind, notes
    ) values (
      case when first_piece then p_request_id else gen_random_uuid() end,
      tenant_uuid, 'refund', -piece, income.currency,
      refund_category_id, income.account_id,
      appt.id, income.client_id, income.team_id, income.master_id, income.payment_method,
      business_today, 'auto', income.id, null,
      coalesce(income.appointment_payment_kind, entry.kind),
      entry.elem ->> 'id', 'client_refund', 'Возврат клиенту: итог записи уменьшен'
    );
    first_piece := false;
    remaining := remaining - piece;

    -- Платёж в записи: целиком возвращённый уходит, частично — с остатком.
    if entry.kind = 'settlement' then
      select coalesce(jsonb_agg(
               case when e.elem ->> 'id' = entry.elem ->> 'id'
                 then jsonb_set(e.elem, '{amount}', to_jsonb(entry_amount - piece))
                 else e.elem end
               order by e.ord), '[]'::jsonb)
        into new_payments
        from jsonb_array_elements(new_payments) with ordinality as e(elem, ord)
       where not (e.elem ->> 'id' = entry.elem ->> 'id' and entry_amount - piece <= 0);
    else
      select coalesce(jsonb_agg(
               case when e.elem ->> 'id' = entry.elem ->> 'id'
                 then jsonb_set(e.elem, '{amount}', to_jsonb(entry_amount - piece))
                 else e.elem end
               order by e.ord), '[]'::jsonb)
        into new_prepayments
        from jsonb_array_elements(new_prepayments) with ordinality as e(elem, ord)
       where not (e.elem ->> 'id' = entry.elem ->> 'id' and entry_amount - piece <= 0);
    end if;
  end loop;

  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'appointment_auto'
     and entity_id = appt.id;

  if remaining > 0 then
    if invoice_money then
      raise exception 'Остаток переплаты — деньги инвойса: верните их на странице инвойса';
    end if;
    raise exception 'Не хватило платежей записи для возврата: осталось %', remaining;
  end if;

  select coalesce(sum(round((e.elem ->> 'amount')::numeric, 2)), 0)
    into new_paid
    from jsonb_array_elements(new_payments) as e(elem);
  select coalesce(sum(round((e.elem ->> 'amount')::numeric, 2)), 0)
    into new_prepaid
    from jsonb_array_elements(new_prepayments) as e(elem);
  new_payment_status := case
    when appt.total_amount > 0 and new_prepaid + new_paid >= appt.total_amount then 'paid'
    when new_paid > 0 then 'partial'
    else 'unpaid'
  end;
  select e.elem into last_entry
    from jsonb_array_elements(new_payments) with ordinality as e(elem, ord)
   order by e.ord desc
   limit 1;
  if last_entry is null then
    select e.elem into last_entry
      from jsonb_array_elements(new_prepayments) with ordinality as e(elem, ord)
     order by e.ord desc
     limit 1;
  end if;

  -- Тот же пропуск сверки и сторожа, что у снятия платежа: проводки уже
  -- написаны выше, запись лишь догоняет их.
  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (txid_current(), 'appointment_payment_cancel', appt.id, tenant_uuid)
  on conflict do nothing;
  update public.appointments
     set payments = new_payments,
         prepayments = new_prepayments,
         payment = public.appointment_payment_mirror(new_payments),
         paid_amount = new_paid,
         prepaid_amount = new_prepaid,
         payment_status = new_payment_status,
         payment_method = case
           when last_entry is null then null
           else last_entry ->> 'method'
         end,
         payment_account_id = case
           when last_entry is null then null
           else nullif(last_entry ->> 'account_id', '')::uuid
         end
   where id = appt.id and tenant_id = tenant_uuid
   returning * into result_row;
  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'appointment_payment_cancel'
     and entity_id = appt.id;
  return result_row;
end;
$function$
;
grant execute on function public.refund_appointment_overpayment(p_appointment_id uuid, p_amount numeric, p_request_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.refund_invoice_payment(p_payment_id uuid, p_request_id uuid, p_amount numeric, p_occurred_on date DEFAULT NULL::date, p_notes text DEFAULT NULL::text)
 RETURNS finance_transactions
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  original_row public.finance_transactions%rowtype;
  refund_row public.finance_transactions%rowtype;
  invoice_row public.invoices%rowtype;
  amount_value numeric(12,2);
  occurred_value date;
  notes_value text := nullif(btrim(p_notes), '');
  already_refunded numeric(12,2) := 0;
  refundable_total numeric(12,2) := 0;
  income_total numeric(12,2) := 0;
  direct_refunds numeric(12,2) := 0;
  linked_refunds numeric(12,2) := 0;
  paid_total numeric(12,2) := 0;
  expected_status text;
  business_date date;
  tenant_timezone text;
begin
  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Недостаточно прав для возврата по инвойсу';
  end if;
  if p_payment_id is null then
    raise exception 'Не указан исходный платёж';
  end if;
  if p_request_id is null then
    raise exception 'Не указан идентификатор возврата';
  end if;
  -- Independent of later migrations: use the tenant's configured calendar
  -- timezone rather than the Supabase session/UTC business date.
  select settings.timezone into tenant_timezone
    from public.calendar_settings settings
   where settings.tenant_id = tenant_uuid;
  tenant_timezone := coalesce(nullif(btrim(tenant_timezone), ''), 'Europe/Nicosia');
  begin
    business_date := (current_timestamp at time zone tenant_timezone)::date;
  exception when invalid_parameter_value then
    business_date := (current_timestamp at time zone 'Europe/Nicosia')::date;
  end;
  occurred_value := coalesce(p_occurred_on, business_date);

  amount_value := round(p_amount, 2);
  if amount_value is null
     or amount_value = 'NaN'::numeric
     or amount_value <= 0 then
    raise exception 'Сумма возврата должна быть больше нуля';
  end if;
  if amount_value is distinct from p_amount then
    raise exception 'Укажите не больше двух знаков после запятой';
  end if;
  if amount_value > 999999999.99 then
    raise exception 'Сумма возврата слишком большая';
  end if;
  if occurred_value > business_date then
    raise exception 'Дата возврата не может быть в будущем';
  end if;

  -- Optimistic idempotency check. We still lock and validate the original
  -- below before returning, so even a malformed legacy refund cannot bypass
  -- the same-invoice/account/method guarantees.
  select * into refund_row
    from public.finance_transactions tx
   where tx.id = p_request_id
     and tx.tenant_id = tenant_uuid;
  if found then
    if refund_row.type <> 'refund'
       or refund_row.source <> 'manual'
       or refund_row.refund_of_id is distinct from p_payment_id
       or abs(refund_row.amount) <> amount_value
       or refund_row.occurred_on <> occurred_value
       or refund_row.notes is distinct from notes_value then
      raise exception 'Идентификатор возврата уже использован с другими данными';
    end if;
  end if;

  -- Every refund writer in the schema locks the original income. This is the
  -- serialization point for concurrent partial/full refunds.
  select * into original_row
    from public.finance_transactions tx
   where tx.id = p_payment_id
     and tx.tenant_id = tenant_uuid
     and tx.type = 'income'
   for update;
  if not found or original_row.invoice_id is null then
    raise exception 'Платёж инвойса не найден или недоступен';
  end if;
  if occurred_value < original_row.occurred_on then
    raise exception 'Возврат не может быть раньше исходного платежа';
  end if;

  select * into invoice_row
    from public.invoices invoice
   where invoice.id = original_row.invoice_id
     and invoice.tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Инвойс исходного платежа не найден';
  end if;

  -- A concurrent retry may have waited on the original row lock.
  select * into refund_row
    from public.finance_transactions tx
   where tx.id = p_request_id
     and tx.tenant_id = tenant_uuid;
  if found then
    if refund_row.type <> 'refund'
       or refund_row.source <> 'manual'
       or refund_row.refund_of_id is distinct from original_row.id
       or refund_row.invoice_id is distinct from invoice_row.id
       or refund_row.account_id is distinct from original_row.account_id
       or refund_row.payment_method is distinct from original_row.payment_method
       or refund_row.team_id is distinct from original_row.team_id
       or abs(refund_row.amount) <> amount_value
       or refund_row.occurred_on <> occurred_value
       or refund_row.notes is distinct from notes_value then
      raise exception 'Идентификатор возврата уже использован с другими данными';
    end if;
    return refund_row;
  end if;

  if invoice_row.status = 'void' then
    raise exception 'По аннулированному инвойсу нельзя оформить возврат';
  end if;
  if original_row.source = 'auto'
     or original_row.appointment_payment_kind is not null then
    -- Appointment receipts own payment_status/paid_amount/payments as well as
    -- the ledger. Refunding one only from the invoice would split those two
    -- truths; that workflow must go through the appointment's atomic action.
    raise exception 'Платёж заявки возвращается из карточки заявки';
  end if;
  if original_row.account_id is null or original_row.payment_method is null then
    raise exception 'У исходного платежа нет счёта или способа оплаты';
  end if;
  if original_row.payment_method not in ('cash', 'card', 'transfer', 'other') then
    raise exception 'У исходного платежа некорректный способ оплаты';
  end if;

  select coalesce(sum(abs(refund.amount)), 0)
    into already_refunded
    from public.finance_transactions refund
   where refund.tenant_id = tenant_uuid
     and refund.refund_of_id = original_row.id
     and refund.type = 'refund';
  refundable_total := round(
    greatest(0, greatest(original_row.amount, 0) - already_refunded),
    2
  );
  if refundable_total <= 0 then
    raise exception 'Этот платёж уже возвращён полностью';
  end if;
  if amount_value > refundable_total then
    raise exception 'Возврат превышает доступный остаток % %',
      refundable_total,
      original_row.currency;
  end if;

  insert into public.finance_transactions (
    id,
    tenant_id,
    type,
    amount,
    currency,
    category_id,
    account_id,
    appointment_id,
    client_id,
    team_id,
    master_id,
    payment_method,
    notes,
    occurred_on,
    invoice_id,
    refund_of_id,
    source,
    created_by
  ) values (
    p_request_id,
    tenant_uuid,
    'refund',
    -amount_value,
    original_row.currency,
    original_row.category_id,
    original_row.account_id,
    original_row.appointment_id,
    original_row.client_id,
    original_row.team_id,
    original_row.master_id,
    original_row.payment_method,
    notes_value,
    occurred_value,
    invoice_row.id,
    original_row.id,
    'manual',
    auth.uid()
  )
  returning * into refund_row;

  -- The existing AFTER trigger persists settlement status. Verify it inside
  -- this transaction so a missing/broken trigger rolls the refund back.
  select * into invoice_row
    from public.invoices invoice
   where invoice.id = original_row.invoice_id
     and invoice.tenant_id = tenant_uuid
   for update;

  select
    coalesce(sum(case when tx.type = 'income'
      then greatest(tx.amount, 0) else 0 end), 0),
    coalesce(sum(case when tx.type = 'refund'
      then abs(tx.amount) else 0 end), 0)
    into income_total, direct_refunds
    from public.finance_transactions tx
   where tx.tenant_id = tenant_uuid
     and tx.invoice_id = invoice_row.id
     and tx.type in ('income', 'refund');
  select coalesce(sum(abs(refund.amount)), 0)
    into linked_refunds
    from public.finance_transactions refund
    join public.finance_transactions original
      on original.id = refund.refund_of_id
   where original.tenant_id = tenant_uuid
     and original.invoice_id = invoice_row.id
     and original.type = 'income'
     and refund.tenant_id = tenant_uuid
     and refund.type = 'refund'
     and refund.invoice_id is null;

  paid_total := greatest(0, income_total - direct_refunds - linked_refunds);
  expected_status := case
    when paid_total >= invoice_row.total - invoice_row.credited_amount then 'paid'
    else 'issued'
  end;
  if invoice_row.status is distinct from expected_status then
    raise exception 'Статус инвойса не синхронизирован с возвратом';
  end if;
  if refund_row.invoice_id is distinct from invoice_row.id
     or refund_row.account_id is distinct from original_row.account_id
     or refund_row.payment_method is distinct from original_row.payment_method then
    raise exception 'Возврат не подтверждён по исходному платежу';
  end if;

  return refund_row;
end;
$function$
;
grant execute on function public.refund_invoice_payment(p_payment_id uuid, p_request_id uuid, p_amount numeric, p_occurred_on date, p_notes text) to authenticated;

CREATE OR REPLACE FUNCTION public.refund_receipt(p_receipt_id uuid, p_request_id uuid, p_amount numeric, p_reason text DEFAULT NULL::text, p_language text DEFAULT 'en'::text)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  receipt_row public.receipts%rowtype;
  income_row public.finance_transactions%rowtype;
  invoice_row public.invoices%rowtype;
  note_row public.invoices%rowtype;
  note_id uuid;
  amount_value numeric(12,2);
  already_refunded numeric(12,2);
  refundable numeric(12,2);
  held numeric(12,2);
  business_date date;
  reason_text text := nullif(btrim(p_reason), '');
begin
  if tenant_uuid is null or not public._documents_write_receipt(p_receipt_id) then
    raise exception 'Нужно право «Документы: Выставляет» в команде документа'
      using errcode = '42501', hint = 'access:owner_only';
  end if;
  if p_request_id is null then
    raise exception 'Не указан идентификатор возврата';
  end if;

  select * into receipt_row
    from public.receipts
   where id = p_receipt_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Чек не найден';
  end if;

  if exists (
    select 1 from public.finance_transactions
     where id = p_request_id and tenant_id = tenant_uuid
  ) then
    select * into note_row
      from public.invoices note
     where note.tenant_id = tenant_uuid
       and note.kind = 'credit_note'
       and (note.credit_note_of_receipt_id = receipt_row.id
            or note.credit_note_of_id = receipt_row.invoice_id)
     order by note.created_at desc
     limit 1;
    if found then return note_row; end if;
    raise exception 'Идентификатор возврата уже использован';
  end if;

  if receipt_row.status <> 'issued' then
    raise exception 'Чек уже погашен — возвращать нечего';
  end if;
  if receipt_row.transaction_id is null then
    raise exception 'У чека нет платежа — вернуть нечего';
  end if;

  select * into income_row
    from public.finance_transactions
   where id = receipt_row.transaction_id
     and tenant_id = tenant_uuid
     and type = 'income'
   for update;
  if not found then
    raise exception 'Платёж чека не найден';
  end if;
  if income_row.source = 'auto' or income_row.appointment_payment_kind is not null then
    raise exception 'Деньги по записи возвращаются в самой записи';
  end if;
  if income_row.account_id is null or income_row.payment_method is null then
    raise exception 'У платежа нет счёта или способа оплаты';
  end if;

  amount_value := round(p_amount, 2);
  if amount_value is null or amount_value = 'NaN'::numeric or amount_value <= 0 then
    raise exception 'Сумма возврата должна быть больше нуля';
  end if;
  if amount_value is distinct from p_amount then
    raise exception 'Укажите не больше двух знаков после запятой';
  end if;

  select coalesce(sum(abs(amount)), 0) into already_refunded
    from public.finance_transactions
   where tenant_id = tenant_uuid and refund_of_id = income_row.id and type = 'refund';
  refundable := round(greatest(0, greatest(income_row.amount, 0) - already_refunded), 2);
  if refundable <= 0 then
    raise exception 'Этот платёж уже возвращён полностью';
  end if;
  if amount_value > refundable then
    raise exception 'Возврат превышает доступный остаток % %', refundable, income_row.currency;
  end if;
  if income_row.invoice_id is not null and amount_value <> refundable then
    raise exception 'Платёж инвойса возвращается целиком — инвойс отменяется кредит-нотой';
  end if;

  business_date := public.tenant_business_date(tenant_uuid);

  insert into public.finance_transactions (
    id, tenant_id, type, amount, currency, category_id, account_id,
    appointment_id, client_id, team_id, master_id, payment_method, notes,
    occurred_on, invoice_id, refund_of_id, source, created_by
  ) values (
    p_request_id, tenant_uuid, 'refund', -amount_value, income_row.currency,
    income_row.category_id, income_row.account_id, income_row.appointment_id,
    income_row.client_id, income_row.team_id, income_row.master_id,
    income_row.payment_method,
    coalesce(reason_text, 'Возврат по чеку ' || receipt_row.number),
    greatest(business_date, income_row.occurred_on),
    income_row.invoice_id, income_row.id, 'manual', auth.uid()
  );

  if income_row.invoice_id is not null then
    select * into invoice_row
      from public.invoices
     where id = income_row.invoice_id and tenant_id = tenant_uuid
     for update;
    select greatest(0,
             coalesce(sum(case when tx.type = 'income' then greatest(tx.amount, 0) else 0 end), 0)
           - coalesce(sum(case when tx.type = 'refund' then abs(tx.amount) else 0 end), 0))
      into held
      from public.finance_transactions tx
     where tx.tenant_id = tenant_uuid
       and tx.invoice_id = invoice_row.id
       and tx.type in ('income', 'refund');
    if held > 0 then
      raise exception 'По инвойсу % остаются другие платежи — верните их на странице инвойса', invoice_row.number;
    end if;
    note_id := public._issue_credit_note(invoice_row.id, reason_text);
    update public.invoices
       set status = 'cancelled', updated_at = now()
     where id = invoice_row.id;
    select * into note_row from public.invoices where id = note_id;
    return note_row;
  end if;

  return public._issue_receipt_credit_note(receipt_row.id, amount_value, reason_text, p_language);
end;
$function$
;
grant execute on function public.refund_receipt(p_receipt_id uuid, p_request_id uuid, p_amount numeric, p_reason text, p_language text) to authenticated;

CREATE OR REPLACE FUNCTION public.replace_day_extras(p_team_id text, p_date text, p_extras jsonb)
 RETURNS SETOF day_extras
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  item jsonb;
  amount_value numeric;
  caller_is_owner boolean;
  writable text[];
  readable text[];
  foreign_item jsonb;
begin
  if auth.uid() is null
     or tenant_uuid is null then
    raise exception 'Ручные финансы доступны только участникам компании'
      using errcode = '42501';
  end if;
  caller_is_owner := coalesce(public.current_user_role() = 'owner', false);
  if not caller_is_owner
     and not coalesce(
       p_team_id = any(public.access_calendars('finance.income', 'write'))
       or p_team_id = any(public.access_calendars('finance.expense', 'write')),
       false
     ) then
    raise exception 'Менять доходы и расходы в этом календаре вам не открыто'
      using errcode = '42501', hint = 'block:finance.income';
  end if;
  if nullif(btrim(coalesce(p_team_id, '')), '') is null
     or not exists (
       select 1 from public.teams team
        where team.tenant_id = tenant_uuid and team.id = p_team_id
     ) then
    raise exception 'Команда не найдена в этой компании'
      using errcode = '23503';
  end if;
  if p_date is null
     or p_date !~ '^\d{4}-\d{2}-\d{2}$'
     or (p_date::date)::text <> p_date then
    raise exception 'Дата ручной операции некорректна'
      using errcode = '22023';
  end if;
  if p_extras is null or jsonb_typeof(p_extras) <> 'array' then
    raise exception 'Список ручных операций повреждён'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_extras) > 200 then
    raise exception 'Слишком много ручных операций за один день'
      using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_extras)
  loop
    if jsonb_typeof(item) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(item) key
          where key not in (
            'id', 'name', 'amount', 'kind', 'category',
            'payment_method', 'receipt_url'
          )
       )
       or jsonb_typeof(item -> 'id') <> 'string'
       or jsonb_typeof(item -> 'name') <> 'string'
       or jsonb_typeof(item -> 'amount') <> 'number'
       or jsonb_typeof(item -> 'kind') <> 'string'
       or nullif(btrim(item ->> 'name'), '') is null
       or char_length(btrim(item ->> 'name')) > 500
       or (item ->> 'kind') not in ('income', 'expense')
       or (
         item ? 'category'
         and item -> 'category' <> 'null'::jsonb
         and (
           jsonb_typeof(item -> 'category') <> 'string'
           or (item ->> 'category') not in ('fuel', 'food', 'supplies', 'other')
         )
       )
       or (
         item ? 'payment_method'
         and item -> 'payment_method' <> 'null'::jsonb
         and (
           jsonb_typeof(item -> 'payment_method') <> 'string'
           or (item ->> 'payment_method') not in ('cash', 'card', 'transfer', 'other')
         )
       )
       or (
         item ? 'receipt_url'
         and item -> 'receipt_url' <> 'null'::jsonb
         and (
           jsonb_typeof(item -> 'receipt_url') <> 'string'
           or char_length(item ->> 'receipt_url') > 2048
         )
       ) then
      raise exception 'Ручная операция содержит некорректные поля'
        using errcode = '22023';
    end if;

    begin
      perform (item ->> 'id')::uuid;
      amount_value := (item ->> 'amount')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Идентификатор или сумма ручной операции некорректны'
        using errcode = '22023';
    end;
    if amount_value = 'NaN'::numeric
       or amount_value < 0
       or amount_value > 999999999.99
       or round(amount_value, 2) is distinct from amount_value then
      raise exception 'Сумма ручной операции некорректна'
        using errcode = '22023';
    end if;
  end loop;

  if (
    select count(distinct (value ->> 'id')::uuid)
      from jsonb_array_elements(p_extras)
  ) <> jsonb_array_length(p_extras) then
    raise exception 'Ручные операции не должны повторяться'
      using errcode = '23505';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(tenant_uuid::text || ':' || p_team_id || ':' || p_date, 0)
  );

  select coalesce(array_agg(side.kind), array[]::text[]) into writable
    from (values ('income'), ('expense')) as side(kind)
   where caller_is_owner
      or coalesce(p_team_id = any(public.access_calendars('finance.' || side.kind, 'write')), false);
  select coalesce(array_agg(side.kind), array[]::text[]) into readable
    from (values ('income'), ('expense')) as side(kind)
   where caller_is_owner
      or coalesce(p_team_id = any(public.access_calendars('finance.' || side.kind, 'read')), false);

  for foreign_item in
    select value
      from jsonb_array_elements(p_extras)
     where not ((value ->> 'kind') = any(writable))
  loop
    if not exists (
      select 1
        from public.day_extras extra
       where extra.tenant_id = tenant_uuid
         and extra.team_id = p_team_id
         and extra.date = p_date
         and extra.id = (foreign_item ->> 'id')::uuid
         and extra.kind = foreign_item ->> 'kind'
         and extra.name = btrim(foreign_item ->> 'name')
         and extra.amount = (foreign_item ->> 'amount')::numeric
         and extra.category is not distinct from (foreign_item ->> 'category')
         and extra.payment_method is not distinct from (foreign_item ->> 'payment_method')
         and extra.receipt_url is not distinct from (foreign_item ->> 'receipt_url')
    ) then
      raise exception 'Менять эту сторону денег в этом календаре вам не открыто'
        using errcode = '42501', hint = 'block:finance.' || (foreign_item ->> 'kind');
    end if;
  end loop;

  delete from public.day_extras extra
   where extra.tenant_id = tenant_uuid
     and extra.team_id = p_team_id
     and extra.date = p_date
     and extra.kind = any(writable);

  insert into public.day_extras (
    id, tenant_id, team_id, date, name, amount, kind, category,
    payment_method, receipt_url
  )
  select
    (value ->> 'id')::uuid,
    tenant_uuid,
    p_team_id,
    p_date,
    btrim(value ->> 'name'),
    (value ->> 'amount')::numeric,
    value ->> 'kind',
    value ->> 'category',
    value ->> 'payment_method',
    value ->> 'receipt_url'
  from jsonb_array_elements(p_extras)
  where (value ->> 'kind') = any(writable);

  return query
    select extra.*
      from public.day_extras extra
     where extra.tenant_id = tenant_uuid
       and extra.team_id = p_team_id
       and extra.date = p_date
       and extra.kind = any(readable)
     order by extra.created_at, extra.id;
end;
$function$
;
grant execute on function public.replace_day_extras(p_team_id text, p_date text, p_extras jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.reset_appointment_payment(p_appointment_id uuid)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  appointment_row public.appointments%rowtype;
  result_row public.appointments%rowtype;
  outstanding_count integer := 0;
  outstanding_amount numeric := 0;
  expected_receipts numeric := 0;
begin
  -- Пропуск сторожа колонок записи (03.10): право на деньги проверяет
  -- сама дверь ниже, а сторож пускает партнёра только с этим флагом.
  perform set_config('babun.member_write', 'on', true);
  if auth.uid() is null
     or coalesce(public.current_user_role(), '') not in ('owner', 'dispatcher') then
    raise exception 'Отменить оплату может владелец или диспетчер';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_appointment_id::text, 0));
  select * into appointment_row
    from public.appointments
   where id = p_appointment_id and tenant_id = tenant_uuid
   for update;
  if not found then raise exception 'Заявка не найдена'; end if;
  if not public.current_user_can_edit_work_appointment(appointment_row.team_id) then
    raise exception 'Заявка не найдена';
  end if;
  if not public.current_user_can_pay_appointment(appointment_row.team_id, appointment_row.master_id) then
    raise exception 'Оплату этой записи менять нельзя' using errcode = '42501', hint = 'block:record.payment';
  end if;
  if appointment_row.status = 'cancelled'
     or appointment_row.payment_status = 'refunded' then
    raise exception 'Оплата уже закрыта возвратом';
  end if;

  expected_receipts := greatest(appointment_row.prepaid_amount, 0) + case
    when appointment_row.payment_status = 'paid' then greatest(
      appointment_row.total_amount - appointment_row.prepaid_amount,
      0
    )
    when appointment_row.payment_status = 'partial' then
      greatest(appointment_row.paid_amount, 0)
    else 0
  end;
  if expected_receipts <= 0 then
    raise exception 'В заявке нет оплаты для отмены';
  end if;

  perform 1
    from public.finance_transactions income
   where income.appointment_id = p_appointment_id
     and income.type = 'income'
     and income.source = 'auto'
   order by income.id
   for update;
  select
    count(*) filter (where receipt.outstanding > 0),
    coalesce(sum(receipt.outstanding), 0)
    into outstanding_count, outstanding_amount
    from (
      select greatest(
        income.amount - coalesce((
          select sum(abs(refund.amount))
            from public.finance_transactions refund
           where refund.refund_of_id = income.id
             and refund.type = 'refund'
        ), 0),
        0
      ) as outstanding
      from public.finance_transactions income
     where income.appointment_id = p_appointment_id
       and income.type = 'income'
       and income.source = 'auto'
    ) receipt;
  if outstanding_count = 0 then
    raise exception 'Все платежи уже возвращены';
  end if;
  -- Previous short-lived settlement undo may already have refunded only the
  -- settlement while a prepayment remains. That history is valid: refund the
  -- still-outstanding receipts, but fail closed if mirrors and ledger differ.
  if round(outstanding_amount, 2) is distinct from round(expected_receipts, 2) then
    raise exception 'Сумма оплаты не совпадает с финансовой историей';
  end if;
  if exists (
    select 1
      from public.finance_transactions income
      left join public.accounts account
        on account.id = income.account_id and account.tenant_id = tenant_uuid
     where income.appointment_id = p_appointment_id
       and income.type = 'income'
       and income.source = 'auto'
       and income.amount > coalesce((
         select sum(abs(refund.amount))
           from public.finance_transactions refund
          where refund.refund_of_id = income.id
            and refund.type = 'refund'
       ), 0)
       and (account.id is null or not account.is_active)
  ) then
    raise exception 'Счёт оплаты закрыт; снова откройте его перед возвратом';
  end if;

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (
    txid_current(), 'appointment_payment_reset', p_appointment_id, tenant_uuid
  )
  on conflict do nothing;
  update public.appointments
     set prepaid_amount = 0,
         paid_amount = 0,
         payment_status = 'unpaid',
         payment_method = null,
         payment = null,
         payments = '[]'::jsonb
   where id = p_appointment_id and tenant_id = tenant_uuid
  returning * into result_row;
  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'appointment_payment_reset'
     and entity_id = p_appointment_id;
  return result_row;
end;
$function$
;
grant execute on function public.reset_appointment_payment(p_appointment_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.resolve_appointment_finance_account(p_tenant_id uuid, p_team_id text, p_payment_method text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  account_id uuid;
  required_kind text;
begin
  if p_team_id is null or btrim(p_team_id) = '' then
    raise exception 'Укажите команду заявки перед оплатой';
  end if;
  if p_payment_method is null
     or p_payment_method not in ('cash', 'card', 'transfer', 'other') then
    raise exception 'Выберите способ оплаты заявки';
  end if;
  required_kind := case p_payment_method
    when 'cash' then 'cash'
    when 'card' then 'card'
    when 'transfer' then 'bank'
    else 'other'
  end;

  select a.id into account_id
    from public.accounts a
   where a.tenant_id = p_tenant_id
     and a.kind = required_kind
     and a.is_active = true
     and a.show_in_payments = true
     and (
       (a.scope = 'team' and a.brigade_id = p_team_id)
       or (a.scope = 'company' and exists (
         select 1 from public.account_teams att
          where att.account_id = a.id and att.team_id = p_team_id
       ))
     )
   order by (a.scope = 'team') desc, a.position, a.name, a.id
   limit 1;
  if account_id is null then
    raise exception 'Для этого способа оплаты нет счёта, принимающего деньги заявок';
  end if;
  return account_id;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.resolve_appointment_payment_account(p_tenant_id uuid, p_team_id text, p_payment_method text, p_account_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ok boolean;
begin
  if p_account_id is null then
    -- Легаси-вход без выбора (закрытие дня, импорт, старые записи).
    return public.resolve_appointment_finance_account(
      p_tenant_id, p_team_id, p_payment_method
    );
  end if;

  select true into ok
    from public.accounts a
   where a.id = p_account_id
     and a.tenant_id = p_tenant_id
     and a.is_active = true
     -- ВТОРОЙ СЛОЙ ЗАЩИТЫ (аудит счетов 2026-09-10). Флаг «показывать при
     -- оплате заявок» проверяли только список (`list_payment_accounts_safe`) и
     -- автоподстановка (`resolve_appointment_finance_account`); эта, третья
     -- дверь его не знала — и счёт, спрятанный владельцем от бригадира, всё
     -- равно принимал деньги, если id пришёл в запросе. У денег в этом
     -- продукте защита всегда двухслойная.
     and a.show_in_payments = true
     and (
       (a.scope = 'team' and a.brigade_id = p_team_id)
       or (a.scope = 'company' and exists (
         select 1 from public.account_teams att
          where att.account_id = a.id and att.team_id = p_team_id
       ))
     );
  if ok is not true then
    raise exception 'Выбранный счёт не обслуживает команду этой заявки';
  end if;
  return p_account_id;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.resolve_company_id(p_tenant_id uuid, p_company_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  resolved uuid;
  caller_role text;
begin
  if p_tenant_id is null then
    return null;
  end if;

  if p_company_id is not null then
    caller_role := public.current_user_role();
    -- 03.10: партнёр с «Документы: Выставляет» выставляет документ от юрлица
    -- своей команды (у команды без своего юрлица — от основного); выбирать
    -- чужие реквизиты он по-прежнему не может.
    if caller_role is not null and caller_role not in ('owner', 'dispatcher')
       and not exists (
         select 1
           from public.teams team
          where team.tenant_id = p_tenant_id
            and team.id = any(public.access_calendars('finance.documents', 'write'))
            and coalesce(team.legal_entity_id, public.resolve_company_id(p_tenant_id, null)) = p_company_id
       ) then
      raise exception 'Выбирать реквизиты может владелец или диспетчер';
    end if;
    select id into resolved
      from public.legal_entities
     where id = p_company_id
       and tenant_id = p_tenant_id;
    if resolved is null then
      raise exception 'Реквизиты не найдены в этой компании';
    end if;
    return resolved;
  end if;

  select id into resolved
    from public.legal_entities
   where tenant_id = p_tenant_id
     and is_default;
  if resolved is not null then
    return resolved;
  end if;

  select id into resolved
    from public.legal_entities
   where tenant_id = p_tenant_id
     and archived_at is null
   order by position, created_at
   limit 1;
  return resolved;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.resolve_own_company_id(p_company_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.resolve_company_id(public.current_tenant_id(), p_company_id);
$function$
;
grant execute on function public.resolve_own_company_id(p_company_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.restore_deleted_operation(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  trashed public.deleted_operations%rowtype;
begin
  -- Снимок ЗАБИРАЕТСЯ из ящика удалением — под RLS звонящего (чужого он не
  -- найдёт) и без права UPDATE, которого у приложения на ящик нет. Два
  -- «Вернуть» разом не вставят операцию дважды: второе ждёт строку первого и
  -- находит пустоту. Отказ вставки ниже откатывает и это удаление.
  delete from public.deleted_operations
   where id = p_id
  returning * into trashed;
  if not found then
    raise exception 'Операции нет в «Удалённых»'
      using errcode = 'P0002', hint = 'operation:not_in_trash';
  end if;
  -- Вставка — под политиками создания операции и всеми сторожами вставки.
  insert into public.finance_transactions
  select (jsonb_populate_record(
    null::public.finance_transactions,
    public.deleted_operation_ready(trashed.operation)
  )).*;
  return p_id;
end;
$function$
;
grant execute on function public.restore_deleted_operation(p_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.seed_client_sources(p_tenant uuid, p_team text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.client_sources (tenant_id, team_id, name, position, key)
  select p_tenant, p_team, v.name, v.pos, v.key
    from (values
      ('referral', 'Рекомендация', 0),
      ('instagram', 'Instagram', 1),
      ('whatsapp', 'WhatsApp', 2),
      ('google_maps', 'Google Maps', 3),
      ('website', 'Сайт', 4),
      ('repeat', 'Повторный', 5),
      ('walk_in', 'Проездом', 6),
      ('other', 'Другое', 7)
    ) as v(key, name, pos)
  on conflict do nothing;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.seed_records_level(p_tenant uuid, p_user uuid, p_by uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
  select mc.tenant_id, mc.user_id, 'calendar.records', mc.team_id, 'read', p_by, now()
    from public.member_calendars mc
   where mc.tenant_id = p_tenant
     and mc.user_id = p_user
     and not exists (
       select 1 from public.member_access ma
        where ma.tenant_id = mc.tenant_id and ma.user_id = mc.user_id
          and ma.block = 'calendar.records' and ma.team_id = mc.team_id
     )
  on conflict do nothing
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.set_appointment_created_by()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.set_appointment_prepayment(p_appointment_id uuid, p_amount numeric, p_payment_method text)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  appointment_row public.appointments%rowtype;
  result_row public.appointments%rowtype;
  normalized_amount numeric(12,2);
begin
  -- Пропуск сторожа колонок записи (03.10): право на деньги проверяет
  -- сама дверь ниже, а сторож пускает партнёра только с этим флагом.
  perform set_config('babun.member_write', 'on', true);
  if auth.uid() is null
     or coalesce(public.current_user_role(), '') not in ('owner', 'dispatcher') then
    raise exception 'Изменить предоплату может владелец или диспетчер';
  end if;
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount < 0 then
    raise exception 'Предоплата не может быть отрицательной';
  end if;
  normalized_amount := round(p_amount, 2);
  if normalized_amount is distinct from p_amount then
    raise exception 'Укажите не больше двух знаков после запятой';
  end if;
  if normalized_amount > 0 and (
    p_payment_method is null
    or p_payment_method not in ('cash', 'card', 'transfer', 'other')
  ) then
    raise exception 'Выберите способ предоплаты';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_appointment_id::text, 0));
  select * into appointment_row
    from public.appointments
   where id = p_appointment_id and tenant_id = tenant_uuid
   for update;
  if not found then raise exception 'Заявка не найдена'; end if;
  if not public.current_user_can_edit_work_appointment(appointment_row.team_id) then
    raise exception 'Заявка не найдена';
  end if;
  if not public.current_user_can_pay_appointment(appointment_row.team_id, appointment_row.master_id) then
    raise exception 'Оплату этой записи менять нельзя' using errcode = '42501', hint = 'block:record.payment';
  end if;
  if appointment_row.status = 'cancelled'
     or appointment_row.payment_status = 'refunded' then
    raise exception 'По отменённой заявке предоплата уже закрыта возвратом';
  end if;
  if appointment_row.status = 'completed' then
    raise exception 'После выполнения отмените оплату целиком и проведите её заново';
  end if;
  if normalized_amount > appointment_row.total_amount then
    raise exception 'Предоплата не может быть больше итоговой суммы';
  end if;
  if appointment_row.paid_amount > 0
     or exists (
       select 1 from public.finance_transactions
        where appointment_id = appointment_row.id
          and source = 'auto'
          and type = 'income'
          and coalesce(appointment_payment_kind, 'settlement') = 'settlement'
     ) then
    raise exception 'После оплаты остатка предоплату отдельно менять нельзя';
  end if;
  if appointment_row.prepaid_amount = normalized_amount
     and appointment_row.payment_method is not distinct from (case
       when normalized_amount > 0 then p_payment_method else null
     end) then
    return appointment_row;
  end if;

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (
    txid_current(), 'appointment_prepayment', appointment_row.id, tenant_uuid
  )
  on conflict do nothing;
  -- Changing tender reclassifies the whole prepayment as two immutable
  -- events: refund on the old account, then a fresh receipt on the new one.
  -- Merely changing the appointment field would falsify the account ledger.
  if appointment_row.prepaid_amount > 0
     and normalized_amount > 0
     and appointment_row.payment_method is distinct from p_payment_method then
    update public.appointments
       set prepaid_amount = 0,
           payment_method = null,
           paid_amount = 0,
           payment_status = 'unpaid'
     where id = appointment_row.id and tenant_id = tenant_uuid;
  end if;
  update public.appointments
     set prepaid_amount = normalized_amount,
         payment_method = case
           when normalized_amount > 0 then p_payment_method else null
         end,
         paid_amount = 0,
         payment_status = case
           when normalized_amount > 0
                and normalized_amount >= total_amount
                and total_amount > 0 then 'paid'
           else 'unpaid'
         end
   where id = appointment_row.id and tenant_id = tenant_uuid
  returning * into result_row;
  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'appointment_prepayment'
     and entity_id = appointment_row.id;
  return result_row;
end;
$function$
;
grant execute on function public.set_appointment_prepayment(p_appointment_id uuid, p_amount numeric, p_payment_method text) to authenticated;

CREATE OR REPLACE FUNCTION public.set_appointment_vat_mode(p_appointment_id uuid, p_vat_mode text)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  appt public.appointments%rowtype;
  result_row public.appointments%rowtype;
begin
  if auth.uid() is null or tenant_uuid is null then
    raise exception 'Войдите в приложение, чтобы выбрать VAT записи';
  end if;
  if p_vat_mode is not null and p_vat_mode not in ('on', 'off') then
    raise exception 'Неизвестный режим VAT записи';
  end if;

  select * into appt
    from public.appointments
   where id = p_appointment_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Заявка не найдена';
  end if;
  if not public.current_user_can_pay_appointment(appt.team_id, appt.master_id) then
    raise exception 'VAT записи выбирает владелец, диспетчер или её команда';
  end if;
  if appt.kind is distinct from 'work' then
    raise exception 'VAT выбирают только у рабочей записи';
  end if;
  if appt.vat_mode is not distinct from p_vat_mode then
    return appt;
  end if;

  update public.appointments
     set vat_mode = p_vat_mode
   where id = appt.id and tenant_id = tenant_uuid
   returning * into result_row;
  return result_row;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.set_client_sms_opt_out(p_client_id uuid, p_value boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- 02.10: партнёру — по блоку «SMS: Меняет»; владельцу — как раньше.
  if auth.uid() is null
     or not (
       (public.current_user_role() = 'owner' and coalesce(public.current_user_can_edit_client(p_client_id), false))
       or p_client_id = any(public.access_block_client_ids('clients.sms', 'write'))
     ) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  update public.clients
     set sms_opt_out = coalesce(p_value, false)
   where id = p_client_id and tenant_id = public.current_tenant_id();
  return coalesce(p_value, false);
end;
$function$
;
grant execute on function public.set_client_sms_opt_out(p_client_id uuid, p_value boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.set_client_team(p_client_id uuid, p_team_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant uuid := public.current_tenant_id();
  active_role text := public.current_user_role();
begin
  if auth.uid() is null or active_tenant is null or active_role is null then
    raise exception 'sign in to change a client'
      using errcode = '42501';
  end if;

  if p_team_id is null
     or not exists (
       select 1
         from public.teams team
        where team.tenant_id = active_tenant
          and team.id = p_team_id
     ) then
    raise exception 'client team does not belong to the active tenant'
      using errcode = '23503';
  end if;

  if public.current_user_can_edit_client(p_client_id) is not true then
    raise exception 'only an owner or an employee who can change this client can move it'
      using errcode = '42501', hint = 'block:clients';
  end if;

  -- Сотрудник переводит клиента только в команду, где ему можно менять
  -- клиентов: иначе он отдал бы клиента туда, где сам его больше не увидит.
  if active_role <> 'owner'
     and (p_team_id = any(public.access_calendars('clients', 'write'))) is not true then
    raise exception 'an employee can move a client only into a team where they change clients'
      using errcode = '42501', hint = 'block:clients';
  end if;

  update public.clients
     set team_id = p_team_id
   where id = p_client_id
     and tenant_id = active_tenant;
end;
$function$
;
grant execute on function public.set_client_team(p_client_id uuid, p_team_id text) to authenticated;

CREATE OR REPLACE FUNCTION public.set_default_company(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
begin
  if auth.uid() is null or tenant_uuid is null then
    raise exception 'Войдите в приложение';
  end if;
  if public.current_user_role() <> 'owner' then
    raise exception 'Основные реквизиты выбирает владелец';
  end if;
  if not exists (
    select 1 from public.legal_entities
     where id = p_company_id and tenant_id = tenant_uuid
  ) then
    raise exception 'Реквизиты не найдены';
  end if;

  update public.legal_entities
     set is_default = false
   where tenant_id = tenant_uuid and is_default and id <> p_company_id;
  update public.legal_entities
     set is_default = true
   where id = p_company_id;
end;
$function$
;
grant execute on function public.set_default_company(p_company_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.set_document_series_start(p_legal_entity_id uuid, p_doc_type text, p_year integer, p_next_number integer)
 RETURNS TABLE(seq integer, number text, can_set_start boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  entity public.legal_entities%rowtype;
begin
  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Нумерацию меняет только владелец'
      using errcode = '42501', hint = 'access:owner_only';
  end if;
  if p_doc_type is null or p_doc_type not in ('invoice', 'receipt', 'credit_note') then
    raise exception 'Неизвестный тип документа';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2999 then
    raise exception 'Некорректный год';
  end if;
  if p_next_number is null or p_next_number < 1 or p_next_number > 99999999 then
    raise exception 'Номер — целое число от 1 до 99999999';
  end if;
  select * into entity
    from public.legal_entities
   where id = p_legal_entity_id
     and tenant_id = tenant_uuid;
  if not found then
    raise exception 'Юрлицо не найдено в этой компании';
  end if;

  -- Строка серии — под замок раньше проверки: выпуск, идущий параллельно,
  -- либо уже виден, либо ждёт, пока старт запишется.
  insert into public.document_sequences (tenant_id, legal_entity_id, doc_type, year, last_number)
  values (tenant_uuid, entity.id, p_doc_type, p_year, 0)
  on conflict (tenant_id, legal_entity_id, doc_type, year) do nothing;
  perform 1
    from public.document_sequences series
   where series.tenant_id = tenant_uuid
     and series.legal_entity_id = entity.id
     and series.doc_type = p_doc_type
     and series.year = p_year
   for update;

  if p_next_number <= public.document_series_max_seq(tenant_uuid, entity.id, p_doc_type, p_year) then
    raise exception 'Номер % уже выдан — следующий может быть от %',
      p_next_number, public.document_series_max_seq(tenant_uuid, entity.id, p_doc_type, p_year) + 1;
  end if;

  update public.document_sequences series
     set last_number = p_next_number - 1,
         updated_at = now()
   where series.tenant_id = tenant_uuid
     and series.legal_entity_id = entity.id
     and series.doc_type = p_doc_type
     and series.year = p_year;

  return query
    select peek.seq, peek.number, peek.can_set_start
      from public.peek_document_number(entity.id, p_doc_type, p_year) peek;
end;
$function$
;
grant execute on function public.set_document_series_start(p_legal_entity_id uuid, p_doc_type text, p_year integer, p_next_number integer) to authenticated;

CREATE OR REPLACE FUNCTION public.set_event_template_created_by()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.set_member_access(p_user_id uuid, p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant uuid := public.access_writer_target(p_user_id);
  attached text[];
begin
  -- Все прикреплённые календари, архивные тоже: экран прав их показывает, и
  -- уровень там должен сниматься.
  select coalesce(array_agg(mc.team_id), array[]::text[])
    into attached
    from public.member_calendars mc
   where mc.tenant_id = active_tenant and mc.user_id = p_user_id;

  -- Та же проверка и тот же писатель, что у приглашения: права, выставленные
  -- в карточке до «Пригласить», и права, поправленные потом, — одно и то же.
  -- Неживые блоки больше не отказываются (владелец 15.09).
  perform public.access_validate_changes(active_tenant, attached, p_changes);
  -- Директор (04.10): ступени не выше своих, право «Партнёры» — владельцу.
  perform public.partners_check_caps(active_tenant, p_user_id, p_changes);
  perform public.access_apply_changes(active_tenant, p_user_id, p_changes, auth.uid());

  return public.access_map_for(active_tenant, p_user_id, true);
end;
$function$
;
grant execute on function public.set_member_access(p_user_id uuid, p_changes jsonb) to authenticated;
grant execute on function public.set_member_access(p_user_id uuid, p_changes jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.set_member_calendars(p_user_id uuid, p_team_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant uuid := public.access_writer_target(p_user_id);
  wanted text[] := coalesce(p_team_ids, array[]::text[]);
  stored text[];
  foreign_team text;
begin
  select w into foreign_team
    from unnest(wanted) as w
   where not exists (select 1 from public.teams t where t.tenant_id = active_tenant and t.id = w)
   limit 1;
  if foreign_team is not null then
    raise exception 'календарь % не из этой компании', foreign_team using errcode = '22023', hint = 'access:bad_team';
  end if;

  -- Директор добавляет и снимает только свои команды (04.10).
  select coalesce(array_agg(mc.team_id), array[]::text[])
    into stored
    from public.member_calendars mc
   where mc.tenant_id = active_tenant and mc.user_id = p_user_id;
  perform public.partners_check_teams(wanted, stored);

  delete from public.member_calendars mc
   where mc.tenant_id = active_tenant
     and mc.user_id = p_user_id
     and not (mc.team_id = any(wanted));

  insert into public.member_calendars (tenant_id, user_id, team_id, attached_by, attached_at)
  select distinct active_tenant, p_user_id, w, auth.uid(), now()
    from unnest(wanted) as w
  on conflict (tenant_id, user_id, team_id) do nothing;

  perform public.seed_records_level(active_tenant, p_user_id, auth.uid());

  return public.access_map_for(active_tenant, p_user_id, true);
end;
$function$
;
grant execute on function public.set_member_calendars(p_user_id uuid, p_team_ids text[]) to authenticated;
grant execute on function public.set_member_calendars(p_user_id uuid, p_team_ids text[]) to service_role;

CREATE OR REPLACE FUNCTION public.set_personal_event_type_created_by()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at = now();
  return new;
end $function$
;
grant execute on function public.set_updated_at() to anon;
grant execute on function public.set_updated_at() to authenticated;
grant execute on function public.set_updated_at() to service_role;

CREATE OR REPLACE FUNCTION public.settle_appointment_from_invoice_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  appt public.appointments%rowtype;
  room numeric;
  applied numeric;
  new_paid numeric;
  received numeric;
  is_refund boolean;
  -- Возврат: элемент исходного платежа в заявке и его зачёт до и после.
  entry_id text;
  entry_credit numeric := 0;
  entry_position bigint;
  income_net numeric := 0;
  credit_after numeric := 0;
begin
  -- Авто-строка — не платёж инвойса: её деньги в заявке держит сверка.
  -- `invoice_id` у авто-дохода — только привязка к бумаге, а у авто-возврата —
  -- наследство от такого дохода.
  if new.source = 'auto' then
    return new;
  end if;

  is_refund := new.type = 'refund' and new.invoice_id is not null
               and new.appointment_id is not null and new.amount < 0;
  if not is_refund and (
       new.type <> 'income'
       or new.invoice_id is null
       or new.appointment_id is null
       or new.amount <= 0
     ) then
    return new;
  end if;

  select * into appt
    from public.appointments
   where id = new.appointment_id and tenant_id = new.tenant_id
   for update;
  if not found then return new; end if;
  if appt.status = 'cancelled' or appt.payment_status = 'refunded' then
    return new;
  end if;

  if is_refund then
    -- ЗАЧЁТ ПОСЛЕ ВОЗВРАТА. Элемент `pay-inv-<исходный доход>` держит то, что
    -- доход зачёл в заявку. После возврата зачёт — меньшее из прежнего и
    -- чистой суммы дохода (эта строка возврата уже в журнале). Возврат той
    -- части, что в заявку не легла (налог «сверху», платёж без зачёта),
    -- заявку не трогает; элемент уходит только в ноль. Раньше элемент
    -- снимался целиком, а `paid_amount` падал на сумму возврата — зачёт
    -- расходился с заявкой, и её правки замерзали на сверке.
    entry_id := 'pay-inv-' || new.refund_of_id::text;
    select coalesce(sum(round((e.elem ->> 'amount')::numeric, 2)), 0),
           min(e.ord)
      into entry_credit, entry_position
      from jsonb_array_elements(coalesce(appt.payments, '[]'::jsonb))
        with ordinality as e(elem, ord)
     where e.elem ->> 'id' = entry_id;
    if entry_position is null then
      return new;
    end if;
    select income.amount - coalesce((
             select sum(abs(refund.amount))
               from public.finance_transactions refund
              where refund.refund_of_id = income.id
                and refund.type = 'refund'
           ), 0)
      into income_net
      from public.finance_transactions income
     where income.id = new.refund_of_id;
    credit_after := greatest(least(entry_credit, coalesce(income_net, 0)), 0);
    -- Не ниже нуля: часть могла быть погашена другим путём.
    applied := greatest(credit_after - entry_credit, -appt.paid_amount);
  else
    -- Больше остатка не зачисляем: инвойс может быть выставлен на часть
    -- работ или, наоборот, на несколько заявок.
    room := greatest(appt.total_amount - appt.prepaid_amount - appt.paid_amount, 0);
    if room <= 0 then return new; end if;
    applied := least(round(new.amount, 2), room);
  end if;
  if applied = 0 then return new; end if;

  new_paid := round(appt.paid_amount + applied, 2);
  received := appt.prepaid_amount + new_paid;

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (txid_current(), 'invoice_payment', appt.id, appt.tenant_id)
  on conflict do nothing;

  update public.appointments
     set paid_amount = new_paid,
         -- Способ появляется у заявки, только если его ещё не было: у
         -- предоплаты свой способ, и перебивать его платежом инвойса нельзя.
         payment_method = case
           when new_paid = 0 and prepaid_amount = 0 then null
           else coalesce(payment_method, new.payment_method)
         end,
         payment_status = case
           when received <= 0 then 'unpaid'
           when total_amount > 0 and received >= total_amount then 'paid'
           else 'partial'
         end,
         -- Витрина платежей карточки: без строки в леджере долг на экране
         -- не гаснет, сколько бы денег ни легло на счёт. Возврат МЕНЯЕТ свою
         -- строку до нового зачёта и снимает её только в ноль, а не
         -- добавляет отрицательную — иначе история платежей превращается в
         -- бухгалтерскую ленту.
         payments = case
           when is_refund then coalesce((
             select jsonb_agg(
                      case
                        when e.ord = entry_position
                          then jsonb_set(e.elem, '{amount}', to_jsonb(credit_after))
                        else e.elem
                      end
                      order by e.ord
                    )
               from jsonb_array_elements(coalesce(payments, '[]'::jsonb))
                 with ordinality as e(elem, ord)
              where e.elem ->> 'id' is distinct from entry_id
                 or (e.ord = entry_position and credit_after > 0)
           ), '[]'::jsonb)
           else coalesce(payments, '[]'::jsonb) || jsonb_build_array(
             jsonb_build_object(
               'id', 'pay-inv-' || new.id::text,
               'method', new.payment_method,
               'amount', applied,
               'paid_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               'account_id', new.account_id
             )
           )
         end
   where id = appt.id and tenant_id = appt.tenant_id;

  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'invoice_payment'
     and entity_id = appt.id;
  return new;
end;
$function$
;
grant execute on function public.settle_appointment_from_invoice_payment() to anon;
grant execute on function public.settle_appointment_from_invoice_payment() to authenticated;
grant execute on function public.settle_appointment_from_invoice_payment() to service_role;

CREATE OR REPLACE FUNCTION public.sms_account()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  is_owner boolean := public.current_user_role() = 'owner';
  cfg public.tenant_sms_config%rowtype;
  auto public.sms_autotopup%rowtype;
  price integer := public.sms_price_cents();
  frozen boolean;
  base jsonb;
  money jsonb;
  month_start timestamptz := date_trunc('month', now());
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms: no access' using errcode = '42501';
  end if;
  select * into cfg from public.tenant_sms_config where tenant_id = v_tenant;
  frozen := cfg.frozen_at is not null;
  base := jsonb_build_object(
    'service_on', public.sms_service_on(),
    'enabled', coalesce(cfg.enabled, false),
    'team_ids', to_jsonb(coalesce(cfg.team_ids, '{}'::text[])),
    'price_cents', price,
    'can_pay', coalesce(cfg.balance_cents, 0) >= price and not coalesce(frozen, false),
    'frozen', coalesce(frozen, false),
    'senders', coalesce((
      select jsonb_object_agg(s.team_id, s.sender_name)
        from public.sms_team_senders s where s.tenant_id = v_tenant
    ), '{}'::jsonb)
  );
  -- ДЕНЬГИ SMS — владельцу и партнёру с правом «SMS» (04.10).
  if not is_owner and public.access_company('cabinet.sms', 'read') is not true then
    return base;
  end if;
  money := jsonb_build_object(
    'balance_cents', coalesce(cfg.balance_cents, 0),
    'free_left', 0,
    'month', (
      select jsonb_build_object(
               'count', count(*) filter (where m.status in ('sending', 'sent', 'delivered')),
               'cents', coalesce(sum(m.cost_cents) filter (where m.status in ('sending', 'sent', 'delivered')), 0)
             )
        from public.sms_messages m
       where m.tenant_id = v_tenant and m.created_at >= month_start
    ),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
               'team_id', s.team_id,
               'count', s.sent,
               'segments', s.segments,
               'cents', s.cents,
               'delivered', s.delivered,
               'failed', s.failed
             ) order by s.team_id)
        from (
          select coalesce(m.team_id, '') as team_id,
                 count(*) filter (where m.status in ('sending', 'sent', 'delivered')) as sent,
                 coalesce(sum(m.segments) filter (where m.status in ('sending', 'sent', 'delivered')), 0) as segments,
                 coalesce(sum(m.cost_cents) filter (where m.status in ('sending', 'sent', 'delivered')), 0) as cents,
                 count(*) filter (where m.status = 'delivered') as delivered,
                 count(*) filter (where m.status in ('failed', 'undelivered', 'blocked')) as failed
            from public.sms_messages m
           where m.tenant_id = v_tenant and m.created_at >= month_start
           group by coalesce(m.team_id, '')
        ) s
    ), '[]'::jsonb),
    'template_counts', coalesce((
      select jsonb_object_agg(t.team_id, t.n)
        from (select team_id, count(*) as n from public.sms_team_templates
               where tenant_id = v_tenant group by team_id) t
    ), '{}'::jsonb)
  );
  -- Автопополнение (сохранённая карта владельца) и тревоги сверки — только
  -- владельцу.
  if not is_owner then
    return base || money;
  end if;
  select * into auto from public.sms_autotopup where tenant_id = v_tenant;
  return base || money || jsonb_build_object(
    'autotopup', jsonb_build_object(
      'enabled', coalesce(auto.enabled, false),
      'threshold_cents', coalesce(auto.threshold_cents, 500),
      'amount_cents', coalesce(auto.amount_cents, 2500),
      'card', auto.card_label,
      'error', auto.last_error
    ),
    'alerts', coalesce((
      select jsonb_agg(jsonb_build_object('kind', a.kind, 'message', a.message, 'at', a.created_at, 'own', a.tenant_id = v_tenant)
                       order by a.created_at desc)
        from public.sms_alerts a
       where a.resolved_at is null
         and (a.tenant_id = v_tenant or public.is_platform_admin())
    ), '[]'::jsonb)
  );
end;
$function$
;
grant execute on function public.sms_account() to authenticated;

CREATE OR REPLACE FUNCTION public.sms_alert(p_tenant uuid, p_kind text, p_message text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.sms_alerts (tenant_id, kind, message)
  values (p_tenant, p_kind, left(p_message, 500))
  on conflict (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), kind)
    where resolved_at is null
  do nothing;
$function$
;
grant execute on function public.sms_alert(p_tenant uuid, p_kind text, p_message text) to service_role;

CREATE OR REPLACE FUNCTION public.sms_appointment_end(p_appointment uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result timestamptz;
begin
  select (a.date || ' ' || left(coalesce(nullif(a.time_end, ''), a.time_start), 5))::timestamp
         at time zone public.sms_appointment_tz(a.id)
    into result
    from public.appointments a
   where a.id = p_appointment;
  return result;
exception when others then
  return null;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_appointment_link(p_appointment_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_team text;
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  select team_id into v_team from public.appointments
   where id = p_appointment_id and tenant_id = v_tenant and kind = 'work';
  if not found or not public.sms_can_see_team(v_team) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  -- Ссылка открывает без входа имя, адрес и услуги записи — сотруднику только
  -- там, где он сам видит клиента записи (защита базы 30.09).
  if public.current_user_role() is distinct from 'owner'
     and (v_team = any(public.access_calendars('record.client', 'read'))) is not true then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  -- Ссылка ещё и ОТМЕНЯЕТ запись без входа — сотруднику только с правом
  -- «Отменять и удалять записи» этого календаря (аудит 04.10).
  if public.current_user_role() is distinct from 'owner'
     and public.member_can('calendar.cancel', 'write', v_team) is not true then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  return public.appointment_link_url(p_appointment_id);
end;
$function$
;
grant execute on function public.sms_appointment_link(p_appointment_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.sms_appointment_start(p_appointment uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result timestamptz;
begin
  select (a.date || ' ' || left(a.time_start, 5))::timestamp at time zone coalesce(
           nullif(t.timezone, ''),
           nullif(cs.timezone, ''),
           'Europe/Nicosia'
         )
    into result
    from public.appointments a
    left join public.teams t on t.tenant_id = a.tenant_id and t.id = a.team_id
    left join public.calendar_settings cs on cs.tenant_id = a.tenant_id
   where a.id = p_appointment;
  return result;
exception when others then
  return null;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_appointment_tz(p_appointment uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(nullif(t.timezone, ''), nullif(cs.timezone, ''), 'Europe/Nicosia')
    from public.appointments a
    left join public.teams t on t.tenant_id = a.tenant_id and t.id = a.team_id
    left join public.calendar_settings cs on cs.tenant_id = a.tenant_id
   where a.id = p_appointment
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_autotopup_card(p_tenant uuid, p_session text, p_customer text, p_payment_method text, p_label text, p_threshold integer, p_amount integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_threshold integer := case when p_threshold in (500, 1000, 2500) then p_threshold else 500 end;
  v_amount integer := case when p_amount in (1000, 2500, 5000, 10000) then p_amount else 2500 end;
  a public.sms_autotopup%rowtype;
begin
  if p_tenant is null or nullif(p_session, '') is null or nullif(p_customer, '') is null
     or nullif(p_payment_method, '') is null then
    raise exception 'sms_autotopup_card: no card' using errcode = '22023';
  end if;
  select * into a from public.sms_autotopup where tenant_id = p_tenant for update;
  if not found then
    insert into public.sms_autotopup (
      tenant_id, enabled, threshold_cents, amount_cents, stripe_customer, payment_method, card_label, card_session
    ) values (
      p_tenant, true, v_threshold, v_amount, p_customer, p_payment_method, left(p_label, 60), p_session
    )
    on conflict (tenant_id) do nothing;
    return true;
  end if;
  if a.card_session = p_session then
    return false;
  end if;
  update public.sms_autotopup
     set enabled = true,
         threshold_cents = v_threshold,
         amount_cents = v_amount,
         stripe_customer = p_customer,
         payment_method = p_payment_method,
         card_label = left(p_label, 60),
         card_session = p_session,
         pending_key = case when pending_since > now() - interval '30 minutes' then pending_key end,
         pending_amount = case when pending_since > now() - interval '30 minutes' then pending_amount end,
         pending_since = case when pending_since > now() - interval '30 minutes' then pending_since end,
         last_error = null,
         last_error_at = null,
         updated_at = now()
   where tenant_id = p_tenant;
  return true;
end;
$function$
;
grant execute on function public.sms_autotopup_card(p_tenant uuid, p_session text, p_customer text, p_payment_method text, p_label text, p_threshold integer, p_amount integer) to service_role;

CREATE OR REPLACE FUNCTION public.sms_autotopup_claim()
 RETURNS TABLE(tenant_id uuid, customer text, payment_method text, amount_cents integer, idem_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  a public.sms_autotopup%rowtype;
  bal integer;
  frozen boolean;
begin
  for a in
    select * from public.sms_autotopup x where x.enabled for update skip locked
  loop
    select c.balance_cents, c.frozen_at is not null into bal, frozen
      from public.tenant_sms_config c where c.tenant_id = a.tenant_id;
    if not public.sms_autotopup_is_due(a, coalesce(bal, 0), coalesce(frozen, false)) then
      continue;
    end if;
    if a.pending_key is null then
      a.pending_key := gen_random_uuid()::text;
      a.pending_amount := a.amount_cents;
      a.day_count := case when a.day is distinct from current_date then 1 else a.day_count + 1 end;
      a.day := current_date;
    end if;
    update public.sms_autotopup x
       set pending_key = a.pending_key, pending_amount = a.pending_amount, pending_since = now(),
           day = a.day, day_count = a.day_count, updated_at = now()
     where x.tenant_id = a.tenant_id;
    tenant_id := a.tenant_id;
    customer := a.stripe_customer;
    payment_method := a.payment_method;
    amount_cents := coalesce(a.pending_amount, a.amount_cents);
    idem_key := 'sms-autotopup-' || a.pending_key;
    return next;
  end loop;
end;
$function$
;
grant execute on function public.sms_autotopup_claim() to service_role;

CREATE OR REPLACE FUNCTION public.sms_autotopup_customer(p_tenant uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select stripe_customer from public.sms_autotopup where tenant_id = p_tenant;
$function$
;
grant execute on function public.sms_autotopup_customer(p_tenant uuid) to service_role;

CREATE OR REPLACE FUNCTION public.sms_autotopup_forget()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  update public.sms_autotopup
     set enabled = false, payment_method = null, card_label = null,
         pending_key = null, pending_since = null, pending_amount = null, last_error = null, updated_at = now()
   where tenant_id = v_tenant;
  return public.sms_account();
end;
$function$
;
grant execute on function public.sms_autotopup_forget() to authenticated;

CREATE OR REPLACE FUNCTION public.sms_autotopup_is_due(a sms_autotopup, p_balance integer, p_frozen boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select a.enabled
     and a.payment_method is not null
     and a.stripe_customer is not null
     and not coalesce(p_frozen, false)
     and coalesce(p_balance, 0) < a.threshold_cents
     and coalesce(p_balance, 0) >= 0
     and (a.pending_since is null or a.pending_since < now() - interval '30 minutes')
     and (a.last_success_at is null or a.last_success_at < now() - interval '15 minutes')
     and (a.day is distinct from current_date or a.day_count < 3);
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_autotopup_poke(p_tenant uuid, p_balance integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (
    select 1 from public.sms_autotopup a
     where a.tenant_id = p_tenant and public.sms_autotopup_is_due(a, p_balance, false)
  ) then
    perform public.sms_autotopup_wake();
  end if;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_autotopup_result(p_tenant uuid, p_key text, p_ok boolean, p_error text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.sms_autotopup
     set pending_key = null,
         pending_since = null,
         pending_amount = null,
         last_success_at = case when p_ok then now() else last_success_at end,
         enabled = case when p_ok then enabled else false end,
         last_error = case when p_ok then null else left(coalesce(p_error, 'Банк отклонил списание'), 300) end,
         last_error_at = case when p_ok then last_error_at else now() end,
         updated_at = now()
   where tenant_id = p_tenant and 'sms-autotopup-' || pending_key = p_key;
end;
$function$
;
grant execute on function public.sms_autotopup_result(p_tenant uuid, p_key text, p_ok boolean, p_error text) to service_role;

CREATE OR REPLACE FUNCTION public.sms_autotopup_save(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  a public.sms_autotopup%rowtype;
  v_enabled boolean;
  v_threshold integer;
  v_amount integer;
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sms: bad settings' using errcode = '22023';
  end if;
  select * into a from public.sms_autotopup where tenant_id = v_tenant for update;
  v_enabled := coalesce(case when p ? 'enabled' then (p ->> 'enabled')::boolean end, a.enabled, false);
  v_threshold := coalesce(case when p ? 'threshold_cents' then (p ->> 'threshold_cents')::integer end, a.threshold_cents, 500);
  v_amount := coalesce(case when p ? 'amount_cents' then (p ->> 'amount_cents')::integer end, a.amount_cents, 2500);
  if v_threshold not in (500, 1000, 2500) or v_amount not in (1000, 2500, 5000, 10000) then
    raise exception 'sms:autotopup_amount' using errcode = '22023';
  end if;
  if v_enabled and (a.payment_method is null or a.stripe_customer is null) then
    raise exception 'sms:autotopup_card' using errcode = 'P0001';
  end if;
  if a.tenant_id is null then
    insert into public.sms_autotopup (tenant_id, enabled, threshold_cents, amount_cents)
    values (v_tenant, false, v_threshold, v_amount)
    on conflict (tenant_id) do nothing;
  else
    update public.sms_autotopup
       set enabled = v_enabled,
           threshold_cents = v_threshold,
           amount_cents = v_amount,
           last_error = case when v_enabled then null else last_error end,
           updated_at = now()
     where tenant_id = v_tenant;
  end if;
  if v_enabled then
    perform public.sms_autotopup_poke(v_tenant, (select balance_cents from public.tenant_sms_config where tenant_id = v_tenant));
  end if;
  return public.sms_account();
end;
$function$
;
grant execute on function public.sms_autotopup_save(p jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.sms_autotopup_wake()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform net.http_post(
    url := 'https://rdtokosbqvgemicqeqwz.supabase.co/functions/v1/sms-autotopup',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select secret from public.edge_cron_secrets where name = 'sms-autotopup')
    )
  );
exception when others then
  raise warning 'sms_autotopup_wake: %', sqlerrm;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_balance_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(current_setting('babun.sms_ledger', true), '') <> 'on' then
    if tg_op = 'INSERT' and coalesce(new.balance_cents, 0) <> 0 then
      raise exception 'sms: баланс меняется только журналом (sms_ledger_post)' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.balance_cents is distinct from old.balance_cents then
      raise exception 'sms: баланс меняется только журналом (sms_ledger_post)' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_can_see_team(p_team text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.current_user_role() = 'owner'
      or (p_team is not null and (
            p_team = any(public.current_user_calendar_ids('view'))
            or p_team = any(public.current_user_team_ids())
          ))
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_charge(p_id uuid, p_body text, p_segments integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m public.sms_messages%rowtype;
  cfg public.tenant_sms_config%rowtype;
  segs integer := greatest(1, coalesce(p_segments, 1));
  cost integer;
  v_after integer;
  v_opt_out boolean;
  v_black boolean;
  v_deleted boolean;
begin
  select * into m from public.sms_messages where id = p_id for update;
  if not found or m.status <> 'sending' then
    return 'gone';
  end if;

  -- КАЛЕНДАРЬ В АРХИВЕ (04.10): сообщения, поставленные до архива, не уходят
  -- — ни SMS, ни денег. Тот же канал «заблокировано», что ниже.
  if m.team_id is not null and not exists (
    select 1 from public.teams t
     where t.id = m.team_id and t.tenant_id = m.tenant_id and t.is_active
  ) then
    update public.sms_messages
       set status = 'blocked', message_body = p_body, segments = segs,
           error_code = 'team_archived', error_message = 'Календарь в архиве'
     where id = p_id;
    return 'no_funds';
  end if;

  -- КЛИЕНТ ОТКАЗАЛСЯ, ПОКА СООБЩЕНИЕ ЖДАЛО ОЧЕРЕДИ (03.10). Отказ от SMS,
  -- чёрный список и удаление `sms_enqueue` проверяет только при постановке, а
  -- отложенное сообщение («После визита» +N ч, сдвиг в окно 8–21) лежит в
  -- очереди часами. Решение — здесь, под замком строки, перед списанием и
  -- отправкой: ни денег, ни SMS. Без клиента (проверка своего номера) — мимо.
  select c.sms_opt_out, c.blacklisted, c.deleted_at is not null
    into v_opt_out, v_black, v_deleted
    from public.clients c
   where c.id = coalesce(
           m.client_id,
           (select a.client_id from public.appointments a where a.id = m.appointment_id)
         );
  if coalesce(v_opt_out, false) or coalesce(v_black, false) or coalesce(v_deleted, false) then
    update public.sms_messages
       set status = 'blocked', message_body = p_body,
           segments = segs,
           error_code = 'opt_out',
           error_message = case
             when v_deleted then 'Клиент удалён'
             when v_black then 'Клиент в чёрном списке'
             else 'Клиент просил не писать'
           end
     where id = p_id;
    return 'no_funds';
  end if;
  select * into cfg from public.tenant_sms_config where tenant_id = m.tenant_id for update;
  if not found then
    update public.sms_messages
       set status = 'blocked', message_body = p_body, segments = segs,
           error_code = 'no_config', error_message = 'SMS у компании не настроены'
     where id = p_id;
    return 'no_funds';
  end if;
  if cfg.frozen_at is not null then
    update public.sms_messages
       set status = 'blocked', message_body = p_body, segments = segs,
           error_code = 'frozen', error_message = 'Отправка SMS остановлена — проверяем баланс'
     where id = p_id;
    return 'no_funds';
  end if;
  if not public.sms_phone_allowed(m.to_phone) then
    update public.sms_messages
       set status = 'blocked', message_body = p_body, segments = segs,
           error_code = 'country', error_message = 'Страна номера не разрешена для SMS'
     where id = p_id;
    return 'no_funds';
  end if;
  segs := greatest(segs, public.sms_min_segments(p_body));
  cost := segs * public.sms_price_cents();
  if cfg.balance_cents < cost then
    update public.sms_messages
       set status = 'blocked', message_body = p_body, segments = segs,
           error_code = 'no_funds', error_message = 'Не хватило баланса'
     where id = p_id;
    return 'no_funds';
  end if;
  v_after := public.sms_ledger_post(m.tenant_id, 'send', -cost, m.id::text, null);
  if v_after is null then
    return 'gone';
  end if;
  update public.sms_messages
     set message_body = p_body, segments = segs, cost_cents = cost, was_free = false
   where id = p_id;
  update public.tenant_sms_config
     set total_sent_count = total_sent_count + 1
   where tenant_id = m.tenant_id;
  perform public.sms_autotopup_poke(m.tenant_id, v_after);
  return 'paid';
end;
$function$
;
grant execute on function public.sms_charge(p_id uuid, p_body text, p_segments integer) to service_role;

CREATE OR REPLACE FUNCTION public.sms_claim(p_limit integer DEFAULT 20)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cap_platform integer := coalesce(
    (select nullif(value, '')::integer from public.app_settings where key = 'sms_hourly_cap'), 2000);
  cap_tenant integer := coalesce(
    (select nullif(value, '')::integer from public.app_settings where key = 'sms_tenant_hourly_cap'), 1000);
begin
  if (select count(*) from public.sms_ledger
       where kind = 'send' and created_at > now() - interval '1 hour') >= cap_platform then
    perform public.sms_alert(null, 'platform_cap',
      format('За час ушло %s SMS — отправка всей платформы на паузе', cap_platform));
    return;
  end if;
  update public.sms_alerts set resolved_at = now()
   where tenant_id is null and kind = 'platform_cap' and resolved_at is null;
  return query
  with picked as (
    select m.id
      from public.sms_messages m
     where m.status = 'queued'
       and (m.send_after is null or m.send_after <= now())
       and not exists (
         select 1 from public.tenant_sms_config f
          where f.tenant_id = m.tenant_id and f.frozen_at is not null
       )
       and (
         select count(*) from public.sms_ledger l
          where l.tenant_id = m.tenant_id and l.kind = 'send'
            and l.created_at > now() - interval '1 hour'
       ) < cap_tenant
     order by coalesce(m.send_after, m.created_at)
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 20), 100))
  ), claimed as (
    update public.sms_messages m
       set status = 'sending', claimed_at = now()
      from picked
     where m.id = picked.id
    returning m.*
  ), texts as (
    select c.*,
           coalesce(c.template_body, (
             select tpl ->> 'body'
               from public.tenant_state ts,
                    jsonb_array_elements(coalesce(ts.prototype_state -> 'smsTemplates', '[]'::jsonb)) tpl
              where ts.tenant_id = c.tenant_id and tpl ->> 'id' = c.template_id
              limit 1
           )) as tpl_text
      from claimed c
  )
  select jsonb_build_object(
    'id', c.id,
    'tenant_id', c.tenant_id,
    'to_phone', c.to_phone,
    'body', c.message_body,
    'trigger_type', c.trigger_type,
    'template_body', c.tpl_text,
    'sender', public.sms_team_sender(c.tenant_id, coalesce(a.team_id, c.team_id)),
    'vars', jsonb_build_object(
      'name', coalesce(nullif(trim(cl.sms_name), ''), split_part(trim(coalesce(cl.full_name, '')), ' ', 1)),
      'date', a.date,
      'time', a.time_start,
      'calendar', t.name,
      'services', coalesce((
        select jsonb_agg(line ->> 'serviceName')
          from jsonb_array_elements(case when jsonb_typeof(a.services) = 'array' then a.services else '[]'::jsonb end) line
      ), '[]'::jsonb),
      'address', a.address,
      'total', a.total_amount,
      'company', tn.name,
      'currency', tn.currency,
      'link', case
        when c.appointment_id is not null and coalesce(c.tpl_text, '') ~ '\[(Ссылка|Link)\]'
          then public.appointment_link_url(c.appointment_id)
      end
    )
  )
    from texts c
    left join public.appointments a on a.id = c.appointment_id
    left join public.clients cl on cl.id = c.client_id
    left join public.teams t on t.tenant_id = c.tenant_id and t.id = coalesce(a.team_id, c.team_id)
    left join public.tenants tn on tn.id = c.tenant_id;
end;
$function$
;
grant execute on function public.sms_claim(p_limit integer) to service_role;

CREATE OR REPLACE FUNCTION public.sms_client_owns_phone(p_client uuid, p_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with c as (select * from public.clients where id = p_client),
  nums as (
    select regexp_replace(coalesce(n, ''), '\D', '', 'g') as d
      from c, lateral (
        select c.phone union all select c.phone_e164 union all select c.whatsapp_phone
        union all
        select x ->> 'number'
          from jsonb_array_elements(case when jsonb_typeof(c.phones) = 'array' then c.phones else '[]'::jsonb end) x
      ) s(n)
  ),
  want as (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d)
  select exists (
    select 1 from nums, want
     where length(nums.d) >= 6 and length(want.d) >= 6
       and (want.d = nums.d or want.d like '%' || nums.d or nums.d like '%' || want.d)
  )
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_credit_topup(p_tenant uuid, p_amount_cents integer, p_session text, p_payment_intent text, p_pack text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  inserted uuid;
  min_cents integer := coalesce((select value::integer from public.app_settings where key = 'sms_topup_min_cents'), 500);
  max_cents integer := coalesce((select value::integer from public.app_settings where key = 'sms_topup_max_cents'), 50000);
begin
  if p_amount_cents is null or p_amount_cents <= 0 or p_payment_intent is null then
    raise exception 'sms_credit_topup: bad payment' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'sms_credit_topup: no tenant' using errcode = '22023';
  end if;
  if p_amount_cents < min_cents or p_amount_cents > max_cents or p_amount_cents % 100 <> 0 then
    perform public.sms_alert(p_tenant, 'topup_amount',
      format('Оплата %s на %s ц. — вне пределов пополнения, не зачислена', p_payment_intent, p_amount_cents));
    return false;
  end if;
  insert into public.sms_topups (
    tenant_id, amount_cents, credits_added, pack_label,
    stripe_session_id, stripe_payment_intent_id, status, completed_at
  ) values (
    p_tenant, p_amount_cents, p_amount_cents / greatest(1, public.sms_price_cents()), p_pack,
    p_session, p_payment_intent, 'completed', now()
  )
  on conflict (stripe_payment_intent_id) do nothing
  returning id into inserted;
  if inserted is null then
    return false;
  end if;
  perform public.sms_ledger_post(p_tenant, 'topup', p_amount_cents, p_payment_intent, p_pack);
  return true;
end;
$function$
;
grant execute on function public.sms_credit_topup(p_tenant uuid, p_amount_cents integer, p_session text, p_payment_intent text, p_pack text) to service_role;

CREATE OR REPLACE FUNCTION public.sms_delete_team_template(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms: owner only' using errcode = '42501';
  end if;
  delete from public.sms_messages
   where tenant_id = v_tenant and template_id = p_id::text and status = 'queued';
  delete from public.sms_team_templates where id = p_id and tenant_id = v_tenant;
  return found;
end;
$function$
;
grant execute on function public.sms_delete_team_template(p_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.sms_enqueue(p_appointment uuid, p_template uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a record;
  tpl public.sms_team_templates%rowtype;
  c record;
  phone text;
  start_at timestamptz;
  send_at timestamptz;
  inserted uuid;
begin
  if not public.sms_service_on() then
    return false;
  end if;
  select ap.id, ap.tenant_id, ap.client_id, ap.team_id, ap.kind
    into a
    from public.appointments ap
   where ap.id = p_appointment;
  if not found or a.kind <> 'work' or a.client_id is null or a.team_id is null then
    return false;
  end if;
  -- Календарь в архиве клиентам не пишет (аудит 04.10).
  if not exists (
    select 1 from public.teams t
     where t.id = a.team_id and t.tenant_id = a.tenant_id and t.is_active
  ) then
    return false;
  end if;
  select * into tpl from public.sms_team_templates
   where id = p_template and tenant_id = a.tenant_id and team_id = a.team_id and enabled;
  if not found or tpl.trigger = 'manual' then
    return false;
  end if;
  -- Имя отправителя и есть выключатель команды (волна 11).
  if public.sms_team_sender(a.tenant_id, a.team_id) is null then
    return false;
  end if;

  start_at := public.sms_appointment_start(a.id);
  if start_at is null then
    return false;
  end if;
  -- Окно шаблона «с send_from до send_to»: вне окна — ждать его начала
  -- (`sms_quiet_shift` считает «нельзя» от конца окна до начала). «Накануне
  -- в ЧЧ:ММ» уходит ровно в своё время — окно у него не действует.
  send_at := greatest(coalesce(p_at, now()), now());
  if tpl.trigger <> 'day_before' then
    send_at := public.sms_quiet_shift(send_at, public.sms_appointment_tz(a.id), tpl.send_to, tpl.send_from);
  end if;
  -- До визита — только пока визит впереди: запись задним числом и отмена
  -- вчерашней — не повод писать клиенту, как и сообщение, которое окно
  -- отодвинуло за начало.
  if tpl.trigger in ('created', 'before', 'day_before', 'rescheduled', 'cancelled') and send_at >= start_at then
    return false;
  end if;

  select cl.phone, cl.phone_e164, cl.sms_opt_out, cl.blacklisted, cl.deleted_at
    into c
    from public.clients cl
   where cl.id = a.client_id and cl.tenant_id = a.tenant_id;
  if not found or c.deleted_at is not null or c.sms_opt_out or coalesce(c.blacklisted, false) then
    return false;
  end if;
  phone := coalesce(nullif(trim(c.phone_e164), ''), nullif(trim(c.phone), ''));
  if phone is null then
    return false;
  end if;

  insert into public.sms_messages (
    tenant_id, appointment_id, client_id, team_id, to_phone,
    trigger_type, template_id, template_body, for_start, send_after, status, mode
  ) values (
    a.tenant_id, a.id, a.client_id, a.team_id, phone,
    public.sms_trigger_kind(tpl.trigger), tpl.id::text, tpl.body, start_at,
    case when send_at > now() then send_at end,
    'queued', 'platform'
  )
  on conflict (appointment_id, template_id, for_start)
    where appointment_id is not null and template_id is not null
      and trigger_type not in ('manual', 'reschedule')
    do nothing
  returning id into inserted;
  return inserted is not null;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_enqueue_due()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  start_at timestamptz;
  moment timestamptz;
  tz text;
  n integer := 0;
begin
  if not public.sms_service_on() then
    return 0;
  end if;

  -- «ЗА N ЧАСОВ» и «НАКАНУНЕ В ЧЧ:ММ». Момент отправки: начало минус N
  -- часов / накануне в ЧЧ:ММ по времени календаря. Запись (или перенос)
  -- должна быть заведена ДО момента — иначе её закрывает подтверждение.
  -- Проспали момент больше чем на 3 часа (сервис был выключен, шаблон
  -- завели поздно) — не шлём: «напоминание» в полночь хуже, чем никакого.
  -- Команды — только с именем отправителя (волна 11).
  for r in
    select a.id, a.created_at, a.date, tpl.id as tpl_id, tpl.trigger, tpl.hours, tpl.at_time
      from public.sms_team_senders snd
      join public.sms_team_templates tpl
        on tpl.tenant_id = snd.tenant_id and tpl.team_id = snd.team_id and tpl.enabled
       and tpl.trigger in ('before', 'day_before')
      join public.appointments a
        on a.tenant_id = snd.tenant_id
       and a.team_id = snd.team_id
       and a.kind = 'work'
       and a.status = 'scheduled'
       and a.client_id is not null
       and a.date between to_char(now() - interval '1 day', 'YYYY-MM-DD')
                      and to_char(now() + interval '8 days', 'YYYY-MM-DD')
  loop
    start_at := public.sms_appointment_start(r.id);
    continue when start_at is null or start_at <= now();
    if r.trigger = 'before' then
      moment := start_at - make_interval(hours => r.hours);
    else
      tz := public.sms_appointment_tz(r.id);
      begin
        moment := ((r.date::date - 1)::text || ' ' || r.at_time)::timestamp at time zone tz;
      exception when others then
        continue;
      end;
    end if;
    continue when now() < moment
      or now() > moment + interval '3 hours'
      or r.created_at > moment;
    continue when exists (
      select 1 from public.sms_messages m
       where m.appointment_id = r.id
         and (
           (m.template_id = r.tpl_id::text and m.for_start = start_at)
           or (m.trigger_type in ('new_appointment', 'reschedule') and m.created_at > moment)
         )
    );
    if public.sms_enqueue(r.id, r.tpl_id) then
      n := n + 1;
    end if;
  end loop;

  -- «ПОРА ПОВТОРИТЬ»: последний выполненный визит клиента был N месяцев
  -- назад (окно — неделя, чтобы старая история не ушла разом), будущей
  -- записи нет.
  for r in
    select a.id, a.date, tpl.id as tpl_id, tpl.months
      from public.sms_team_senders snd
      join public.sms_team_templates tpl
        on tpl.tenant_id = snd.tenant_id and tpl.team_id = snd.team_id and tpl.enabled and tpl.trigger = 'repeat'
      join public.appointments a
        on a.tenant_id = snd.tenant_id
       and a.team_id = snd.team_id
       and a.kind = 'work'
       and a.status = 'completed'
       and a.client_id is not null
       and a.date between to_char(now() - interval '25 months', 'YYYY-MM-DD')
                      and to_char(now() - interval '1 month', 'YYYY-MM-DD')
     where not exists (
         select 1 from public.sms_messages m
          where m.appointment_id = a.id and m.template_id = tpl.id::text
       )
       and not exists (
         select 1 from public.appointments later
          where later.tenant_id = a.tenant_id and later.client_id = a.client_id
            and later.kind = 'work' and later.id <> a.id
            and (
              (later.status = 'completed' and later.date > a.date)
              or (later.status in ('scheduled', 'in_progress') and later.date >= to_char(now(), 'YYYY-MM-DD'))
            )
       )
  loop
    continue when not (
      r.date::date + make_interval(months => r.months) <= current_date
      and r.date::date + make_interval(months => r.months) > current_date - 7
    );
    if public.sms_enqueue(r.id, r.tpl_id) then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_enqueue_trigger(p_appointment uuid, p_trigger text, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t record;
  queued boolean := false;
begin
  for t in
    select tpl.id
      from public.appointments a
      join public.sms_team_templates tpl
        on tpl.tenant_id = a.tenant_id and tpl.team_id = a.team_id
       and tpl.enabled and tpl.trigger = p_trigger
     where a.id = p_appointment
     order by tpl.position, tpl.created_at
  loop
    if public.sms_enqueue(p_appointment, t.id, p_at) then
      queued := true;
    end if;
  end loop;
  return queued;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_for_appointment(p_appointment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  is_owner boolean := public.current_user_role() = 'owner';
  a record;
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  select ap.id, ap.team_id into a
    from public.appointments ap
   where ap.id = p_appointment_id and ap.tenant_id = v_tenant;
  if not found or not public.sms_can_see_team(a.team_id) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  -- ТЕКСТЫ SMS — О КЛИЕНТЕ ЗАПИСИ (аудит 03.10): имя, дата, адрес и ответ
  -- клиента. Не владельцу — только с «Записями клиентов» и «Клиентом в
  -- записи» на команду записи, а не по одному прикреплению к команде.
  if not is_owner and not (
       a.team_id = any(public.access_calendars('calendar.records', 'read'))
       and a.team_id = any(public.access_calendars('record.client', 'read'))
       -- «SMS» записи — своё право (03.10).
       and a.team_id = any(public.access_calendars('record.sms', 'read'))
     ) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'templates', coalesce((
      select jsonb_agg(public.sms_team_template_json(t) order by t.position, t.created_at)
        from public.sms_team_templates t
       where t.tenant_id = v_tenant and t.team_id = a.team_id and t.enabled
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(public.sms_message_json(m, is_owner) order by m.created_at desc)
        from public.sms_messages m
       where m.tenant_id = v_tenant and m.appointment_id = a.id
    ), '[]'::jsonb),
    'client_answer', (select l.answer from public.appointment_links l where l.appointment_id = a.id),
    'client_answered_at', (select l.answered_at from public.appointment_links l where l.appointment_id = a.id)
  );
end;
$function$
;
grant execute on function public.sms_for_appointment(p_appointment_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.sms_for_client(p_client_id uuid, p_limit integer DEFAULT 50)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  is_owner boolean := public.current_user_role() = 'owner';
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  -- Сотрудник — только о клиенте, у которого видит блок «SMS» (02.10).
  if not is_owner and not (p_client_id = any(public.access_block_client_ids('clients.sms', 'read'))) then
    return;
  end if;
  return query
  select public.sms_message_json(m, is_owner)
    from public.sms_messages m
   where m.tenant_id = v_tenant
     and m.client_id = p_client_id
     and (is_owner or (m.team_id is not null and public.sms_can_see_team(m.team_id)))
   order by m.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$function$
;
grant execute on function public.sms_for_client(p_client_id uuid, p_limit integer) to authenticated;

CREATE OR REPLACE FUNCTION public.sms_frozen(p_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.tenant_sms_config where tenant_id = p_tenant and frozen_at is not null
  );
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_history(p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50, p_team_id text DEFAULT NULL::text, p_trigger text DEFAULT NULL::text)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', m.id,
    'created_at', m.created_at,
    'send_after', m.send_after,
    'to_phone', m.to_phone,
    'client_id', m.client_id,
    'client_name', cl.full_name,
    'appointment_id', m.appointment_id,
    'team_id', m.team_id,
    'body', m.message_body,
    'template_body', m.template_body,
    'template_name', tpl.name,
    'status', m.status,
    'trigger', m.trigger_type,
    'segments', m.segments,
    'cost_cents', m.cost_cents,
    'was_free', m.was_free,
    'error', m.error_message
  )
    from public.sms_messages m
    left join public.clients cl on cl.id = m.client_id
    left join public.sms_team_templates tpl on tpl.id::text = m.template_id
   where public.current_user_role() = 'owner'
     and m.tenant_id = public.current_tenant_id()
     and (p_before is null or m.created_at < p_before)
     and (p_team_id is null or m.team_id = p_team_id)
     and (p_trigger is null or m.trigger_type = p_trigger)
   order by m.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200))
$function$
;
grant execute on function public.sms_history(p_before timestamp with time zone, p_limit integer, p_team_id text, p_trigger text) to authenticated;

CREATE OR REPLACE FUNCTION public.sms_ledger_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  raise exception 'sms_ledger: журнал только дописывается' using errcode = '42501';
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_ledger_no_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if pg_trigger_depth() <= 1 then
    raise exception 'sms_ledger: журнал не стирается' using errcode = '42501';
  end if;
  return old;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_ledger_post(p_tenant uuid, p_kind text, p_amount integer, p_ref text, p_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_balance integer;
begin
  if p_tenant is null or p_amount is null or p_amount = 0 then
    raise exception 'sms_ledger_post: пустая операция' using errcode = '22023';
  end if;
  insert into public.tenant_sms_config (tenant_id) values (p_tenant)
  on conflict (tenant_id) do nothing;
  select balance_cents into v_balance
    from public.tenant_sms_config where tenant_id = p_tenant for update;
  if p_ref is not null and exists (
    select 1 from public.sms_ledger where kind = p_kind and ref = p_ref
  ) then
    return null;
  end if;
  v_balance := v_balance + p_amount;
  perform set_config('babun.sms_ledger', 'on', true);
  update public.tenant_sms_config
     set balance_cents = v_balance, updated_at = now()
   where tenant_id = p_tenant;
  perform set_config('babun.sms_ledger', 'off', true);
  insert into public.sms_ledger (tenant_id, kind, amount_cents, balance_after, ref, note)
  values (p_tenant, p_kind, p_amount, v_balance, p_ref, left(p_note, 200));
  return v_balance;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_mark(p_id uuid, p_status text, p_sid text, p_error_code text, p_error_message text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m public.sms_messages%rowtype;
  paid integer;
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'sms_mark: bad status %', p_status using errcode = '22023';
  end if;
  select * into m from public.sms_messages where id = p_id for update;
  if not found or m.status <> 'sending' then
    return;
  end if;
  if p_status = 'sent' then
    update public.sms_messages
       set status = 'sent', twilio_sid = nullif(p_sid, ''), error_code = null, error_message = null
     where id = p_id;
    return;
  end if;
  update public.sms_messages
     set status = 'failed', error_code = p_error_code, error_message = left(p_error_message, 500)
   where id = p_id;
  select -amount_cents into paid from public.sms_ledger where kind = 'send' and ref = m.id::text;
  if coalesce(paid, 0) > 0 then
    perform public.sms_ledger_post(m.tenant_id, 'send_refund', paid, m.id::text, left(coalesce(p_error_code, ''), 100));
    update public.tenant_sms_config
       set total_sent_count = greatest(0, total_sent_count - 1), updated_at = now()
     where tenant_id = m.tenant_id;
    update public.sms_messages set cost_cents = 0 where id = p_id;
  end if;
end;
$function$
;
grant execute on function public.sms_mark(p_id uuid, p_status text, p_sid text, p_error_code text, p_error_message text) to service_role;

CREATE OR REPLACE FUNCTION public.sms_message_json(m sms_messages, p_owner boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', m.id,
    'created_at', m.created_at,
    'send_after', m.send_after,
    'status', m.status,
    'trigger', m.trigger_type,
    'appointment_id', m.appointment_id,
    'team_id', m.team_id,
    -- Кому ушло: SMS закреплены за клиентом (03.10).
    'client_id', m.client_id,
    -- Номер получателя — только владельцу (защита базы 30.09): история SMS
    -- иначе вытягивала бы номера мимо двери «номер по одному».
    'to_phone', case when p_owner then m.to_phone else '' end,
    'body', m.message_body,
    'template_body', m.template_body,
    -- Шаблон, по которому ушло, — именем; удалён — пусто.
    'template_name', (
      select t.name from public.sms_team_templates t
       where t.tenant_id = m.tenant_id and t.id::text = m.template_id
    ),
    'segments', m.segments,
    'error', m.error_message,
    'cost_cents', case when p_owner then m.cost_cents else 0 end,
    'was_free', case when p_owner then m.was_free else false end
  )
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_messages_tier_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.tenant_effective_plan(new.tenant_id) is distinct from 'free' then
    return new;
  end if;
  if auth.uid() is not null then
    raise exception 'SMS — в тарифах Соло, Про и Макс'
      using errcode = 'P0001', hint = 'plan:sms';
  end if;
  -- Автоматическое без тарифа — не ставим в очередь.
  return null;
end;
$function$
;
grant execute on function public.sms_messages_tier_guard() to authenticated;

CREATE OR REPLACE FUNCTION public.sms_min_segments(p_body text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  astral integer := char_length(regexp_replace(coalesce(p_body, ''), '[^\U00010000-\U0010FFFF]', '', 'g'));
  units integer;
begin
  if astral = 0 then
    return 1;
  end if;
  units := char_length(p_body) + astral;
  return case when units <= 70 then 1 else ceil(units / 67.0)::integer end;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_phone_allowed(p_phone text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  prefixes text[];
begin
  if n like '00%' then
    n := '+' || substr(n, 3);
  end if;
  if n not like '+%' then
    return true;
  end if;
  select coalesce(array_agg(trim(x)), '{}') into prefixes
    from unnest(string_to_array(coalesce(
      (select value from public.app_settings where key = 'sms_allowed_prefixes'), '+357'), ',')) x
   where trim(x) <> '';
  return exists (select 1 from unnest(prefixes) p where n like p || '%');
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_price_cents()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select nullif(value, '')::integer from public.app_settings where key = 'sms_price_cents_per_segment'),
    10
  )
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_quiet_shift(p_at timestamp with time zone, p_tz text, p_from integer, p_to integer)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  tz text := coalesce(nullif(p_tz, ''), 'Europe/Nicosia');
  local_ts timestamp;
  h integer;
  quiet boolean;
  morning timestamp;
begin
  if p_from is null or p_to is null or p_from = p_to then
    return p_at;
  end if;
  begin
    local_ts := p_at at time zone tz;
  exception when others then
    tz := 'Europe/Nicosia';
    local_ts := p_at at time zone tz;
  end;
  h := extract(hour from local_ts);
  quiet := case when p_from > p_to then h >= p_from or h < p_to
                else h >= p_from and h < p_to end;
  if not quiet then
    return p_at;
  end if;
  morning := date_trunc('day', local_ts) + make_interval(hours => p_to);
  if morning <= local_ts then
    morning := morning + interval '1 day';
  end if;
  return morning at time zone tz;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_reconcile()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  n integer := 0;
begin
  for r in
    select c.tenant_id, c.balance_cents,
           coalesce((select sum(l.amount_cents) from public.sms_ledger l where l.tenant_id = c.tenant_id), 0) as ledger_sum
      from public.tenant_sms_config c
  loop
    if r.balance_cents <> r.ledger_sum then
      n := n + 1;
      update public.tenant_sms_config
         set frozen_at = coalesce(frozen_at, now()), frozen_reason = 'ledger_mismatch'
       where tenant_id = r.tenant_id;
      perform public.sms_alert(r.tenant_id, 'ledger_mismatch',
        format('Баланс %s ц. не равен журналу %s ц. — отправка остановлена', r.balance_cents, r.ledger_sum));
    end if;
  end loop;
  for r in
    select t.tenant_id, t.stripe_payment_intent_id
      from public.sms_topups t
     where t.status in ('completed', 'refunded')
       and not exists (select 1 from public.sms_ledger l where l.kind = 'topup' and l.ref = t.stripe_payment_intent_id)
  loop
    n := n + 1;
    update public.tenant_sms_config
       set frozen_at = coalesce(frozen_at, now()), frozen_reason = 'topup_missing'
     where tenant_id = r.tenant_id;
    perform public.sms_alert(r.tenant_id, 'topup_missing',
      format('Оплата %s не в журнале — отправка остановлена', r.stripe_payment_intent_id));
  end loop;
  for r in
    select m.tenant_id, m.id, m.cost_cents, coalesce(l.net, 0) as net
      from public.sms_messages m
      left join (
        select ref, sum(amount_cents) as net
          from public.sms_ledger
         where kind in ('send', 'send_refund')
         group by ref
      ) l on l.ref = m.id::text
     where m.created_at > now() - interval '60 days'
       and coalesce(l.net, 0) <> -coalesce(m.cost_cents, 0)
  loop
    n := n + 1;
    update public.tenant_sms_config
       set frozen_at = coalesce(frozen_at, now()), frozen_reason = 'send_mismatch'
     where tenant_id = r.tenant_id;
    perform public.sms_alert(r.tenant_id, 'send_mismatch',
      format('SMS %s: списано %s ц., журнал %s ц. — отправка остановлена', r.id, r.cost_cents, -r.net));
  end loop;
  return n;
end;
$function$
;
grant execute on function public.sms_reconcile() to service_role;

CREATE OR REPLACE FUNCTION public.sms_refund_failed_after_sent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  paid integer;
begin
  if old.status = 'sent' and new.status = 'failed' then
    select -amount_cents into paid from public.sms_ledger where kind = 'send' and ref = new.id::text;
    if coalesce(paid, 0) > 0 then
      perform public.sms_ledger_post(new.tenant_id, 'send_refund', paid, new.id::text, 'Twilio: не отправлено');
      new.cost_cents := 0;
    end if;
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_reorder_team_templates(p_team_id text, p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms: owner only' using errcode = '42501';
  end if;
  update public.sms_team_templates t
     set position = o.ord - 1, updated_at = now()
    from unnest(p_ids) with ordinality as o(id, ord)
   where t.id = o.id and t.tenant_id = v_tenant and t.team_id = p_team_id;
end;
$function$
;
grant execute on function public.sms_reorder_team_templates(p_team_id text, p_ids uuid[]) to authenticated;

CREATE OR REPLACE FUNCTION public.sms_save_settings(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  teams text[];
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms: owner only' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sms: bad settings' using errcode = '22023';
  end if;
  if p ? 'team_ids' then
    if jsonb_typeof(p -> 'team_ids') <> 'array' then
      raise exception 'sms: bad team_ids' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct t.id order by t.id), '{}')
      into teams
      from jsonb_array_elements_text(p -> 'team_ids') x(id)
      join public.teams t on t.tenant_id = v_tenant and t.id = x.id;
  end if;

  insert into public.tenant_sms_config (tenant_id) values (v_tenant)
  on conflict (tenant_id) do nothing;

  update public.tenant_sms_config set
    enabled = case when p ? 'enabled' then coalesce((p ->> 'enabled')::boolean, enabled) else enabled end,
    team_ids = case when p ? 'team_ids' then teams else team_ids end,
    quiet_from = case when p ? 'quiet_from' then (p ->> 'quiet_from')::integer else quiet_from end,
    quiet_to = case when p ? 'quiet_to' then (p ->> 'quiet_to')::integer else quiet_to end,
    updated_at = now()
  where tenant_id = v_tenant;

  return public.sms_account();
end;
$function$
;
grant execute on function public.sms_save_settings(p jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.sms_save_team_sender(p_team_id text, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms: owner only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.teams t where t.tenant_id = v_tenant and t.id = p_team_id) then
    raise exception 'sms: bad team' using errcode = '22023';
  end if;
  if v_name = '' then
    delete from public.sms_team_senders where tenant_id = v_tenant and team_id = p_team_id;
    return public.sms_account();
  end if;
  if not (v_name ~ '^[A-Za-z0-9 ]{1,11}$' and v_name ~ '[A-Za-z]') then
    raise exception 'sms:sender_format' using errcode = '22023';
  end if;
  if lower(replace(v_name, ' ', '')) = any (array[
       'babun', 'twilio', 'stripe', 'paypal', 'visa', 'mastercard', 'apple', 'google',
       'revolut', 'bank', 'police', 'cyta', 'epic', 'verify', 'sms', 'info', 'test'
     ])
     or exists (
       select 1 from public.sms_team_senders s
        where lower(s.sender_name) = lower(v_name) and s.tenant_id <> v_tenant
     ) then
    raise exception 'sms:sender_taken' using errcode = 'P0001';
  end if;
  insert into public.sms_team_senders (tenant_id, team_id, sender_name)
  values (v_tenant, p_team_id, v_name)
  on conflict (tenant_id, team_id) do update set sender_name = excluded.sender_name, updated_at = now();
  return public.sms_account();
end;
$function$
;
grant execute on function public.sms_save_team_sender(p_team_id text, p_name text) to authenticated;

CREATE OR REPLACE FUNCTION public.sms_save_team_template(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_team text := nullif(trim(coalesce(p ->> 'team_id', '')), '');
  v_trigger text := coalesce(nullif(p ->> 'trigger', ''), 'manual');
  v_hours integer := case when v_trigger in ('before', 'after') then nullif(p ->> 'hours', '')::integer end;
  v_at text := case when v_trigger = 'day_before' then nullif(p ->> 'at_time', '') end;
  v_months integer := case when v_trigger = 'repeat' then nullif(p ->> 'months', '')::integer end;
  v_from smallint := coalesce(nullif(p ->> 'send_from', '')::smallint, 8);
  v_to smallint := coalesce(nullif(p ->> 'send_to', '')::smallint, 21);
  v_color text := nullif(trim(coalesce(p ->> 'color', '')), '');
  v_icon text := nullif(trim(coalesce(p ->> 'icon', '')), '');
  saved public.sms_team_templates%rowtype;
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms: owner only' using errcode = '42501';
  end if;
  if v_team is null or not exists (select 1 from public.teams t where t.tenant_id = v_tenant and t.id = v_team) then
    raise exception 'sms: bad team' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.sms_team_templates (
      tenant_id, team_id, name, body, trigger, hours, at_time, months, send_from, send_to,
      color, icon, enabled, position
    ) values (
      v_tenant, v_team, trim(p ->> 'name'), trim(p ->> 'body'), v_trigger, v_hours, v_at, v_months, v_from, v_to,
      v_color, v_icon,
      coalesce((p ->> 'enabled')::boolean, true),
      coalesce((select max(position) + 1 from public.sms_team_templates
                 where tenant_id = v_tenant and team_id = v_team), 0)
    )
    returning * into saved;
  else
    update public.sms_team_templates set
      name = trim(p ->> 'name'),
      body = trim(p ->> 'body'),
      trigger = v_trigger,
      hours = v_hours,
      at_time = v_at,
      months = v_months,
      send_from = v_from,
      send_to = v_to,
      color = v_color,
      icon = v_icon,
      enabled = coalesce((p ->> 'enabled')::boolean, enabled),
      updated_at = now()
    where id = v_id and tenant_id = v_tenant and team_id = v_team
    returning * into saved;
    if not found then
      raise exception 'sms: template not found' using errcode = 'P0002';
    end if;
  end if;
  return public.sms_team_template_json(saved);
end;
$function$
;
grant execute on function public.sms_save_team_template(p jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.sms_send_bulk(p_team_id text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_team text := nullif(trim(coalesce(p_team_id, '')), '');
  it jsonb;
  c record;
  phone text;
  v_body text;
  v_balance integer;
  n_items integer;
  queued integer := 0;
  skipped integer := 0;
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  if not public.sms_service_on() then
    raise exception 'sms:service_off' using errcode = 'P0001';
  end if;
  if public.sms_frozen(v_tenant) then
    raise exception 'sms:frozen' using errcode = 'P0001';
  end if;
  if v_team is null or not exists (select 1 from public.teams t where t.tenant_id = v_tenant and t.id = v_team) then
    raise exception 'sms:calendar' using errcode = 'P0001';
  end if;
  if public.sms_team_sender(v_tenant, v_team) is null then
    raise exception 'sms:sender' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'sms:body' using errcode = '22023';
  end if;
  n_items := jsonb_array_length(p_items);
  if n_items = 0 or n_items > 500 then
    raise exception 'sms:body' using errcode = '22023';
  end if;
  select balance_cents into v_balance from public.tenant_sms_config where tenant_id = v_tenant;
  if coalesce(v_balance, 0) < public.sms_price_cents() * n_items then
    raise exception 'sms:funds' using errcode = 'P0001';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_body := trim(coalesce(it ->> 'body', ''));
    select cl.id, cl.phone, cl.phone_e164, cl.sms_opt_out, cl.blacklisted, cl.deleted_at
      into c
      from public.clients cl
     where cl.id = nullif(it ->> 'client_id', '')::uuid and cl.tenant_id = v_tenant;
    phone := case when found then coalesce(nullif(trim(c.phone_e164), ''), nullif(trim(c.phone), '')) end;
    if phone is null or not public.sms_phone_allowed(phone)
       or c.deleted_at is not null or c.sms_opt_out or coalesce(c.blacklisted, false)
       or length(v_body) = 0 or length(v_body) > 1000 then
      skipped := skipped + 1;
      continue;
    end if;
    insert into public.sms_messages (
      tenant_id, client_id, team_id, to_phone, message_body, trigger_type, status, mode, sent_by
    ) values (
      v_tenant, c.id, v_team, phone, v_body, 'bulk', 'queued', 'platform', auth.uid()
    );
    queued := queued + 1;
  end loop;
  if queued > 0 then
    perform public.sms_wake();
  end if;
  return jsonb_build_object('queued', queued, 'skipped', skipped);
end;
$function$
;
grant execute on function public.sms_send_bulk(p_team_id text, p_items jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.sms_send_manual(p_appointment_id uuid, p_client_id uuid, p_body text, p_template_id text DEFAULT NULL::text, p_team_id text DEFAULT NULL::text, p_phone text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  is_owner boolean := public.current_user_role() = 'owner';
  a record;
  v_client uuid := p_client_id;
  v_team text := nullif(trim(coalesce(p_team_id, '')), '');
  c record;
  phone text;
  v_body text := trim(coalesce(p_body, ''));
  v_balance integer;
  v_id uuid;
  cap_member integer := coalesce(
    (select nullif(value, '')::integer from public.app_settings where key = 'sms_member_daily_cap'), 100);
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  if not public.sms_service_on() then
    raise exception 'sms:service_off' using errcode = 'P0001';
  end if;
  if public.sms_frozen(v_tenant) then
    raise exception 'sms:frozen' using errcode = 'P0001';
  end if;
  if length(v_body) = 0 or length(v_body) > 1000 then
    raise exception 'sms:body' using errcode = '22023';
  end if;
  if p_appointment_id is not null then
    select ap.client_id, ap.team_id into a
      from public.appointments ap
     where ap.id = p_appointment_id and ap.tenant_id = v_tenant;
    if not found then
      raise exception 'sms:appointment' using errcode = 'P0001';
    end if;
    -- Клиент на экране (сменили и не сохранили) — ему; нет — клиент записи.
    -- SMS всё равно о записи (03.10). Право на клиента — проверками ниже.
    v_client := coalesce(p_client_id, a.client_id);
    if v_client is null then
      raise exception 'sms:appointment' using errcode = 'P0001';
    end if;
    v_team := a.team_id;
  end if;
  if v_team is null or v_client is null then
    raise exception 'sms:calendar' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.teams t where t.tenant_id = v_tenant and t.id = v_team) then
    raise exception 'sms:calendar' using errcode = 'P0001';
  end if;
  if not is_owner and not public.sms_can_see_team(v_team) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  -- Клиент — только тот, кого сотрудник видит в этой команде (защита базы
  -- 30.09): иначе SMS уходило бы любому клиенту компании по его uuid.
  if not is_owner and not public.member_client_in_team(v_client, v_team) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  -- «SMS: Меняет» — на КАЖДУЮ отправку не владельца (аудит 03.10): из записи
  -- SMS шло по одному праву видеть календарь, и партнёр со «SMS: Скрыт» тратил
  -- баланс владельца из любой записи команды.
  if not is_owner
     and not (v_client = any(public.access_block_client_ids('clients.sms', 'write'))) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  -- ПОЛУЧАТЕЛЬ — НЕ КЛИЕНТ ЗАПИСИ (аудит 03.10): это SMS другому клиенту, и
  -- право то же, что с карточки, — «SMS: Меняет». Без этого по любой записи
  -- команды SMS уходило любому клиенту её базы.
  if not is_owner and p_appointment_id is not null then
    if v_client is distinct from a.client_id
       and not (v_client = any(public.access_block_client_ids('clients.sms', 'write'))) then
      raise exception 'sms:rights' using errcode = '42501';
    end if;
  end if;
  if not is_owner and (
    select count(*) from public.sms_messages
     where sent_by = auth.uid() and created_at > now() - interval '1 day'
  ) >= cap_member then
    raise exception 'sms:limit' using errcode = 'P0001';
  end if;
  if public.sms_team_sender(v_tenant, v_team) is null then
    raise exception 'sms:sender' using errcode = 'P0001';
  end if;
  select cl.phone, cl.phone_e164, cl.sms_opt_out, cl.blacklisted, cl.deleted_at
    into c
    from public.clients cl
   where cl.id = v_client and cl.tenant_id = v_tenant;
  if not found or c.deleted_at is not null then
    raise exception 'sms:client' using errcode = 'P0001';
  end if;
  if c.sms_opt_out or coalesce(c.blacklisted, false) then
    raise exception 'sms:opt_out' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_phone, '')), '') is not null then
    -- Выбрать номер может только тот, кому номер открыт (30.09): иначе дверь
    -- служила бы проверкой угаданного номера.
    if not is_owner
       and not (v_client = any(public.access_contact_client_ids())
                or v_client = any(public.access_day_contact_client_ids())) then
      raise exception 'sms:phone' using errcode = 'P0001';
    end if;
    if not public.sms_client_owns_phone(v_client, p_phone) then
      raise exception 'sms:phone' using errcode = 'P0001';
    end if;
    phone := trim(p_phone);
  else
    phone := coalesce(nullif(trim(c.phone_e164), ''), nullif(trim(c.phone), ''));
  end if;
  if phone is null then
    raise exception 'sms:phone' using errcode = 'P0001';
  end if;
  if not public.sms_phone_allowed(phone) then
    raise exception 'sms:country' using errcode = 'P0001';
  end if;
  select balance_cents into v_balance from public.tenant_sms_config where tenant_id = v_tenant;
  if coalesce(v_balance, 0) < public.sms_price_cents() then
    raise exception 'sms:funds' using errcode = 'P0001';
  end if;
  insert into public.sms_messages (
    tenant_id, appointment_id, client_id, team_id, to_phone, message_body,
    trigger_type, template_id, status, mode, sent_by
  ) values (
    v_tenant, p_appointment_id, v_client, v_team, phone, v_body,
    'manual', nullif(p_template_id, ''), 'queued', 'platform', auth.uid()
  )
  returning sms_messages.id into v_id;
  perform public.sms_wake();
  return v_id;
end;
$function$
;
grant execute on function public.sms_send_manual(p_appointment_id uuid, p_client_id uuid, p_body text, p_template_id text, p_team_id text, p_phone text) to authenticated;

CREATE OR REPLACE FUNCTION public.sms_service_on()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select value from public.app_settings where key = 'sms_enabled'), 'off') = 'on'
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_set_team_template_enabled(p_id uuid, p_enabled boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms: owner only' using errcode = '42501';
  end if;
  update public.sms_team_templates
     set enabled = coalesce(p_enabled, false), updated_at = now()
   where id = p_id and tenant_id = public.current_tenant_id();
  return coalesce(p_enabled, false);
end;
$function$
;
grant execute on function public.sms_set_team_template_enabled(p_id uuid, p_enabled boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.sms_stripe_dispute(p_payment_intent text, p_dispute text, p_amount integer, p_phase text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t public.sms_topups%rowtype;
  r record;
  opened integer;
  take integer;
begin
  if p_dispute is null or p_phase not in ('opened', 'withdrawn', 'reinstated') then
    return 0;
  end if;
  select * into t from public.sms_topups where stripe_payment_intent_id = p_payment_intent for update;
  if not found or t.status not in ('completed', 'refunded') then
    return 0;
  end if;
  if p_phase in ('opened', 'withdrawn') then
    update public.sms_autotopup
       set enabled = false, payment_method = null, card_label = null,
           pending_key = null, pending_since = null, pending_amount = null,
           last_error = 'Спор по оплате — сохраните новую карту', last_error_at = now(), updated_at = now()
     where tenant_id = t.tenant_id;
    perform public.sms_alert(t.tenant_id, 'dispute', 'Спор по оплате SMS в банке');
  end if;
  if p_phase = 'opened' then
    return 0;
  end if;
  select -amount_cents into opened
    from public.sms_ledger
   where kind = 'dispute' and ref = p_payment_intent || ':dispute:' || p_dispute;
  if p_phase = 'withdrawn' then
    if opened is not null then
      return 0;
    end if;
    select * into r from public.sms_topup_reversed(p_payment_intent);
    take := least(greatest(coalesce(p_amount, 0), 0), t.amount_cents - r.refunded - r.disputed);
    if take <= 0 then
      return 0;
    end if;
    perform public.sms_ledger_post(
      t.tenant_id, 'dispute', -take, p_payment_intent || ':dispute:' || p_dispute, 'Банк забрал деньги по спору'
    );
    return take;
  end if;
  if opened is null then
    return 0;
  end if;
  if public.sms_ledger_post(
    t.tenant_id, 'dispute_won', opened, p_payment_intent || ':dispute_won:' || p_dispute, 'Банк вернул деньги по спору'
  ) is null then
    return 0;
  end if;
  update public.sms_alerts set resolved_at = now()
   where tenant_id = t.tenant_id and kind = 'dispute' and resolved_at is null;
  return opened;
end;
$function$
;
grant execute on function public.sms_stripe_dispute(p_payment_intent text, p_dispute text, p_amount integer, p_phase text) to service_role;

CREATE OR REPLACE FUNCTION public.sms_stripe_refund(p_payment_intent text, p_refunded_total integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t public.sms_topups%rowtype;
  r record;
  take integer;
begin
  select * into t from public.sms_topups where stripe_payment_intent_id = p_payment_intent for update;
  if not found or t.status not in ('completed', 'refunded') then
    return 0; -- не пополнение SMS (подписка) или не зачислено
  end if;
  select * into r from public.sms_topup_reversed(p_payment_intent);
  take := least(greatest(coalesce(p_refunded_total, 0), 0), t.amount_cents) - r.refunded;
  take := least(take, t.amount_cents - r.refunded - r.disputed);
  if take <= 0 then
    return 0;
  end if;
  perform public.sms_ledger_post(
    t.tenant_id, 'stripe_refund', -take,
    p_payment_intent || ':refund:' || (r.refunded + take), 'Возврат оплаты в Stripe'
  );
  if r.refunded + take >= t.amount_cents then
    update public.sms_topups set status = 'refunded' where id = t.id;
  end if;
  update public.sms_autotopup
     set enabled = false, last_error = 'Возврат оплаты — автопополнение выключено', last_error_at = now(), updated_at = now()
   where tenant_id = t.tenant_id and enabled;
  return take;
end;
$function$
;
grant execute on function public.sms_stripe_refund(p_payment_intent text, p_refunded_total integer) to service_role;

CREATE OR REPLACE FUNCTION public.sms_team_sender(p_tenant uuid, p_team text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.sender_name from public.sms_team_senders s
   where s.tenant_id = p_tenant and s.team_id = p_team
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_team_template_json(t sms_team_templates)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', t.id,
    'team_id', t.team_id,
    'name', t.name,
    'body', t.body,
    'trigger', t.trigger,
    'hours', t.hours,
    'at_time', t.at_time,
    'months', t.months,
    'send_from', t.send_from,
    'send_to', t.send_to,
    'color', t.color,
    'icon', t.icon,
    'enabled', t.enabled,
    'position', t.position
  )
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_team_templates(p_team_id text DEFAULT NULL::text)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  return query
  select public.sms_team_template_json(t)
    from public.sms_team_templates t
   where t.tenant_id = v_tenant
     and (p_team_id is null or t.team_id = p_team_id)
     and public.sms_can_see_team(t.team_id)
   order by t.team_id, t.position, t.created_at;
end;
$function$
;
grant execute on function public.sms_team_templates(p_team_id text) to authenticated;

CREATE OR REPLACE FUNCTION public.sms_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  stuck record;
begin
  if not public.sms_service_on() then
    return;
  end if;
  perform public.sms_enqueue_due();
  for stuck in
    select id from public.sms_messages
     where status = 'sending' and coalesce(claimed_at, created_at) < now() - interval '15 minutes'
  loop
    perform public.sms_mark(stuck.id, 'failed', null, 'timeout', 'Отправка не завершилась');
  end loop;
  if exists (
    select 1 from public.sms_messages
     where status = 'queued' and (send_after is null or send_after <= now())
  ) then
    perform public.sms_wake();
  end if;
  if exists (
    select 1 from public.sms_autotopup a
      left join public.tenant_sms_config c on c.tenant_id = a.tenant_id
     where public.sms_autotopup_is_due(a, coalesce(c.balance_cents, 0), c.frozen_at is not null)
  ) then
    perform public.sms_autotopup_wake();
  end if;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_topup_reversed(p_payment_intent text, OUT refunded integer, OUT disputed integer)
 RETURNS record
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(-sum(amount_cents) filter (where kind = 'stripe_refund'), 0)::integer,
         (coalesce(-sum(amount_cents) filter (where kind = 'dispute'), 0)
          - coalesce(sum(amount_cents) filter (where kind = 'dispute_won'), 0))::integer
    from public.sms_ledger
   where kind in ('stripe_refund', 'dispute', 'dispute_won')
     and split_part(ref, ':', 1) = p_payment_intent;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_trigger_kind(p_trigger text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case p_trigger
    when 'created' then 'new_appointment'
    when 'before' then 'reminder'
    when 'day_before' then 'reminder'
    when 'rescheduled' then 'reschedule'
    when 'cancelled' then 'cancellation'
    when 'after' then 'thank_you'
    when 'repeat' then 'repeat'
    else 'manual'
  end
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sms_unfreeze(p_tenant uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.tenant_sms_config set frozen_at = null, frozen_reason = null where tenant_id = p_tenant;
  update public.sms_alerts set resolved_at = now()
   where tenant_id = p_tenant and resolved_at is null
     and kind in ('ledger_mismatch', 'topup_missing', 'send_missing', 'send_mismatch', 'topup_amount');
$function$
;
grant execute on function public.sms_unfreeze(p_tenant uuid) to service_role;

CREATE OR REPLACE FUNCTION public.sms_wake()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform net.http_post(
    url := 'https://rdtokosbqvgemicqeqwz.supabase.co/functions/v1/send_sms',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select secret from public.edge_cron_secrets where name = 'send_sms')
    )
  );
exception when others then
  -- Не разбудили — очередь заберёт расписание через 5 минут.
  raise warning 'sms_wake: %', sqlerrm;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.start_trial(p_tier text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_kind text;
  v_started timestamptz;
  v_ends timestamptz := now() + interval '14 days';
begin
  if auth.uid() is null or v_tenant is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'Пробный период включает владелец аккаунта'
      using errcode = '42501', hint = 'plan:owner';
  end if;
  select t.kind, t.trial_started_at into v_kind, v_started
    from public.tenants t
   where t.id = v_tenant
     for update;
  if p_tier is null or p_tier not in ('solo', 'pro', 'max') then
    raise exception 'Неизвестный тариф' using errcode = '22023';
  end if;
  -- Личное — только Соло, компания — не ниже Про. Приложения из магазина
  -- (1.0.2, 1.0.3) предлагают пробный «Про» и в Личном: не отказ, а Соло.
  p_tier := 'max';
  if v_started is not null then
    raise exception 'Пробный период уже был'
      using errcode = 'P0001', hint = 'plan:trial-used';
  end if;
  if public.tenant_effective_plan(v_tenant) is distinct from 'free' then
    raise exception 'Тариф уже действует'
      using errcode = 'P0001', hint = 'plan:active';
  end if;
  perform set_config('babun.billing_write', 'on', true);
  update public.tenants
     set trial_tier = p_tier,
         trial_started_at = now(),
         trial_ends_at = v_ends
   where id = v_tenant;
  perform set_config('babun.billing_write', 'off', true);
  return jsonb_build_object('tier', p_tier, 'trial_ends_at', v_ends);
end;
$function$
;
grant execute on function public.start_trial(p_tier text) to authenticated;

CREATE OR REPLACE FUNCTION public.submit_rating(p_token text, p_stars integer, p_comment text)
 RETURNS TABLE(ok boolean, code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_token public.master_rating_tokens%rowtype;
begin
  if p_token is null or length(p_token) < 16 or length(p_token) > 200 then
    return query select false, 'bad_token_format'::text; return;
  end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then
    return query select false, 'stars_out_of_range'::text; return;
  end if;
  if p_comment is not null and length(p_comment) > 2000 then
    return query select false, 'comment_too_long'::text; return;
  end if;

  -- Lock the token row so two concurrent submissions serialise on
  -- the same token. Second caller sees `used_at` already set by the
  -- first transaction's AFTER INSERT trigger and returns
  -- token_already_used cleanly.
  select * into v_token
    from public.master_rating_tokens
    where token = p_token
    for update;
  if not found then
    return query select false, 'token_not_found'::text; return;
  end if;
  if v_token.used_at is not null then
    return query select false, 'token_already_used'::text; return;
  end if;
  if v_token.expires_at <= now() then
    return query select false, 'token_expired'::text; return;
  end if;

  insert into public.master_ratings (
    tenant_id, master_id, appointment_id, stars, comment, token
  )
  values (
    v_token.tenant_id, v_token.master_id, v_token.appointment_id,
    p_stars,
    nullif(btrim(coalesce(p_comment, '')), ''),
    p_token
  );

  return query select true, 'ok'::text;
exception
  -- Defence-in-depth: if the unique constraint below ever fires,
  -- map it to the same code as the in-function check above.
  when unique_violation then
    return query select false, 'token_already_used'::text; return;
end
$function$
;
grant execute on function public.submit_rating(p_token text, p_stars integer, p_comment text) to anon;
grant execute on function public.submit_rating(p_token text, p_stars integer, p_comment text) to authenticated;

CREATE OR REPLACE FUNCTION public.sync_appointment_finance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.reconcile_appointment_finance(
    new.id,
    old.total_amount,
    old.prepaid_amount,
    old.paid_amount,
    old.payment_status,
    old.status,
    false
  );
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sync_appointment_finance_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.reconcile_appointment_finance(
    new.id, 0, 0, 0, 'unpaid', 'scheduled', true
  );
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sync_client_requisites()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  sets jsonb;
  main jsonb;
  legacy jsonb;
  requisites_changed boolean;
  legacy_changed boolean;
begin
  if tg_op = 'INSERT' then
    requisites_changed := coalesce(new.requisites, '[]'::jsonb) <> '[]'::jsonb;
    legacy_changed := not requisites_changed;
  else
    requisites_changed := new.requisites is distinct from old.requisites;
    legacy_changed := row(new.legal_name, new.vat_number, new.reg_number, new.billing_address)
      is distinct from row(old.legal_name, old.vat_number, old.reg_number, old.billing_address);
  end if;

  sets := public.normalize_client_requisites(new.requisites);

  -- Писатель старых колонок правит ОСНОВНОЙ набор: иначе зеркало молча
  -- вернуло бы старое значение поверх его правки.
  if legacy_changed and not requisites_changed then
    legacy := jsonb_build_object(
      'legal_name', new.legal_name,
      'vat_number', new.vat_number,
      'reg_number', new.reg_number,
      'billing_address', new.billing_address
    );
    if exists (
      select 1 from jsonb_array_elements(sets) e
       where (e ->> 'is_default')::boolean
    ) then
      select jsonb_agg(
               case when (e.value ->> 'is_default')::boolean then e.value || legacy else e.value end
               order by e.ordinality
             )
        into sets
        from jsonb_array_elements(sets) with ordinality e;
    else
      sets := sets || jsonb_build_array(legacy || jsonb_build_object('is_default', true));
    end if;
    sets := public.normalize_client_requisites(sets);
  end if;

  new.requisites := sets;
  select e into main
    from jsonb_array_elements(sets) e
   where (e ->> 'is_default')::boolean
   limit 1;
  new.legal_name := main ->> 'legal_name';
  new.vat_number := main ->> 'vat_number';
  new.reg_number := main ->> 'reg_number';
  new.billing_address := main ->> 'billing_address';
  return new;
end;
$function$
;
grant execute on function public.sync_client_requisites() to authenticated;

CREATE OR REPLACE FUNCTION public.sync_invoice_status_from_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  old_invoice_id uuid;
  new_invoice_id uuid;
  target_invoice_id uuid;
  invoice_total numeric(12,2);
  invoice_status text;
  income_total numeric(12,2);
  direct_refunds numeric(12,2);
  linked_refunds numeric(12,2);
  paid_total numeric(12,2);
begin
  if tg_op <> 'INSERT' then
    old_invoice_id := old.invoice_id;
    if old_invoice_id is null and old.type = 'refund' and old.refund_of_id is not null then
      select invoice_id into old_invoice_id
        from public.finance_transactions
       where id = old.refund_of_id;
    end if;
  end if;
  if tg_op <> 'DELETE' then
    new_invoice_id := new.invoice_id;
    if new_invoice_id is null and new.type = 'refund' and new.refund_of_id is not null then
      select invoice_id into new_invoice_id
        from public.finance_transactions
       where id = new.refund_of_id;
    end if;
  end if;

  for target_invoice_id in
    select distinct invoice_id
      from (values (old_invoice_id), (new_invoice_id)) as targets(invoice_id)
     where invoice_id is not null
  loop
    select total - coalesce(credited_amount, 0), status into invoice_total, invoice_status
      from public.invoices
     where id = target_invoice_id
     for update;
    -- Отменённый кредит-нотой статус от поздних движений не меняет (04.10).
    if not found or invoice_status in ('void', 'cancelled') then
      continue;
    end if;

    select
      coalesce(sum(case when type = 'income' then greatest(amount, 0) else 0 end), 0),
      coalesce(sum(case when type = 'refund' then abs(amount) else 0 end), 0)
      into income_total, direct_refunds
      from public.finance_transactions
     where invoice_id = target_invoice_id
       and type in ('income', 'refund');
    select coalesce(sum(abs(refund.amount)), 0)
      into linked_refunds
      from public.finance_transactions refund
      join public.finance_transactions original
        on original.id = refund.refund_of_id
     where original.invoice_id = target_invoice_id
       and original.type = 'income'
       and refund.type = 'refund'
       and refund.invoice_id is null;

    paid_total := greatest(0, income_total - direct_refunds - linked_refunds);
    update public.invoices
       set status = case when paid_total >= invoice_total then 'paid' else 'issued' end
     where id = target_invoice_id
       and status <> 'void';
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.sync_receipt_with_income()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
grant execute on function public.sync_receipt_with_income() to anon;
grant execute on function public.sync_receipt_with_income() to authenticated;
grant execute on function public.sync_receipt_with_income() to service_role;

CREATE OR REPLACE FUNCTION public.sync_tenant_claims(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_meta jsonb;
  v_available jsonb;
  v_claim text;
  v_next_tenant public.tenant_members.tenant_id%type;
  v_next_role public.tenant_members.role%type;
  v_next_master public.tenant_members.master_id%type;
begin
  select coalesce(u.raw_app_meta_data, '{}'::jsonb)
    into v_meta
    from auth.users u
   where u.id = p_user_id;

  -- Аккаунт удаляется целиком (каскад из auth.users) — писать некуда.
  if not found then
    return;
  end if;

  select coalesce(jsonb_agg(x.tenant_id order by x.joined_at, x.tenant_id), '[]'::jsonb)
    into v_available
    from (
      select tm.tenant_id::text as tenant_id, min(tm.joined_at) as joined_at
        from public.tenant_members tm
       where tm.user_id = p_user_id
       group by tm.tenant_id
    ) x;

  v_claim := nullif(v_meta ->> 'tenant_id', '');

  if v_claim is null or v_available ? v_claim then
    if coalesce(v_meta -> 'available_tenants', '[]'::jsonb) is distinct from v_available then
      update auth.users u
         set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object('available_tenants', v_available)
       where u.id = p_user_id;
    end if;
    return;
  end if;

  select tm.tenant_id, tm.role, tm.master_id
    into v_next_tenant, v_next_role, v_next_master
    from public.tenant_members tm
   where tm.user_id = p_user_id
   order by tm.joined_at asc, tm.tenant_id asc
   limit 1;

  update auth.users u
     set raw_app_meta_data =
       (coalesce(u.raw_app_meta_data, '{}'::jsonb) - 'tenant_id' - 'tenant_role' - 'tenant_master_id')
       || jsonb_build_object('available_tenants', v_available)
       || case
            when v_next_tenant is null then '{}'::jsonb
            else jsonb_build_object('tenant_id', v_next_tenant::text, 'tenant_role', v_next_role)
          end
       || case
            when v_next_tenant is null or v_next_master is null then '{}'::jsonb
            else jsonb_build_object('tenant_master_id', v_next_master)
          end
   where u.id = p_user_id;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.tariff_partner_count(p_tenant uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::integer
    from (
      select m.user_id::text
        from public.tenant_members m
       where m.tenant_id = p_tenant
         and m.role <> 'owner'
      union
      select lower(i.email)
        from public.invitations i
       where i.tenant_id = p_tenant
         and i.accepted_at is null
         and i.expires_at > now()
    ) people
$function$
;
grant execute on function public.tariff_partner_count(p_tenant uuid) to service_role;

CREATE OR REPLACE FUNCTION public.team_design_guard_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  old_blocks text[] := array[]::text[];
  new_blocks text[];
  old_rule text := 'team';
  old_palette jsonb;
  old_fallback text;
  old_list text[];
  old_ways jsonb;
  old_maps jsonb;
  old_months integer;
  old_record_order text[];
  old_event_order text[];
  team text;
begin
  if auth.uid() is null or public.current_user_role() is not distinct from 'owner' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'удалять настройки команды может только владелец'
      using errcode = '42501', hint = 'access:owner';
  end if;

  if tg_op = 'INSERT' and exists (
    select 1 from public.team_design d
     where d.tenant_id = new.tenant_id and d.team_id = new.team_id
  ) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    old_blocks := coalesce(old.disabled_blocks, array[]::text[]);
    old_rule := old.record_color_rule;
    old_palette := old.record_color_palette;
    old_fallback := old.record_color_fallback;
    old_list := old.client_list_off;
    old_ways := old.contact_ways;
    old_maps := old.map_services;
    old_months := old.service_every_months;
    old_record_order := old.record_order;
    old_event_order := old.event_order;
    if new.team_id is distinct from old.team_id or new.tenant_id is distinct from old.tenant_id then
      raise exception 'строку настроек нельзя перенести в другую команду'
        using errcode = '42501', hint = 'access:owner';
    end if;
  end if;

  team := new.team_id;
  new_blocks := coalesce(new.disabled_blocks, array[]::text[]);

  if new.record_color_rule is distinct from old_rule
     or new.record_color_palette is distinct from old_palette
     or new.record_color_fallback is distinct from old_fallback
     or new.record_order is distinct from old_record_order
     or new.event_order is distinct from old_event_order
     or array(select b from unnest(new_blocks) b where b not like 'client\_%' order by b)
        is distinct from array(select b from unnest(old_blocks) b where b not like 'client\_%' order by b)
  then
    if not team = any(public.access_calendars('calendar.booking_form', 'write')) then
      raise exception 'нет права менять «Записи» этой команды'
        using errcode = '42501', hint = 'block:calendar.booking_form';
    end if;
  end if;

  if new.client_list_off is distinct from old_list
     or array(select b from unnest(new_blocks) b where b like 'client\_%' order by b)
        is distinct from array(select b from unnest(old_blocks) b where b like 'client\_%' order by b)
  then
    if not team = any(public.access_calendars('clients.settings_card', 'write')) then
      raise exception 'нет права менять «Карточку клиента» этой команды'
        using errcode = '42501', hint = 'block:clients.settings_card';
    end if;
  end if;

  if new.contact_ways is distinct from old_ways
     and not team = any(public.access_calendars('clients.settings_ways', 'write')) then
    raise exception 'нет права менять «Способы связи» этой команды'
      using errcode = '42501', hint = 'block:clients.settings_ways';
  end if;

  if new.map_services is distinct from old_maps
     and not team = any(public.access_calendars('clients.settings_maps', 'write')) then
    raise exception 'нет права менять «Карты для маршрута» этой команды'
      using errcode = '42501', hint = 'block:clients.settings_maps';
  end if;

  if new.service_every_months is distinct from old_months
     and not team = any(public.access_calendars('clients.settings_objects', 'write')) then
    raise exception 'нет права менять «Типы объектов» этой команды'
      using errcode = '42501', hint = 'block:clients.settings_objects';
  end if;

  return new;
end;
$function$
;
grant execute on function public.team_design_guard_columns() to authenticated;

CREATE OR REPLACE FUNCTION public.team_is_working(p_tenant uuid, p_team text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with lim as (
    select public.tenant_tier_limit(p_tenant, 'teams') as n
  ),
  live as (
    select tm.id, tm.created_at
      from public.teams tm
     where tm.tenant_id = p_tenant
       and tm.is_active
  ),
  chosen as (
    select coalesce(t.working_team_ids, array[]::text[]) as ids
      from public.tenants t
     where t.id = p_tenant
  ),
  -- Выбранные владельцем — первыми и в его порядке; свободные места (команду
  -- из выбора убрали в архив, лимит вырос) добираются живыми по созданию.
  ranked as (
    select l.id,
           row_number() over (
             order by array_position(c.ids, l.id) nulls last, l.created_at, l.id
           ) as rn
      from live l
      cross join chosen c
  )
  select case
    when (select count(*) from live) <= (select n from lim) then true
    else exists (
      select 1 from ranked r where r.id = p_team and r.rn <= (select n from lim)
    )
  end
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.teams_seed_client_sources()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.seed_client_sources(new.tenant_id, new.id);
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.tenant_business_date(p_tenant_id uuid)
 RETURNS date
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_timezone text;
begin
  select cs.timezone into tenant_timezone
    from public.calendar_settings cs
   where cs.tenant_id = p_tenant_id;
  tenant_timezone := coalesce(nullif(btrim(tenant_timezone), ''), 'Europe/Nicosia');
  begin
    return (current_timestamp at time zone tenant_timezone)::date;
  exception when invalid_parameter_value then
    return (current_timestamp at time zone 'Europe/Nicosia')::date;
  end;
end;
$function$
;
grant execute on function public.tenant_business_date(p_tenant_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.tenant_currency(p_tenant_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select upper(t.currency) from public.tenants t where t.id = p_tenant_id),
    'EUR'
  );
$function$
;
grant execute on function public.tenant_currency(p_tenant_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.tenant_data_export()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_role      text := public.current_user_role();
  v_clients         json;
  v_client_tags     json;
  v_client_tag_assg json;
  v_appts           json;
  v_appt_photos     json;
  v_recurring       json;
  v_masters         json;
  v_brigades        json;
  v_team_schedules  json;
  v_day_cities      json;
  v_day_extras      json;
  v_tenant_members  json;
  v_invitations     json;
  v_sms_messages    json;
  v_sms_logs        json;
  v_topups          json;
  v_billing_events  json;
  v_push_subs       json;
  v_settings        json;
  v_tenant          json;
begin
  if v_tenant_id is null then return json_build_object('error', 'no_tenant'); end if;
  if v_role <> 'owner' then return json_build_object('error', 'owner_only'); end if;

  select row_to_json(t) into v_tenant from (select * from public.tenants where id = v_tenant_id) t;

  select coalesce(json_agg(row_to_json(c)), '[]'::json) into v_clients from public.clients c where c.tenant_id = v_tenant_id;
  select coalesce(json_agg(row_to_json(a)), '[]'::json) into v_appts from public.appointments a where a.tenant_id = v_tenant_id;

  if to_regclass('public.client_tags') is not null then
    execute 'select coalesce(json_agg(row_to_json(t)), ''[]''::json) from public.client_tags t where t.tenant_id = $1' into v_client_tags using v_tenant_id;
  else v_client_tags := '[]'::json; end if;

  if to_regclass('public.client_tag_assignments') is not null then
    execute 'select coalesce(json_agg(row_to_json(a)), ''[]''::json) from public.client_tag_assignments a join public.clients c on c.id = a.client_id where c.tenant_id = $1' into v_client_tag_assg using v_tenant_id;
  else v_client_tag_assg := '[]'::json; end if;

  if to_regclass('public.appointment_photos') is not null then
    execute 'select coalesce(json_agg(row_to_json(p)), ''[]''::json) from public.appointment_photos p where p.tenant_id = $1' into v_appt_photos using v_tenant_id;
  else v_appt_photos := '[]'::json; end if;

  if to_regclass('public.recurring_reminders') is not null then
    execute 'select coalesce(json_agg(row_to_json(r)), ''[]''::json) from public.recurring_reminders r where r.tenant_id = $1' into v_recurring using v_tenant_id;
  else v_recurring := '[]'::json; end if;

  if to_regclass('public.masters') is not null then
    execute 'select coalesce(json_agg(row_to_json(m)), ''[]''::json) from public.masters m where m.tenant_id = $1' into v_masters using v_tenant_id;
  else v_masters := '[]'::json; end if;

  if to_regclass('public.brigades') is not null then
    execute 'select coalesce(json_agg(row_to_json(b)), ''[]''::json) from public.brigades b where b.tenant_id = $1' into v_brigades using v_tenant_id;
  else v_brigades := '[]'::json; end if;

  if to_regclass('public.team_schedules') is not null then
    execute 'select coalesce(json_agg(row_to_json(s)), ''[]''::json) from public.team_schedules s where s.tenant_id = $1' into v_team_schedules using v_tenant_id;
  else v_team_schedules := '[]'::json; end if;

  if to_regclass('public.day_cities') is not null then
    execute 'select coalesce(json_agg(row_to_json(d)), ''[]''::json) from public.day_cities d where d.tenant_id = $1' into v_day_cities using v_tenant_id;
  else v_day_cities := '[]'::json; end if;

  if to_regclass('public.day_extras') is not null then
    execute 'select coalesce(json_agg(row_to_json(d)), ''[]''::json) from public.day_extras d where d.tenant_id = $1' into v_day_extras using v_tenant_id;
  else v_day_extras := '[]'::json; end if;

  if to_regclass('public.tenant_members') is not null then
    execute 'select coalesce(json_agg(row_to_json(m)), ''[]''::json) from public.tenant_members m where m.tenant_id = $1' into v_tenant_members using v_tenant_id;
  else v_tenant_members := '[]'::json; end if;

  if to_regclass('public.invitations') is not null then
    execute 'select coalesce(json_agg(row_to_json(i)), ''[]''::json) from public.invitations i where i.tenant_id = $1' into v_invitations using v_tenant_id;
  else v_invitations := '[]'::json; end if;

  if to_regclass('public.sms_messages') is not null then
    execute 'select coalesce(json_agg(row_to_json(m)), ''[]''::json) from public.sms_messages m where m.tenant_id = $1' into v_sms_messages using v_tenant_id;
  else v_sms_messages := '[]'::json; end if;

  if to_regclass('public.sms_logs') is not null then
    execute 'select coalesce(json_agg(row_to_json(l)), ''[]''::json) from public.sms_logs l where l.tenant_id = $1' into v_sms_logs using v_tenant_id;
  else v_sms_logs := '[]'::json; end if;

  if to_regclass('public.sms_topups') is not null then
    execute 'select coalesce(json_agg(row_to_json(t)), ''[]''::json) from public.sms_topups t where t.tenant_id = $1' into v_topups using v_tenant_id;
  else v_topups := '[]'::json; end if;

  if to_regclass('public.billing_events') is not null then
    execute 'select coalesce(json_agg(row_to_json(b)), ''[]''::json) from public.billing_events b where b.tenant_id = $1' into v_billing_events using v_tenant_id;
  else v_billing_events := '[]'::json; end if;

  if to_regclass('public.push_subscriptions') is not null then
    execute 'select coalesce(json_agg(row_to_json(p)), ''[]''::json) from public.push_subscriptions p where p.tenant_id = $1' into v_push_subs using v_tenant_id;
  else v_push_subs := '[]'::json; end if;

  select json_build_object(
    'calendar_settings', (select row_to_json(s) from public.calendar_settings s where s.tenant_id = v_tenant_id limit 1),
    'tenant_sms_config', (select row_to_json(s) from public.tenant_sms_config s where s.tenant_id = v_tenant_id limit 1)
  ) into v_settings;

  return json_build_object(
    'exported_at', now(),
    'export_version', 2,
    'tenant', v_tenant,
    'clients', v_clients,
    'client_tags', v_client_tags,
    'client_tag_assignments', v_client_tag_assg,
    'appointments', v_appts,
    'appointment_photos', v_appt_photos,
    'recurring_reminders', v_recurring,
    'masters', v_masters,
    'brigades', v_brigades,
    'team_schedules', v_team_schedules,
    'day_cities', v_day_cities,
    'day_extras', v_day_extras,
    'tenant_members', v_tenant_members,
    'invitations', v_invitations,
    'sms_messages', v_sms_messages,
    'sms_logs', v_sms_logs,
    'sms_topups', v_topups,
    'billing_events', v_billing_events,
    'push_subscriptions', v_push_subs,
    'settings', v_settings
  );
end;
$function$
;
grant execute on function public.tenant_data_export() to authenticated;

CREATE OR REPLACE FUNCTION public.tenant_effective_plan(t_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when t.plan_override in ('lifetime', 'beta_unlimited') then 'max'
    when t.plan in ('solo', 'pro', 'max')
         and t.subscription_status in ('active', 'trialing', 'past_due')
         and (t.current_period_end is null or t.current_period_end > now())
      then t.plan
    when t.trial_tier is not null and t.trial_ends_at > now() then t.trial_tier
    else 'free'
  end
    from public.tenants t
   where t.id = t_id
$function$
;
grant execute on function public.tenant_effective_plan(t_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.tenant_free_readonly_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null
     or public.tenant_effective_plan(new.tenant_id) is distinct from 'free' then
    return new;
  end if;

  if tg_table_name = 'appointments' then
    if new.kind = 'work' or (tg_op = 'UPDATE' and old.kind = 'work') then
      raise exception 'Записи клиентов без тарифа — только для просмотра'
        using errcode = 'P0001', hint = 'plan:book-clients';
    end if;
    return new;
  end if;

  if tg_table_name = 'clients' then
    -- Архив — можно: он ничего не добавляет базе.
    if tg_op = 'UPDATE'
       and (to_jsonb(new) - 'deleted_at' - 'purge_at' - 'updated_at')
         = (to_jsonb(old) - 'deleted_at' - 'purge_at' - 'updated_at') then
      return new;
    end if;
    raise exception 'Клиенты без тарифа — только для просмотра'
      using errcode = 'P0001', hint = 'plan:clients';
  end if;

  -- Файлы и теги клиента.
  raise exception 'Клиенты без тарифа — только для просмотра'
    using errcode = 'P0001', hint = 'plan:clients';
end;
$function$
;
grant execute on function public.tenant_free_readonly_guard() to authenticated;

CREATE OR REPLACE FUNCTION public.tenant_members_removed_archive_card()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Ушёл из компании — его карточку в архив: работу ушедшему не назначить.
  -- По `master_id` — тоже: при удалении аккаунта `user_id` карточки
  -- обнуляется раньше, чем сработает этот триггер.
  update public.masters m
     set is_active = false,
         account_status = 'terminated'
   where m.tenant_id = old.tenant_id
     and m.is_active
     and (m.user_id = old.user_id or m.id = old.master_id);
  return null;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.tenant_members_removed_signal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform realtime.send(
    jsonb_build_object('tenant_id', old.tenant_id),
    'membership_removed',
    'access:' || old.user_id::text,
    true
  );
  return null;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.tenant_members_removed_sync_claims()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.sync_tenant_claims(old.user_id);
  return null;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.tenant_partner_writes_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_role text;
begin
  if tg_op = 'DELETE' then
    v_tenant := old.tenant_id;
  else
    v_tenant := new.tenant_id;
  end if;
  if v_uid is not null and v_tenant is not null then
    select tm.role into v_role
      from public.tenant_members tm
     where tm.tenant_id = v_tenant
       and tm.user_id = v_uid;
    if v_role is not null and v_role <> 'owner'
       and public.tenant_tier_limit(v_tenant, 'partners') = 0 then
      raise exception 'Тариф владельца команды закончился — можно только смотреть'
        using errcode = 'P0001', hint = 'plan:partner-frozen';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$
;
grant execute on function public.tenant_partner_writes_guard() to authenticated;

CREATE OR REPLACE FUNCTION public.tenant_quota_appointments_month(t_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select 999999999
$function$
;
grant execute on function public.tenant_quota_appointments_month(t_id uuid) to authenticated;
grant execute on function public.tenant_quota_appointments_month(t_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.tenant_quota_clients(t_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select 999999999
$function$
;
grant execute on function public.tenant_quota_clients(t_id uuid) to authenticated;
grant execute on function public.tenant_quota_clients(t_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.tenant_quota_sms_month(t_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                                                                                                                                                                        select coalesce(
                                                                                                                                                                            (select c.free_quota_per_month from public.tenant_sms_config c where c.tenant_id = t_id),
                                                                                                                                                                                case public.tenant_effective_plan(t_id)
                                                                                                                                                                                      when 'lifetime'        then 999999999
                                                                                                                                                                                            when 'beta_unlimited'  then 999999999
                                                                                                                                                                                                  when 'business'        then 999999999
                                                                                                                                                                                                        when 'pro'             then 200
                                                                                                                                                                                                              else 10
                                                                                                                                                                                                                  end
                                                                                                                                                                                                                    );
                                                                                                                                                                                                                    $function$
;
grant execute on function public.tenant_quota_sms_month(t_id uuid) to authenticated;
grant execute on function public.tenant_quota_sms_month(t_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.tenant_quota_summary(t_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                                                                                                                                                                                                                      select jsonb_build_object(
                                                                                                                                                                                                                          'plan',                public.tenant_effective_plan(t_id),
                                                                                                                                                                                                                              'clients',             public.tenant_quota_clients(t_id),
                                                                                                                                                                                                                                  'appointments_month',  public.tenant_quota_appointments_month(t_id),
                                                                                                                                                                                                                                      'team_members',        public.tenant_quota_team_members(t_id),
                                                                                                                                                                                                                                          'sms_month',           public.tenant_quota_sms_month(t_id)
                                                                                                                                                                                                                                            );
                                                                                                                                                                                                                                            $function$
;
grant execute on function public.tenant_quota_summary(t_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.tenant_quota_team_members(t_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select 999999999
$function$
;
grant execute on function public.tenant_quota_team_members(t_id uuid) to authenticated;
grant execute on function public.tenant_quota_team_members(t_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.tenant_sms_summary()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_role      text := public.current_user_role();
  v_config    json;
  v_logs      json;
begin
  if v_tenant_id is null then
    return json_build_object('error', 'no_tenant');
  end if;

  select json_build_object(
    'enabled', t.enabled,
    'sender_name', t.sender_name,
    'sender_status', t.sender_status,
    'sender_requested_at', t.sender_requested_at,
    'sender_approved_at', t.sender_approved_at,
    'free_sms_remaining', t.free_sms_remaining,
    'total_sent_count', t.total_sent_count,
    'balance_cents',
      case when v_role = 'owner' then t.balance_cents else null end,
    'remind_24h_before', t.remind_24h_before,
    'remind_2h_before', t.remind_2h_before,
    'template_24h', t.template_24h,
    'template_2h', t.template_2h
  )
  into v_config
  from public.tenant_sms_config t
  where t.tenant_id = v_tenant_id;

  if v_role = 'owner' then
    select coalesce(json_agg(row_to_json(l) order by l.created_at desc), '[]'::json)
    into v_logs
    from (
      select id, to_phone, body, sender_name_used, cost_cents,
             was_free, twilio_status, error_code, error_message,
             created_at, delivered_at
      from public.sms_logs
      where tenant_id = v_tenant_id
      order by created_at desc
      limit 20
    ) l;
  else
    v_logs := '[]'::json;
  end if;

  return json_build_object(
    'config', coalesce(v_config, 'null'::json),
    'logs', v_logs
  );
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.tenant_tier_limit(t_id uuid, p_what text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case public.tenant_effective_plan(t_id)
    when 'max' then 1000
    when 'pro' then 5
    else case p_what when 'teams' then 1 else 0 end
  end
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.tenants_guard_billing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.role() is null
     or auth.role() = 'service_role'
     or current_setting('babun.billing_write', true) = 'on' then
    return new;
  end if;
  if new.plan is distinct from old.plan
     or new.plan_override is distinct from old.plan_override
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.subscription_status is distinct from old.subscription_status
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.current_period_end is distinct from old.current_period_end
     or new.trial_tier is distinct from old.trial_tier
     or new.trial_started_at is distinct from old.trial_started_at
     or new.working_team_ids is distinct from old.working_team_ids
     or new.paid_calendars is distinct from old.paid_calendars then
    raise exception 'Тариф меняется только оплатой или пробным периодом'
      using errcode = '42501', hint = 'plan:billing';
  end if;
  return new;
end;
$function$
;
grant execute on function public.tenants_guard_billing() to authenticated;

CREATE OR REPLACE FUNCTION public.tenants_guard_kind()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if auth.role() is null
     or auth.role() = 'service_role'
     or current_setting('babun.kind_write', true) = 'on' then
    return new;
  end if;
  if new.kind is distinct from old.kind
     or new.personal_of is distinct from old.personal_of
     or new.created_by is distinct from old.created_by then
    raise exception 'Вид аккаунта не меняется'
      using errcode = '42501', hint = 'account:kind';
  end if;
  return new;
end;
$function$
;
grant execute on function public.tenants_guard_kind() to anon;
grant execute on function public.tenants_guard_kind() to authenticated;
grant execute on function public.tenants_guard_kind() to service_role;

CREATE OR REPLACE FUNCTION public.touch_event_template_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;
grant execute on function public.touch_event_template_updated_at() to anon;
grant execute on function public.touch_event_template_updated_at() to authenticated;
grant execute on function public.touch_event_template_updated_at() to service_role;

CREATE OR REPLACE FUNCTION public.transfer_company_ownership(p_tenant uuid, p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Войдите в приложение' using errcode = '42501', hint = 'owner:auth';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = p_tenant and tm.user_id = v_uid and tm.role = 'owner'
  ) then
    raise exception 'Передать владение может только владелец' using errcode = '42501', hint = 'owner:not_owner';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant and t.kind = 'company') then
    raise exception 'Личное не передаётся' using errcode = '42501', hint = 'owner:personal';
  end if;
  if p_user is null or p_user = v_uid or not exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = p_tenant and tm.user_id = p_user
  ) then
    raise exception 'Этот человек не в компании' using errcode = '22023', hint = 'owner:not_member';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('owner:' || p_tenant::text, 0));

  update public.tenant_members
     set role = 'owner'
   where tenant_id = p_tenant and user_id = p_user;

  update public.tenant_members
     set role = 'master'
   where tenant_id = p_tenant and user_id = v_uid;

  -- Новому владельцу строки прав не нужны: владелец видит всё по роли.
  delete from public.member_access where tenant_id = p_tenant and user_id = p_user;

  perform public.grant_full_company_access(p_tenant, v_uid, v_uid);

  perform public.sync_tenant_claims(p_user);
  perform public.sync_tenant_claims(v_uid);
end;
$function$
;
grant execute on function public.transfer_company_ownership(p_tenant uuid, p_user uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.trash_deleted_operation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Только удаление «Удалить» из приложения (`delete_operation`): стирание
  -- календаря, отмена перевода и каскад компании флага не ставят.
  if coalesce(current_setting('babun.operation_trash', true), '') <> 'on' then
    return old;
  end if;
  -- Чек к доходу ещё жив (гасящий триггер идёт после этого): удаление
  -- погасило бы его насовсем, и «Вернуть» его не оживит.
  if old.type = 'income' and exists (
    select 1 from public.receipts r where r.transaction_id = old.id and r.status = 'issued'
  ) then
    raise exception 'К этому доходу выписан чек — такую операцию не удалить'
      using errcode = '23514', hint = 'operation:has_receipt';
  end if;
  insert into public.deleted_operations
    (id, tenant_id, team_id, type, operation, deleted_by, deleted_at, purge_at)
  values
    (old.id, old.tenant_id, old.team_id, old.type, to_jsonb(old), auth.uid(),
     now(), now() + interval '30 days');
  return old;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.try_uuid(p_value text)
 RETURNS uuid
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
begin
  return p_value::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$function$
;
grant execute on function public.try_uuid(p_value text) to authenticated;

CREATE OR REPLACE FUNCTION public.undo_appointment_payment(p_appointment_id uuid)
 RETURNS SETOF appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  appointment_row public.appointments%rowtype;
  settlement_count integer := 0;
  prepayment_method text;
begin
  -- Пропуск сторожа колонок записи (03.10): право на деньги проверяет
  -- сама дверь ниже, а сторож пускает партнёра только с этим флагом.
  perform set_config('babun.member_write', 'on', true);
  if auth.uid() is null
     or coalesce(public.current_user_role(), '') not in ('owner', 'dispatcher') then
    raise exception 'Отменить оплату может владелец или диспетчер';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_appointment_id::text, 0));
  select * into appointment_row
    from public.appointments
   where id = p_appointment_id and tenant_id = tenant_uuid
   for update;
  if not found then raise exception 'Заявка не найдена'; end if;
  if not public.current_user_can_edit_work_appointment(appointment_row.team_id) then
    raise exception 'Заявка не найдена';
  end if;
  if not public.current_user_can_pay_appointment(appointment_row.team_id, appointment_row.master_id) then
    raise exception 'Оплату этой записи менять нельзя' using errcode = '42501', hint = 'block:record.payment';
  end if;
  if appointment_row.payment_status = 'refunded' then
    raise exception 'По оплате уже оформлен возврат';
  end if;
  if appointment_row.payment_status not in ('partial', 'paid') then
    raise exception 'Оплата ещё не синхронизирована или уже отменена';
  end if;
  perform 1
    from public.finance_transactions income
   where income.appointment_id = p_appointment_id
     and income.type = 'income'
     and income.source = 'auto'
     and coalesce(income.appointment_payment_kind, 'settlement') = 'settlement'
   order by income.id
   for update;
  select count(*) into settlement_count
    from public.finance_transactions income
   where income.appointment_id = p_appointment_id
     and income.type = 'income'
     and income.source = 'auto'
     and coalesce(income.appointment_payment_kind, 'settlement') = 'settlement';
  if settlement_count = 0 and appointment_row.total_amount > 0 then
    raise exception 'Оплата состоит только из предоплаты; оформите её возврат';
  end if;
  if exists (
    select 1
      from public.finance_transactions refund
      join public.finance_transactions income on income.id = refund.refund_of_id
     where income.appointment_id = p_appointment_id
       and income.type = 'income'
       and income.source = 'auto'
       and coalesce(income.appointment_payment_kind, 'settlement') = 'settlement'
       and refund.type = 'refund'
  ) then
    raise exception 'По оплате уже есть возврат; отмена недоступна';
  end if;
  if exists (
    select 1 from public.finance_transactions income
    left join public.accounts account
      on account.id = income.account_id and account.tenant_id = tenant_uuid
   where income.appointment_id = p_appointment_id
     and income.type = 'income'
     and income.source = 'auto'
     and coalesce(income.appointment_payment_kind, 'settlement') = 'settlement'
     and (account.id is null or not account.is_active)
  ) then
    raise exception 'Счёт оплаты закрыт; снова откройте его перед отменой';
  end if;

  select income.payment_method into prepayment_method
    from public.finance_transactions income
   where income.appointment_id = p_appointment_id
     and income.type = 'income'
     and income.source = 'auto'
     and income.appointment_payment_kind = 'prepayment'
   order by income.created_at desc, income.id desc
   limit 1;

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (txid_current(), 'appointment_undo', p_appointment_id, tenant_uuid)
  on conflict do nothing;
  -- Do not delete receipts. The appointment transition fires reconciliation,
  -- which writes one linked refund per outstanding settlement piece. This
  -- also inherits invoice_id and atomically reopens an attached invoice.
  update public.appointments
     set payment_status = case
           when prepaid_amount > 0 and total_amount > 0
                and prepaid_amount >= total_amount then 'paid'
           else 'unpaid'
         end,
         payment_method = case
           when prepaid_amount > 0 then coalesce(prepayment_method, payment_method)
           else null
         end,
         paid_amount = 0,
         payment = null,
         payments = '[]'::jsonb
   where id = p_appointment_id and tenant_id = tenant_uuid;
  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'appointment_undo' and entity_id = p_appointment_id;
  return query select * from public.appointments where id = p_appointment_id;
end;
$function$
;
grant execute on function public.undo_appointment_payment(p_appointment_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.update_client_with_tags(p_tenant_id uuid, p_client_id uuid, p_patch jsonb, p_tag_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant_id uuid := public.current_tenant_id();
  active_role text := public.current_user_role();
  current_row public.clients%rowtype;
  next_row public.clients%rowtype;
  saved_row public.clients%rowtype;
  result_tag_ids uuid[];
  card_blocks jsonb;
  denied_block text;
begin
  -- 02.10: сотрудник с «Только видит» у базы правит блоки карточки, где у
  -- него «Меняет», поэтому вход — по «Видит», а поля — ниже, по блокам.
  if auth.uid() is null
     or active_tenant_id is null
     or active_role is null
     or not (active_role = 'owner' or public.access_company('clients', 'read')) then
    raise exception 'only an owner or an employee who can change clients can update a client'
      using errcode = '42501', hint = 'block:clients';
  end if;

  if p_tenant_id is null
     or p_tenant_id is distinct from active_tenant_id then
    raise exception 'client tenant does not match the active tenant'
      using errcode = '42501';
  end if;

  if p_client_id is null then
    raise exception 'client id is required'
      using errcode = '22023';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'client patch must be an object'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_object_keys(p_patch) key
     where key not in (
       'full_name',
       'phone',
       'whatsapp_phone',
       'email',
       'sms_name',
       'telegram_username',
       'instagram_username',
       'balance',
       'discount',
       'comment',
       'acquisition_source',
       'referred_by_client_id',
       'first_contact_date',
       'address',
       'city',
       'city_manual',
       'property_type',
       'language',
       'birthday',
       'blacklisted',
       'pinned_at',
       'reminder_at',
       'phones',
       'locations',
       'notes',
       'equipment',
       'phone_e164',
       'avatar_url',
       'deleted_at',
       'favorite_master_id',
       'legal_name',
       'vat_number',
       'reg_number',
       'billing_address',
       'memberships',
       'requisites'
     )
  ) then
    raise exception 'client patch contains a protected or unknown field'
      using errcode = '22023';
  end if;

  select client.*
    into current_row
    from public.clients client
   where client.id = p_client_id
     and client.tenant_id = active_tenant_id
   for update;

  if not found then
    raise exception 'client not found'
      using errcode = 'P0002';
  end if;
  -- Сотрудник правит только клиента, которого видит (02.10: по «Видит», а не
  -- по «Меняет» базы — «Меняет» у неё больше нет).
  if active_role <> 'owner'
     and (p_client_id = any(public.access_client_ids_in(public.access_calendars('clients', 'read')))) is not true then
    raise exception 'client not found'
      using errcode = 'P0002';
  end if;

  next_row := jsonb_populate_record(current_row, p_patch);

  if active_role <> 'owner' then
    -- Корзина и деньги клиента — дело владельца. Реквизиты с 30.09 — свой
    -- блок карточки (ниже). Удаляет партнёр с «Удаление клиента: Может» своей
    -- дверью (`member_trash_client`); чёрный список с 03.10 — «Меню клиента»
    -- (ниже).
    if p_patch ?| array['deleted_at', 'balance', 'discount',
                        'favorite_master_id'] then
      raise exception 'only the owner archives a client, changes its money or company-wide marks'
        using errcode = '42501', hint = 'block:clients';
    end if;
    -- БЛОКИ КАРТОЧКИ (30.09): каждое поле — под своим блоком; «Меняет» блока —
    -- по командам, через которые клиент виден (`access_client_blocks`). Связи
    -- с 30.09 — блок «Люди»: он же их и показывает, маска контактов тут ни при
    -- чём.
    card_blocks := coalesce((
      select b.blocks
        from public.access_client_blocks() b
       where b.client_id = p_client_id
    ), '{}'::jsonb);
    -- БЛОК «КЛИЕНТ» (02.10): имя, номера и мессенджеры, фото — по его
    -- «Меняет». Напоминание и чёрный список — «Меню клиента» (ниже). Судим по значению, а не по ключу: карточка, которая
    -- пронесла то же имя рядом с заметкой, ничего в блоке не меняет. Имя для
    -- SMS — блок «SMS» (ниже).
    if coalesce(card_blocks ->> 'clients.client', 'off') <> 'write'
       and exists (
         select 1
           from unnest(array['full_name', 'phone', 'whatsapp_phone', 'email',
                             'telegram_username', 'instagram_username', 'phones',
                             'phone_e164', 'avatar_url']) as f(field)
          where (to_jsonb(next_row) -> f.field) is distinct from (to_jsonb(current_row) -> f.field)
       ) then
      raise exception 'this block of the client card is closed for this employee'
        using errcode = '42501', hint = 'block:clients.client';
    end if;
    -- 03.10: номера больше не приходят пустыми — блок «Клиент» с «Видит»
    -- отдаёт их целиком (владелец: «видит клиента — видит номер и звонит»).
    -- Проверка «сначала открой номер дверью» снята: менять номер может тот,
    -- у кого блок «Клиент» с «Меняет», а он номер уже видит.
    select g.block_key into denied_block
      from (values
        ('clients.note', array['comment', 'notes']),
        ('clients.people', array['memberships']),
        ('clients.objects', array['locations', 'equipment', 'address', 'property_type']),
        ('clients.labels', array['city', 'city_manual']),
        ('clients.personal', array['birthday', 'language', 'acquisition_source',
                                   'referred_by_client_id', 'first_contact_date']),
        ('clients.requisites', array['legal_name', 'vat_number', 'reg_number',
                                     'billing_address', 'requisites']),
        ('clients.sms', array['sms_name']),
        ('clients.menu', array['reminder_at', 'pinned_at', 'blacklisted'])
      ) as g(block_key, fields)
     where p_patch ?| g.fields
       and coalesce(card_blocks ->> g.block_key, 'off') <> 'write'
     limit 1;
    -- 03.10: теги — своё право «Тег» (`clients.tags`); «Метка» — город.
    if denied_block is null
       and p_tag_ids is not null
       and coalesce(card_blocks ->> 'clients.tags', 'off') <> 'write' then
      denied_block := 'clients.tags';
    end if;
    if denied_block is not null then
      raise exception 'this block of the client card is closed for this employee'
        using errcode = '42501', hint = 'block:' || denied_block;
    end if;
  end if;

  if nullif(btrim(next_row.full_name), '') is null then
    raise exception 'client name is required'
      using errcode = '23514';
  end if;

  if jsonb_typeof(coalesce(next_row.phones, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(next_row.locations, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(next_row.notes, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(next_row.equipment, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(next_row.memberships, '[]'::jsonb)) <> 'array' then
    raise exception 'client nested collections must be arrays'
      using errcode = '22023';
  end if;

  if p_patch ? 'referred_by_client_id'
     and next_row.referred_by_client_id = p_client_id then
    raise exception 'client cannot refer itself'
      using errcode = '23514';
  end if;

  if p_patch ? 'referred_by_client_id'
     and next_row.referred_by_client_id is not null
     and not exists (
       select 1
         from public.clients referrer
        where referrer.tenant_id = active_tenant_id
          and referrer.id = next_row.referred_by_client_id
     ) then
    raise exception 'referring client does not belong to the active tenant'
      using errcode = '23503';
  end if;

  if p_patch ? 'favorite_master_id'
     and next_row.favorite_master_id is not null
     and not exists (
       select 1
         from public.masters master
        where master.tenant_id = active_tenant_id
          and master.id = next_row.favorite_master_id
     ) then
    raise exception 'favorite master does not belong to the active tenant'
      using errcode = '23503';
  end if;

  if p_tag_ids is not null then
    result_tag_ids := public.normalize_client_tag_ids(
      active_tenant_id,
      p_tag_ids
    );
    -- 03.10: сотрудник ставит только теги команды клиента. Тег другой
    -- команды, который уже стоит на клиенте (ставил владелец), остаётся.
    if active_role <> 'owner' and exists (
      select 1
        from unnest(result_tag_ids) supplied(tag_id)
        join public.client_tags tag
          on tag.tenant_id = active_tenant_id
         and tag.id = supplied.tag_id
       where tag.team_id is not null
         and tag.team_id is distinct from current_row.team_id
         and not exists (
           select 1
             from public.client_tag_assignments assignment
            where assignment.tenant_id = active_tenant_id
              and assignment.client_id = p_client_id
              and assignment.tag_id = supplied.tag_id
         )
    ) then
      raise exception 'client tag belongs to another team'
        using errcode = '23503', hint = 'client:tag_other_team';
    end if;
  end if;

  update public.clients client
     set full_name = next_row.full_name,
         phone = next_row.phone,
         whatsapp_phone = next_row.whatsapp_phone,
         email = next_row.email,
         sms_name = next_row.sms_name,
         telegram_username = next_row.telegram_username,
         instagram_username = next_row.instagram_username,
         balance = next_row.balance,
         discount = next_row.discount,
         comment = next_row.comment,
         acquisition_source = next_row.acquisition_source,
         referred_by_client_id = next_row.referred_by_client_id,
         first_contact_date = next_row.first_contact_date,
         address = next_row.address,
         city = next_row.city,
         city_manual = next_row.city_manual,
         property_type = next_row.property_type,
         language = next_row.language,
         birthday = next_row.birthday,
         blacklisted = next_row.blacklisted,
         pinned_at = next_row.pinned_at,
         reminder_at = next_row.reminder_at,
         phones = next_row.phones,
         locations = next_row.locations,
         notes = next_row.notes,
         equipment = next_row.equipment,
         phone_e164 = next_row.phone_e164,
         avatar_url = next_row.avatar_url,
         deleted_at = next_row.deleted_at,
         favorite_master_id = next_row.favorite_master_id,
         legal_name = nullif(btrim(next_row.legal_name), ''),
         vat_number = nullif(btrim(next_row.vat_number), ''),
         reg_number = nullif(btrim(next_row.reg_number), ''),
         billing_address = nullif(btrim(next_row.billing_address), ''),
         memberships = coalesce(next_row.memberships, '[]'::jsonb),
         requisites = coalesce(next_row.requisites, '[]'::jsonb)
   where client.id = p_client_id
     and client.tenant_id = active_tenant_id
  returning client.* into saved_row;

  if p_tag_ids is not null then
    delete from public.client_tag_assignments assignment
     where assignment.tenant_id = active_tenant_id
       and assignment.client_id = p_client_id;

    insert into public.client_tag_assignments (
      tenant_id,
      client_id,
      tag_id
    )
    select active_tenant_id, p_client_id, supplied.tag_id
      from unnest(result_tag_ids) supplied(tag_id);
  else
    select coalesce(
             array_agg(assignment.tag_id order by assignment.tag_id),
             array[]::uuid[]
           )
      into result_tag_ids
      from public.client_tag_assignments assignment
     where assignment.tenant_id = active_tenant_id
       and assignment.client_id = p_client_id;
  end if;

  -- Теги — внутрь маски: закрытые «Метка и тег» сотруднику не вернутся.
  return public.client_seen_by_caller(
    to_jsonb(saved_row) || jsonb_build_object('tag_ids', to_jsonb(result_tag_ids))
  );
end;
$function$
;
grant execute on function public.update_client_with_tags(p_tenant_id uuid, p_client_id uuid, p_patch jsonb, p_tag_ids uuid[]) to authenticated;

CREATE OR REPLACE FUNCTION public.update_invitation(p_invitation_id uuid, p_full_name text, p_phone text, p_team_ids text[], p_master_title text, p_master_color text, p_access jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_full_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_master_title text := nullif(btrim(coalesce(p_master_title, '')), '');
  v_master_color text := nullif(btrim(coalesce(p_master_color, '')), '');
  v_access jsonb := coalesce(p_access, '[]'::jsonb);
  v_team_ids text[];
  v_stored text[];
  v_gone text[];
  v_bad_team text;
  v_invitation public.invitations%rowtype;
begin
  if auth.uid() is null
     or v_tenant_id is null
     or not (public.current_user_role() = 'owner' or public.access_company('company.partners', 'write')) then
    raise exception 'only an owner can update invitations'
      using errcode = '42501';
  end if;

  -- Чужая компания и отсутствие приглашения неразличимы: оракула нет.
  select * into v_invitation
    from public.invitations i
   where i.id = p_invitation_id
     and i.tenant_id = v_tenant_id;
  if not found then
    raise exception 'invitation not found'
      using errcode = 'P0002', hint = 'invite:not_found';
  end if;

  -- Порядок замков тот же, что у создания и приёма (почта → строка): правка не
  -- разойдётся с одновременным приёмом и не оживит уже удалённое повторным
  -- приглашением.
  perform pg_advisory_xact_lock(
    hashtextextended(v_invitation.tenant_id::text || ':' || lower(v_invitation.email), 0)
  );

  select * into v_invitation
    from public.invitations i
   where i.id = p_invitation_id
     and i.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception 'invitation not found'
      using errcode = 'P0002', hint = 'invite:not_found';
  end if;

  -- Принятое приглашение уже стало сотрудником: его правят в «Правах», а не
  -- здесь. Истёкшее не примут — править в нём нечего, его отправляют заново.
  if v_invitation.accepted_at is not null then
    raise exception 'invitation already accepted'
      using errcode = '42501', hint = 'invite:not_pending';
  end if;

  if v_invitation.expires_at <= now() then
    raise exception 'invitation expired'
      using errcode = '42501', hint = 'invite:not_pending';
  end if;

  -- Календари приглашения ДО этой правки.
  v_stored := array_remove(coalesce(v_invitation.team_ids, array[v_invitation.team_id]), null);

  select coalesce(array_agg(x.team_id order by x.first_ord), array[]::text[])
    into v_team_ids
    from (
      select s.team_id, min(s.ord) as first_ord
        from (
          select nullif(btrim(coalesce(src.team_id, '')), '') as team_id, src.ord
            from unnest(coalesce(p_team_ids, array[]::text[]))
                 with ordinality as src(team_id, ord)
        ) s
       where s.team_id is not null
       group by s.team_id
    ) x;

  -- Календарь, уже бывший в приглашении и с тех пор ушедший в архив или
  -- удалённый, снимается молча — ровно как при приёме (grant_invitation_calendar);
  -- иначе приглашение нельзя сохранить в том виде, в каком его вернул сервер, и
  -- владелец не поправит даже имя, не угадав, какой календарь пропал. Отказ —
  -- только на календарь, который добавляют этой правкой.
  select coalesce(array_agg(x.team_id), array[]::text[])
    into v_gone
    from unnest(v_team_ids) as x(team_id)
   where coalesce(x.team_id = any(v_stored), false)
     and not exists (
       select 1 from public.teams t
        where t.tenant_id = v_tenant_id
          and t.id = x.team_id
          and t.is_active
     );

  select x.team_id
    into v_bad_team
    from unnest(v_team_ids) as x(team_id)
   where not exists (
     select 1 from public.teams t
      where t.tenant_id = v_tenant_id
        and t.id = x.team_id
        and t.is_active
   )
     and not coalesce(x.team_id = any(v_stored), false)
   limit 1;

  if v_bad_team is not null then
    raise exception 'calendar not found or archived'
      using errcode = '22023', hint = 'invite:bad_calendar', detail = v_bad_team;
  end if;

  if cardinality(v_gone) > 0 then
    select coalesce(array_agg(x.team_id order by x.ord), array[]::text[])
      into v_team_ids
      from unnest(v_team_ids) with ordinality as x(team_id, ord)
     where not (x.team_id = any(v_gone));

    -- Уровни снятого календаря уходят вместе с ним. Не массив проходит как есть:
    -- его отказом `access:bad_changes` назовёт общая проверка.
    if jsonb_typeof(v_access) = 'array' then
      select coalesce(jsonb_agg(c.change order by c.ord), '[]'::jsonb)
        into v_access
        from jsonb_array_elements(v_access) with ordinality as c(change, ord)
       where not (jsonb_typeof(c.change) = 'object'
                  and coalesce(nullif(c.change ->> 'team_id', '') = any(v_gone), false));
    end if;
  end if;

  if v_invitation.role = 'master'
     and v_invitation.master_id is null
     and cardinality(v_team_ids) = 0 then
    raise exception 'master invitation requires a calendar or an employee card'
      using errcode = '22023', hint = 'invite:needs_calendar';
  end if;

  if v_full_name is not null and char_length(v_full_name) > 120 then
    raise exception 'invitation name is too long'
      using errcode = '22023';
  end if;

  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'invalid invitation phone'
      using errcode = '22023';
  end if;

  if v_master_title is not null and char_length(v_master_title) > 120 then
    raise exception 'invitation job title is too long'
      using errcode = '22023';
  end if;

  if v_master_color is not null and v_master_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'invalid invitation colour'
      using errcode = '22023';
  end if;

  -- Та же граница, что у создания: у существующей карточки должность и цвет
  -- правятся в ней самой.
  if v_invitation.master_id is not null
     and (v_master_title is not null or v_master_color is not null) then
    raise exception 'job title and colour belong to the linked employee card'
      using errcode = '22023', hint = 'invite:card_fields_on_card';
  end if;

  perform public.access_validate_changes(v_tenant_id, v_team_ids, v_access);
  -- Директор: команды — только свои, ступени — не выше своих (04.10).
  perform public.partners_check_teams(v_team_ids, v_stored);
  perform public.partners_check_caps(v_tenant_id, null, v_access);

  -- Токен и срок не трогаются: ссылка, которую человек уже получил, остаётся
  -- той же, а правка карточки не продлевает приглашение. Ушедший домашний
  -- календарь уступает дом следующему живому.
  update public.invitations i
     set team_id = v_team_ids[1],
         team_ids = case when cardinality(v_team_ids) > 0 then v_team_ids else null end,
         full_name = v_full_name,
         phone = v_phone,
         master_title = case when i.role = 'master' then v_master_title else null end,
         master_color = case when i.role = 'master' then v_master_color else null end,
         access_changes = v_access
   where i.id = v_invitation.id
  returning * into v_invitation;

  return jsonb_build_object(
    'id', v_invitation.id,
    'tenant_id', v_invitation.tenant_id,
    'email', v_invitation.email,
    'role', v_invitation.role,
    'master_id', v_invitation.master_id,
    'team_id', v_invitation.team_id,
    'team_ids', coalesce(v_invitation.team_ids, array[]::text[]),
    'full_name', v_invitation.full_name,
    'phone', v_invitation.phone,
    'master_title', v_invitation.master_title,
    'master_color', v_invitation.master_color,
    'access_changes', v_invitation.access_changes,
    'token', v_invitation.token,
    'expires_at', v_invitation.expires_at,
    'created_at', v_invitation.created_at
  );
end;
$function$
;
grant execute on function public.update_invitation(p_invitation_id uuid, p_full_name text, p_phone text, p_team_ids text[], p_master_title text, p_master_color text, p_access jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.update_invoice_draft(p_invoice_id uuid, p_due_on date, p_client_id uuid, p_appointment_id uuid, p_brigade_id text, p_vat_mode text, p_vat_percent numeric, p_lines jsonb, p_notes text DEFAULT NULL::text, p_company_id uuid DEFAULT NULL::uuid, p_account_id uuid DEFAULT NULL::uuid, p_issued_on date DEFAULT NULL::date, p_location_id text DEFAULT NULL::text, p_client_requisites_id text DEFAULT NULL::text)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  invoice_row public.invoices%rowtype;
  line_item jsonb;
  line_title text;
  qty_value numeric;
  unit_price_value numeric;
  line_total numeric;
  base_total numeric := 0;
  vat_rate numeric := 0;
  vat_total numeric := 0;
  invoice_total numeric := 0;
  line_count integer := 0;
  discount_lines integer := 0;
  old_line_count integer := 0;
  affected integer := 0;
  appointment_client_id uuid;
  appointment_team_id text;
  resolved_client_id uuid := p_client_id;
  resolved_brigade_id text := p_brigade_id;
  invoice_vat_mode text;
  next_issued_on date;
  location_text text := nullif(btrim(p_location_id), '');
  requisites_text text := nullif(btrim(p_client_requisites_id), '');
begin
  if tenant_uuid is null or not (public._documents_write_invoice(p_invoice_id)
         and public._documents_write_team(coalesce(p_brigade_id,
               (select i.brigade_id from public.invoices i where i.id = p_invoice_id)))) then
    raise exception 'Нужно право «Документы: Выставляет» в команде документа';
  end if;

  select * into invoice_row
    from public.invoices
   where id = p_invoice_id
     and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Инвойс не найден или недоступен';
  end if;
  if invoice_row.kind <> 'invoice' then
    raise exception 'Кредит-нота не редактируется — она сама является сторно';
  end if;
  if invoice_row.status <> 'issued' then
    raise exception 'Редактировать можно только неоплаченный инвойс';
  end if;
  if exists (
    select 1
      from public.finance_transactions
     where tenant_id = tenant_uuid
       and invoice_id = invoice_row.id
       and type in ('income', 'refund')
  ) or exists (
    select 1
      from public.finance_transactions refund
      join public.finance_transactions original on original.id = refund.refund_of_id
     where original.invoice_id = invoice_row.id
       and refund.type = 'refund'
  ) then
    raise exception 'Инвойс с платежами нельзя редактировать';
  end if;

  next_issued_on := coalesce(p_issued_on, invoice_row.issued_on);
  if extract(year from next_issued_on)::integer <> invoice_row.year then
    raise exception 'Дата инвойса — в пределах % года: номер % из серии этого года',
      invoice_row.year, invoice_row.number;
  end if;
  if location_text is not null and p_client_id is null and p_appointment_id is null then
    raise exception 'Объект выбирают у клиента — сначала клиент';
  end if;
  if p_due_on is not null and p_due_on < next_issued_on then
    raise exception 'Срок оплаты не может быть раньше даты выставления';
  end if;
  if p_appointment_id is not null then
    select client_id, team_id into appointment_client_id, appointment_team_id
      from public.appointments
     where id = p_appointment_id
       and tenant_id = tenant_uuid;
    if not found then
      raise exception 'Заявка не найдена или недоступна';
    end if;
    if resolved_client_id is not null
       and resolved_client_id is distinct from appointment_client_id then
      raise exception 'Клиент инвойса не совпадает с клиентом заявки';
    end if;
    if resolved_brigade_id is not null
       and resolved_brigade_id is distinct from appointment_team_id then
      raise exception 'Команда инвойса не совпадает с командой заявки';
    end if;
    resolved_client_id := appointment_client_id;
    resolved_brigade_id := appointment_team_id;
  end if;
  if resolved_client_id is not null and not exists (
    select 1 from public.clients where id = resolved_client_id and tenant_id = tenant_uuid
  ) then
    raise exception 'Клиент не найден или недоступен';
  end if;
  if resolved_brigade_id is not null and not exists (
    select 1 from public.teams where id = resolved_brigade_id and tenant_id = tenant_uuid
  ) then
    raise exception 'Команда не найдена или недоступна';
  end if;
  if p_vat_mode is null or p_vat_mode not in ('off', 'inclusive', 'exclusive') then
    raise exception 'Некорректный режим VAT';
  end if;
  if p_vat_percent is null
     or p_vat_percent = 'NaN'::numeric
     or p_vat_percent < 0
     or p_vat_percent > 100
     or round(p_vat_percent, 2) is distinct from p_vat_percent then
    raise exception 'VAT должен быть от 0 до 100%%';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Позиции инвойса должны быть списком';
  end if;
  line_count := jsonb_array_length(p_lines);
  if line_count < 1 or line_count > 100 then
    raise exception 'В инвойсе должно быть от 1 до 100 позиций';
  end if;

  for line_item in select value from jsonb_array_elements(p_lines)
  loop
    if jsonb_typeof(line_item) <> 'object'
       or jsonb_typeof(line_item -> 'title') <> 'string'
       or jsonb_typeof(line_item -> 'qty') <> 'number'
       or jsonb_typeof(line_item -> 'unit_price') <> 'number' then
      raise exception 'Позиция инвойса имеет неверный формат';
    end if;
    line_title := btrim(coalesce(line_item->>'title', ''));
    if line_title = '' or char_length(line_title) > 500 then
      raise exception 'Некорректное название позиции';
    end if;
    qty_value := (line_item->>'qty')::numeric;
    unit_price_value := (line_item->>'unit_price')::numeric;
    if qty_value is null or qty_value <= 0 or qty_value > 100000 then
      raise exception 'Некорректное количество: %', line_title;
    end if;
    if (line_item->>'discount') = 'true' then
      -- Скидка: одна строка, количество 1, цена меньше нуля.
      if unit_price_value is null or unit_price_value >= 0
         or unit_price_value < -999999999 or qty_value <> 1 then
        raise exception 'Некорректная скидка';
      end if;
      discount_lines := discount_lines + 1;
      if discount_lines > 1 then
        raise exception 'Скидка в инвойсе может быть только одна';
      end if;
    elsif unit_price_value is null or unit_price_value < 0 or unit_price_value > 999999999 then
      raise exception 'Некорректная цена: %', line_title;
    end if;
    if round(qty_value, 3) is distinct from qty_value
       or round(unit_price_value, 2) is distinct from unit_price_value then
      raise exception 'Слишком много знаков после запятой: %', line_title;
    end if;
    line_total := round(qty_value * unit_price_value, 2);
    if line_total > 9999999999.99 then
      raise exception 'Сумма позиции слишком большая: %', line_title;
    end if;
    base_total := base_total + line_total;
  end loop;

  base_total := round(base_total, 2);
  vat_rate := case when p_vat_mode = 'off' then 0 else round(p_vat_percent, 2) end;
  if p_vat_mode = 'inclusive' and vat_rate > 0 then
    invoice_total := base_total;
    vat_total := round(base_total - (base_total / (1 + vat_rate / 100)), 2);
    base_total := round(invoice_total - vat_total, 2);
  elsif p_vat_mode = 'exclusive' and vat_rate > 0 then
    vat_total := round(base_total * vat_rate / 100, 2);
    invoice_total := round(base_total + vat_total, 2);
  else
    vat_total := 0;
    invoice_total := base_total;
  end if;
  if invoice_total <= 0 then
    raise exception 'Итог инвойса должен быть больше нуля';
  end if;
  if invoice_total > 9999999999.99 then
    raise exception 'Итог инвойса слишком большой';
  end if;
  invoice_vat_mode := case when vat_rate > 0 then p_vat_mode else 'off' end;

  update public.invoices
     set due_on = p_due_on,
         client_id = resolved_client_id,
         appointment_id = p_appointment_id,
         brigade_id = resolved_brigade_id,
         subtotal_net = base_total,
         vat_percent = vat_rate,
         vat_amount = vat_total,
         total = invoice_total,
         vat_mode = invoice_vat_mode,
         notes = nullif(btrim(p_notes), ''),
         company_id = coalesce(invoice_row.company_id, p_company_id),
         issued_on = next_issued_on,
         location_id = location_text,
         client_requisites_id = requisites_text,
         account_id = p_account_id
   where id = invoice_row.id
     and tenant_id = tenant_uuid
     and status = 'issued'
  returning * into invoice_row;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Реквизиты инвойса не обновлены';
  end if;

  select count(*) into old_line_count
    from public.invoice_lines
   where invoice_id = invoice_row.id;
  delete from public.invoice_lines where invoice_id = invoice_row.id;
  get diagnostics affected = row_count;
  if affected <> old_line_count then
    raise exception 'Не все старые позиции инвойса удалены';
  end if;

  insert into public.invoice_lines (
    invoice_id, position, title, description, unit, qty, unit_price, total
  )
  select
    invoice_row.id,
    ordinality::integer - 1,
    btrim(value->>'title'),
    nullif(btrim(coalesce(value->>'description', '')), ''),
    nullif(btrim(coalesce(value->>'unit', '')), ''),
    round((value->>'qty')::numeric, 3),
    round((value->>'unit_price')::numeric, 2),
    round(
      round((value->>'qty')::numeric, 3) *
      round((value->>'unit_price')::numeric, 2),
      2
    )
  from jsonb_array_elements(p_lines) with ordinality as entries(value, ordinality);
  get diagnostics affected = row_count;
  if affected <> line_count then
    raise exception 'Не все новые позиции инвойса сохранены';
  end if;

  return invoice_row;
end;
$function$
;
grant execute on function public.update_invoice_draft(p_invoice_id uuid, p_due_on date, p_client_id uuid, p_appointment_id uuid, p_brigade_id text, p_vat_mode text, p_vat_percent numeric, p_lines jsonb, p_notes text, p_company_id uuid, p_account_id uuid, p_issued_on date, p_location_id text, p_client_requisites_id text) to authenticated;

CREATE OR REPLACE FUNCTION public.update_master_appointment_safe(p_appointment_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
  v_current_status text;
  v_team text;
begin
  if auth.uid() is null
     or public.current_user_role() is distinct from 'master' then
    raise exception 'only a master can use this appointment update'
      using errcode = '42501';
  end if;

  if p_patch is null
     or jsonb_typeof(p_patch) <> 'object'
     or p_patch = '{}'::jsonb then
    raise exception 'appointment patch must be a non-empty object'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_object_keys(p_patch) key
     where key <> 'comment'
  ) then
    -- Статуса записи нет (03.10) — дверь правит только заметку.
    raise exception 'master can update only the appointment note'
      using errcode = '42501';
  end if;

  if p_patch ? 'status'
     and (
       jsonb_typeof(p_patch -> 'status') <> 'string'
       or (p_patch ->> 'status') not in (
         'scheduled',
         'in_progress',
         'completed'
       )
     ) then
    raise exception 'unsupported master appointment status'
      using errcode = '22023';
  end if;

  if p_patch ? 'comment'
     and jsonb_typeof(p_patch -> 'comment') <> 'string' then
    raise exception 'appointment comment must be text'
      using errcode = '22023';
  end if;

  if length(coalesce(p_patch ->> 'comment', '')) > 10000 then
    raise exception 'appointment comment is too long'
      using errcode = '22023';
  end if;

  select a.status, a.team_id
    into v_current_status, v_team
    from public.appointments a
   where a.id = p_appointment_id
     and a.tenant_id = public.current_tenant_id()
     and a.kind = 'work'
     and a.team_id in (select unnest(public.access_calendars('record.note', 'write')))
   for update;

  if not found then
    raise exception 'work appointment not found or no longer assigned'
      using errcode = 'P0002';
  end if;

  -- ЗАМЕТКА — СВОЁ ПРАВО (record.note, с 30.09), а не «Статус: Меняет»
  -- (аудит 03.10): партнёр со скрытой заметкой переписывал её этой дверью.
  if p_patch ? 'comment'
     and (v_team = any(public.access_calendars('record.note', 'write'))) is not true then
    raise exception 'master cannot change the appointment note'
      using errcode = '42501';
  end if;

  if p_patch ? 'status'
     and not (
       (p_patch ->> 'status') = v_current_status
       or (
         v_current_status = 'scheduled'
         and (p_patch ->> 'status') = 'in_progress'
       )
       or (
         v_current_status = 'in_progress'
         and (p_patch ->> 'status') = 'completed'
       )
     ) then
    raise exception 'master appointment status transition is not allowed'
      using errcode = '23514';
  end if;

  update public.appointments a
     set status = case
           when p_patch ? 'status' then p_patch ->> 'status'
           else a.status
         end,
         comment = case
           when p_patch ? 'comment' then p_patch ->> 'comment'
           else a.comment
         end
   where a.id = p_appointment_id
     and a.tenant_id = public.current_tenant_id()
  returning jsonb_build_object(
    'id', a.id,
    'status', a.status,
    'comment', a.comment,
    'updated_at', a.updated_at
  ) into v_result;

  return v_result;
end;
$function$
;
grant execute on function public.update_master_appointment_safe(p_appointment_id uuid, p_patch jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.update_receipt(p_receipt_id uuid, p_lines jsonb DEFAULT NULL::jsonb, p_issued_on date DEFAULT NULL::date, p_location_id text DEFAULT NULL::text, p_client_requisites_id text DEFAULT NULL::text)
 RETURNS receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
grant execute on function public.update_receipt(p_receipt_id uuid, p_lines jsonb, p_issued_on date, p_location_id text, p_client_requisites_id text) to authenticated;

CREATE OR REPLACE FUNCTION public.validate_invoice_payment_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  invoice_row public.invoices%rowtype;
  original_row public.finance_transactions%rowtype;
  appointment_row public.appointments%rowtype;
  income_total numeric := 0;
  direct_refunds numeric := 0;
  linked_refunds numeric := 0;
  paid_total numeric := 0;
  remaining_total numeric := 0;
  refunded_original numeric := 0;
  account_team_id text;
  account_kind text;
  -- Деньги заявки вне этого инвойса и работа инвойса (сумма его строк).
  credited_here numeric := 0;
  other_money numeric := 0;
  invoice_work numeric := 0;
begin
  if new.type = 'refund' and new.refund_of_id is not null then
    select * into original_row
      from public.finance_transactions
     where id = new.refund_of_id
       and tenant_id = new.tenant_id
       and type = 'income'
     for update;
    if not found then
      raise exception 'Исходный доход для возврата не найден';
    end if;
    if new.invoice_id is not null
       and new.invoice_id is distinct from original_row.invoice_id then
      raise exception 'Возврат относится к другому инвойсу';
    end if;
    if abs(new.amount) <= 0 then
      raise exception 'Сумма возврата должна быть больше нуля';
    end if;
    new.amount := -round(abs(new.amount), 2);
    if new.account_id is distinct from original_row.account_id
       or (
         new.team_id is not null
         and new.team_id is distinct from original_row.team_id
       ) then
      raise exception 'Возврат должен пройти по исходному счёту и команде';
    end if;
    if new.payment_method is not null
       and new.payment_method is distinct from original_row.payment_method then
      raise exception 'Возврат должен использовать способ исходного платежа';
    end if;

    select coalesce(sum(abs(amount)), 0) into refunded_original
      from public.finance_transactions
     where refund_of_id = original_row.id
       and type = 'refund';
    if refunded_original + abs(new.amount) > greatest(original_row.amount, 0) then
      raise exception 'Возврат превышает остаток исходного дохода';
    end if;

    new.invoice_id := original_row.invoice_id;
    new.currency := original_row.currency;
    new.appointment_id := original_row.appointment_id;
    new.client_id := original_row.client_id;
    new.team_id := original_row.team_id;
    new.master_id := original_row.master_id;
    new.payment_method := original_row.payment_method;
    if new.invoice_id is not null then
      select * into invoice_row
        from public.invoices
       where id = new.invoice_id
         and tenant_id = new.tenant_id
       for update;
      if not found or invoice_row.status = 'void' then
        raise exception 'Инвойс для возврата не найден или аннулирован';
      end if;
    end if;
    return new;
  end if;

  if new.invoice_id is null then
    return new;
  end if;
  if new.type <> 'income' or new.source <> 'manual' then
    raise exception 'К инвойсу можно добавить только ручной платёж или корректный возврат';
  end if;
  if new.amount <= 0 then
    raise exception 'Сумма платежа должна быть больше нуля';
  end if;
  if new.refund_of_id is not null or new.transfer_group_id is not null then
    raise exception 'Платёж инвойса не может быть возвратом или переводом';
  end if;
  if new.payment_method is null
     or new.payment_method not in ('cash', 'card', 'transfer', 'other') then
    raise exception 'Некорректный способ оплаты инвойса';
  end if;

  select * into invoice_row
    from public.invoices
   where id = new.invoice_id
     and tenant_id = new.tenant_id
   for update;
  if not found or invoice_row.status = 'void' then
    raise exception 'Инвойс не найден или аннулирован';
  end if;
  -- Отменённый кредит-нотой инвойс оплату не принимает ни одной дорогой.
  if invoice_row.status = 'cancelled' then
    raise exception 'Инвойс отменён кредит-нотой — оплату по нему принять нельзя';
  end if;
  select brigade_id, kind into account_team_id, account_kind
    from public.accounts
   where id = new.account_id
     and tenant_id = new.tenant_id
     and is_active = true;
  if not found or (
    invoice_row.brigade_id is not null
    and not public.account_serves_team(new.account_id, invoice_row.brigade_id)
  ) then
    raise exception 'Финансовый счёт не найден или не относится к команде инвойса';
  end if;
  if account_kind <> (case new.payment_method
       when 'cash' then 'cash'
       when 'card' then 'card'
       when 'transfer' then 'bank'
       else 'other'
     end) then
    raise exception 'Способ оплаты не соответствует выбранному счёту';
  end if;

  new.currency := invoice_row.currency;
  new.appointment_id := invoice_row.appointment_id;
  new.client_id := invoice_row.client_id;
  new.team_id := coalesce(invoice_row.brigade_id, account_team_id);

  select
    coalesce(sum(case when type = 'income' then greatest(amount, 0) else 0 end), 0),
    coalesce(sum(case when type = 'refund' then abs(amount) else 0 end), 0)
    into income_total, direct_refunds
    from public.finance_transactions
   where invoice_id = invoice_row.id
     and type in ('income', 'refund');
  select coalesce(sum(abs(refund.amount)), 0) into linked_refunds
    from public.finance_transactions refund
    join public.finance_transactions original on original.id = refund.refund_of_id
   where original.invoice_id = invoice_row.id
     and original.type = 'income'
     and refund.type = 'refund'
     and refund.invoice_id is null;
  paid_total := greatest(
    0,
    case
      when invoice_row.status = 'paid' then greatest(invoice_row.total - invoice_row.credited_amount, income_total)
      else income_total
    end - direct_refunds - linked_refunds
  );
  remaining_total := greatest(0, invoice_row.total - invoice_row.credited_amount - paid_total);
  if remaining_total <= 0 or new.amount > remaining_total then
    raise exception 'Платёж превышает остаток инвойса';
  end if;

  -- ДЕНЬГИ ВНЕ ИНВОЙСА — то же правило, что в `record_invoice_payment`, и там
  -- же, после проверки остатка инвойса.
  if invoice_row.appointment_id is not null then
    select * into appointment_row
      from public.appointments
     where id = invoice_row.appointment_id
       and tenant_id = new.tenant_id
     for update;
    if found
       and appointment_row.status <> 'cancelled'
       and appointment_row.payment_status <> 'refunded' then
      select coalesce(sum(least(credit.entry_sum, greatest(credit.net, 0))), 0)
        into credited_here
        from (
          select income.amount - coalesce((
                   select sum(abs(refund.amount))
                     from public.finance_transactions refund
                    where refund.refund_of_id = income.id
                      and refund.type = 'refund'
                 ), 0) as net,
                 (
                   select sum(round((e.elem ->> 'amount')::numeric, 2))
                     from jsonb_array_elements(coalesce(appointment_row.payments, '[]'::jsonb)) as e(elem)
                    where e.elem ->> 'id' = 'pay-inv-' || income.id::text
                 ) as entry_sum
            from public.finance_transactions income
           where income.appointment_id = appointment_row.id
             and income.invoice_id = invoice_row.id
             and income.type = 'income'
             and income.source = 'manual'
        ) credit
       where credit.entry_sum > 0;
      other_money := appointment_row.prepaid_amount + case
          when appointment_row.payment_status in ('partial', 'paid')
            then appointment_row.paid_amount
          else 0
        end - credited_here;
      select coalesce(sum(line.total), 0)
        into invoice_work
        from public.invoice_lines line
       where line.invoice_id = invoice_row.id;
      if other_money > 0
         and other_money + invoice_work > appointment_row.total_amount then
        if appointment_row.total_amount - other_money > 0 then
          raise exception 'По заявке уже есть оплата вне инвойса — аннулируйте инвойс и выставьте новый на остаток % %',
            round(appointment_row.total_amount - other_money, 2), invoice_row.currency;
        end if;
        raise exception 'По заявке уже есть оплата вне инвойса — аннулируйте инвойс';
      end if;
    end if;
  end if;
  return new;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.void_invoice(p_invoice_id uuid)
 RETURNS invoices
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  raise exception 'Инвойс отменяется только кредит-нотой — обновите приложение';
end;
$function$
;
grant execute on function public.void_invoice(p_invoice_id uuid) to anon;
grant execute on function public.void_invoice(p_invoice_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.void_receipt_on_income_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.type <> 'income' then
    return old;
  end if;
  update public.receipts
     set status = 'void'
   where transaction_id = old.id
     and status = 'issued';
  return old;
end;
$function$
;
-- no execute grant to anon/authenticated/service_role

CREATE OR REPLACE FUNCTION public.void_receipt_on_refund()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_id uuid;
  refunded numeric;
  original numeric;
begin
  if tg_op = 'DELETE' then
    if old.type <> 'refund' or old.refund_of_id is null then return old; end if;
    target_id := old.refund_of_id;
  else
    if new.type <> 'refund' or new.refund_of_id is null then return new; end if;
    target_id := new.refund_of_id;
  end if;

  select amount into original
    from public.finance_transactions where id = target_id;
  select coalesce(sum(abs(amount)), 0) into refunded
    from public.finance_transactions
   where refund_of_id = target_id and type = 'refund';

  -- Гасим только при ПОЛНОМ возврате: частичный оставляет чек в силе,
  -- иначе документ на реально полученные деньги исчезал бы.
  if original is null then
    null;
  elsif refunded >= round(original, 2) then
    update public.receipts
       set status = 'void'
     where transaction_id = target_id
       and status = 'issued';
  else
    update public.receipts
       set status = 'issued'
     where transaction_id = target_id
       and status = 'void';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$
;
grant execute on function public.void_receipt_on_refund() to anon;
grant execute on function public.void_receipt_on_refund() to authenticated;
grant execute on function public.void_receipt_on_refund() to service_role;
