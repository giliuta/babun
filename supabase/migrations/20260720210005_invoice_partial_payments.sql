-- Atomic partial payments for an invoice.
-- The 14-digit prefix is a unique Supabase CLI migration version.
--
-- The invoice row is locked for the duration of the calculation + insert, so
-- two owner devices cannot both spend the same remaining balance. A
-- client-generated request UUID makes a transport retry idempotent.

-- Invoice receipts need the same business date as the rest of the ledger.
-- Define the helper before the payment RPC; _006 replaces it with the same
-- contract for the appointment-finance rollout.
create or replace function public.tenant_business_date(p_tenant_id uuid)
returns date
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  tenant_timezone text;
begin
  select settings.timezone into tenant_timezone
    from public.calendar_settings settings
   where settings.tenant_id = p_tenant_id;
  tenant_timezone := coalesce(
    nullif(btrim(tenant_timezone), ''),
    'Europe/Nicosia'
  );
  begin
    return (current_timestamp at time zone tenant_timezone)::date;
  exception when invalid_parameter_value then
    return (current_timestamp at time zone 'Europe/Nicosia')::date;
  end;
end;
$function$;

revoke all on function public.tenant_business_date(uuid)
  from public, anon, authenticated;

create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_request_id uuid,
  p_amount numeric,
  p_account_id uuid,
  p_payment_method text,
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
  invoice_row public.invoices%rowtype;
  account_row public.accounts%rowtype;
  payment_row public.finance_transactions%rowtype;
  income_total numeric(12,2) := 0;
  direct_refunds numeric(12,2) := 0;
  linked_refunds numeric(12,2) := 0;
  paid_total numeric(12,2) := 0;
  remaining_total numeric(12,2) := 0;
  amount_value numeric(12,2);
  payment_date date;
  affected integer := 0;
begin
  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Недостаточно прав для оплаты инвойса';
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
     and account_row.brigade_id is distinct from invoice_row.brigade_id then
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
        then greatest(invoice_row.total, income_total)
      else income_total
    end - direct_refunds - linked_refunds
  );
  remaining_total := greatest(0, invoice_row.total - paid_total);

  if remaining_total <= 0 then
    raise exception 'Инвойс уже полностью оплачен';
  end if;
  if amount_value > remaining_total then
    raise exception 'Платёж превышает остаток % %', round(remaining_total, 2), invoice_row.currency;
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
    source
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
    'manual'
  )
  returning * into payment_row;

  update public.invoices
     set status = case
       when paid_total + amount_value >= invoice_row.total then 'paid'
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
$function$;

revoke all on function public.record_invoice_payment(uuid, uuid, numeric, uuid, text, date, text)
  from public;
grant execute on function public.record_invoice_payment(uuid, uuid, numeric, uuid, text, date, text)
  to authenticated;

-- Voiding uses the same row lock as payment recording. This closes the race
-- where one device could accept money while another voided the invoice.
create or replace function public.void_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
security invoker
set search_path = public
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  invoice_row public.invoices%rowtype;
  affected integer := 0;
begin
  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Недостаточно прав для аннулирования инвойса';
  end if;

  select * into invoice_row
    from public.invoices
   where id = p_invoice_id
     and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Инвойс не найден или недоступен';
  end if;
  if invoice_row.status = 'void' then
    return invoice_row;
  end if;
  if invoice_row.status <> 'issued' then
    raise exception 'Оплаченный инвойс нельзя аннулировать';
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
      join public.finance_transactions original
        on original.id = refund.refund_of_id
     where original.tenant_id = tenant_uuid
       and original.invoice_id = invoice_row.id
       and refund.tenant_id = tenant_uuid
       and refund.type = 'refund'
  ) then
    raise exception 'Инвойс с платежами нельзя аннулировать';
  end if;

  update public.invoices
     set status = 'void'
   where id = invoice_row.id
     and tenant_id = tenant_uuid
     and status = 'issued'
  returning * into invoice_row;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Аннулирование инвойса не подтверждено';
  end if;
  return invoice_row;
end;
$function$;

revoke all on function public.void_invoice(uuid) from public;
grant execute on function public.void_invoice(uuid) to authenticated;

-- Invoice creation (number allocation, document, lines, and optional income
-- link) is one transaction. The request UUID is also the invoice UUID, which
-- makes a transport retry idempotent without another bookkeeping table.
create or replace function public.issue_invoice(
  p_request_id uuid,
  p_issued_on date,
  p_due_on date,
  p_client_id uuid,
  p_appointment_id uuid,
  p_brigade_id text,
  p_vat_mode text,
  p_vat_percent numeric,
  p_lines jsonb,
  p_notes text default null,
  p_link_to_tx_id uuid default null
)
returns public.invoices
language plpgsql
security invoker
set search_path = public
as $function$
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
  affected integer := 0;
  invoice_year integer;
  invoice_seq integer;
  invoice_prefix text;
  invoice_currency text := 'EUR';
  tenant_currency text;
  resolved_client_id uuid := p_client_id;
  resolved_appointment_id uuid := p_appointment_id;
  resolved_brigade_id text := p_brigade_id;
  appointment_client_id uuid;
  appointment_team_id text;
begin
  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
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
    if unit_price_value is null or unit_price_value < 0 or unit_price_value > 999999999 then
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
    select client_id, team_id into appointment_client_id, appointment_team_id
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

  -- A single per-tenant lock makes max(seq)+1 safe and also serializes two
  -- concurrent retries carrying the same request UUID.
  perform pg_advisory_xact_lock(hashtextextended(tenant_uuid::text, 0));
  select * into invoice_row
    from public.invoices
   where id = p_request_id
     and tenant_id = tenant_uuid;
  if found then
    return invoice_row;
  end if;

  invoice_year := extract(year from p_issued_on)::integer;
  select tenant.invoice_prefix, tenant.currency
    into invoice_prefix, tenant_currency
    from public.tenants as tenant
   where tenant.id = tenant_uuid;
  if p_link_to_tx_id is null then
    invoice_currency := coalesce(nullif(btrim(tenant_currency), ''), 'EUR');
  end if;
  invoice_prefix := regexp_replace(btrim(coalesce(invoice_prefix, 'INV')), '[[:space:]-]+$', '');
  if invoice_prefix = '' then invoice_prefix := 'INV'; end if;
  select coalesce(max(seq), 0) + 1 into invoice_seq
    from public.invoices
   where tenant_id = tenant_uuid
     and year = invoice_year;

  insert into public.invoices (
    id, tenant_id, number, year, seq, issued_on, due_on, client_id,
    appointment_id, brigade_id, subtotal_net, vat_percent, vat_amount,
    total, currency, status, notes, created_by
  ) values (
    p_request_id,
    tenant_uuid,
    invoice_prefix || '-' || invoice_year::text || '-' || lpad(invoice_seq::text, 3, '0'),
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
    auth.uid()
  )
  returning * into invoice_row;

  insert into public.invoice_lines (
    invoice_id, position, title, qty, unit_price, total
  )
  select
    invoice_row.id,
    ordinality::integer - 1,
    btrim(value->>'title'),
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
$function$;

revoke all on function public.issue_invoice(
  uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid
) from public;
grant execute on function public.issue_invoice(
  uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid
) to authenticated;

-- Header + line replacement is one transaction under the same row lock used
-- by payment and void RPCs. A payment can therefore happen entirely before
-- or entirely after an edit, never in the middle of it.
create or replace function public.update_invoice_draft(
  p_invoice_id uuid,
  p_due_on date,
  p_client_id uuid,
  p_appointment_id uuid,
  p_brigade_id text,
  p_vat_mode text,
  p_vat_percent numeric,
  p_lines jsonb,
  p_notes text default null
)
returns public.invoices
language plpgsql
security invoker
set search_path = public
as $function$
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
  old_line_count integer := 0;
  affected integer := 0;
  appointment_client_id uuid;
  appointment_team_id text;
  resolved_client_id uuid := p_client_id;
  resolved_brigade_id text := p_brigade_id;
begin
  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Недостаточно прав для редактирования инвойса';
  end if;

  select * into invoice_row
    from public.invoices
   where id = p_invoice_id
     and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Инвойс не найден или недоступен';
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

  if p_due_on is not null and p_due_on < invoice_row.issued_on then
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
    if unit_price_value is null or unit_price_value < 0 or unit_price_value > 999999999 then
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

  update public.invoices
     set due_on = p_due_on,
         client_id = resolved_client_id,
         appointment_id = p_appointment_id,
         brigade_id = resolved_brigade_id,
         subtotal_net = base_total,
         vat_percent = vat_rate,
         vat_amount = vat_total,
         total = invoice_total,
         notes = nullif(btrim(p_notes), '')
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
    invoice_id, position, title, qty, unit_price, total
  )
  select
    invoice_row.id,
    ordinality::integer - 1,
    btrim(value->>'title'),
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
$function$;

revoke all on function public.update_invoice_draft(
  uuid, date, uuid, uuid, text, text, numeric, jsonb, text
) from public;
grant execute on function public.update_invoice_draft(
  uuid, date, uuid, uuid, text, text, numeric, jsonb, text
) to authenticated;

-- Once money exists, document economics are immutable. The app checks this
-- early for a friendly message; the trigger is the race-safe final guard.
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

    -- Historic imports can carry status='paid' without a ledger row. They are
    -- preserved as immutable paid documents instead of being silently reopened.
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

drop trigger if exists trg_prevent_settled_invoice_rewrite on public.invoices;
create trigger trg_prevent_settled_invoice_rewrite
before update on public.invoices
for each row execute function public.prevent_settled_invoice_rewrite();
revoke all on function public.prevent_settled_invoice_rewrite()
  from public, anon, authenticated;

create or replace function public.prevent_settled_invoice_delete()
returns trigger
language plpgsql
security invoker
set search_path = public
as $function$
begin
  -- Let tenant deletion cascade through its children.
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;
  -- Invoice numbers form a legal/audit sequence. Even an unpaid document is
  -- retained and marked void; hard deletion would create an unexplained gap
  -- and make an already shared PDF disappear from the ledger.
  raise exception 'Инвойс нельзя удалить; аннулируйте документ';
end;
$function$;

drop trigger if exists trg_prevent_settled_invoice_delete on public.invoices;
create trigger trg_prevent_settled_invoice_delete
before delete on public.invoices
for each row execute function public.prevent_settled_invoice_delete();
revoke all on function public.prevent_settled_invoice_delete()
  from public, anon, authenticated;

create or replace function public.assert_invoice_lines_mutable()
returns trigger
language plpgsql
security invoker
set search_path = public
as $function$
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
$function$;

drop trigger if exists trg_assert_invoice_lines_mutable on public.invoice_lines;
create trigger trg_assert_invoice_lines_mutable
before insert or update or delete on public.invoice_lines
for each row execute function public.assert_invoice_lines_mutable();
revoke all on function public.assert_invoice_lines_mutable()
  from public, anon, authenticated;

create or replace function public.protect_invoice_payment_row()
returns trigger
language plpgsql
security invoker
set search_path = public
as $function$
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
$function$;

drop trigger if exists trg_protect_invoice_payment_row
  on public.finance_transactions;
create trigger trg_protect_invoice_payment_row
before update or delete on public.finance_transactions
for each row execute function public.protect_invoice_payment_row();
revoke all on function public.protect_invoice_payment_row()
  from public, anon, authenticated;

create or replace function public.validate_invoice_payment_insert()
returns trigger
language plpgsql
security invoker
set search_path = public
as $function$
declare
  invoice_row public.invoices%rowtype;
  original_row public.finance_transactions%rowtype;
  income_total numeric := 0;
  direct_refunds numeric := 0;
  linked_refunds numeric := 0;
  paid_total numeric := 0;
  remaining_total numeric := 0;
  refunded_original numeric := 0;
  account_team_id text;
  account_kind text;
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
       or new.team_id is distinct from original_row.team_id then
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
  select brigade_id, kind into account_team_id, account_kind
    from public.accounts
   where id = new.account_id
     and tenant_id = new.tenant_id
     and is_active = true;
  if not found or (
    invoice_row.brigade_id is not null
    and account_team_id is distinct from invoice_row.brigade_id
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
      when invoice_row.status = 'paid' then greatest(invoice_row.total, income_total)
      else income_total
    end - direct_refunds - linked_refunds
  );
  remaining_total := greatest(0, invoice_row.total - paid_total);
  if remaining_total <= 0 or new.amount > remaining_total then
    raise exception 'Платёж превышает остаток инвойса';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_validate_invoice_payment_insert
  on public.finance_transactions;
create trigger trg_validate_invoice_payment_insert
before insert on public.finance_transactions
for each row execute function public.validate_invoice_payment_insert();
revoke all on function public.validate_invoice_payment_insert()
  from public, anon, authenticated;

-- Keep the legal status aligned with the ledger even when a refund is
-- created from the ordinary finance screen. The UI also derives settlement,
-- but persistence must never leave `paid` on an invoice with a remainder.
create or replace function public.sync_invoice_status_from_ledger()
returns trigger
language plpgsql
security invoker
set search_path = public
as $function$
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
    select total, status into invoice_total, invoice_status
      from public.invoices
     where id = target_invoice_id
     for update;
    if not found or invoice_status = 'void' then
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
$function$;

drop trigger if exists trg_sync_invoice_status_from_ledger
  on public.finance_transactions;
create trigger trg_sync_invoice_status_from_ledger
after insert or update or delete on public.finance_transactions
for each row execute function public.sync_invoice_status_from_ledger();
revoke all on function public.sync_invoice_status_from_ledger()
  from public, anon, authenticated;

-- Reconcile rows that existed before the trigger (notably an old paid income
-- followed by a refund). Paid invoices without any ledger row are intentional
-- legacy records and remain paid.
with direct as (
  select
    invoice_id,
    coalesce(sum(case when type = 'income' then greatest(amount, 0) else 0 end), 0) as income,
    coalesce(sum(case when type = 'refund' then abs(amount) else 0 end), 0) as refunds
  from public.finance_transactions
  where invoice_id is not null and type in ('income', 'refund')
  group by invoice_id
), legacy_refunds as (
  select
    original.invoice_id,
    coalesce(sum(abs(refund.amount)), 0) as refunds
  from public.finance_transactions refund
  join public.finance_transactions original on original.id = refund.refund_of_id
  where original.invoice_id is not null
    and original.type = 'income'
    and refund.type = 'refund'
    and refund.invoice_id is null
  group by original.invoice_id
)
update public.invoices invoice
   set status = case
     when greatest(0, direct.income - direct.refunds - coalesce(legacy_refunds.refunds, 0))
          >= invoice.total then 'paid'
     else 'issued'
   end
  from direct
  left join legacy_refunds on legacy_refunds.invoice_id = direct.invoice_id
 where invoice.id = direct.invoice_id
   and invoice.status <> 'void';
