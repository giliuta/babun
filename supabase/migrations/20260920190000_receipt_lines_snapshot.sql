-- ЧЕК ПОМНИТ СВОИ СТРОКИ САМ.
--
-- ЗАЧЕМ. Сегодня перечень работ на бумаге чека собирает УСТРОЙСТВО, читая
-- живую запись или живой инвойс за спиной проводки (`receiptLinesFrom
-- Appointment` / `receiptLinesFromInvoice`). Это значит две вещи, и обе
-- плохие:
--   • выданный документ МЕНЯЕТСЯ задним числом — поправили услугу в записи
--     через неделю, и чек, который клиент уже держит в руках, печатается
--     иначе. Снимок, который не снимок;
--   • чек, составленный С НУЛЯ (владелец 2026-09-20: «я создаю с нуля…
--     выбрать уже из услуг, которые у меня добавлены»), прикрепить перечень
--     НЕКУДА: у проводки нет ни записи, ни инвойса, а у `receipts` не было
--     колонки. Бумага печатала бы одно «Получено €N» над пустым местом.
--
-- ЧТО ДЕЛАЕТСЯ. У `receipts` появляется `lines jsonb` — снимок строк на
-- момент выдачи, рядом с уже имеющимися снимками продавца и покупателя.
-- Заполняет его та же дверь `issue_receipt`, получив строки от составителя;
-- сервер их ЧИСТИТ (см. `_receipt_lines_snapshot`), а не берёт как есть.
--
-- СТАРЫЕ ЧЕКИ. `lines` у них остаётся `null`, и это не «пусто», а «снимка
-- нет»: для таких бумага ведёт себя ровно как сегодня — достаёт перечень из
-- источника. Колонка добавляется БЕЗ `default` намеренно: умолчание
-- прописалось бы всем существующим строкам разом (см. урок
-- `add column … default` 2026-09-19), а выдумывать прошлым документам
-- содержимое нельзя.
--
-- ЧЕГО ЗДЕСЬ НЕТ. Проверки «сумма строк равна сумме чека» — нет намеренно.
-- При «плюс налог» полученное больше перечня на ставку, при скидке — меньше
-- на скидку, и честное равенство пришлось бы собирать из полей, которых у
-- проводки нет. Сумма чека по-прежнему приходит ТОЛЬКО из проводки
-- (`p_tx.amount`), строки на неё не влияют ни в одной ветке — перечень здесь
-- пояснение к деньгам, а не их источник.

alter table public.receipts add column if not exists lines jsonb;

comment on column public.receipts.lines is
  'Снимок перечня работ на момент выдачи: [{name,qty,unit,unitPrice,sum}]. '
  'null — снимка нет (чеки, выданные до 2026-09-20): такие печатаются из '
  'источника, как раньше. Чистится _receipt_lines_snapshot; на сумму чека не '
  'влияет — она приходит из проводки.';

-- ─── 0. ЧИСЛО ИЗ ЧЕГО УГОДНО ────────────────────────────────────────────
-- `(item ->> 'qty')::numeric` — тихая мина: «1,5» (запятая как разделитель —
-- обычный ввод с телефона), «две», «1.2.3» роняют приведение, исключение
-- уходит наружу из `issue_receipt`, и кнопка отвечает человеку сырой ошибкой
-- Postgres вместо чека. Найдено сухим прогоном до наката.
--
-- Правило то же, что у остальной чистки: непонятное становится нулём, а не
-- аварией. Ноль в количестве виден на бумаге сразу и чинится правкой строки;
-- упавшая кнопка не чинится ничем.
create or replace function public._receipt_num(p_value text)
returns numeric
language plpgsql
immutable
as $$
begin
  -- Запятая — тот же разделитель, что точка: человек пишет «1,5», и документ
  -- обязан прочесть это как полтора, а не как ноль.
  return coalesce(replace(btrim(coalesce(p_value, '')), ',', '.')::numeric, 0);
exception when others then
  return 0;
end;
$$;

revoke all on function public._receipt_num(text) from public, anon, authenticated;

-- ─── 1. ЧИСТКА СНИМКА ───────────────────────────────────────────────────
-- Строки приходят с устройства, а ложатся в документ. Сервер не доверяет им
-- форму: берёт только пять известных полей, приводит числа к числам, режет
-- длину имени и всего списка. Всё, что не массив объектов с непустым именем,
-- превращается в `null` — лучше бумага без перечня, чем бумага с мусором.
--
-- `immutable` и без доступа к таблицам: это чистая функция над jsonb, её
-- незачем пускать в базу.
create or replace function public._receipt_lines_snapshot(p_lines jsonb)
returns jsonb
language sql
immutable
as $$
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
$$;

revoke all on function public._receipt_lines_snapshot(jsonb) from public, anon, authenticated;

-- ─── 2. ЯДРО ПРИНИМАЕТ СНИМОК ───────────────────────────────────────────
-- Подпись меняется, поэтому старую функцию сначала СНОСИМ: `create or
-- replace` с другим списком аргументов оставил бы рядом вторую, и `issue_
-- receipt` продолжил бы звать безстрочную. Зависимостей у ядра ровно одна —
-- дверь ниже, она пересоздаётся в §3.
drop function if exists public._issue_receipt_core(public.finance_transactions);

create or replace function public._issue_receipt_core(
  p_tx public.finance_transactions,
  p_lines jsonb default null
)
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
    transaction_id, account_id, payment_method, seller_snapshot, client_snapshot,
    lines
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
    buyer,
    public._receipt_lines_snapshot(p_lines)
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

revoke all on function public._issue_receipt_core(public.finance_transactions, jsonb)
  from public, anon, authenticated;

-- ─── 3. ДВЕРЬ ПЕРЕДАЁТ СНИМОК ───────────────────────────────────────────
-- Тело двери — то же, что в 20260920120000, слово в слово; меняются РОВНО
-- две строки: подпись (второй необязательный параметр) и вызов ядра. Права,
-- порядок проверок, тексты отказов и идемпотентность не трогаются.
--
-- СНОС ПЕРЕД СОЗДАНИЕМ ОБЯЗАТЕЛЕН. `create or replace` различает функции по
-- СПИСКУ ТИПОВ, а не по имени: `issue_receipt(uuid)` и `issue_receipt(uuid,
-- jsonb)` — две разные функции, и без сноса в каталоге осталась бы пара. Для
-- вызова `issue_receipt(<uuid>)` они обе подходят (у второй параметр с
-- умолчанием), и Postgres ответил бы «function is not unique» — дверь
-- перестала бы открываться вовсе. §4 сторожит ровно это: дверь должна быть
-- одна.
--
-- СТАРЫЙ ВЫЗОВ `issue_receipt(uuid)` ОСТАЁТСЯ РАБОЧИМ и после сноса: у новой
-- двери второй параметр со значением по умолчанию, и сборка на руках у
-- человека, зовущая дверь одним аргументом, продолжает выписывать чек —
-- просто без перечня.
drop function if exists public.issue_receipt(uuid);

create or replace function public.issue_receipt(
  p_transaction_id uuid,
  p_lines jsonb default null
)
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

  result_row := public._issue_receipt_core(tx, p_lines);
  if result_row.id is null then
    select * into result_row from public.receipts where transaction_id = tx.id;
  end if;
  if result_row.id is null then
    raise exception 'Не удалось выписать чек';
  end if;
  return result_row;
end;
$$;

revoke all on function public.issue_receipt(uuid, jsonb) from public, anon;
grant execute on function public.issue_receipt(uuid, jsonb) to authenticated;

comment on function public.issue_receipt(uuid, jsonb) is
  'Выписывает чек по кнопке для проводки p_transaction_id (владелец 2026-09-20: '
  'чек не выписывается сам, только по нажатию); p_lines — перечень работ, '
  'который замораживается в чеке снимком. Права — как у приёма денег по этой '
  'проводке; идемпотентна; отказывает без клиента, не на доходе, при полном '
  'возврате или сумме ≤ 0.';

-- ─── 4. Проверки после наката ───────────────────────────────────────────
do $audit$
declare
  core_oid oid;
  door_oid oid;
  sample jsonb;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'receipts' and column_name = 'lines'
  ) then
    raise exception 'receipt_lines: колонка lines не создана';
  end if;
  -- Умолчание не прописано существующим строкам — ни через `default`, ни
  -- скрытым `atthasmissing` (урок 2026-09-19).
  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.receipts'::regclass
       and attname = 'lines'
       and (atthasdef or atthasmissing)
  ) then
    raise exception 'receipt_lines: у колонки lines есть умолчание — оно прошьётся старым чекам';
  end if;
  if exists (select 1 from public.receipts where lines is not null) then
    raise exception 'receipt_lines: у старых чеков появился перечень — снимка у них быть не может';
  end if;

  if (select count(*) from pg_proc
       where proname = 'issue_receipt' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'receipt_lines: дверей issue_receipt должно остаться ровно одна';
  end if;
  if (select count(*) from pg_proc
       where proname = '_issue_receipt_core' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'receipt_lines: ядер _issue_receipt_core должно остаться ровно одно';
  end if;

  select p.oid into door_oid from pg_proc p
   where p.proname = 'issue_receipt' and p.pronamespace = 'public'::regnamespace;
  select p.oid into core_oid from pg_proc p
   where p.proname = '_issue_receipt_core' and p.pronamespace = 'public'::regnamespace;

  if has_function_privilege('anon', door_oid, 'EXECUTE') then
    raise exception 'receipt_lines: issue_receipt доступна anon';
  end if;
  if not has_function_privilege('authenticated', door_oid, 'EXECUTE') then
    raise exception 'receipt_lines: issue_receipt недоступна authenticated';
  end if;
  if has_function_privilege('authenticated', core_oid, 'EXECUTE') then
    raise exception 'receipt_lines: ядро исполнимо напрямую authenticated';
  end if;
  if has_function_privilege('authenticated', 'public._receipt_lines_snapshot(jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._receipt_num(text)', 'EXECUTE') then
    raise exception 'receipt_lines: служебная чистка исполнима напрямую authenticated';
  end if;

  -- Чистка работает и на мусоре, и на деле — проверяем обе стороны здесь же,
  -- чтобы накат падал на сломанной чистке, а не выяснялось это на бумаге.
  if public._receipt_lines_snapshot('"строка"'::jsonb) is not null then
    raise exception 'receipt_lines: не-массив обязан стать null';
  end if;
  if public._receipt_lines_snapshot('[]'::jsonb) is not null then
    raise exception 'receipt_lines: пустой массив обязан стать null';
  end if;
  if public._receipt_lines_snapshot('[{"qty":1}]'::jsonb) is not null then
    raise exception 'receipt_lines: строка без имени обязана быть отброшена';
  end if;
  sample := public._receipt_lines_snapshot(
    '[{"name":"  Чистка  ","qty":2,"unit":"шт","unitPrice":50,"sum":100,"чужое":"x"},{"name":""}]'::jsonb
  );
  if jsonb_array_length(sample) <> 1 then
    raise exception 'receipt_lines: чистка не отбросила безымянную строку';
  end if;
  if sample -> 0 ->> 'name' <> 'Чистка' then
    raise exception 'receipt_lines: имя не очищено от пробелов';
  end if;
  if sample -> 0 ? 'чужое' then
    raise exception 'receipt_lines: чужое поле просочилось в документ';
  end if;

  -- ЧИСЛА ИЗ ЧЕГО УГОДНО: запятая читается как точка, мусор становится нулём,
  -- и ни один вход не роняет выписку. Проверяется ЗДЕСЬ, на накате: сломанная
  -- чистка обязана отменить миграцию целиком, а не выясниться на кнопке.
  if public._receipt_num('1,5') <> 1.5 then
    raise exception 'receipt_lines: запятая в числе прочитана не как разделитель';
  end if;
  if public._receipt_num('две') <> 0 or public._receipt_num('1.2.3') <> 0
     or public._receipt_num(null) <> 0 then
    raise exception 'receipt_lines: мусор в числе обязан стать нулём, а не ошибкой';
  end if;
  sample := public._receipt_lines_snapshot(
    '[{"name":"Полтора метра","qty":"1,5","unitPrice":"две","sum":"1.2.3"}]'::jsonb
  );
  if (sample -> 0 ->> 'qty')::numeric <> 1.5
     or (sample -> 0 ->> 'unitPrice')::numeric <> 0
     or (sample -> 0 ->> 'sum')::numeric <> 0 then
    raise exception 'receipt_lines: нечисловая строка не превратилась в число безопасно';
  end if;
end;
$audit$;
