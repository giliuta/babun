-- =====================================================================
-- СНИМОК ЖИВЫХ ОБЪЕКТОВ ПРОДА — 2026-08-10
-- Проект Supabase: rdtokosbqvgemicqeqwz (Postgres 17)
--
-- ЗАЧЕМ ЭТОТ ФАЙЛ.
--   Четыре миграции применены к проду, но их исходников нет в репозитории:
--     20260808224150 appointments_payment_account
--     20260808224215 resolve_payment_account_with_choice
--     20260808224303 reconcile_uses_chosen_account
--     20260809100524 vat_per_operation_and_account
--   Из-за этого чистая среда и прод разъезжаются, а тот, кто пишет новую
--   миграцию, вынужден вспоминать «как оно там устроено» по памяти. Это уже
--   стоило нам одного отката (atomic_client_tags снесла более новую логику).
--   Здесь лежит фактура, снятая читающими запросами прямо с боевой базы:
--   определения функций слово в слово, колонки, констрейнты, триггеры,
--   индексы, журнал миграций. Пишите следующую миграцию по этому файлу.
--
-- ЭТО НЕ МИГРАЦИЯ.
--   Файл лежит в docs/audit/, а не в apps/web/supabase/migrations, и его имя
--   намеренно не подходит под шаблон YYYYMMDDHHMMSS_slug.sql. Всё содержимое
--   ниже — комментарии; единственная исполняемая инструкция в файле (сразу
--   под этой шапкой) просто отказывается работать. Нужный кусок копируйте в
--   новый файл миграции руками, осознанно.
--
-- КАК СНЯТО: execute_sql, только чтение (pg_get_functiondef, pg_constraint,
--   pg_trigger, pg_indexes, information_schema, supabase_migrations).
--   К базе в этом прогоне ничего не применялось.
-- =====================================================================

do $snapshot_is_not_a_migration$
begin
  -- Страховка от «запустил не тот файл»: снимок не должен ничего менять.
  raise exception using
    message = 'PROD-SCHEMA-SNAPSHOT-2026-08-10.sql — справочный снимок прода, а не миграция',
    hint    = 'Скопируйте нужный блок в новый файл apps/web/supabase/migrations/YYYYMMDDHHMMSS_slug.sql';
end;
$snapshot_is_not_a_migration$;


-- =====================================================================
-- 1. ФУНКЦИИ — pg_get_functiondef, слово в слово с прода
-- =====================================================================
--
-- Порядок важен: resolve_appointment_payment_account вызывает старый
-- resolve_appointment_finance_account, а reconcile_appointment_finance
-- вызывает новый резолвер. В репозитории лежит ТОЛЬКО старый резолвер —
-- значит на чистой среде reconcile упадёт с «function does not exist»,
-- пока недостающие миграции не будут восстановлены.


-- ---------------------------------------------------------------------
-- 1.1 resolve_appointment_payment_account(uuid, text, text, uuid)
--     ЕСТЬ В ПРОДЕ, НЕТ В ФАЙЛАХ (миграция 20260808224215).
--     Смысл: выбранный в записи счёт бьёт угадывание по способу оплаты;
--     проверяется, что счёт того же тенанта, активен и обслуживает команду
--     заявки (свой командный либо счёт компании, подключённый через
--     account_teams). Без p_account_id — падение назад на старый резолвер.
-- ---------------------------------------------------------------------
/*
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
*/


-- ---------------------------------------------------------------------
-- 1.2 resolve_appointment_finance_account(uuid, text, text)
--     Старый резолвер «угадай счёт по способу оплаты». ЕСТЬ и в проде, и в
--     репозитории (20260727100001_shared_accounts.sql). Сохранён здесь,
--     потому что новый резолвер на него опирается: сносить нельзя.
--     Обратите внимание на маппинг transfer -> kind='bank'.
-- ---------------------------------------------------------------------
/*
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
     and (
       (a.scope = 'team' and a.brigade_id = p_team_id)
       or (a.scope = 'company' and exists (
         select 1 from public.account_teams att
          where att.account_id = a.id and att.team_id = p_team_id
       ))
     )
   order by (a.scope = 'team') desc, a.position, a.id
   limit 1;
  if account_id is null then
    raise exception 'Для этого способа оплаты нет активного счёта команды';
  end if;
  return account_id;
end;
$function$
*/


-- ---------------------------------------------------------------------
-- 1.3 reconcile_appointment_finance(uuid, numeric, numeric, numeric, text, text, boolean)
--     ЖИВАЯ ВЕРСИЯ ПРОДА. В репозитории её нет в этом виде: файл
--     20260727130706/20260720210006 знает только старый резолвер.
--     Здесь уже соединены ДВА более поздних изменения:
--       * 20260808224303 — счёт берётся из appointments.payment_account_id;
--       * 20260809081215 — ранний выход, если деньги уже провёл платёж
--         инвойса (_finance_write_context kind='invoice_payment').
--     ВАЖНО ДЛЯ ЗНАКОВ: возвраты пишутся ОТРИЦАТЕЛЬНОЙ суммой
--     (type='refund', amount = -refund_piece). Значит «доход − расход −
--     возврат» считает возврат дважды. Правильная формула — сумма amount
--     со знаком, где расход берётся со знаком минус.
-- ---------------------------------------------------------------------
/*
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

  select * into appointment_row
    from public.appointments
   where id = p_appointment_id
   for share;
  if not found then
    raise exception 'Заявка для синхронизации оплаты не найдена';
  end if;
  business_today := public.tenant_business_date(appointment_row.tenant_id);

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
        appointment_payment_kind, notes
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
        business_today,
        'auto',
        case
          when adjustment.payment_kind = 'prepayment' then 'prepayment'
          else 'settlement'
        end,
        case
          when adjustment.payment_kind = 'prepayment' then 'Предоплата по заявке'
          else 'Оплата по заявке'
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
*/


-- ---------------------------------------------------------------------
-- 1.4 fill_transaction_vat()  — триггер BEFORE INSERT на finance_transactions
--     ЕСТЬ В ПРОДЕ, НЕТ В ФАЙЛАХ в этом виде (миграция 20260809100524).
--     Приоритет режима: счёт -> команда -> компания (coalesce a/s/t).
--     Ставка при этом берётся ТОЛЬКО из команды/компании — у счёта своей
--     ставки нет, есть только режим. Это осознанно, но легко упустить.
--     'none' на операции гасит налог, даже если у компании он включён.
--     Математика одна для inclusive и exclusive: в базу всегда приходит
--     ВАЛОВАЯ сумма, налог извлекается из неё.
-- ---------------------------------------------------------------------
/*
CREATE OR REPLACE FUNCTION public.fill_transaction_vat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  mode text;
  rate numeric;
begin
  -- Явно переданный снимок уважаем: инвойс печатает свою ставку.
  if new.vat_amount is not null then
    return new;
  end if;

  -- «Без НДС» сказано вслух — молчим, даже если у компании налог включён.
  if new.vat_mode = 'none' then
    new.vat_rate := null;
    return new;
  end if;

  select coalesce(a.vat_mode, s.vat_mode, t.vat_mode), coalesce(s.vat_rate, t.vat_rate)
    into mode, rate
    from public.tenants t
    left join public.team_finance_settings s
      on s.tenant_id = t.id and s.team_id = new.team_id
    left join public.accounts a
      on a.id = new.account_id and a.tenant_id = t.id
   where t.id = new.tenant_id;

  if mode is null or mode = 'off' or coalesce(rate, 0) <= 0 then
    return new;
  end if;

  new.vat_rate := rate;
  -- Из ВАЛОВОЙ суммы: в кассу пришло 480, налог внутри — 80.
  -- Знак сохраняем (возврат уносит и налог).
  new.vat_amount := round(new.amount * rate / (100 + rate), 2);
  return new;
end;
$function$
*/


-- ---------------------------------------------------------------------
-- 1.5 guard_account_financial_history() — триггер BEFORE UPDATE на accounts
--     Есть и в проде, и в репозитории (20260720210006_finance_integrity).
--     Сохранён, потому что именно он держит формулу баланса счёта:
--       opening_balance + Σ (expense: -amount, refund: -abs(amount), иначе amount)
--     Обратите внимание: refund уже лежит в базе ОТРИЦАТЕЛЬНЫМ, а формула
--     берёт -abs(amount) — то есть возврат вычитается ОДИН раз и корректно.
--     Любая новая витрина баланса обязана считать так же, иначе цифры
--     разъедутся с этим триггером (эталон: Giliuta, июнь 2026, счёт «Карта»
--     team-mp8379ea — верный net €180, ошибочная формула даёт €280).
-- ---------------------------------------------------------------------
/*
CREATE OR REPLACE FUNCTION public.guard_account_financial_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ledger_balance numeric(14,2);
begin
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return new;
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'Компания финансового счёта неизменяема';
  end if;
  if new.scope is distinct from old.scope and exists (
    select 1 from public.finance_transactions where account_id = old.id
  ) then
    raise exception 'Тип охвата счёта с операциями нельзя изменить';
  end if;
  if new.brigade_id is distinct from old.brigade_id and exists (
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
*/


-- ---------------------------------------------------------------------
-- 1.6 record_account_transfer(uuid, uuid, uuid, numeric, date, text)
--     Есть и в проде, и в репозитории. Сохранён как ОБРАЗЕЦ приёмов, которые
--     нужно повторять в новых функциях:
--       * security definer + set search_path to 'public';
--       * тенант берётся из public.current_tenant_id() (то есть из auth.uid()),
--         клиентскому tenant_id не верим ВООБЩЕ;
--       * роль проверяется явно: current_user_role() = 'owner';
--       * идемпотентность через p_request_id + pg_advisory_xact_lock +
--         повторный вызов возвращает уже созданные строки, а не дубль;
--       * та же формула баланса, что и в guard_account_financial_history.
--     Ещё отсюда видно правило переводов: team -> team разных бригад
--     запрещён, идти надо через счёт компании.
-- ---------------------------------------------------------------------
/*
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
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Переводы между счетами доступны только владельцу';
  end if;
  if p_request_id is null then raise exception 'Не удалось определить запрос перевода'; end if;
  if p_from_account_id is null or p_to_account_id is null then
    raise exception 'Выберите оба счёта';
  end if;
  if p_from_account_id = p_to_account_id then raise exception 'Выберите разные счета'; end if;
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
            and team_id is not distinct from (
              select brigade_id from public.accounts where id = p_from_account_id
            )
            and amount = -normalized_amount
       ) or not exists (
         select 1 from public.finance_transactions
          where transfer_group_id = p_request_id
            and tenant_id = tenant_uuid and account_id = p_to_account_id
            and team_id is not distinct from (
              select brigade_id from public.accounts where id = p_to_account_id
            )
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
  if from_account.scope = 'team' and to_account.scope = 'team'
     and from_account.brigade_id <> to_account.brigade_id then
    raise exception 'Перевод между командами идёт через счёт компании';
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
*/


-- =====================================================================
-- 2. КОЛОНКИ, КОТОРЫХ НЕТ В ФАЙЛАХ, И ВСЁ, ЧТО К НИМ ПРИВЯЗАНО
-- =====================================================================
--
-- Снято из information_schema.columns + pg_constraint (pg_get_constraintdef)
-- + col_description. Ни одна из трёх колонок не имеет DEFAULT и все три
-- nullable — то есть смысл «не задано» кодируется через NULL, и любая
-- новая логика обязана это учитывать (NULL != 'off' и NULL != 'none').
--
--   таблица.колонка                       | тип  | null | default
--   --------------------------------------+------+------+---------
--   appointments.payment_account_id        | uuid | YES  | (нет)
--   accounts.vat_mode                      | text | YES  | (нет)
--   finance_transactions.vat_mode          | text | YES  | (нет)
--
-- Комментарии колонок в проде (COMMENT ON COLUMN):
--   appointments.payment_account_id:
--     'Счёт, выбранный при приёме денег. NULL — счёт резолвится по способу оплаты (легаси).'
--   accounts.vat_mode:
--     'Режим НДС по умолчанию для операций этого счёта. NULL — как у команды/компании.'
--   finance_transactions.vat_mode:
--     'Как оператор назначил налог этой операции. NULL — унаследовано от настроек (старые строки и автопроводки).'
--
-- ВНИМАНИЕ: наборы значений vat_mode у СЧЁТА и у ОПЕРАЦИИ РАЗНЫЕ.
--   счёт    : 'off'  | 'inclusive' | 'exclusive'   (+ NULL)
--   операция: 'none' | 'inclusive' | 'exclusive'   (+ NULL)
-- «Выключено» на счёте называется off, а на операции — none. Одинаковая
-- строка на обеих сторонах уронит check-констрейнт. Тот, кто пишет UI или
-- маппер, обязан переводить одно в другое явно.
--
-- Констрейнты (verbatim из pg_get_constraintdef):
/*
-- accounts:
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_vat_mode_check
  CHECK (((vat_mode IS NULL) OR (vat_mode = ANY (ARRAY['off'::text, 'inclusive'::text, 'exclusive'::text]))));

-- finance_transactions:
ALTER TABLE public.finance_transactions
  ADD CONSTRAINT finance_transactions_vat_mode_check
  CHECK (((vat_mode IS NULL) OR (vat_mode = ANY (ARRAY['none'::text, 'inclusive'::text, 'exclusive'::text]))));

-- appointments (внешний ключ выбранного счёта):
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_payment_account_id_fkey
  FOREIGN KEY (payment_account_id) REFERENCES accounts(id) ON DELETE SET NULL;

-- частичный индекс под этот FK (тоже из потерянной миграции):
CREATE INDEX idx_appointments_payment_account
  ON public.appointments USING btree (payment_account_id)
  WHERE (payment_account_id IS NOT NULL);
*/
--
-- Для сравнения — где ещё живёт vat_mode (эти констрейнты В ФАЙЛАХ ЕСТЬ,
-- миграция 20260809110000_vat.sql; у компании и команды набор как у счёта):
/*
tenants.vat_mode              CHECK ((vat_mode = ANY (ARRAY['off','inclusive','exclusive'])))   -- NOT NULL
team_finance_settings.vat_mode CHECK (((vat_mode IS NULL) OR (vat_mode = ANY (ARRAY['off','inclusive','exclusive']))))
team_finance_settings.vat_rate CHECK (((vat_rate IS NULL) OR ((vat_rate >= 0) AND (vat_rate < 100))))
tenants.vat_rate              CHECK (((vat_rate >= 0) AND (vat_rate < 100)))
*/


-- =====================================================================
-- 3. ВСЕ ВНЕШНИЕ КЛЮЧИ, ССЫЛАЮЩИЕСЯ НА public.accounts(id)
-- =====================================================================
--
-- Зачем сохранено: это карта того, что произойдёт при удалении счёта. Из
-- пяти ссылок ЧЕТЫРЕ стоят на ON DELETE SET NULL — то есть на уровне схемы
-- удаление счёта не запрещено, оно просто ОБЕЗЛИЧИВАЕТ историю: операции,
-- чеки и оплаты заявок останутся, но потеряют счёт и выпадут из балансов.
-- Единственная настоящая защита — BEFORE DELETE триггер
-- trg_guard_account_delete (см. раздел 4). Триггеры не работают при
-- session_replication_role = 'replica', а именно в этом режиме идёт
-- восстановление из дампа — то есть ровно при восстановлении бэкапа защита
-- молча выключена. Если решим страховаться на уровне схемы, менять надо
-- эти правила, а не триггер.
--
--   таблица              | констрейнт                             | on delete
--   ---------------------+----------------------------------------+-----------
--   account_teams        | account_teams_account_id_fkey          | CASCADE
--   appointments         | appointments_payment_account_id_fkey   | SET NULL
--   finance_templates    | finance_templates_account_id_fkey      | SET NULL
--   finance_transactions | finance_transactions_account_id_fkey   | SET NULL
--   receipts             | receipts_account_id_fkey               | SET NULL
--
/*
FOREIGN KEY (account_id)         REFERENCES accounts(id) ON DELETE CASCADE   -- account_teams
FOREIGN KEY (payment_account_id) REFERENCES accounts(id) ON DELETE SET NULL  -- appointments
FOREIGN KEY (account_id)         REFERENCES accounts(id) ON DELETE SET NULL  -- finance_templates
FOREIGN KEY (account_id)         REFERENCES accounts(id) ON DELETE SET NULL  -- finance_transactions
FOREIGN KEY (account_id)         REFERENCES accounts(id) ON DELETE SET NULL  -- receipts
*/


-- =====================================================================
-- 4. ТРИГГЕРЫ НА accounts И finance_transactions
-- =====================================================================
--
-- Зачем сохранено: порядок и полнота. Любая новая миграция, трогающая
-- деньги, встраивается в этот хор, а не рядом с ним. Все триггеры сейчас
-- в состоянии tgenabled = 'O' (origin) — то есть работают при обычной
-- записи и МОЛЧАТ при session_replication_role='replica'.
--
-- accounts (4 триггера):
/*
CREATE TRIGGER accounts_closed_day_guard BEFORE INSERT OR DELETE OR UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION guard_closed_day_account_write();
CREATE TRIGGER accounts_set_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_guard_account_delete BEFORE DELETE ON public.accounts FOR EACH ROW EXECUTE FUNCTION guard_account_delete_with_history();
CREATE TRIGGER trg_guard_account_financial_history BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION guard_account_financial_history();
*/
--
-- finance_transactions (10 триггеров; порядок срабатывания внутри одной
-- фазы — АЛФАВИТНЫЙ по имени, поэтому finance_transactions_closed_day_guard
-- отрабатывает раньше trg_fill_transaction_vat, а тот раньше
-- trg_protect_invoice_payment_row):
/*
CREATE TRIGGER finance_transactions_closed_day_guard BEFORE INSERT OR DELETE OR UPDATE ON public.finance_transactions FOR EACH ROW EXECUTE FUNCTION guard_closed_day_finance_write();
CREATE TRIGGER finance_tx_set_updated_at BEFORE UPDATE ON public.finance_transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_assert_finance_transaction_integrity BEFORE INSERT OR DELETE OR UPDATE ON public.finance_transactions FOR EACH ROW EXECUTE FUNCTION assert_finance_transaction_integrity();
CREATE TRIGGER trg_fill_transaction_vat BEFORE INSERT ON public.finance_transactions FOR EACH ROW EXECUTE FUNCTION fill_transaction_vat();
CREATE TRIGGER trg_issue_receipt_for_income AFTER INSERT ON public.finance_transactions FOR EACH ROW EXECUTE FUNCTION issue_receipt_for_income();
CREATE TRIGGER trg_protect_invoice_payment_row BEFORE DELETE OR UPDATE ON public.finance_transactions FOR EACH ROW EXECUTE FUNCTION protect_invoice_payment_row();
CREATE TRIGGER trg_settle_appointment_from_invoice AFTER INSERT ON public.finance_transactions FOR EACH ROW EXECUTE FUNCTION settle_appointment_from_invoice_payment();
CREATE TRIGGER trg_sync_invoice_status_from_ledger AFTER INSERT OR DELETE OR UPDATE ON public.finance_transactions FOR EACH ROW EXECUTE FUNCTION sync_invoice_status_from_ledger();
CREATE TRIGGER trg_validate_invoice_payment_insert BEFORE INSERT ON public.finance_transactions FOR EACH ROW EXECUTE FUNCTION validate_invoice_payment_insert();
CREATE TRIGGER trg_void_receipt_on_refund AFTER INSERT ON public.finance_transactions FOR EACH ROW EXECUTE FUNCTION void_receipt_on_refund();
*/
--
-- Тело trg_guard_account_delete (единственная защита счёта от удаления;
-- шаблоны операций она молча отвязывает, а операции/чеки/оплаты заявок —
-- запрещает; в репозитории есть, 20260810150000_guard_account_delete.sql):
/*
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
*/


-- =====================================================================
-- 5. ИНДЕКСЫ НА accounts
-- =====================================================================
--
-- Зачем сохранено: два уникальных индекса частичные, и это ловушка для
-- любой миграции, которая захочет «просто переименовать счёт» или сделать
-- сортировку по position. Уникальность имени действует ОТДЕЛЬНО для
-- команды и для компании, поэтому «Карта» может существовать у каждой
-- бригады и ещё раз как счёт компании. Индекса по position НЕТ вообще —
-- а в проде 8 из 11 счетов лежат с position = 0, то есть текущая
-- сортировка списка счетов держится на тай-брейкере, а не на позиции.
/*
CREATE UNIQUE INDEX accounts_pkey ON public.accounts USING btree (id);
CREATE INDEX idx_accounts_tenant_brigade ON public.accounts USING btree (tenant_id, brigade_id) WHERE (is_active = true);
CREATE UNIQUE INDEX ux_accounts_company_name ON public.accounts USING btree (tenant_id, name) WHERE (scope = 'company'::text);
CREATE UNIQUE INDEX ux_accounts_team_name ON public.accounts USING btree (tenant_id, brigade_id, name) WHERE (scope = 'team'::text);
*/
--
-- Полный список колонок accounts на 2026-08-10 (порядковый):
--   id              uuid    NOT NULL default gen_random_uuid()
--   tenant_id       uuid    NOT NULL
--   brigade_id      text    NULL
--   name            text    NOT NULL
--   kind            text    NOT NULL           -- cash | card | bank | other
--   owner_master_id text    NULL
--   opening_balance numeric(12,2) NOT NULL default 0
--   icon            text    NULL
--   color           text    NULL
--   position        integer NOT NULL default 0
--   is_active       boolean NOT NULL default true
--   created_at      timestamptz NOT NULL default now()
--   updated_at      timestamptz NOT NULL default now()
--   created_by      uuid    NULL
--   scope           text    NOT NULL default 'team'   -- team | company
--   balance_hidden  boolean NOT NULL default false    -- снос запланирован слайсом С10, НЕ сейчас
--   vat_mode        text    NULL                      -- off | inclusive | exclusive
--
-- Прочие check-констрейнты accounts (в файлах есть, приведены для полноты):
/*
CHECK ((kind = ANY (ARRAY['cash'::text, 'card'::text, 'bank'::text, 'other'::text])))          -- accounts_kind_check
CHECK ((opening_balance <> 'NaN'::numeric))                                                     -- accounts_opening_balance_finite
CHECK ((((scope = 'team') AND (brigade_id IS NOT NULL)) OR ((scope = 'company') AND (brigade_id IS NULL))))  -- accounts_scope_brigade_check
CHECK ((scope = ANY (ARRAY['team'::text, 'company'::text])))                                    -- accounts_scope_check
*/


-- =====================================================================
-- 6. ЖУРНАЛ МИГРАЦИЙ ПРОДА — 20 последних
--    select version, name from supabase_migrations.schema_migrations
--     order by version desc limit 20;
-- =====================================================================
--
-- Зачем сохранено: по этому списку сверяется, что новая миграция получит
-- версию БОЛЬШЕ последней применённой. Сейчас максимум — 20260810100605.
-- Любой файл с меньшим номером будет считаться «уже применённым» и молча
-- не попадёт на прод (именно так мы потеряли исходники четырёх миграций
-- из раздела 7 и один раз откатили логику).
--
--   20260810100605  account_teams_cleanup_on_team_delete
--   20260810100456  guard_account_delete_with_history
--   20260810082341  tenant_logos_bucket
--   20260810082131  format_invoice_number_no_truncation
--   20260810081028  next_invoice_number_helper
--   20260810080816  invoice_numbering_settings
--   20260810080327  invoice_seller_snapshot_logo
--   20260810074732  void_invoice_guard_uses_net_paid
--   20260810074601  void_invoice_after_full_refund
--   20260810074222  grant_tenant_business_date_to_authenticated
--   20260809100524  vat_per_operation_and_account          <-- исходника в репозитории НЕТ
--   20260809094433  finance_category_hidden
--   20260809094413  finance_categories_for_field_service
--   20260809094043  receipts_bucket_policies
--   20260809081622  protect_allows_invoice_payment_context
--   20260809081517  invoice_refund_unsettles_appointment
--   20260809081336  write_context_invoice_payment_kind
--   20260809081215  invoice_payment_settles_appointment
--   20260809081124  invoice_payment_settles_appointment_guards
--   20260808235552  receipt_conflict_predicate_fix
--
-- Ниже границы двадцатки, но важно для этой задачи:
--   20260808224303  reconcile_uses_chosen_account          <-- исходника НЕТ
--   20260808224215  resolve_payment_account_with_choice    <-- исходника НЕТ
--   20260808224150  appointments_payment_account           <-- исходника НЕТ
--
-- Ещё одна особенность имён: с 20260727 версии в проде НЕ совпадают с
-- именами файлов репозитория (файл 20260720210006_finance_integrity.sql
-- записан в журнал как версия 20260727130710). Сверять надо по name, а не
-- по version.


-- =====================================================================
-- 7. ВОССТАНОВЛЕННЫЕ ИСХОДНИКИ ЧЕТЫРЁХ МИГРАЦИЙ-СИРОТ
--    (supabase_migrations.schema_migrations.statements — прод хранит
--     ТЕКСТ применённых миграций, поэтому восстанавливать «по памяти» не
--     пришлось: ниже дословный текст, каким его применили)
-- =====================================================================
--
-- КАК ЭТИМ ПОЛЬЗОВАТЬСЯ: скопировать блок в новый файл миграции с ТЕМ ЖЕ
-- именем версии, что в журнале — иначе на проде он выполнится повторно.
-- Повторное выполнение безопасно (add column if not exists + create or
-- replace), кроме `drop constraint if exists` в 20260809100524: на проде
-- это на долю секунды снимает проверку vat_mode. Поэтому в файл лучше
-- переносить идемпотентную форму через do $$ ... pg_constraint ... $$,
-- а не буквальный drop/add.


-- ---------------------------------------------------------------------
-- 7.1 20260808224150_appointments_payment_account
-- ---------------------------------------------------------------------
/*
-- ДЕНЬГИ ИДУТ НА ВЫБРАННЫЙ СЧЁТ, А НЕ НА УГАДАННЫЙ.
--
-- Было: в записи выбирается абстрактный способ (нал/карта/перевод/другое), а
-- сервер ищет первый активный счёт подходящего вида у команды. Если такого
-- счёта нет — приём денег ПАДАЕТ, и бригадир не может закрыть долг. У
-- владельца это ловилось на трёх способах из четырёх.
--
-- Стало: запись помнит КОНКРЕТНЫЙ счёт. Угадывание остаётся только для
-- старых записей и входов без выбора (закрытие дня, импорт).

alter table public.appointments
  add column if not exists payment_account_id uuid
    references public.accounts(id) on delete set null;

comment on column public.appointments.payment_account_id is
  'Счёт, выбранный при приёме денег. NULL — счёт резолвится по способу оплаты (легаси).';

create index if not exists idx_appointments_payment_account
  on public.appointments (payment_account_id)
  where payment_account_id is not null;
*/


-- ---------------------------------------------------------------------
-- 7.2 20260808224215_resolve_payment_account_with_choice
--     (тело функции совпадает с разделом 1.1 слово в слово)
-- ---------------------------------------------------------------------
/*
-- Выбранный счёт бьёт угадывание. Проверяем, что счёт вообще может принять
-- эти деньги: тот же тенант, активен, и обслуживает команду записи (свой
-- командный либо общий, подключённый к этой команде). Иначе оплата легла бы
-- в чужую кассу молча.
create or replace function public.resolve_appointment_payment_account(
  p_tenant_id uuid,
  p_team_id text,
  p_payment_method text,
  p_account_id uuid
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
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
$$;
*/


-- ---------------------------------------------------------------------
-- 7.3 20260808224303_reconcile_uses_chosen_account
--     Полный текст — 10 242 символа, это целиком create or replace
--     reconcile_appointment_finance. Здесь сохранена только шапка: тело
--     той версии УЖЕ УСТАРЕЛО, поверх него легла 20260809081215
--     (ранний выход при платеже инвойса). Актуальное тело — раздел 1.3,
--     именно оно сейчас в проде. Если восстанавливаете файл ради истории,
--     берите текст из журнала; если ради работоспособности чистой
--     среды — достаточно, чтобы после всех миграций получилось тело 1.3.
-- ---------------------------------------------------------------------
/*
-- Тот же reconcile, одна строка иначе: счёт берётся из записи, если он там
-- выбран, и только иначе угадывается по способу оплаты.
create or replace function public.reconcile_appointment_finance(
  p_appointment_id uuid,
  p_old_total numeric,
  p_old_prepaid numeric,
  p_old_paid numeric,
  p_old_payment_status text,
  p_old_status text,
  p_is_insert boolean default false
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
  ... (тело версии 2026-08-08, без блока _finance_write_context/invoice_payment;
       актуальное тело смотри в разделе 1.3) ...
$function$;
*/


-- ---------------------------------------------------------------------
-- 7.4 20260809100524_vat_per_operation_and_account
-- ---------------------------------------------------------------------
/*
-- НДС РЕШАЕТСЯ НА КАЖДОЙ ОПЕРАЦИИ, А НЕ ОДИН РАЗ НА КОМПАНИЮ.
--
-- Владелец 2026-08-09: «иногда есть оплаты, которые без НДС, и это надо
-- самому регулировать — три клавиши: без НДС, НДС включён, плюс НДС». Так и
-- есть: одна и та же компания принимает наличку от частника без налога и
-- выставляет счёт фирме с налогом. Раньше триггер назначал налог ВСЕМУ, что
-- проходило мимо, если у компании включён режим, — и наличка от частника
-- бесшумно уносила 19% в отчёт по налогу.
--
-- Что где хранится:
--   none      — налога нет вовсе (vat_amount = null);
--   inclusive — сумма уже с налогом, налог ИЗВЛЕКАЕТСЯ из неё;
--   exclusive — оператор ввёл цену без налога, приложение прибавило сверху,
--               и в базу пришла уже валовая сумма (математика одна).
-- Режим хранится, чтобы при повторном открытии операции показать её тем же
-- языком, каким её вводили.

alter table public.finance_transactions
  add column if not exists vat_mode text;

alter table public.finance_transactions drop constraint if exists finance_transactions_vat_mode_check;
alter table public.finance_transactions add constraint finance_transactions_vat_mode_check
  check (vat_mode is null or vat_mode in ('none', 'inclusive', 'exclusive'));

comment on column public.finance_transactions.vat_mode is
  'Как оператор назначил налог этой операции. NULL — унаследовано от настроек (старые строки и автопроводки).';

-- НДС МОЖЕТ ЖИТЬ НА СЧЁТЕ. «Счёт с НДС» — обычная практика: на расчётный
-- падают деньги с налогом, а в кассу от частника — без. Счёт побеждает
-- команду, команда — компанию.
alter table public.accounts
  add column if not exists vat_mode text;

alter table public.accounts drop constraint if exists accounts_vat_mode_check;
alter table public.accounts add constraint accounts_vat_mode_check
  check (vat_mode is null or vat_mode in ('off', 'inclusive', 'exclusive'));

comment on column public.accounts.vat_mode is
  'Режим НДС по умолчанию для операций этого счёта. NULL — как у команды/компании.';

create or replace function public.fill_transaction_vat()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  mode text;
  rate numeric;
begin
  -- Явно переданный снимок уважаем: инвойс печатает свою ставку.
  if new.vat_amount is not null then
    return new;
  end if;

  -- «Без НДС» сказано вслух — молчим, даже если у компании налог включён.
  if new.vat_mode = 'none' then
    new.vat_rate := null;
    return new;
  end if;

  select coalesce(a.vat_mode, s.vat_mode, t.vat_mode), coalesce(s.vat_rate, t.vat_rate)
    into mode, rate
    from public.tenants t
    left join public.team_finance_settings s
      on s.tenant_id = t.id and s.team_id = new.team_id
    left join public.accounts a
      on a.id = new.account_id and a.tenant_id = t.id
   where t.id = new.tenant_id;

  if mode is null or mode = 'off' or coalesce(rate, 0) <= 0 then
    return new;
  end if;

  new.vat_rate := rate;
  -- Из ВАЛОВОЙ суммы: в кассу пришло 480, налог внутри — 80.
  -- Знак сохраняем (возврат уносит и налог).
  new.vat_amount := round(new.amount * rate / (100 + rate), 2);
  return new;
end;
$$;
*/


-- =====================================================================
-- 8. ЧТО ИЗ ЭТОГО СЛЕДУЕТ ДЛЯ БЛИЖАЙШИХ МИГРАЦИЙ
--    (короткие выводы, чтобы не перечитывать весь файл)
-- =====================================================================
--
-- 8.1 Прежде чем трогать reconcile_appointment_finance — брать текст из
--     раздела 1.3, а НЕ из репозитория: в файлах лежит версия на два
--     изменения старше и со старым резолвером.
--
-- 8.2 Новый резолвер resolve_appointment_payment_account в файлах
--     отсутствует. Пока его исходник не восстановлен, чистая среда
--     (локальный supabase start) НЕ поднимется до рабочего состояния:
--     reconcile сошлётся на несуществующую функцию.
--     Проверено grep-ом по apps/web/supabase/migrations на 2026-08-10:
--       reconcile_appointment_finance  — только 20260720210006_finance_integrity.sql (старая версия);
--       resolve_appointment_payment_account — НИ В ОДНОМ файле;
--       accounts.vat_mode / finance_transactions_vat_mode_check — НИ В ОДНОМ файле;
--       payment_account_id — упоминается только в 20260810150000_guard_account_delete.sql,
--         который эту колонку ЧИТАЕТ, но нигде в файлах её не создают. На чистой
--         среде функция создастся (plpgsql не проверяет тело при создании), а
--         упадёт позже — при первой попытке удалить счёт.
--
-- 8.3 vat_mode: 'off' у счёта/команды/компании, 'none' у операции. Не
--     смешивать. NULL везде значит «наследуй дальше», а не «выключено».
--
-- 8.4 Баланс счёта считается ОДНОЙ формулой (см. 1.5 и record_account_transfer):
--       opening_balance + Σ CASE type WHEN 'expense' THEN -amount
--                                     WHEN 'refund'  THEN -abs(amount)
--                                     ELSE amount END
--     Возвраты в базе уже отрицательные. Формула «доход − расход − возврат»
--     ЗАПРЕЩЕНА: на живых данных она даёт €280 вместо €180 (Giliuta, июнь
--     2026, счёт «Карта» бригады team-mp8379ea) и €310 вместо €190
--     (счёт «Карта» бригады team-mp8qhxe3).
--
-- 8.5 Удаление счёта на уровне схемы разрешено и обезличивает историю
--     (SET NULL в четырёх таблицах). Держит только BEFORE DELETE триггер,
--     который выключается при session_replication_role='replica'.
--
-- 8.6 Ловушка PG17, уже ловили: конструкция вида `(case … end) then`
--     не парсится. Разбирайте выражения на отдельные case/if.
--
-- 8.7 Новая версия миграции обязана быть > 20260810100605.
--
-- 8.8 accounts.balance_hidden ещё жив и NOT NULL default false — снос
--     запланирован отдельным слайсом (С10), в текущих миграциях не трогать.
--
-- 8.9 ЛОВУШКА ПОРЯДКА ПРИ ВОССТАНОВЛЕНИИ 7.4. В репозитории лежит файл
--     20260809110000_vat.sql, и в нём на строке 85 своя, СТАРАЯ версия
--     fill_transaction_vat: она читает только coalesce(s.vat_mode, t.vat_mode)
--     (команда -> компания) и ничего не знает ни про счёт, ни про 'none'.
--     На чистой среде файлы применяются по имени, поэтому файл с версией
--     20260809100524 отработает РАНЬШЕ 20260809110000 — и старая функция
--     затрёт новую. Ровно так же нас уже откатывала atomic_client_tags.
--     Значит восстанавливать 7.4 «под её родным номером» НЕЛЬЗЯ: либо
--     класть восстановленный fill_transaction_vat отдельным файлом с
--     версией > 20260810100605, либо править 20260809110000_vat.sql. На
--     проде это ни на что не влияет (обе версии уже в журнале), разъезд
--     проявится только на чистой среде — то есть тихо.
--
-- КОНЕЦ СНИМКА.
-- =====================================================================
