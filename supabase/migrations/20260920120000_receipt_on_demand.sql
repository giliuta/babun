-- ЧЕК ПО КНОПКЕ, А НЕ САМ (владелец 2026-09-20, дословно): «мы получаем
-- оплату, но мы можем сами решать, выписывать чек на этого клиента или нет.
-- То есть чек не сразу выписывается — мы выписываем его только тогда, когда
-- нажмём кнопку „Выписать чек“».
--
-- ДО ЭТОЙ МИГРАЦИИ. `issue_receipt_for_income()` — триггер AFTER INSERT на
-- `finance_transactions` (20260809120000_receipts_and_credit_notes) — рождал
-- строку `receipts` САМ, для КАЖДОЙ вставки с `type = 'income' and client_id
-- is not null and amount > 0`. Дорог к такой вставке у продукта три, и все
-- три сегодня получают чек без спроса:
--   • `reconcile_appointment_finance()` — доплата/предоплата по плитке записи
--     (`record_appointment_payment`), автоматическая строка `source='auto'`;
--   • `record_invoice_payment()` — ручной платёж по инвойсу, `source='manual'`,
--     `invoice_id` не пуст;
--   • прямая ручная вставка в `finance_transactions` с клиентом (сотрудник
--     или владелец в форме операции), `source='manual'`, без инвойса.
-- Писать в `receipts` с клиента нельзя — таблица закрыта на чтение
-- (`receipts_read`: только `owner`/`dispatcher`), значит открытой двери для
-- «передумать» тоже не было.
--
-- ЧТО МЕНЯЕТСЯ. Триггер снят. Его тело не выброшено — перенесено дословно (та
-- же серия `RC-<год>-<NNN>`, тот же `pg_advisory_xact_lock`, те же снимки
-- продавца/клиента) в закрытое ядро `_issue_receipt_core`, и новая дверь
-- `public.issue_receipt(p_transaction_id)` — единственный способ вызвать его
-- теперь. Права двери — РОВНО те же, что у приёма денег по этой же проводке
-- (см. §3): не шире того, что сегодня разрешено видеть и писать по деньгам.
--
-- ЧТО НЕ МЕНЯЕТСЯ. `void_receipt_on_refund()` — как был: полный возврат
-- по-прежнему гасит УЖЕ ВЫПИСАННЫЙ чек. Если чек ещё не выписали, а доход уже
-- вернули целиком — гасить нечего, и `issue_receipt` сам откажет (§3, пункт
-- «чек уже погашен возвратом»): выписывать бумагу на возвращённые деньги нет
-- смысла.
--
-- ВИДИМОСТЬ — §4. Пока чек рождался сам, его никто, кроме владельца и
-- диспетчера, и не ждал. Дверь §3 это ломает: исполнитель, который вправе
-- принять деньги по своей записи, вправе и нажать кнопку — получит строку из
-- SECURITY DEFINER функции один раз и больше своего же чека не увидит
-- (`receipts_read`: только `owner`/`dispatcher`). Кнопка, после которой
-- бумага исчезает, — это не кнопка. §4 добавляет ВТОРУЮ политику чтения, не
-- трогая первую: видно того чека, чьи деньги тебе и так видны.
--
-- ПОСЛЕДСТВИЕ ДЛЯ УЖЕ ВЫПИСАННЫХ ЧЕКОВ: ноль — таблица `receipts` не
-- меняется, старые строки, их номера и статусы стоят как стояли.
-- ПОСЛЕДСТВИЕ ДЛЯ ОПЛАТЫ ИНВОЙСОВ: тот же переход, что и у записи — оплата
-- инвойса больше не приносит чек сама, его тоже нужно выписать кнопкой на
-- проводке платежа. Это осознанно: «получаем оплату» в словах владельца не
-- различает источник денег.

-- ─── 1. ЯДРО: тело триггера, дословно, параметризованное строкой проводки ──
-- Копия исполняемой части `issue_receipt_for_income()` (20260809120000).
-- Ничего в номере, замке или снимках не меняется — только `new.*` стало
-- `p_tx.*`, а `return new` (для триггера) — `return result_row` (для двери).
-- Не публичная дверь: следующая GRANT-секция закрывает её от всех ролей,
-- вызывать может только SECURITY DEFINER функция того же владельца ниже.
create or replace function public._issue_receipt_core(p_tx public.finance_transactions)
returns public.receipts
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  receipt_year integer;
  receipt_seq integer;
  seller jsonb;
  buyer jsonb;
  result_row public.receipts%rowtype;
begin
  -- Тот же защитный периметр, что был в триггере: ядро — не единственная
  -- страховка (дверь ниже проверяет то же самое с понятным текстом отказа
  -- раньше), но бумага не должна родиться в обход условия ни одним путём.
  if p_tx.type <> 'income' or p_tx.client_id is null or p_tx.amount <= 0 then
    return null;
  end if;

  receipt_year := extract(year from p_tx.occurred_on)::integer;
  -- Тот же замок, что у инвойсов и что был у триггера: max(seq)+1 без гонки,
  -- серия без дыр, в рамках компании и года.
  perform pg_advisory_xact_lock(hashtextextended(p_tx.tenant_id::text || ':rc', 0));
  select coalesce(max(seq), 0) + 1 into receipt_seq
    from public.receipts
   where tenant_id = p_tx.tenant_id and year = receipt_year;

  select jsonb_build_object(
           'name', coalesce(t.legal_name, t.name),
           'address', t.business_address,
           'vat_mode', t.vat_mode,
           'currency', t.currency
         )
    into seller
    from public.tenants t where t.id = p_tx.tenant_id;

  select jsonb_build_object('name', c.full_name, 'phone', c.phone)
    into buyer
    from public.clients c where c.id = p_tx.client_id;

  insert into public.receipts (
    tenant_id, number, year, seq, issued_on, amount, currency,
    vat_rate, vat_amount, client_id, appointment_id, invoice_id,
    transaction_id, account_id, payment_method, seller_snapshot, client_snapshot
  ) values (
    p_tx.tenant_id,
    'RC-' || receipt_year::text || '-' || lpad(receipt_seq::text, 3, '0'),
    receipt_year,
    receipt_seq,
    p_tx.occurred_on,
    round(p_tx.amount, 2),
    coalesce(p_tx.currency, 'EUR'),
    p_tx.vat_rate,
    p_tx.vat_amount,
    p_tx.client_id,
    p_tx.appointment_id,
    p_tx.invoice_id,
    p_tx.id,
    p_tx.account_id,
    p_tx.payment_method,
    coalesce(seller, '{}'::jsonb),
    buyer
  )
  -- ПРЕДИКАТ ОБЯЗАТЕЛЕН: тот же частичный уникальный индекс арбитром, что и
  -- раньше — двух вызовов на одну проводку быть не может.
  on conflict (transaction_id) where transaction_id is not null do nothing
  returning * into result_row;

  if not found then
    -- Проиграли гонку внутри своего же замка (два вызова на одну и ту же
    -- проводку почти одновременно) — вернуть то, что уже создал соперник,
    -- а не пустую строку.
    select * into result_row from public.receipts where transaction_id = p_tx.id;
  end if;
  return result_row;
end;
$$;

revoke all on function public._issue_receipt_core(public.finance_transactions)
  from public, anon, authenticated;

-- ─── 2. СНЯТЬ АВТОМАТИЧЕСКУЮ ВЫПИСКУ ────────────────────────────────────
-- Тело перенесено в §1 дословно — функция-триггер больше не нужна как
-- отдельная сущность и не остаётся мёртвым кодом без триггера на ней.
drop trigger if exists trg_issue_receipt_for_income on public.finance_transactions;
drop function if exists public.issue_receipt_for_income();

-- `void_receipt_on_refund` и её триггер не трогаем: возврат по-прежнему гасит
-- уже выписанный чек ровно как раньше (20260809120000, без изменений).

-- ─── 3. ДВЕРЬ: «Выписать чек» ───────────────────────────────────────────
-- Права — РОВНО права на приём денег по этой же проводке, не шире:
--   • проводка родилась плиткой оплаты записи (`source = 'auto'`,
--     `appointment_id` заполнен) — то же условие, что у
--     `record_appointment_payment` / `cancel_appointment_payment`:
--     `current_user_can_pay_appointment` (владелец, диспетчер без строк прав,
--     либо команда/исполнитель этой записи);
--   • любая другая проводка (ручной доход, в том числе платёж инвойса —
--     `record_invoice_payment` тоже пишет `source = 'manual'`) — то же
--     условие, что у ручной вставки дохода в `finance_transactions_insert_
--     calendar`: календарь счёта на «Меняет» по `finance.operations`, сам
--     счёт — в счетах, куда можно писать, и, если проводка привязана к
--     долгу, — «Меняет» по `finance.debts` на календаре этого долга.
-- Решение (заявка не описывает этот случай явно): чек инвойса разбирается
-- как «ручной доход», а не отдельным владелец-только правилом — сегодня
-- `record_invoice_payment` и так пускает только владельца, так что для
-- проводок инвойса это не шире факта; когда/если оплату инвойса разрешат
-- диспетчеру, право на выписку последует за тем же блоком автоматически.
-- Блок `finance.documents` («Инвойсы и чеки», access_blocks.position 140)
-- существует в реестре, но НЕ live (20260915180000 включает live только
-- `finance.accounts`, `finance.debts`, `finance.operations`) — использовать
-- его сегодня означало бы «только владелец» для всех, независимо от их
-- настроек, и это не то, что просил владелец («те же права, что у приёма
-- денег»). Если продукт захочет тонкое право именно на бумагу отдельно от
-- денег — это будущая миграция, которая включит `finance.documents` живым.
create or replace function public.issue_receipt(p_transaction_id uuid)
returns public.receipts
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  tenant_uuid uuid := public.current_tenant_id();
  tx public.finance_transactions%rowtype;
  existing public.receipts%rowtype;
  result_row public.receipts%rowtype;
  refunded_amount numeric;
  allowed boolean := false;
begin
  if auth.uid() is null or tenant_uuid is null then
    raise exception 'Войдите в приложение, чтобы выписать чек';
  end if;
  if p_transaction_id is null then
    raise exception 'Не указана операция';
  end if;

  -- «Проводка чужой компании» получает тот же ответ, что и несуществующая:
  -- дверь не должна становиться оракулом чужих id.
  select * into tx
    from public.finance_transactions
   where id = p_transaction_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Операция не найдена';
  end if;

  if public.current_user_role() = 'owner' then
    allowed := true;
  elsif tx.source = 'auto' and tx.appointment_id is not null then
    allowed := public.current_user_can_pay_appointment(tx.team_id, tx.master_id);
  else
    allowed :=
      (
        tx.team_id is null
        or tx.team_id = any(public.access_calendars('finance.operations', 'write'))
      )
      and (
        tx.account_id is null
        or tx.account_id = any(public.access_accounts_for('finance.operations', 'write'))
      )
      and (
        tx.debt_id is null
        or tx.debt_id in (
          select d.id from public.debts d
           where d.tenant_id = tenant_uuid
             and d.team_id = any(public.access_calendars('finance.debts', 'write'))
        )
      );
  end if;
  if not allowed then
    raise exception 'Недостаточно прав, чтобы выписать чек по этой операции';
  end if;

  -- Идемпотентность: повторный вызов на этой же проводке отдаёт уже
  -- выписанный чек (или уже погашенный возвратом) — второго номера не будет.
  -- Проверяется ПОСЛЕ прав: неавторизованный вызов не должен подсматривать,
  -- выписан ли чек, тем более получать его.
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

  result_row := public._issue_receipt_core(tx);
  if result_row.id is null then
    select * into result_row from public.receipts where transaction_id = tx.id;
  end if;
  if result_row.id is null then
    raise exception 'Не удалось выписать чек';
  end if;
  return result_row;
end;
$$;

revoke all on function public.issue_receipt(uuid) from public, anon;
grant execute on function public.issue_receipt(uuid) to authenticated;

comment on function public.issue_receipt(uuid) is
  'Выписывает чек по кнопке для проводки p_transaction_id (владелец 2026-09-20: '
  'чек не выписывается сам, только по нажатию). Права — как у приёма денег по '
  'этой проводке; идемпотентна; отказывает без клиента, не на доходе, при '
  'полном возврате или сумме ≤ 0. Ядро номера/замка/снимков — '
  '_issue_receipt_core, перенесено дословно из бывшего триггера '
  'issue_receipt_for_income.';

-- ─── 4. ВИДИМОСТЬ: чек виден тому, кому видны его деньги ─────────────────
-- Политика ДОБАВЛЯЕТСЯ рядом с `receipts_read`, а не заменяет её: permissive
-- политики складываются по ИЛИ, поэтому владелец и диспетчер не теряют ничего
-- (они и так видят всё), а исполнитель получает ровно свой чек — тот, чья
-- проводка проходит его собственные политики на `finance_transactions`
-- (`_select_calendar` по «Доходы и расходы» его календарей, `_select_debt` по
-- «Долгам»). Своего права у бумаги нет: право на деньги — оно же право на
-- бумагу об этих деньгах, ровно как у двери §3.
--
-- Подзапрос без SECURITY DEFINER намеренно: RLS `finance_transactions`
-- считается здесь ОТ ИМЕНИ ВЫЗЫВАЮЩЕГО, в этом весь смысл — иначе политика
-- открыла бы чужие чеки. `tenant_id` в условии оставлен отдельным членом:
-- проводка у чека может быть пуста (`transaction_id is null` — ручной чек
-- будущих миграций), и тогда строка не должна проваливаться в чужую компанию
-- через `null in (...)`, а честно не совпасть ни с чем.
drop policy if exists receipts_read_own_money on public.receipts;
create policy receipts_read_own_money on public.receipts
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and transaction_id in (
      select ft.id from public.finance_transactions ft
       where ft.tenant_id = (select public.current_tenant_id())
    )
  );

comment on policy receipts_read_own_money on public.receipts is
  'Чек виден тому, кому видна его проводка (2026-09-20, вместе с кнопкой '
  '«Выписать чек»): исполнитель, принявший деньги по своей записи, видит '
  'выписанный им чек. Складывается по ИЛИ с receipts_read (владелец, диспетчер).';

-- ─── 5. Проверки после наката ───────────────────────────────────────────
-- Каталожные проверки по oid, а не по строке сигнатуры: композитный тип
-- параметра ядра (`public.finance_transactions`) не всегда безопасно писать
-- текстом в `to_regprocedure`/`has_function_privilege(text)` — берём
-- `pg_proc` напрямую и двух-аргументный `has_function_privilege(oid, text)`.
do $audit$
declare
  core_oid oid;
  door_oid oid;
begin
  if exists (
    select 1 from pg_trigger
     where tgname = 'trg_issue_receipt_for_income' and not tgisinternal
  ) then
    raise exception 'receipt_on_demand: старый триггер выписки всё ещё стоит';
  end if;
  if exists (
    select 1 from pg_proc
     where proname = 'issue_receipt_for_income'
       and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'receipt_on_demand: старая функция-триггер не снята';
  end if;

  select p.oid into door_oid
    from pg_proc p
   where p.proname = 'issue_receipt'
     and p.pronamespace = 'public'::regnamespace;
  if door_oid is null then
    raise exception 'receipt_on_demand: дверь issue_receipt не создана';
  end if;

  select p.oid into core_oid
    from pg_proc p
   where p.proname = '_issue_receipt_core'
     and p.pronamespace = 'public'::regnamespace;
  if core_oid is null then
    raise exception 'receipt_on_demand: ядро _issue_receipt_core не создано';
  end if;

  if has_function_privilege('anon', door_oid, 'EXECUTE') then
    raise exception 'receipt_on_demand: issue_receipt доступна anon';
  end if;
  if not has_function_privilege('authenticated', door_oid, 'EXECUTE') then
    raise exception 'receipt_on_demand: issue_receipt недоступна authenticated';
  end if;
  if has_function_privilege('authenticated', core_oid, 'EXECUTE') then
    raise exception 'receipt_on_demand: ядро не должно быть исполнимо напрямую authenticated';
  end if;
  if has_function_privilege('anon', core_oid, 'EXECUTE') then
    raise exception 'receipt_on_demand: ядро не должно быть исполнимо напрямую anon';
  end if;

  if (select count(*) from pg_trigger
       where tgname = 'trg_void_receipt_on_refund' and not tgisinternal) <> 1 then
    raise exception 'receipt_on_demand: void_receipt_on_refund пострадал — должен остаться нетронутым';
  end if;

  -- §4: обе политики чтения стоят рядом и обе permissive — иначе «складываются
  -- по ИЛИ» превращается в «И», и владелец с диспетчером потеряли бы чеки без
  -- проводки вместо того, чтобы приобрести чеки исполнителей.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'receipts' and policyname = 'receipts_read'
  ) then
    raise exception 'receipt_on_demand: receipts_read пропала — её трогать не собирались';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'receipts'
       and policyname = 'receipts_read_own_money'
  ) then
    raise exception 'receipt_on_demand: политика receipts_read_own_money не создана';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'receipts'
       and policyname in ('receipts_read', 'receipts_read_own_money')
       and permissive <> 'PERMISSIVE'
  ) then
    raise exception 'receipt_on_demand: политика чтения чеков стала restrictive — чтение сузится, а не расширится';
  end if;
  -- Писать в `receipts` с устройства по-прежнему нельзя ничем, кроме сервера:
  -- номер документа назначает только он (20260809120000).
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'receipts' and cmd <> 'SELECT'
  ) then
    raise exception 'receipt_on_demand: у receipts появилась политика записи — номера назначает только сервер';
  end if;
end;
$audit$;
