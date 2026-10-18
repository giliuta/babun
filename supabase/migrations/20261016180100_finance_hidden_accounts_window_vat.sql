-- ФИНАНСЫ, ВТОРОЙ КРУГ АУДИТА: СКРЫТЫЕ СЧЕТА, ОКНО ПАРТНЁРА, НАЛОГ ДОЛЕЙ.
--
-- Что закрыто и зачем (подробности — у каждого куска ниже):
--   1. Чек, возврат по чеку и частичная кредит-нота не смотрели на
--      `accounts.is_hidden`: партнёр с «Документы: Меняет» мог выписать чек и
--      вернуть деньги по платежу на скрытом счёте. Теперь это — владельцу.
--      Строки `receipts` на скрытом счёте не-владельцу тоже не видны.
--   2. `account_period_totals` и `account_balances` не знали ни окна
--      партнёра, ни прав «Доход» / «Расход»: суммы периода и даты истории
--      открывали то, что построчно закрыто политиками. Остаток (баланс)
--      остаётся полным — его даёт право «Счета».
--   3. Доход, привязанный к инвойсу, берёт налог бумаги в том же обновлении.
--   4. Возвраты, кредит-ноты инвойса и чека: последняя доля берёт остаток
--      налога, как это уже делают оплаты.
--   5. Чек на оплату долга не выписывается (тупик: ни вернуть, ни удалить).
--   6. Повтор запроса кредит-ноты отдаёт только СВОЮ ноту, не любой документ.
--   7. Повтор полной отмены инвойса идемпотентен.
--   Внутренние помощники кредит-нот снова закрыты для `authenticated`.

-- ======================================================================
-- Служебный помощник: наружу не торчит.
-- ======================================================================

-- Скрытый счёт не-владельцу не существует: те же слова и подсказка, что у
-- ожидания оплаты на скрытый счёт.
create or replace function public._assert_account_not_hidden(
  p_tenant_id uuid,
  p_account_id uuid
) returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if p_account_id is not null
     and public.current_user_role() is distinct from 'owner'
     and exists (
       select 1 from public.accounts a
        where a.id = p_account_id
          and a.tenant_id = p_tenant_id
          and a.is_hidden
     ) then
    raise exception 'Счёт не найден или недоступен'
      using errcode = 'P0001', hint = 'block:finance.documents';
  end if;
end;
$function$;
revoke all on function public._assert_account_not_hidden(uuid, uuid) from public, anon, authenticated;



-- ======================================================================
-- 1. СКРЫТЫЙ СЧЁТ: ЧЕК, ВОЗВРАТ ПО ЧЕКУ И КРЕДИТ-НОТА — ТОЛЬКО ВЛАДЕЛЬЦУ
-- ======================================================================

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
  -- Скрытый счёт не-владельцу не существует: чек по платежу на нём ему не
  -- выписать и не поправить, даже с «Документы: Меняет».
  if allowed is true
     and p_tx.account_id is not null
     and public.current_user_role() is distinct from 'owner'
     and exists (
       select 1 from public.accounts hidden_account
        where hidden_account.id = p_tx.account_id
          and hidden_account.tenant_id = tenant_uuid
          and hidden_account.is_hidden
     ) then
    return false;
  end if;
  return allowed is true;
end;
$function$;

revoke all on function public._receipt_tx_allowed(public.finance_transactions) from public, anon, authenticated;

-- ======================================================================
-- 5. ЧЕК НЕ ВЫПИСЫВАЕТСЯ НА ОПЛАТУ ДОЛГА (и скрытый счёт — п. 1)
-- ======================================================================

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
  perform public._assert_account_not_hidden(tenant_uuid, tx.account_id);
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
  -- Оплата долга чека не получает: такой доход нельзя ни вернуть
  -- (`guard_refund_of_debt_payment`), ни удалить (сторожа выданного чека), а
  -- чек не снять, пока он не последний в серии, — тупик без выхода.
  if tx.debt_id is not null then
    raise exception 'По оплате долга чек не выписывается'
      using errcode = 'P0001', hint = 'receipt:debt_payment';
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
  if p_issued_on is not null and p_issued_on > public.tenant_business_date(tenant_uuid) then
    raise exception 'Документ нельзя датировать будущим числом';
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
$function$;

CREATE OR REPLACE FUNCTION public._refund_invoice_money(p_invoice invoices, p_amount numeric, p_on date, p_note text, p_payment_id uuid DEFAULT NULL::uuid)
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
  -- Платёж, с которого человек нажал «Вернуть», обязан быть платежом этого
  -- инвойса; возврат идёт с него первым, остаток — прежним правилом.
  if p_payment_id is not null and not exists (
    select 1 from public.finance_transactions tx
     where tx.id = p_payment_id
       and tx.tenant_id = p_invoice.tenant_id
       and tx.invoice_id = p_invoice.id
       and tx.type = 'income'
  ) then
    raise exception 'Платёж не относится к этому инвойсу';
  end if;
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
     order by (tx.id is not distinct from p_payment_id) desc, tx.created_at desc
     limit 1
     for update;
    if not found then
      raise exception 'Не нашлось платежа инвойса для возврата';
    end if;
    if income_row.source = 'auto' or income_row.appointment_payment_kind is not null then
      raise exception 'Деньги по записи возвращаются в самой записи';
    end if;
    -- Платёж на скрытом счёте возвращает только владелец: возврат пишет
    -- строку журнала именно на этот счёт.
    perform public._assert_account_not_hidden(p_invoice.tenant_id, income_row.account_id);
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
$function$;

revoke all on function public._refund_invoice_money(public.invoices, numeric, date, text, uuid) from public, anon, authenticated;

-- ======================================================================
-- 4. НАЛОГ ВОЗВРАТОВ И КРЕДИТ-НОТ: ПОСЛЕДНЯЯ ДОЛЯ БЕРЁТ ОСТАТОК
-- ======================================================================

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
  refunded_before numeric;
  vat_before numeric;
  vat_left numeric;
  vat_share numeric;
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
        -- ПОСЛЕДНЯЯ ДОЛЯ ВОЗВРАТА ДОБИРАЕТ НАЛОГ ДОХОДА: доли, округлённые
        -- каждая до цента, расходились с налогом исходного платежа. Возврат,
        -- с которым вернули всю сумму, несёт остаток — налог дохода минус то,
        -- что унесли прежние возвраты. Остальные доли остаток не превышают.
        select coalesce(sum(abs(r.amount)), 0), coalesce(sum(abs(coalesce(r.vat_amount, 0))), 0)
          into refunded_before, vat_before
          from public.finance_transactions r
         where r.refund_of_id = original.id
           and r.type = 'refund'
           and r.id is distinct from new.id;
        vat_left := greatest(0, original.vat_amount - vat_before);
        vat_share := round(original.vat_amount * abs(new.amount) / original.amount, 2);
        if refunded_before + abs(new.amount) >= original.amount then
          vat_share := vat_left;
        else
          vat_share := least(vat_share, vat_left);
        end if;
        new.vat_amount := sign(new.amount) * vat_share;
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
$function$;

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
  perform public._assert_account_not_hidden(tenant_uuid, income_row.account_id);

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
$function$;

revoke all on function public.refund_receipt(uuid, uuid, numeric, text, text) from public, anon;

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
  note_vat numeric(12,2);
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

  -- Налог ноты — остаток налога бумаги: сколько на ней напечатано минус то,
  -- что унесли прежние (частичные) ноты. Пропорция от остатка суммы теряла
  -- цент на каждой доле, и сумма нот не сходилась с инвойсом.
  note_vat := greatest(0, coalesce(original.vat_amount, 0) - coalesce((
    select sum(-prior.vat_amount)
      from public.invoices prior
     where prior.credit_note_of_id = original.id
       and prior.tenant_id = original.tenant_id
       and prior.kind = 'credit_note'
  ), 0));

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
    -(original.total - original.credited_amount - note_vat),
    original.vat_percent,
    -note_vat,
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
$function$;

revoke all on function public._issue_credit_note(uuid, text) from public, anon, authenticated;

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
  credited_before numeric;
  vat_before numeric;
  vat_left numeric;
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
  -- Нота, доводящая возврат до суммы чека, несёт остаток налога чека: налог
  -- чека минус налог прежних нот. Остальные доли остаток не превышают.
  select coalesce(sum(-prior.total), 0), coalesce(sum(-prior.vat_amount), 0)
    into credited_before, vat_before
    from public.invoices prior
   where prior.credit_note_of_receipt_id = receipt_row.id
     and prior.tenant_id = receipt_row.tenant_id
     and prior.kind = 'credit_note';
  vat_left := greatest(0, coalesce(receipt_row.vat_amount, 0) - vat_before);
  note_vat := case
    when coalesce(receipt_row.vat_amount, 0) > 0 and receipt_row.amount > 0
      then case
        when credited_before + amount_value >= receipt_row.amount then vat_left
        else least(round(receipt_row.vat_amount * amount_value / receipt_row.amount, 2), vat_left)
      end
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
$function$;

revoke all on function public._issue_receipt_credit_note(uuid, numeric, text, text) from public, anon, authenticated;

-- ======================================================================
-- 6, 7. issue_partial_credit_note: ЧУЖОЙ ДОКУМЕНТ НА ПОВТОРЕ И ПОВТОР ПОЛНОЙ ОТМЕНЫ
-- ======================================================================

CREATE OR REPLACE FUNCTION public.issue_partial_credit_note(p_invoice_id uuid, p_request_id uuid, p_amount numeric, p_reason text DEFAULT NULL::text, p_language text DEFAULT 'en'::text, p_payment_id uuid DEFAULT NULL::uuid)
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

  -- Повтор запроса возвращает СВОЮ ноту. Строка с этим id, не являющаяся
  -- нотой этого инвойса, — чужой документ: отдавать её нельзя.
  select * into note_row from public.invoices where id = p_request_id and tenant_id = tenant_uuid;
  if found then
    if note_row.kind = 'credit_note' and note_row.credit_note_of_id = invoice_row.id then
      return note_row;
    end if;
    raise exception 'Запрос кредит-ноты уже использован';
  end if;

  if invoice_row.kind <> 'invoice' then
    raise exception 'Кредит-нота не сторнируется — она сама является сторно';
  end if;
  -- Повтор полной отмены: нота полной отмены выписывается под своим номером
  -- (id запроса ей не достаётся), поэтому повтор узнаётся по ноте этого же
  -- автора на ту же сумму — отменённый инвойс отдаёт её, а не ошибку.
  if invoice_row.status = 'cancelled' then
    select * into note_row
      from public.invoices note
     where note.tenant_id = tenant_uuid
       and note.kind = 'credit_note'
       and note.credit_note_of_id = invoice_row.id
       and not note.credit_partial
       and note.created_by is not distinct from auth.uid()
       and -note.total = round(p_amount, 2)
     order by note.created_at, note.id
     limit 1;
    if found then
      return note_row;
    end if;
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
    perform public._refund_invoice_money(invoice_row, to_refund, business_date, 'Возврат по отмене инвойса ' || invoice_row.number, p_payment_id);
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
  -- Доля налога не больше остатка налога бумаги (прежние ноты уже унесли
  -- свою часть); последнюю долю добирает `_issue_credit_note` как остаток.
  note_vat := case
    when coalesce(invoice_row.vat_amount, 0) > 0 and invoice_row.total > 0
      then least(
        round(invoice_row.vat_amount * amount_value / invoice_row.total, 2),
        greatest(0, invoice_row.vat_amount - coalesce((
          select sum(-prior.vat_amount)
            from public.invoices prior
           where prior.credit_note_of_id = invoice_row.id
             and prior.tenant_id = tenant_uuid
             and prior.kind = 'credit_note'
        ), 0))
      )
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

  perform public._refund_invoice_money(invoice_row, to_refund, business_date, 'Возврат по кредит-ноте ' || note_number, p_payment_id);

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
$function$;

revoke all on function public.issue_partial_credit_note(uuid, uuid, numeric, text, text, uuid) from public, anon;

-- ======================================================================
-- 3. issue_invoice: ПРИВЯЗАННЫЙ ДОХОД БЕРЁТ НАЛОГ ИНВОЙСА
-- ======================================================================

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
  vat_rate_percent numeric := 0;
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
  if p_issued_on > public.tenant_business_date(tenant_uuid) then
    raise exception 'Документ нельзя датировать будущим числом';
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
  vat_rate_percent := vat_rate;

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
         and public.account_serves_team(acc.id, resolved_brigade_id)
         and not acc.is_hidden
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
    -- Налог привязанного дохода — с бумаги, в том же обновлении (как у оплат
    -- инвойса): иначе доход держал бы свой НДС и спорил с напечатанным.
    -- Итог инвойса равен доходу (проверено выше), делить налог не на что.
    update public.finance_transactions
       set invoice_id = invoice_row.id,
           vat_mode = case when vat_total > 0 then 'inclusive' else 'none' end,
           vat_rate = case when vat_total > 0 then vat_rate_percent else null end,
           vat_amount = case when vat_total > 0 then vat_total else null end
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

revoke all on function public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text, text) from public, anon;

-- ======================================================================
-- 1. СТРОКИ ЧЕКОВ НА СКРЫТОМ СЧЁТЕ — ТОЛЬКО ВЛАДЕЛЬЦУ
-- ======================================================================

-- Как `finance_transactions_hidden_owner_only`: чек несёт счёт платежа, а
-- доходная строка этого счёта партнёру уже не видна.
drop policy if exists receipts_hidden_owner_only on public.receipts;
create policy receipts_hidden_owner_only on public.receipts
  as restrictive
  for select
  to authenticated
  using (
    account_id is null
    or (select public.current_user_role()) = 'owner'
    or not (account_id in (select unnest(public.hidden_account_ids())))
  );

-- ======================================================================
-- 2. СВОДКИ СЧЕТОВ: ОКНО ПАРТНЁРА И ПРАВА «ДОХОД» / «РАСХОД»
-- ======================================================================

-- Не-владелец видит в суммах периода и в датах истории только те строки, что
-- ему видны построчно: доходы и возвраты — с правом «Доход», расходы — с
-- «Расход», оплаты долгов — с «Долги», и всё это не раньше окна его команды
-- (`member_finance_window_starts`; оплаты долгов и переводы окна не знают).
-- Остаток (`delta`, `opening_before`) считается по всем строкам счёта: его
-- читают по праву «Счета», и неполный остаток — ложь.
create or replace function public.account_period_totals(p_tenant uuid, p_from date, p_to date)
 returns table(account_id uuid, opening_before numeric, income numeric, expense numeric, refund numeric, transfer_in numeric, transfer_out numeric, net numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  caller_is_owner boolean;
  visible_accounts uuid[];
  income_teams text[] := array[]::text[];
  expense_teams text[] := array[]::text[];
  debt_teams text[] := array[]::text[];
  window_starts jsonb := '{}'::jsonb;
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
    income_teams := public.access_calendars('finance.income', 'read');
    expense_teams := public.access_calendars('finance.expense', 'read');
    debt_teams := public.access_calendars('finance.debts', 'read');
    window_starts := public.member_finance_window_starts();
  end if;

  return query
  with ledger as (
    select
      tx.account_id as ledger_account_id,
      sum(
        case
          when tx.type = 'expense' then -tx.amount
          when tx.type = 'refund' then -abs(tx.amount)
          else tx.amount
        end
      ) filter (where tx.occurred_on < p_from) as delta_before,
      sum(tx.amount) filter (
        where tx.visible and tx.type = 'income' and tx.occurred_on >= p_from
      ) as income_total,
      sum(-tx.amount) filter (
        where tx.visible and tx.type = 'expense' and tx.occurred_on >= p_from
      ) as expense_total,
      sum(-abs(tx.amount)) filter (
        where tx.visible and tx.type = 'refund' and tx.occurred_on >= p_from
      ) as refund_total,
      sum(tx.amount) filter (
        where tx.type = 'transfer' and tx.amount > 0 and tx.occurred_on >= p_from
      ) as transfer_in_total,
      sum(tx.amount) filter (
        where tx.type = 'transfer' and tx.amount < 0 and tx.occurred_on >= p_from
      ) as transfer_out_total,
      sum(
        case
          when tx.type = 'expense' then -tx.amount
          when tx.type = 'refund' then -abs(tx.amount)
          else tx.amount
        end
      ) filter (
        where tx.visible and tx.type <> 'transfer' and tx.occurred_on >= p_from
      ) as net_total
    from (
      select
        t.account_id,
        t.type,
        t.amount,
        t.occurred_on,
        coalesce(
          caller_is_owner
          or t.type = 'transfer'
          or (
            (
              (t.type in ('income', 'refund') and t.team_id = any(income_teams))
              or (t.type = 'expense' and t.team_id = any(expense_teams))
              or (t.debt_id is not null and t.team_id = any(debt_teams))
            )
            and (
              t.debt_id is not null
              or t.occurred_on >= coalesce((window_starts ->> t.team_id)::date, '-infinity'::date)
            )
          ),
          false
        ) as visible
      from public.finance_transactions t
      where t.tenant_id = tenant_uuid
        and t.occurred_on <= p_to
        and (caller_is_owner or t.account_id = any(visible_accounts))
    ) tx
    group by tx.account_id
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
$function$;
revoke all on function public.account_period_totals(uuid, date, date) from public, anon;

-- Остаток и «есть ли история» — по всем строкам; даты первой и последней
-- операции — только по видимым (иначе дата открывает, что было до окна).
create or replace function public.account_balances(p_tenant uuid)
 returns table(account_id uuid, delta numeric, has_history boolean, is_active boolean, last_outflow_on date, last_tx_on date, first_tx_on date)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  caller_is_owner boolean;
  visible_accounts uuid[];
  income_teams text[] := array[]::text[];
  expense_teams text[] := array[]::text[];
  debt_teams text[] := array[]::text[];
  window_starts jsonb := '{}'::jsonb;
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
    income_teams := public.access_calendars('finance.income', 'read');
    expense_teams := public.access_calendars('finance.expense', 'read');
    debt_teams := public.access_calendars('finance.debts', 'read');
    window_starts := public.member_finance_window_starts();
  end if;

  return query
  with ledger as (
    select
      tx.account_id as ledger_account_id,
      sum(
        case
          when tx.type = 'expense' then -tx.amount
          when tx.type = 'refund' then -abs(tx.amount)
          else tx.amount
        end
      ) as ledger_delta,
      count(*) as tx_count,
      max(tx.occurred_on) filter (
        where tx.type = 'transfer' and tx.amount < 0
      ) as ledger_last_outflow_on,
      max(tx.occurred_on) filter (where tx.visible) as ledger_last_tx_on,
      min(tx.occurred_on) filter (where tx.visible) as ledger_first_tx_on
    from (
      select
        t.account_id,
        t.type,
        t.amount,
        t.occurred_on,
        coalesce(
          caller_is_owner
          or t.type = 'transfer'
          or (
            (
              (t.type in ('income', 'refund') and t.team_id = any(income_teams))
              or (t.type = 'expense' and t.team_id = any(expense_teams))
              or (t.debt_id is not null and t.team_id = any(debt_teams))
            )
            and (
              t.debt_id is not null
              or t.occurred_on >= coalesce((window_starts ->> t.team_id)::date, '-infinity'::date)
            )
          ),
          false
        ) as visible
      from public.finance_transactions t
      where t.tenant_id = tenant_uuid
        and (caller_is_owner or t.account_id = any(visible_accounts))
    ) tx
    group by tx.account_id
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
$function$;
revoke all on function public.account_balances(uuid) from public, anon;

-- ======================================================================
-- Самопроверка: функции этой миграции несут свои правки.
-- ======================================================================

do $$
begin
  if pg_get_functiondef('public.issue_receipt(uuid, jsonb, uuid, date, text, text)'::regprocedure) not like '%_assert_account_not_hidden%'
     or pg_get_functiondef('public.issue_receipt(uuid, jsonb, uuid, date, text, text)'::regprocedure) not like '%receipt:debt_payment%'
     or pg_get_functiondef('public._receipt_tx_allowed(public.finance_transactions)'::regprocedure) not like '%is_hidden%'
     or pg_get_functiondef('public._refund_invoice_money(public.invoices, numeric, date, text, uuid)'::regprocedure) not like '%_assert_account_not_hidden%'
     or pg_get_functiondef('public.refund_receipt(uuid, uuid, numeric, text, text)'::regprocedure) not like '%_assert_account_not_hidden%' then
    raise exception 'Миграция finance_hidden_accounts_window_vat: проверка скрытого счёта не встала';
  end if;
  if pg_get_functiondef('public.account_period_totals(uuid, date, date)'::regprocedure) not like '%member_finance_window_starts%'
     or pg_get_functiondef('public.account_balances(uuid)'::regprocedure) not like '%member_finance_window_starts%' then
    raise exception 'Миграция finance_hidden_accounts_window_vat: окно партнёра не встало';
  end if;
  if pg_get_functiondef('public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text, text)'::regprocedure) not like '%vat_rate_percent%'
     or pg_get_functiondef('public.fill_transaction_vat()'::regprocedure) not like '%vat_left%'
     or pg_get_functiondef('public._issue_credit_note(uuid, text)'::regprocedure) not like '%note_vat%'
     or pg_get_functiondef('public._issue_receipt_credit_note(uuid, numeric, text, text)'::regprocedure) not like '%vat_left%'
     or pg_get_functiondef('public.issue_partial_credit_note(uuid, uuid, numeric, text, text, uuid)'::regprocedure) not like '%Запрос кредит-ноты уже использован%' then
    raise exception 'Миграция finance_hidden_accounts_window_vat: налог долей не встал';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'receipts'
       and policyname = 'receipts_hidden_owner_only' and permissive = 'RESTRICTIVE'
  ) then
    raise exception 'Миграция finance_hidden_accounts_window_vat: политика чеков не встала';
  end if;
end;
$$;
