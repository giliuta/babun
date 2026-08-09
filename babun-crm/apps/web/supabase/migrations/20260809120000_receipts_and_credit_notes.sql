-- ДОКУМЕНТЫ: ЧЕК НА КАЖДЫЙ ПРИЁМ ДЕНЕГ И CREDIT NOTE НА ОТКАЗ.
--
-- Владелец 2026-08-09: «инвойс — выборочно, по кнопке; если деньги приходят —
-- значит выписывается чек; кнопка отказа от инвойса создаёт credit note».
--
-- Разница по смыслу: инвойс — ПРОСЬБА заплатить (её выставляют не всегда),
-- чек — ПОДТВЕРЖДЕНИЕ, что деньги получены (он нужен всегда). Поэтому чек
-- рождается автоматически вместе с проводкой, а инвойс — руками.
--
-- Чек нефискальный: печатать фискальные чеки вправе только касса,
-- зарегистрированная в налоговой.

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number text not null,
  year integer not null,
  seq integer not null,
  issued_on date not null,
  amount numeric not null,
  currency text not null default 'EUR',
  vat_rate numeric,
  vat_amount numeric,
  client_id uuid references public.clients(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  -- Операция может быть стёрта; чек переживает её и остаётся документом.
  transaction_id uuid references public.finance_transactions(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  payment_method text,
  status text not null default 'issued',
  seller_snapshot jsonb not null default '{}'::jsonb,
  client_snapshot jsonb,
  created_at timestamptz not null default now(),
  constraint receipts_status_check check (status in ('issued', 'void')),
  constraint receipts_amount_check check (amount > 0)
);

create unique index if not exists ux_receipts_number
  on public.receipts (tenant_id, year, seq);
create index if not exists idx_receipts_client on public.receipts (tenant_id, client_id);
create index if not exists idx_receipts_appointment on public.receipts (tenant_id, appointment_id);
create index if not exists idx_receipts_invoice on public.receipts (tenant_id, invoice_id);
create unique index if not exists ux_receipts_transaction
  on public.receipts (transaction_id) where transaction_id is not null;

alter table public.receipts enable row level security;

drop policy if exists receipts_read on public.receipts;
create policy receipts_read on public.receipts
  for select
  using (tenant_id = public.current_tenant_id()
         and public.current_user_role() in ('owner', 'dispatcher'));
-- Пишет только сервер: номер документа не может назначать клиентское
-- устройство — два телефона офлайн выдали бы один и тот же.

create or replace function public.issue_receipt_for_income()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  receipt_year integer;
  receipt_seq integer;
  seller jsonb;
  buyer jsonb;
begin
  -- Доход без клиента (внесли остаток кассы, исправили ошибку) — не приём
  -- денег от заказчика: чек там не нужен и только засорит серию.
  if new.type <> 'income' or new.client_id is null or new.amount <= 0 then
    return new;
  end if;

  receipt_year := extract(year from new.occurred_on)::integer;
  -- Тот же замок, что у инвойсов: max(seq)+1 без гонки, серия без дыр.
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':rc', 0));
  select coalesce(max(seq), 0) + 1 into receipt_seq
    from public.receipts
   where tenant_id = new.tenant_id and year = receipt_year;

  select jsonb_build_object(
           'name', coalesce(t.legal_name, t.name),
           'address', t.business_address,
           'vat_mode', t.vat_mode,
           'currency', t.currency
         )
    into seller
    from public.tenants t where t.id = new.tenant_id;

  select jsonb_build_object('name', c.full_name, 'phone', c.phone)
    into buyer
    from public.clients c where c.id = new.client_id;

  insert into public.receipts (
    tenant_id, number, year, seq, issued_on, amount, currency,
    vat_rate, vat_amount, client_id, appointment_id, invoice_id,
    transaction_id, account_id, payment_method, seller_snapshot, client_snapshot
  ) values (
    new.tenant_id,
    'RC-' || receipt_year::text || '-' || lpad(receipt_seq::text, 3, '0'),
    receipt_year,
    receipt_seq,
    new.occurred_on,
    round(new.amount, 2),
    coalesce(new.currency, 'EUR'),
    new.vat_rate,
    new.vat_amount,
    new.client_id,
    new.appointment_id,
    new.invoice_id,
    new.id,
    new.account_id,
    new.payment_method,
    coalesce(seller, '{}'::jsonb),
    buyer
  )
  -- ПРЕДИКАТ ОБЯЗАТЕЛЕН: арбитром служит ЧАСТИЧНЫЙ уникальный индекс, и без
  -- повтора его условия Postgres падает прямо в проводке денег.
  on conflict (transaction_id) where transaction_id is not null do nothing;
  return new;
end;
$$;

drop trigger if exists trg_issue_receipt_for_income on public.finance_transactions;
create trigger trg_issue_receipt_for_income
  after insert on public.finance_transactions
  for each row execute function public.issue_receipt_for_income();

-- Возврат ГАСИТ чек, но не стирает его: номер занят навсегда, дыра в серии —
-- первый вопрос любой проверки.
create or replace function public.void_receipt_on_refund()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  refunded numeric;
  original numeric;
begin
  if new.type <> 'refund' or new.refund_of_id is null then
    return new;
  end if;
  select amount into original
    from public.finance_transactions where id = new.refund_of_id;
  select coalesce(sum(abs(amount)), 0) into refunded
    from public.finance_transactions
   where refund_of_id = new.refund_of_id and type = 'refund';
  -- Только при ПОЛНОМ возврате: частичный оставляет чек в силе, иначе
  -- документ на реально полученные деньги исчезал бы.
  if original is not null and refunded >= round(original, 2) then
    update public.receipts
       set status = 'void'
     where transaction_id = new.refund_of_id
       and status = 'issued';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_void_receipt_on_refund on public.finance_transactions;
create trigger trg_void_receipt_on_refund
  after insert on public.finance_transactions
  for each row execute function public.void_receipt_on_refund();

-- ── CREDIT NOTE ────────────────────────────────────────────────────
-- Выставленный документ нельзя стереть: у клиента на руках бумага с номером.
-- Его сторнируют встречным документом той же силы. `void` остаётся легаси-
-- статусом «внутренне отменён»: смешивать «удалили по ошибке» и
-- «сторнировали документом» нельзя.

alter table public.invoices
  add column if not exists kind text not null default 'invoice',
  add column if not exists credit_note_of_id uuid references public.invoices(id) on delete restrict;

alter table public.invoices drop constraint if exists invoices_kind_check;
alter table public.invoices add constraint invoices_kind_check
  check (kind in ('invoice', 'credit_note'));

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices add constraint invoices_status_check
  check (status in ('issued', 'paid', 'void', 'cancelled'));

create index if not exists idx_invoices_credit_note_of
  on public.invoices (credit_note_of_id) where credit_note_of_id is not null;

create or replace function public.cancel_invoice(
  p_invoice_id uuid,
  p_reason text default null
) returns public.invoices
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  tenant_uuid uuid := public.current_tenant_id();
  original public.invoices%rowtype;
  note_row public.invoices%rowtype;
  note_year integer;
  note_seq integer;
  paid_total numeric;
begin
  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Отменить инвойс может только владелец';
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

  -- Оплаченный документ сторнируется только вместе с возвратом денег: иначе
  -- бумага говорит «отменено», а деньги лежат в кассе.
  select coalesce(sum(amount), 0) into paid_total
    from public.finance_transactions
   where invoice_id = original.id and type = 'income';
  if paid_total > 0 then
    raise exception 'По инвойсу уже прошла оплата — сначала оформите возврат';
  end if;

  note_year := extract(year from current_date)::integer;
  perform pg_advisory_xact_lock(hashtextextended(tenant_uuid::text || ':cn', 0));
  select coalesce(max(seq), 0) + 1 into note_seq
    from public.invoices
   where tenant_id = tenant_uuid and year = note_year and kind = 'credit_note';

  insert into public.invoices (
    tenant_id, number, year, seq, issued_on, client_id, appointment_id,
    brigade_id, subtotal_net, vat_percent, vat_amount, total, currency,
    status, kind, credit_note_of_id, notes, created_by,
    seller_snapshot, client_snapshot
  ) values (
    tenant_uuid,
    'CN-' || note_year::text || '-' || lpad(note_seq::text, 3, '0'),
    note_year,
    note_seq,
    current_date,
    original.client_id,
    original.appointment_id,
    original.brigade_id,
    -original.subtotal_net,
    original.vat_percent,
    -original.vat_amount,
    -original.total,
    original.currency,
    'issued',
    'credit_note',
    original.id,
    coalesce(nullif(btrim(p_reason), ''), 'Отмена инвойса ' || original.number),
    auth.uid(),
    original.seller_snapshot,
    original.client_snapshot
  )
  returning * into note_row;

  update public.invoices
     set status = 'cancelled', updated_at = now()
   where id = original.id;

  return note_row;
end;
$$;

revoke all on function public.cancel_invoice(uuid, text) from public, anon;
grant execute on function public.cancel_invoice(uuid, text) to authenticated;
