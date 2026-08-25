-- Legal invoice snapshots and atomic per-payment refunds.
-- The 14-digit prefix is a unique Supabase CLI migration version.
--
-- Party details are copied into the invoice itself. They can be refreshed by
-- an owner while the issued document has no ledger rows, but are immutable
-- after the first payment. Refunds are tied to one concrete income row and
-- serialize on that row, so concurrent partial refunds cannot over-refund it.

alter table public.invoices
  add column if not exists seller_snapshot jsonb,
  add column if not exists client_snapshot jsonb;

create or replace function public.build_invoice_seller_snapshot(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select jsonb_build_object(
    'schema_version', 1,
    'tenant_id', tenant.id,
    'name', coalesce(nullif(btrim(tenant.legal_name), ''), nullif(btrim(tenant.name), '')),
    'display_name', nullif(btrim(tenant.name), ''),
    'legal_name', nullif(btrim(tenant.legal_name), ''),
    'vat_number', nullif(btrim(tenant.vat_number), ''),
    'business_address', nullif(btrim(tenant.business_address), ''),
    'address', coalesce(
      nullif(btrim(tenant.business_address), ''),
      nullif(
        concat_ws(
          ', ',
          nullif(btrim(tenant.address), ''),
          nullif(btrim(tenant.city), '')
        ),
        ''
      )
    ),
    'city', nullif(btrim(tenant.city), ''),
    'country', nullif(btrim(tenant.country), ''),
    'contact_email', nullif(btrim(tenant.contact_email), ''),
    'contact_phone', nullif(btrim(tenant.contact_phone), ''),
    'iban', nullif(btrim(tenant.iban), ''),
    'bank_name', nullif(btrim(tenant.bank_name), ''),
    'currency', nullif(btrim(tenant.currency), '')
  )
    from public.tenants tenant
   where tenant.id = p_tenant_id
$function$;

create or replace function public.build_invoice_client_snapshot(
  p_tenant_id uuid,
  p_client_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select jsonb_build_object(
    'schema_version', 1,
    'client_id', client.id,
    'full_name', nullif(btrim(client.full_name), ''),
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
$function$;

revoke all on function public.build_invoice_seller_snapshot(uuid)
  from public, anon, authenticated;
revoke all on function public.build_invoice_client_snapshot(uuid, uuid)
  from public, anon, authenticated;

-- Existing documents can only be snapshotted from the best data available at
-- migration time. From this point on every issued document keeps that copy.
update public.invoices invoice
   set seller_snapshot = public.build_invoice_seller_snapshot(invoice.tenant_id),
       client_snapshot = case
         when invoice.client_id is null then null
         else public.build_invoice_client_snapshot(invoice.tenant_id, invoice.client_id)
       end;

alter table public.invoices
  alter column seller_snapshot set not null;

do $constraints$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.invoices'::regclass
       and conname = 'invoices_seller_snapshot_object'
  ) then
    alter table public.invoices
      add constraint invoices_seller_snapshot_object
      check (jsonb_typeof(seller_snapshot) = 'object') not valid;
  end if;
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.invoices'::regclass
       and conname = 'invoices_client_snapshot_object'
  ) then
    alter table public.invoices
      add constraint invoices_client_snapshot_object
      check (client_snapshot is null or jsonb_typeof(client_snapshot) = 'object') not valid;
  end if;
end;
$constraints$;

alter table public.invoices validate constraint invoices_seller_snapshot_object;
alter table public.invoices validate constraint invoices_client_snapshot_object;

-- `_005` correctly freezes paid documents, but its rewrite guard predates the
-- account-deletion cascade. Deleting a tenant first cascades through clients;
-- their `invoice.client_id ON DELETE SET NULL` can reach a paid invoice before
-- the invoice's own tenant cascade. Bypass only after the parent tenant is
-- already gone, while preserving every live-tenant status/economics rule.
create or replace function public.prevent_settled_invoice_rewrite()
returns trigger
language plpgsql
security invoker
set search_path = public
as $function$
declare
  income_total numeric := 0;
  direct_refunds numeric := 0;
  linked_refunds numeric := 0;
  net_paid numeric := 0;
  has_ledger boolean := false;
begin
  -- Never interpret an RLS-hidden tenant row as deletion. Only the
  -- service-role cleanup may bypass, and only after the parent is truly gone.
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
    elsif new.status = 'paid' and net_paid < new.total then
      raise exception 'Статус «Оплачен» требует подтверждённых платежей на всю сумму';
    elsif new.status = 'issued' and net_paid >= new.total then
      raise exception 'Полностью оплаченный инвойс нельзя отметить неоплаченным';
    elsif new.status = 'void' and (old.status <> 'issued' or has_ledger) then
      raise exception 'Аннулировать можно только неоплаченный инвойс без операций';
    elsif new.status not in ('issued', 'paid', 'void') then
      raise exception 'Некорректный статус инвойса';
    end if;
  end if;

  if row(
    new.tenant_id,
    new.number,
    new.year,
    new.seq,
    new.issued_on,
    new.due_on,
    new.client_id,
    new.appointment_id,
    new.brigade_id,
    new.subtotal_net,
    new.vat_percent,
    new.vat_amount,
    new.total,
    new.currency,
    new.notes,
    new.created_by
  ) is distinct from row(
    old.tenant_id,
    old.number,
    old.year,
    old.seq,
    old.issued_on,
    old.due_on,
    old.client_id,
    old.appointment_id,
    old.brigade_id,
    old.subtotal_net,
    old.vat_percent,
    old.vat_amount,
    old.total,
    old.currency,
    old.notes,
    old.created_by
  ) and (
    old.status <> 'issued' or exists (
      select 1
        from public.finance_transactions
       where invoice_id = old.id
         and type in ('income', 'refund')
    ) or exists (
      select 1
        from public.finance_transactions refund
        join public.finance_transactions original on original.id = refund.refund_of_id
       where original.invoice_id = old.id
         and original.type = 'income'
         and refund.type = 'refund'
    )
  ) then
    raise exception 'Инвойс с платежами нельзя редактировать';
  end if;
  return new;
end;
$function$;

revoke all on function public.prevent_settled_invoice_rewrite()
  from public, anon, authenticated;

create or replace function public.capture_invoice_document_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  document_changed boolean := false;
  refresh_requested boolean := false;
  has_ledger boolean := false;
begin
  if tg_op = 'INSERT' then
    new.seller_snapshot := public.build_invoice_seller_snapshot(new.tenant_id);
    if new.seller_snapshot is null then
      raise exception 'Компания для инвойса не найдена';
    end if;
    new.client_snapshot := case
      when new.client_id is null then null
      else public.build_invoice_client_snapshot(new.tenant_id, new.client_id)
    end;
    if new.client_id is not null and new.client_snapshot is null then
      raise exception 'Клиент для инвойса не найден в этой компании';
    end if;
    return new;
  end if;

  -- Let a deliberate tenant deletion cascade through clients/appointments.
  -- Their SET NULL foreign keys can update this row before the invoice's own
  -- tenant cascade deletes it; preserving snapshots here avoids blocking the
  -- account-deletion transaction while never weakening a live tenant.
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
    new.number,
    new.year,
    new.seq,
    new.issued_on,
    new.due_on,
    new.client_id,
    new.appointment_id,
    new.brigade_id,
    new.subtotal_net,
    new.vat_percent,
    new.vat_amount,
    new.total,
    new.currency,
    new.notes,
    new.created_at,
    new.created_by
  ) is distinct from row(
    old.number,
    old.year,
    old.seq,
    old.issued_on,
    old.due_on,
    old.client_id,
    old.appointment_id,
    old.brigade_id,
    old.subtotal_net,
    old.vat_percent,
    old.vat_amount,
    old.total,
    old.currency,
    old.notes,
    old.created_at,
    old.created_by
  );
  refresh_requested := document_changed
    or new.seller_snapshot is distinct from old.seller_snapshot
    or new.client_snapshot is distinct from old.client_snapshot;

  if not refresh_requested then
    -- A status or PDF-path update can never incidentally alter legal parties.
    new.seller_snapshot := old.seller_snapshot;
    new.client_snapshot := old.client_snapshot;
    return new;
  end if;

  select exists (
    select 1
      from public.finance_transactions tx
     where tx.tenant_id = old.tenant_id
       and tx.invoice_id = old.id
       and tx.type in ('income', 'refund')
  ) or exists (
    select 1
      from public.finance_transactions refund
      join public.finance_transactions original
        on original.id = refund.refund_of_id
     where original.tenant_id = old.tenant_id
       and original.invoice_id = old.id
       and original.type = 'income'
       and refund.tenant_id = old.tenant_id
       and refund.type = 'refund'
  ) into has_ledger;

  if old.status <> 'issued' or has_ledger then
    raise exception 'Снимки сторон инвойса неизменяемы после первого платежа';
  end if;

  -- Ignore any JSON supplied by the client. A permitted draft refresh always
  -- derives both parties again from canonical server rows.
  new.seller_snapshot := public.build_invoice_seller_snapshot(new.tenant_id);
  if new.seller_snapshot is null then
    raise exception 'Компания для инвойса не найдена';
  end if;
  new.client_snapshot := case
    when new.client_id is null then null
    else public.build_invoice_client_snapshot(new.tenant_id, new.client_id)
  end;
  if new.client_id is not null and new.client_snapshot is null then
    raise exception 'Клиент для инвойса не найден в этой компании';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_capture_invoice_document_snapshots on public.invoices;
create trigger trg_capture_invoice_document_snapshots
before insert or update on public.invoices
for each row execute function public.capture_invoice_document_snapshots();

revoke all on function public.capture_invoice_document_snapshots()
  from public, anon, authenticated;

-- A draft edit can change only line items while every header value remains
-- byte-identical. Signal a server refresh from the line mutation itself so a
-- changed company/client profile is captured in the same transaction. The
-- existing BEFORE line guard rejects this path after the first payment.
create or replace function public.refresh_invoice_snapshots_from_line_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $function$
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
$function$;

drop trigger if exists trg_refresh_invoice_snapshots_from_lines
  on public.invoice_lines;
create trigger trg_refresh_invoice_snapshots_from_lines
after insert or update or delete on public.invoice_lines
for each row execute function public.refresh_invoice_snapshots_from_line_change();

revoke all on function public.refresh_invoice_snapshots_from_line_change()
  from public, anon, authenticated;

create or replace function public.refund_invoice_payment(
  p_payment_id uuid,
  p_request_id uuid,
  p_amount numeric,
  p_occurred_on date default null,
  p_notes text default null
)
returns public.finance_transactions
language plpgsql
security invoker
set search_path = public
as $function$
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
    when paid_total >= invoice_row.total then 'paid'
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
$function$;

revoke all on function public.refund_invoice_payment(uuid, uuid, numeric, date, text)
  from public, anon;
grant execute on function public.refund_invoice_payment(uuid, uuid, numeric, date, text)
  to authenticated;

do $assertions$
begin
  if exists (
    select 1
      from public.invoices invoice
     where invoice.seller_snapshot is null
        or jsonb_typeof(invoice.seller_snapshot) <> 'object'
  ) then
    raise exception 'invoice hardening: seller snapshot backfill failed';
  end if;
  if not exists (
    select 1
      from pg_trigger trg
     where trg.tgrelid = 'public.invoices'::regclass
       and trg.tgname = 'trg_capture_invoice_document_snapshots'
       and not trg.tgisinternal
  ) then
    raise exception 'invoice hardening: snapshot trigger is missing';
  end if;
  if not exists (
    select 1
      from pg_trigger trg
     where trg.tgrelid = 'public.invoice_lines'::regclass
       and trg.tgname = 'trg_refresh_invoice_snapshots_from_lines'
       and not trg.tgisinternal
  ) then
    raise exception 'invoice hardening: line snapshot trigger is missing';
  end if;
  if has_function_privilege(
       'anon',
       'public.refund_invoice_payment(uuid,uuid,numeric,date,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.refund_invoice_payment(uuid,uuid,numeric,date,text)',
       'EXECUTE'
     ) then
    raise exception 'invoice hardening: refund RPC grants are unsafe';
  end if;
  if has_function_privilege(
       'authenticated',
       'public.build_invoice_seller_snapshot(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.build_invoice_client_snapshot(uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception 'invoice hardening: snapshot builders are client-callable';
  end if;
end;
$assertions$;
