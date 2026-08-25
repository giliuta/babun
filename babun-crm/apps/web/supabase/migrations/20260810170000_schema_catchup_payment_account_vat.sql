-- ДОГОН ДРЕЙФА СХЕМЫ: файл написан ЗАДНИМ ЧИСЛОМ.
--
-- ПОЧЕМУ ЭТОТ ФАЙЛ ПОЯВИЛСЯ ПОСЛЕ ТОГО, КАК ВСЁ УЖЕ РАБОТАЕТ В ПРОДЕ.
--   8 и 9 августа четыре миграции были применены к боевой базе напрямую,
--   мимо репозитория:
--     20260808224150 appointments_payment_account
--     20260808224215 resolve_payment_account_with_choice
--     20260808224303 reconcile_uses_chosen_account
--     20260809100524 vat_per_operation_and_account
--   Прод от этого работает, а вот ЧИСТАЯ среда — новый клиент, восстановление,
--   CI, локальный `supabase start` — поднималась битой:
--     * колонки `appointments.payment_account_id` нет, хотя клиент её пишет и
--       она есть в `database.types.ts`;
--     * функции `resolve_appointment_payment_account` нет вовсе, поэтому
--       `reconcile_appointment_finance` падает «function does not exist» при
--       первой же оплате заявки;
--     * `guard_account_delete_with_history` (20260810150000) ЧИТАЕТ
--       `payment_account_id` — plpgsql не проверяет тело при создании, так что
--       функция создаётся молча, а падает позже, при удалении счёта;
--     * колонок `vat_mode` нет ни у счёта, ни у операции — НДС не поднимается.
--   Итог: на свежей среде оплата записи молча уезжала на счёт с position 0.
--
-- ЭТО ДОГОН, А НЕ РЕФАКТОРИНГ.
--   Тексты обеих функций перенесены с прода СЛОВО В СЛОВО (снято
--   `pg_get_functiondef`, зафиксировано в docs/audit/PROD-SCHEMA-SNAPSHOT-2026-08-10.sql).
--   Ни одной «попутной» правки здесь нет: задача файла — сделать чистую среду
--   равной проду, и любое улучшение сделало бы это утверждение ложным.
--   Улучшения живут в соседних файлах 20260810170100 / 170200 / 170300.
--
-- НА ПРОДЕ ЭТОТ ФАЙЛ — NO-OP. Всё DDL идемпотентно (`if not exists`,
-- `do $$ … pg_constraint … $$`, `create or replace`), функции переписываются
-- тем же телом. В этом весь смысл: одна и та же миграция обязана быть
-- бесшумной на проде и созидательной на пустой базе.

-- ─── 1. appointments.payment_account_id ──────────────────────────────
-- Запись помнит КОНКРЕТНУЮ кассу, а не абстрактный способ оплаты. Раньше
-- сервер угадывал счёт по способу, и если подходящего счёта у команды не было,
-- приём денег просто падал — бригадир не мог закрыть долг.
alter table public.appointments
  add column if not exists payment_account_id uuid;

-- В Postgres нет `add constraint if not exists`, поэтому наличие проверяем
-- сами. Правило `on delete set null` здесь оставлено ровно как в проде:
-- заявка переживает удаление счёта, потеряв лишь адрес кассы. Ужесточается
-- только связь `finance_transactions.account_id` — там теряется не адрес, а
-- деньги (см. 20260810170300).
do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.appointments'::regclass
       and conname = 'appointments_payment_account_id_fkey'
  ) then
    alter table public.appointments
      add constraint appointments_payment_account_id_fkey
      foreign key (payment_account_id) references public.accounts(id)
      on delete set null;
  end if;
end;
$constraints$;

comment on column public.appointments.payment_account_id is
  'Счёт, выбранный при приёме денег. NULL — счёт резолвится по способу оплаты (легаси).';

-- Индекс частичный: заполненных значений мало (в проде на 2026-08-10 — ноль),
-- а читается колонка только при удалении счёта и в отчётах по кассе.
create index if not exists idx_appointments_payment_account
  on public.appointments (payment_account_id)
  where payment_account_id is not null;

-- ─── 2. vat_mode на операции и на счёте ──────────────────────────────
-- НДС решается на КАЖДОЙ операции: одна и та же компания принимает наличку от
-- частника без налога и выставляет счёт фирме с налогом. Раньше режим компании
-- назначал налог всему, что проходило мимо.
--
-- ВНИМАНИЕ, наборы значений РАЗНЫЕ и унифицировать их нельзя:
--   счёт    : 'off'  | 'inclusive' | 'exclusive'  (+ NULL)
--   операция: 'none' | 'inclusive' | 'exclusive'  (+ NULL)
-- «Выключено» у счёта называется off, у операции — none. NULL с обеих сторон
-- значит «наследуй дальше», а НЕ «выключено». Одинаковая строка на обеих
-- сторонах уронит check-констрейнт, и это правильно: маппер обязан переводить
-- одно в другое явно, а не полагаться на совпадение слов.

alter table public.finance_transactions
  add column if not exists vat_mode text;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_transactions'::regclass
       and conname = 'finance_transactions_vat_mode_check'
  ) then
    alter table public.finance_transactions
      add constraint finance_transactions_vat_mode_check
      check (vat_mode is null or vat_mode in ('none', 'inclusive', 'exclusive'));
  end if;
end;
$constraints$;

comment on column public.finance_transactions.vat_mode is
  'Как оператор назначил налог этой операции. NULL — унаследовано от настроек (старые строки и автопроводки).';

-- «Счёт с НДС» — обычная практика: на расчётный падают деньги с налогом, а в
-- кассу от частника — без. Счёт побеждает команду, команда — компанию.
-- Своей СТАВКИ у счёта нет намеренно: ставку задаёт страна работы команды,
-- а счёт лишь говорит «здесь налог есть» или «здесь его нет».
alter table public.accounts
  add column if not exists vat_mode text;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.accounts'::regclass
       and conname = 'accounts_vat_mode_check'
  ) then
    alter table public.accounts
      add constraint accounts_vat_mode_check
      check (vat_mode is null or vat_mode in ('off', 'inclusive', 'exclusive'));
  end if;
end;
$constraints$;

comment on column public.accounts.vat_mode is
  'Режим НДС по умолчанию для операций этого счёта. NULL — как у команды/компании.';

-- ─── 3. Резолвер счёта, уважающий выбор оператора ────────────────────
-- Выбранный счёт бьёт угадывание. Проверяем, что счёт вообще может принять эти
-- деньги: тот же тенант, активен, и обслуживает команду записи (свой командный
-- либо счёт компании, подключённый к этой команде). Иначе оплата легла бы в
-- чужую кассу молча.
--
-- Текст — с прода, слово в слово.
create or replace function public.resolve_appointment_payment_account(
  p_tenant_id uuid,
  p_team_id text,
  p_payment_method text,
  p_account_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

-- Потерянная миграция забыла отозвать права, и функция уехала на прод с
-- дефолтным грантом PUBLIC: её мог позвать даже anon. Она SECURITY DEFINER и
-- берёт `p_tenant_id` из аргумента — то есть работает оракулом «обслуживает ли
-- счёт X команду Y» для любого, кто угадает пару uuid. Внутренний резолвер
-- рядом (`resolve_appointment_finance_account`) закрыт с самого начала; тут
-- восстанавливается то же правило, а не вводится новое.
revoke all on function public.resolve_appointment_payment_account(
  uuid, text, text, uuid
) from public, anon, authenticated;

-- ─── 4. reconcile_appointment_finance — живая версия прода ───────────
-- В репозитории лежала версия на два изменения старше: она звала старый
-- резолвер и ничего не знала про платежи инвойса. Здесь соединены оба
-- поздних изменения, как они лежат в проде:
--   * 20260808224303 — счёт берётся из appointments.payment_account_id;
--   * 20260809081215 — ранний выход, если деньги уже провёл платёж инвойса.
--
-- ЗНАКИ: возвраты пишутся ОТРИЦАТЕЛЬНОЙ суммой (type='refund', -refund_piece).
-- Любая витрина, считающая «доход − расход − возврат», удвоит возврат.
-- Каноническая формула — сумма amount со знаком (см. guard_account_financial_history).
--
-- Текст — с прода, слово в слово.
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
as $function$
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
$function$;

revoke all on function public.reconcile_appointment_finance(
  uuid, numeric, numeric, numeric, text, text, boolean
) from public, anon, authenticated;

-- ─── 5. Deploy assertions ────────────────────────────────────────────
-- Смысл блока: файл догоняет прод, поэтому «применилось молча» — не ответ.
-- Каждая проверка отвечает на один вопрос: «а если бы этой миграции не было,
-- что бы сломалось?»
do $audit$
declare
  tx_vat_check text;
  account_vat_check text;
begin
  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.appointments'::regclass
       and attname = 'payment_account_id'
       and not attisdropped
  ) then
    raise exception 'догон схемы: колонки appointments.payment_account_id нет — приём денег будет угадывать кассу';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.appointments'::regclass
       and conname = 'appointments_payment_account_id_fkey'
       and contype = 'f'
  ) then
    raise exception 'догон схемы: у appointments.payment_account_id нет внешнего ключа на accounts';
  end if;

  if to_regclass('public.idx_appointments_payment_account') is null then
    raise exception 'догон схемы: индекс idx_appointments_payment_account не создан';
  end if;

  select pg_get_constraintdef(oid) into tx_vat_check
    from pg_constraint
   where conrelid = 'public.finance_transactions'::regclass
     and conname = 'finance_transactions_vat_mode_check';
  if tx_vat_check is null then
    raise exception 'догон схемы: нет проверки finance_transactions.vat_mode';
  end if;
  -- «Выключено» у операции называется none. Если кто-то «унифицировал»
  -- значения со счётом, три клавиши НДС на операции перестанут сохраняться.
  if tx_vat_check not like '%none%' then
    raise exception 'догон схемы: finance_transactions.vat_mode не принимает none — набор значений подменён';
  end if;

  select pg_get_constraintdef(oid) into account_vat_check
    from pg_constraint
   where conrelid = 'public.accounts'::regclass
     and conname = 'accounts_vat_mode_check';
  if account_vat_check is null then
    raise exception 'догон схемы: нет проверки accounts.vat_mode';
  end if;
  -- А у счёта — off. Наборы разные намеренно, см. раздел 2.
  if account_vat_check not like '%off%' then
    raise exception 'догон схемы: accounts.vat_mode не принимает off — набор значений подменён';
  end if;

  if to_regprocedure(
       'public.resolve_appointment_payment_account(uuid,text,text,uuid)'
     ) is null then
    raise exception 'догон схемы: нет resolve_appointment_payment_account(uuid,text,text,uuid)';
  end if;
  if to_regprocedure(
       'public.resolve_appointment_finance_account(uuid,text,text)'
     ) is null then
    raise exception 'догон схемы: пропал старый резолвер, на который падает новый';
  end if;
  if to_regprocedure(
       'public.reconcile_appointment_finance(uuid,numeric,numeric,numeric,text,text,boolean)'
     ) is null then
    raise exception 'догон схемы: нет reconcile_appointment_finance с ожидаемой сигнатурой';
  end if;

  -- Главная проверка файла: reconcile обязан звать НОВЫЙ резолвер. Если более
  -- старая миграция когда-нибудь применится следом и молча вернёт угадывание
  -- по способу оплаты, деньги начнут уезжать на чужую кассу — а тесты этого
  -- не заметят, потому что оплата продолжит проходить.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'reconcile_appointment_finance'
       and p.prosrc like '%resolve_appointment_payment_account%'
       and p.prosrc like '%payment_account_id%'
  ) then
    raise exception 'догон схемы: reconcile_appointment_finance не читает выбранный счёт — откат более старой миграцией';
  end if;

  if has_function_privilege(
       'anon',
       'public.resolve_appointment_payment_account(uuid,text,text,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.resolve_appointment_payment_account(uuid,text,text,uuid)',
       'EXECUTE'
     ) then
    raise exception 'догон схемы: внутренний резолвер счёта доступен клиенту';
  end if;
end;
$audit$;
