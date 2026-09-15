-- НДС ЗАПИСИ — «С НДС / БЕЗ НДС» ПРЯМО В ОПЛАТЕ (владелец 2026-09-15: «есть
-- записи, которые оплачиваются с НДС, есть записи, которые оплачиваются без
-- НДС»).
--
-- До этой миграции налог дохода по записи решал только счёт, на который легли
-- деньги. Владелец спрашивает о самой записи: этот клиент платит с НДС или без.
-- Выбор записи сильнее счёта и живёт ДО ПЕРВОЙ ОПЛАТЫ: каждая оплата снимает
-- налог в свою проводку (и в чек), а менять его задним числом значило бы
-- переписывать уже пробитые чеки.
--
-- `appointments.vat_mode`:
--   null  — как у счёта / команды / компании (так было всегда);
--   'on'  — с НДС: режим и ставка — от команды, выключенный у команды — от
--           компании; компания без НДС налог не включает;
--   'off' — без НДС.

alter table public.appointments
  add column if not exists vat_mode text
  check (vat_mode is null or vat_mode in ('on', 'off'));

comment on column public.appointments.vat_mode is
  'НДС записи: null — как у счёта/команды/компании; on — с НДС; off — без НДС. Меняется только до первой оплаты.';

-- СТРАЖ: НДС записи меняется только до первой оплаты — любой дорогой, не
-- только через `set_appointment_vat_mode`.
create or replace function public.guard_appointment_vat_mode()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.vat_mode is distinct from old.vat_mode and exists (
    select 1 from public.finance_transactions
     where appointment_id = old.id and source = 'auto' and type = 'income'
  ) then
    raise exception 'НДС записи выбирают до первой оплаты — сначала отмените оплату';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_appointment_vat_mode on public.appointments;
create trigger trg_guard_appointment_vat_mode
  before update of vat_mode on public.appointments
  for each row execute function public.guard_appointment_vat_mode();

-- ДВЕРЬ ВЫБОРА. Права — те же, что у приёма денег: кто может записать оплату
-- заявки, тот и говорит, с налогом ли она.
create or replace function public.set_appointment_vat_mode(
  p_appointment_id uuid,
  p_vat_mode text
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
begin
  if auth.uid() is null or tenant_uuid is null then
    raise exception 'Войдите в приложение, чтобы выбрать НДС записи';
  end if;
  if p_vat_mode is not null and p_vat_mode not in ('on', 'off') then
    raise exception 'Неизвестный режим НДС записи';
  end if;

  select * into appt
    from public.appointments
   where id = p_appointment_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Заявка не найдена';
  end if;
  if not public.current_user_can_pay_appointment(appt.team_id, appt.master_id) then
    raise exception 'НДС записи выбирает владелец, диспетчер или её команда';
  end if;
  if appt.kind is distinct from 'work' then
    raise exception 'НДС выбирают только у рабочей заявки';
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
$$;

revoke all on function public.set_appointment_vat_mode(uuid, text) from public, anon;
grant execute on function public.set_appointment_vat_mode(uuid, text) to authenticated;

-- ДОХОД ЗАПИСИ НЕСЁТ ЕЁ НДС. Выбор записи превращается в снимок налога прямо
-- в строке дохода: `off` — явное «без НДС» ('none'), `on` — готовый снимок по
-- ставке команды/компании (триггер `fill_transaction_vat` присланный снимок
-- уважает). Пустой выбор ничего не пишет — налог решает счёт, как и раньше.
-- Остальное тело функции не менялось.
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
  income_vat_mode text;
  income_vat_rate numeric;
  vat_tenant_mode text;
  vat_team_mode text;
  vat_rate_value numeric;
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

  -- НДС ЗАПИСИ (appointment_vat_choice): выбор записи сильнее счёта.
  if appointment_row.vat_mode = 'off' then
    income_vat_mode := 'none';
  elsif appointment_row.vat_mode = 'on' then
    select t.vat_mode, s.vat_mode, coalesce(s.vat_rate, t.vat_rate)
      into vat_tenant_mode, vat_team_mode, vat_rate_value
      from public.tenants t
      left join public.team_finance_settings s
        on s.tenant_id = t.id and s.team_id = appointment_row.team_id
     where t.id = appointment_row.tenant_id;
    if vat_tenant_mode is not null and vat_tenant_mode <> 'off'
       and coalesce(vat_rate_value, 0) > 0 then
      income_vat_mode := coalesce(nullif(vat_team_mode, 'off'), vat_tenant_mode);
      income_vat_rate := vat_rate_value;
    else
      -- Компания без НДС: «с НДС» у записи налог не включает.
      income_vat_mode := 'none';
    end if;
  end if;

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
        income_vat_mode,
        income_vat_rate,
        case
          when income_vat_rate is not null then
            round(round(adjustment.amount, 2) * income_vat_rate / (100 + income_vat_rate), 2)
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
$function$;
