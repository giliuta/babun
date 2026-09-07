-- ДВЕРИ ДЕНЕГ ЗАПИСИ: record_appointment_payment / cancel_appointment_payment
-- (STORY-066 — сервер под блок «Оплата» STORY-065; владелец 2026-09-05/06).
--
-- «Бригадир тапает счёт, на который оплатили, и деньги заходят в финансы на
--  этот счёт… Бригадир нажал „на карту“, но оплата не поступила — я могу
--  снять это, и бригадир может в любой момент снять эту сумму, и оно
--  переводится в долг».
--
-- До сих пор клиент собирал ПЯТЬ зеркал записи сам (`buildDebtPaidPatch`) и
-- слал UPDATE, а роль `master` через `update_master_appointment_safe` могла
-- менять только статус и заметку — бригадир оплату записать не мог вовсе.
-- Снятие умели только `undo_appointment_payment` (вся доплата разом, только
-- владелец, словом «Возврат») и `reset_appointment_payment` (всё целиком).
--
-- Что меняется.
--   1. `record_appointment_payment` — одно событие денег: сумма → счёт.
--      Проверяет доступ (владелец, диспетчер, команда записи), счёт
--      (активен, «показывать в оплате», обслуживает команду), сумму
--      (≤ остатка, два знака), дедуп по `p_request_id`; дописывает леджер
--      (`payments[]` для доплаты, новый `prepayments[]` для предоплаты) и
--      зеркала ровно как клиент, а проводку рождает существующий триггер —
--      одна дельта, одна строка на переданный счёт. Дата проводки —
--      день оплаты из `p_paid_at` (офлайн-оплата вечером ложится в вечер),
--      но не позже рабочего дня компании.
--   2. `cancel_appointment_payment` — снятие КОНКРЕТНОГО платежа: сторно
--      против его же строки дохода (`reversal_kind = 'not_received'`,
--      «Оплата снята: деньги не поступили»), платёж уходит из леджера,
--      зеркала пересчитываются, статус визита не трогается — запись
--      возвращается в остаток/долг. Чек гасит существующий
--      `void_receipt_on_refund`. Это НЕ возврат клиенту.
--   3. Проводка знает свой платёж (`finance_transactions.appointment_payment_id`):
--      `reconcile_appointment_finance` читает контекст `appointment_payment_meta`
--      и ставит id и дату; снятие ищет строку по ссылке, а для платежей до
--      этой миграции — по признакам и только при однозначности.
--   4. `appointments.prepayments` — происхождение предоплат (id, счёт, время);
--      сумма по-прежнему в `prepaid_amount`, старые клиенты колонку не видят.
--
-- Что НЕ меняется: формулы reconcile, сторожа, возвраты клиенту, инвойсы.
-- Тела `reconcile_appointment_finance` и `protect_paid_appointment_finance`
-- воспроизведены из базы дословно; добавлены только чтение контекста и
-- пропуск нового контекста снятия.

-- ─── 1. Контекст записи денег: полезная нагрузка и два новых вида ────────────

alter table public._finance_write_context
  add column if not exists occurred_on date,
  add column if not exists payment_id text;

alter table public._finance_write_context
  drop constraint if exists _finance_write_context_kind_check;
alter table public._finance_write_context
  add constraint _finance_write_context_kind_check
  check (kind in (
    'appointment_auto',
    'appointment_undo',
    'appointment_prepayment',
    'appointment_payment_reset',
    'transfer_write',
    'invoice_payment',
    'appointment_payment_meta',
    'appointment_payment_cancel'
  ));

-- ─── 2. Проводка знает свой платёж; сторно знает, почему оно ────────────────

alter table public.finance_transactions
  add column if not exists appointment_payment_id text,
  add column if not exists reversal_kind text;

alter table public.finance_transactions
  drop constraint if exists finance_transactions_reversal_kind_check;
alter table public.finance_transactions
  add constraint finance_transactions_reversal_kind_check
  check (reversal_kind is null or reversal_kind in ('not_received', 'client_refund'));

create index if not exists idx_finance_tx_appointment_payment_id
  on public.finance_transactions (appointment_id, appointment_payment_id)
  where appointment_payment_id is not null;

comment on column public.finance_transactions.appointment_payment_id is
  'id платежа из appointments.payments[] / prepayments[], которым рождена проводка. NULL — платёж до 2026-09-06 или ручная операция.';
comment on column public.finance_transactions.reversal_kind is
  'Почему сторно: not_received — оплата снята, деньги не поступили (не возврат клиенту); client_refund — возврат клиенту. NULL — не сторно или старая строка.';

-- ─── 3. Предоплаты записи с происхождением ──────────────────────────────────

alter table public.appointments
  add column if not exists prepayments jsonb not null default '[]'::jsonb;

comment on column public.appointments.prepayments is
  'Предоплаты как события: [{id, method, amount, paid_at, account_id}]. Сумма живёт в prepaid_amount; расхождение суммы означает предоплату, записанную старым путём.';

-- ─── 4. Зеркало legacy-объекта payment из леджера (как paymentMirrorFromLedger) ─

create or replace function public.appointment_payment_mirror(p_payments jsonb)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
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
$$;

revoke all on function public.appointment_payment_mirror(jsonb) from public, anon;

-- ─── 5. Кто вправе записывать и снимать деньги по заявке ────────────────────

create or replace function public.current_user_can_pay_appointment(
  p_team_id text,
  p_master_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  role_name text := coalesce(public.current_user_role(), '');
begin
  if auth.uid() is null then
    return false;
  end if;
  if role_name in ('owner', 'dispatcher') then
    return true;
  end if;
  if role_name = 'master' then
    return (p_team_id is not null and p_team_id = any(public.current_user_team_ids()))
        or (p_master_id is not null and p_master_id = public.current_user_master_id());
  end if;
  return false;
end;
$$;

revoke all on function public.current_user_can_pay_appointment(text, text) from public, anon;
grant execute on function public.current_user_can_pay_appointment(text, text) to authenticated;

-- ─── 6. reconcile_appointment_finance: контекст платежа и пропуск снятия ─────

create or replace function public.reconcile_appointment_finance(
  p_appointment_id uuid,
  p_old_total numeric,
  p_old_prepaid numeric,
  p_old_paid numeric,
  p_old_payment_status text,
  p_old_status text,
  p_is_insert boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  appointment_row public.appointments%rowtype;
  services_category_id uuid;
  refund_category_id uuid;
  resolved_account_id uuid;
  old_prepayment_target numeric := 0;
  old_settlement_target numeric := 0;
  new_prepayment_target numeric := 0;
  new_settlement_target numeric := 0;
  prepayment_delta numeric := 0;
  settlement_delta numeric := 0;
  total_delta numeric := 0;
  income_count integer := 0;
  legacy_income_count integer := 0;
  received_amount numeric := 0;
  adjustment record;
  income_candidate record;
  remaining_refund numeric := 0;
  refund_piece numeric := 0;
  business_today date;
  meta_occurred_on date;
  meta_payment_id text;
begin
  -- Деньги уже проведены платежом инвойса — заявка лишь отражает их.
  if exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'invoice_payment'
       and entity_id = p_appointment_id
  ) then
    return;
  end if;
  -- Платёж снят RPC: сторно уже написано против его строки, здесь ничего.
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
  -- Событие денег, записанное RPC, несёт свою дату и свой id платежа.
  select c.occurred_on, c.payment_id
    into meta_occurred_on, meta_payment_id
    from public._finance_write_context c
   where c.transaction_id = txid_current()
     and c.kind = 'appointment_payment_meta'
     and c.entity_id = p_appointment_id
   limit 1;

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

  if not p_is_insert
     and p_old_status <> 'cancelled'
     and p_old_payment_status <> 'refunded' then
    old_prepayment_target := greatest(coalesce(p_old_prepaid, 0), 0);
    old_settlement_target := case p_old_payment_status
      when 'paid' then greatest(
        coalesce(p_old_total, 0) - coalesce(p_old_prepaid, 0),
        0
      )
      when 'partial' then greatest(coalesce(p_old_paid, 0), 0)
      else 0
    end;
  end if;

  select
    count(*),
    count(*) filter (where appointment_payment_kind is null)
    into income_count, legacy_income_count
    from public.finance_transactions
   where appointment_id = appointment_row.id
     and source = 'auto'
     and type = 'income';

  if income_count = 0 then
    prepayment_delta := new_prepayment_target;
    settlement_delta := new_settlement_target;
  elsif legacy_income_count > 0 then
    total_delta :=
      (new_prepayment_target + new_settlement_target)
      - (old_prepayment_target + old_settlement_target);
  else
    prepayment_delta := new_prepayment_target - old_prepayment_target;
    settlement_delta := new_settlement_target - old_settlement_target;
  end if;

  if prepayment_delta = 0 and settlement_delta = 0 and total_delta = 0 then
    return;
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
        appointment_payment_kind, notes, appointment_payment_id
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
        meta_payment_id
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
$$;

-- ─── 7. protect_paid_appointment_finance: пропуск контекста снятия платежа ───

create or replace function public.protect_paid_appointment_finance()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
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
  select exists (
    select 1 from public.finance_transactions
     where appointment_id = old.id
       and source = 'auto'
       and type = 'income'
       and coalesce(appointment_payment_kind, 'settlement') = 'settlement'
  ) into has_settlement;

  if (
    has_linked_finance
    or exists (select 1 from public.invoices where appointment_id = old.id)
  ) and (
    new.client_id is distinct from old.client_id
    or new.team_id is distinct from old.team_id
    or new.master_id is distinct from old.master_id
  ) then
    raise exception 'Сначала верните оплату; клиента, команду и исполнителя менять нельзя';
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
  -- Деньги уже проведены платежом (или возвратом) по инвойсу; заявка лишь
  -- отражает их у себя, и своих проводок здесь не рождается.
  select exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'invoice_payment'
       and entity_id = old.id
       and tenant_id = old.tenant_id
  ) into invoice_payment_context;
  -- Платёж снят RPC `cancel_appointment_payment`: сторно уже написано, зеркала
  -- пересчитала сама RPC — сторож пропускает так же, как сброс оплаты.
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
    if old.status = 'cancelled' or old.payment_status = 'refunded' then
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
     or new.total_amount is distinct from old.total_amount
     or new.custom_total is distinct from old.custom_total
     or new.discount_amount is distinct from old.discount_amount
     or new.services is distinct from old.services
     or new.service_ids is distinct from old.service_ids
     or new.service_price_overrides is distinct from old.service_price_overrides
     or new.global_discount is distinct from old.global_discount
     or new.payment_method is distinct from old.payment_method
     or new.prepaid_amount is distinct from old.prepaid_amount
     or new.payment is distinct from old.payment
     or new.payments is distinct from old.payments
     or (new.status is distinct from old.status and not is_cancel_transition)
     or (new.paid_amount is distinct from old.paid_amount and not is_refund_transition)
     or (new.payment_status is distinct from old.payment_status and not is_refund_transition)
     or ((old.status = 'cancelled' or old.payment_status = 'refunded') and
       (new.status is distinct from old.status or new.payment_status is distinct from old.payment_status)) then
    raise exception 'Сначала отмените оплату или оформите возврат по заявке';
  end if;
  return new;
end;
$$;

-- ─── 8. record_appointment_payment ──────────────────────────────────────────

create or replace function public.record_appointment_payment(
  p_appointment_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_request_id uuid,
  p_kind text default 'settlement',
  p_paid_at timestamptz default now(),
  p_close_visit boolean default false
)
returns public.appointments
language plpgsql
security definer
set search_path to 'public'
as $$
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

  -- Повтор запроса после обрыва сети: платёж уже записан — вернуть как есть.
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
  if appt.team_id is null then
    raise exception 'У заявки нет команды — некуда положить деньги';
  end if;
  if appt.total_amount is null or appt.total_amount <= 0 then
    raise exception 'У заявки нет суммы — сначала укажите итог';
  end if;

  -- Счёт: тот же фильтр, что у пикера касс (list_payment_accounts_safe).
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

  -- Дата проводки — день оплаты в рабочем поясе компании, но не будущий.
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

  -- Доплата: остаток считается в центах, как на клиенте (appointmentDebtCents).
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
$$;

revoke all on function public.record_appointment_payment(uuid, uuid, numeric, uuid, text, timestamptz, boolean)
  from public, anon;
grant execute on function public.record_appointment_payment(uuid, uuid, numeric, uuid, text, timestamptz, boolean)
  to authenticated;

-- ─── 9. cancel_appointment_payment ──────────────────────────────────────────

create or replace function public.cancel_appointment_payment(
  p_appointment_id uuid,
  p_payment_id text,
  p_request_id uuid
)
returns public.appointments
language plpgsql
security definer
set search_path to 'public'
as $$
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
begin
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

  -- Повтор после обрыва сети: сторно с этим id уже записано.
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

  -- Проводка платежа: по ссылке, а для платежей до этой миграции — по
  -- признакам и только если она одна.
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
  if exists (
    select 1 from public.finance_transactions r
     where r.refund_of_id = income.id and r.type = 'refund'
  ) then
    raise exception 'По этому платежу уже есть возврат';
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

  -- Сторно против своей строки дохода. source='auto', потому что доход
  -- автоматический (сторож возвратов требует того же источника).
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
    p_request_id, tenant_uuid, 'refund', -round(income.amount, 2), income.currency,
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

  -- Заявка: платёж уходит из леджера, зеркала пересчитываются, статус визита
  -- не меняется — работа была, денег нет, это долг.
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
$$;

revoke all on function public.cancel_appointment_payment(uuid, text, uuid) from public, anon;
grant execute on function public.cancel_appointment_payment(uuid, text, uuid) to authenticated;
