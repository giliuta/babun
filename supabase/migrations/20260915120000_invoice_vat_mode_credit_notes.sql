-- ДОКУМЕНТЫ: РЕЖИМ НДС НА ИНВОЙСЕ, СВЯЗЬ С ПЛАТЕЖОМ И КРЕДИТ-НОТА, КОТОРАЯ
-- ПРАВДА ВЫПИСЫВАЕТСЯ (шаг 4 плана «НДС в оплате записи», спецификация
-- 2026-09-15, §4 и §6.4; разбор, пункты A7 и B9).
--
-- Шаг — фундамент под «инвойс оплаты» шага 5 и починка того, что в документах
-- сломано уже сегодня. Денег он не двигает и живые строки не переписывает.
--
-- 1. РЕЖИМ НДС ХРАНИТСЯ НА ДОКУМЕНТЕ. Раньше «в цене» или «сверху» было только
--    аргументом `issue_invoice`, а экран угадывал режим обратно по суммам
--    (`invoiceVatMode` в `format.ts`). Теперь `invoices.vat_mode` пишут
--    `issue_invoice` и `update_invoice_draft`. У старых инвойсов колонка пуста:
--    режим, угаданный задним числом, остался бы догадкой, только записанной
--    в базу.
-- 2. СВЯЗЬ С ПЛАТЕЖОМ. `invoices.payment_id` — элемент `payments[]` записи,
--    который закроет инвойс оплаты шага 5. В компании он уникален: на один
--    платёж — один инвойс, и повтор платежа второго не выпишет. У ручных
--    инвойсов и у кредит-нот пусто.
-- 3. КРЕДИТ-НОТА — ОДНОЙ ДВЕРЬЮ, `_issue_credit_note`. Её зовут отмена инвойса
--    сейчас и возврат платежа с НДС на шаге 5, поэтому она внутренняя: права
--    проверяет вызывающий, из приложения её не вызвать. Номер CN-ГГГГ-NNN — по
--    году БИЗНЕС-ДАТЫ компании: `current_date` сервера живёт в UTC и в
--    новогоднюю ночь по Никосии дал бы прошлый год. Шапка — суммы инвойса с
--    минусом, стороны — снимки самого инвойса. Повтор возвращает уже
--    выписанную ноту.
-- 4. СТОРНО ПРОХОДИТ НА ЛЮБОМ ТАРИФЕ. Кредит-нота отменяет уже выписанный
--    документ, а на шаге 5 её рождает возврат денег: отказ тарифа откатил бы
--    вместе с нотой и возврат.
-- 5. «ОТМЕНЁН» СТАЛ ДОСТИЖИМ (A7). Сторож статусов знал только «выставлен /
--    оплачен / аннулирован», и `cancel_invoice` не мог закончиться ни разу:
--    кредит-нота откатывалась вместе с отказом сторожа. Теперь «выставлен →
--    отменён» разрешён, когда по инвойсу у нас не осталось денег и кредит-нота
--    выписана. Отменённый — конец пути, как аннулированный; кредит-нота
--    неизменяема. Её стороны — стороны инвойса, и триггер снимков больше не
--    подменяет их сегодняшними реквизитами.
-- 6. `cancel_invoice` ВЫЧИТАЕТ ВОЗВРАТЫ. Он считал одни доходы, и полностью
--    возвращённый инвойс отменить было нельзя никогда.
-- 7. ЧУЖОЙ НОМЕР НЕ ОТДАЁМ (B9). `next_invoice_number` отвечал любому, даже
--    без входа, про любую компанию: префикс и следующий номер чужой серии.
--    Приложение зовёт её для предпросмотра номера, поэтому вход остаётся, но
--    только про свою компанию.
--
-- Каждое тело взято из `pg_get_functiondef` 2026-09-15 и меняется только в
-- местах, описанных над ним. Владелец, права, SECURITY DEFINER и search_path —
-- как у живых функций. Функции соседнего шага
-- `20260915115000_appointment_ledger_by_journal` (сверка, `settle`,
-- `record_invoice_payment`, `validate_invoice_payment_insert`,
-- `protect_paid_appointment_finance`) этот файл не трогает.

-- ЗАМОК НЕ ЖДЁТ ДОЛГО. Новые колонки и индекс берут замок на `invoices`; пока
-- он ждёт чужую открытую транзакцию, за ним встают все чтения документов.
-- Через пять секунд миграция падает целиком — её повторяют в тихую минуту.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1–2. КОЛОНКИ

alter table public.invoices
  add column vat_mode text,
  add column payment_id text;

-- NULL проходит проверку сам: у старых инвойсов режима нет, и это честно.
alter table public.invoices
  add constraint invoices_vat_mode_check
  check (vat_mode in ('off', 'inclusive', 'exclusive'));

create unique index invoices_tenant_payment_id_key
  on public.invoices (tenant_id, payment_id)
  where payment_id is not null;

comment on column public.invoices.vat_mode is
  'Режим НДС, которым посчитан документ: off / inclusive / exclusive. Пишут issue_invoice и update_invoice_draft с 20260915120000; у старых инвойсов NULL — режим задним числом не восстанавливается.';
comment on column public.invoices.payment_id is
  'Элемент payments[] записи, который закрыл инвойс оплаты (шаг 5). Уникален в компании; у ручных инвойсов и кредит-нот NULL.';

-- ---------------------------------------------------------------------------
-- 3. СТОРОНЫ КРЕДИТ-НОТЫ — СТОРОНЫ ЕЁ ИНВОЙСА
--
-- Триггер снимков на вставке всегда собирал продавца и клиента заново из
-- сегодняшних строк компании и клиента, и снимки, которые `cancel_invoice`
-- копировал с инвойса, молча выбрасывались: смени компания реквизиты — сторно
-- напечатало бы не того продавца, что стоит на отменяемой бумаге. Теперь:
-- • кредит-нота на вставке берёт оба снимка из строки своего инвойса — на
--   сервере, присланный JSON по-прежнему не слушаем;
-- • клиент ноты обязан совпадать с клиентом инвойса, иначе снимок описывал бы
--   не того человека, что стоит в `client_id`;
-- • кредит-нота «ни на что» — без инвойса своей компании — не вставляется;
-- • пересобрать стороны ноты позже нельзя: это подписанное сторно.
-- Остальное — байт в байт как было.
CREATE OR REPLACE FUNCTION public.capture_invoice_document_snapshots()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  document_changed boolean := false;
  refresh_requested boolean := false;
  has_ledger boolean := false;
  source_invoice public.invoices%rowtype;
begin
  if tg_op = 'INSERT' then
    -- Кредит-нота несёт стороны своего инвойса, а не сегодняшние.
    if new.kind = 'credit_note' then
      select * into source_invoice
        from public.invoices invoice
       where invoice.id = new.credit_note_of_id
         and invoice.tenant_id = new.tenant_id
         and invoice.kind = 'invoice';
      if not found then
        raise exception 'Кредит-нота должна ссылаться на инвойс этой компании';
      end if;
      if new.client_id is distinct from source_invoice.client_id then
        raise exception 'Клиент кредит-ноты не совпадает с клиентом инвойса';
      end if;
      new.seller_snapshot := source_invoice.seller_snapshot;
      new.client_snapshot := source_invoice.client_snapshot;
      return new;
    end if;

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

  -- Стороны кредит-ноты взяты с её инвойса при выписке и не пересобираются.
  if old.kind = 'credit_note' then
    raise exception 'Стороны кредит-ноты не обновляются — это стороны её инвойса';
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

-- ---------------------------------------------------------------------------
-- 3. ОДНА ДВЕРЬ К КРЕДИТ-НОТЕ
--
-- Внутренняя: права проверяет вызывающий (`cancel_invoice` — владелец; на
-- шаге 5 — сверка и снятие платежа с НДС), а приложению, `anon` и
-- `authenticated` вызов закрыт.
-- • Замок строки инвойса: две отмены одного инвойса идут по очереди, и вторая
--   видит ноту первой. Пока замок держится, денег на инвойс не внести — оплата
--   берёт тот же замок.
-- • Одна нота на инвойс: повтор возвращает уже выписанную. Эта проверка стоит
--   до проверки статуса — у отменённого инвойса нота уже есть.
-- • Нота выписывается только на действующий инвойс, по которому у нас не
--   осталось денег: доходы − возвраты, включая старые возвраты, привязанные к
--   доходу одной `refund_of_id`. Бумага «отменено» при деньгах в кассе —
--   ошибка учёта, какая бы дверь её ни попросила.
-- • Номер — своя серия CN-ГГГГ-NNN под замком `:cn` компании, как у прежнего
--   `cancel_invoice`; год и дата — из `tenant_business_date`.
-- • Шапка — суммы инвойса с минусом, та же ставка, валюта, режим НДС и язык.
--   `payment_id` не копируется: он уникален и принадлежит инвойсу. Позиций у
--   ноты нет — как и у нот, которые пытался выписать прежний `cancel_invoice`.
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
  income_total numeric := 0;
  direct_refunds numeric := 0;
  linked_refunds numeric := 0;
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

  note_date := public.tenant_business_date(original.tenant_id);
  note_year := extract(year from note_date)::integer;
  perform pg_advisory_xact_lock(hashtextextended(original.tenant_id::text || ':cn', 0));
  select coalesce(max(seq), 0) + 1 into note_seq
    from public.invoices
   where tenant_id = original.tenant_id
     and year = note_year
     and kind = 'credit_note';

  -- Снимки сторон дублирует триггер `capture_invoice_document_snapshots`:
  -- он берёт их из этой же строки инвойса, что бы здесь ни передали.
  insert into public.invoices (
    tenant_id, number, year, seq, issued_on, client_id, appointment_id,
    brigade_id, subtotal_net, vat_percent, vat_amount, total, currency,
    status, kind, credit_note_of_id, notes, created_by, language, vat_mode,
    seller_snapshot, client_snapshot
  ) values (
    original.tenant_id,
    'CN-' || note_year::text
          || '-' || lpad(note_seq::text, greatest(3, length(note_seq::text)), '0'),
    note_year,
    note_seq,
    note_date,
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
    original.language,
    original.vat_mode,
    original.seller_snapshot,
    original.client_snapshot
  )
  returning id into note_id;

  return note_id;
end;
$function$;

revoke execute on function public._issue_credit_note(uuid, text)
  from public, anon, authenticated;

comment on function public._issue_credit_note(uuid, text) is
  'Внутренняя: кредит-нота CN-ГГГГ-NNN на инвойс без денег у нас (доходы − возвраты = 0). Год — бизнес-дата компании, стороны — снимки инвойса, повтор возвращает ту же ноту. Права проверяет вызывающий.';

-- ---------------------------------------------------------------------------
-- 4. СТОРНО НЕ УПИРАЕТСЯ В ТАРИФ
--
-- Бесплатный тариф запрещает документы, и кредит-нота была документом, как
-- любой другой: компания, опустившаяся на бесплатный тариф, не могла отменить
-- уже выписанный инвойс, а на шаге 5 отказ откатил бы и возврат денег, внутри
-- которого нота выписывается. Пропускается только сторно настоящего инвойса
-- своей компании: кредит-нота «ни на что» по-прежнему документ. Остальное —
-- байт в байт как было.
CREATE OR REPLACE FUNCTION public.enforce_plan_limits()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_plan text;
begin
  if new.tenant_id is null then
    raise exception 'ограничение тарифа требует tenant_id' using errcode = '22023';
  end if;

  v_plan := public.tenant_effective_plan(new.tenant_id);

  if v_plan is distinct from 'free' then
    return new;
  end if;

  if tg_table_name = 'appointments' then
    if new.kind = 'work' then
      raise exception 'Записывать клиентов в этом тарифе нельзя'
        using errcode = 'P0001', hint = 'plan:book-clients';
    end if;
    return new;
  end if;

  if tg_table_name = 'services' then
    raise exception 'Услуги доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:services';
  end if;

  if tg_table_name = 'masters' then
    raise exception 'Мастера доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:masters';
  end if;

  if tg_table_name = 'invoices' then
    -- Сторно уже выписанного инвойса своей компании проходит на любом тарифе.
    if new.kind = 'credit_note' and exists (
      select 1
        from public.invoices original
       where original.id = new.credit_note_of_id
         and original.tenant_id = new.tenant_id
         and original.kind = 'invoice'
    ) then
      return new;
    end if;
    raise exception 'Документы доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:documents';
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. «ОТМЕНЁН» ДОСТИЖИМ, И ДАЛЬШЕ ПУТИ НЕТ (A7)
--
-- • «Выставлен → отменён» — когда по инвойсу у нас не осталось денег (тем же
--   счётом, что «аннулирован»: доходы − возвраты, включая старые возвраты
--   через `refund_of_id`) и кредит-нота на него уже выписана. Раньше любой
--   статус, кроме трёх, получал «Некорректный статус инвойса».
-- • Отменённый не открывается снова. Иначе оплата вернула бы его в «выставлен»
--   или «оплачен» — статус пересчитывается из журнала, — и кредит-нота гасила
--   бы действующий документ. Отказ стоит здесь, одним местом для всех дверей.
-- • Кредит-нота не меняет статус и не правится: её нельзя аннулировать, а
--   редактор черновика пересчитал бы её минусовые суммы в плюсовые.
-- • Шапка, замороженная после первого платежа, включает новые `vat_mode` и
--   `payment_id`, а заодно вид документа и ссылку на сторнированный инвойс —
--   иначе кредит-нота перестала бы быть нотой одной правкой строки.
CREATE OR REPLACE FUNCTION public.prevent_settled_invoice_rewrite()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Отменённый — конец пути: по нему выписана кредит-нота.
    if old.status = 'cancelled' then
      raise exception 'Отменённый инвойс нельзя открыть повторно — по нему выписана кредит-нота';
    end if;
    -- Кредит-нота не оплачивается, не аннулируется и не отменяется.
    if old.kind = 'credit_note' then
      raise exception 'Кредит-нота не меняет статус — она сама является сторно';
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
    -- Аннулировать нельзя, пока деньги У НАС. Полностью возвращённый платёж
    -- документ не держит: в кассе по нему ноль.
    elsif new.status = 'void' and (old.status <> 'issued' or net_paid > 0) then
      raise exception 'Инвойс с полученной оплатой нельзя аннулировать — сначала верните деньги';
    -- Отменить — тем же правилом денег, и только вместе с кредит-нотой.
    elsif new.status = 'cancelled' and (old.status <> 'issued' or net_paid > 0) then
      raise exception 'Инвойс с полученной оплатой нельзя отменить — сначала верните деньги';
    elsif new.status = 'cancelled' and not exists (
      select 1
        from public.invoices note
       where note.credit_note_of_id = old.id
         and note.tenant_id = old.tenant_id
         and note.kind = 'credit_note'
    ) then
      raise exception 'Инвойс отменяется только вместе с кредит-нотой';
    elsif new.status not in ('issued', 'paid', 'void', 'cancelled') then
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
    new.created_by,
    new.vat_mode,
    new.payment_id,
    new.kind,
    new.credit_note_of_id
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
    old.created_by,
    old.vat_mode,
    old.payment_id,
    old.kind,
    old.credit_note_of_id
  ) then
    -- Кредит-нота неизменяема с рождения: её суммы — минус суммы инвойса.
    if old.kind = 'credit_note' then
      raise exception 'Кредит-нота неизменяема — она сама является сторно';
    end if;
    if old.status <> 'issued' or exists (
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
    ) then
      raise exception 'Инвойс с платежами нельзя редактировать';
    end if;
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5–6. ОТМЕНА ИНВОЙСА ЗАКАНЧИВАЕТСЯ (A7)
--
-- • Оплаченное — доходы − возвраты, как у аннулирования. Раньше считались
--   одни доходы, и полностью возвращённый инвойс отменить было нельзя.
-- • Нота выписывается общей дверью `_issue_credit_note`: номер по бизнес-дате,
--   стороны инвойса, повтор без второй ноты.
-- • Аннулированный инвойс не отменяется: он уже не действует. Прежняя функция
--   выписывала на него ноту, и сторож статусов откатывал её вместе с отказом.
-- Проверка владельца, возвращаемая строка (кредит-нота) и права — как были.
CREATE OR REPLACE FUNCTION public.cancel_invoice(p_invoice_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  original public.invoices%rowtype;
  note_row public.invoices%rowtype;
  note_id uuid;
  income_total numeric := 0;
  direct_refunds numeric := 0;
  linked_refunds numeric := 0;
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
  if original.status = 'void' then
    raise exception 'Аннулированный инвойс уже не действует — отменять нечего';
  end if;

  -- Оплаченный документ сторнируется только вместе с возвратом денег:
  -- иначе бумага говорит «отменено», а деньги лежат в кассе. Возвраты
  -- вычитаются — и прямые, и старые, привязанные к доходу одной `refund_of_id`.
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
    raise exception 'По инвойсу уже прошла оплата — сначала оформите возврат';
  end if;

  note_id := public._issue_credit_note(original.id, p_reason);

  update public.invoices
     set status = 'cancelled', updated_at = now()
   where id = original.id;

  select * into note_row
    from public.invoices
   where id = note_id;
  return note_row;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 1. ВЫСТАВЛЕНИЕ ЗАПИСЫВАЕТ РЕЖИМ НДС
--
-- Режим пишется тем, чем документ посчитан. «В цене» и «сверху» при ставке 0
-- математика ниже считает как «Без НДС» (налог 0, ставка 0), и колонка говорит
-- `off` — иначе она назвала бы «НДС включён · 0%» документ без налога. Экран
-- читает такой документ так же (`invoiceVatMode`: ставка или налог 0 → «off»).
-- Остальное — как было.
CREATE OR REPLACE FUNCTION public.issue_invoice(p_request_id uuid, p_issued_on date, p_due_on date, p_client_id uuid, p_appointment_id uuid, p_brigade_id text, p_vat_mode text, p_vat_percent numeric, p_lines jsonb, p_notes text DEFAULT NULL::text, p_link_to_tx_id uuid DEFAULT NULL::uuid)
 RETURNS invoices
 LANGUAGE plpgsql
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
  vat_total numeric := 0;
  invoice_total numeric := 0;
  line_count integer := 0;
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
  -- Режим документа — тот, которым он посчитан: при ставке 0 это «off».
  invoice_vat_mode := case when vat_rate > 0 then p_vat_mode else 'off' end;

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
  select numbering.seq, numbering.number
    into invoice_seq, invoice_number
    from public.next_invoice_number(tenant_uuid, invoice_year) as numbering;

  insert into public.invoices (
    id, tenant_id, number, year, seq, issued_on, due_on, client_id,
    appointment_id, brigade_id, subtotal_net, vat_percent, vat_amount,
    total, currency, status, notes, created_by, vat_mode
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
    invoice_vat_mode
  )
  returning * into invoice_row;

  -- «Продолжить с номера» применено — гасим настройку, иначе следующий
  -- документ вернулся бы к тому же номеру.
  update public.tenants
     set invoice_next_number = null
   where id = tenant_uuid
     and invoice_next_number is not null;

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

-- ---------------------------------------------------------------------------
-- 1. ПРАВКА ЧЕРНОВИКА ДЕРЖИТ РЕЖИМ В ЛАД С СУММАМИ
--
-- Режим пишется тем же правилом, что при выставлении. Кредит-нота редактором
-- не открывается: пересчёт позиций сделал бы её минусовые суммы плюсовыми, а
-- у ноты позиций нет вовсе. Остальное — как было.
CREATE OR REPLACE FUNCTION public.update_invoice_draft(p_invoice_id uuid, p_due_on date, p_client_id uuid, p_appointment_id uuid, p_brigade_id text, p_vat_mode text, p_vat_percent numeric, p_lines jsonb, p_notes text DEFAULT NULL::text)
 RETURNS invoices
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  invoice_vat_mode text;
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
  if invoice_row.kind <> 'invoice' then
    raise exception 'Кредит-нота не редактируется — она сама является сторно';
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
  -- Режим документа — тот, которым он посчитан: при ставке 0 это «off».
  invoice_vat_mode := case when vat_rate > 0 then p_vat_mode else 'off' end;

  update public.invoices
     set due_on = p_due_on,
         client_id = resolved_client_id,
         appointment_id = p_appointment_id,
         brigade_id = resolved_brigade_id,
         subtotal_net = base_total,
         vat_percent = vat_rate,
         vat_amount = vat_total,
         total = invoice_total,
         vat_mode = invoice_vat_mode,
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
    raise exception 'Не все новые позиции инвойса сохранены';
  end if;

  return invoice_row;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. СЛЕДУЮЩИЙ НОМЕР — ТОЛЬКО СВОЕЙ КОМПАНИИ (B9)
--
-- Функция SECURITY DEFINER читала префикс и серию любой компании по
-- присланному id и была открыта `anon`. Приложение зовёт её для предпросмотра
-- номера в форме инвойса (`useNextInvoiceNumber` в
-- `apps/mobile/src/features/invoices/queries.ts`) с активной компанией
-- устройства — той же, что уходит заголовком `x-babun-tenant`. Поэтому вход
-- `authenticated` остаётся, чужой id получает отказ, а `anon` и PUBLIC вход
-- теряют. `issue_invoice` передаёт `current_tenant_id()` и проверку проходит
-- сам. `format_invoice_number` не трогаем: она только склеивает переданные
-- числа и в таблицы не смотрит. Остальное — как было.
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_tenant_id uuid, p_year integer)
 RETURNS TABLE(seq integer, number text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  prefix text;
  padding integer := 3;
  yearly_reset boolean := true;
  next_number integer;
  computed integer;
begin
  -- Серия чужой компании не видна: только своя, подтверждённая членством.
  if p_tenant_id is null or p_tenant_id is distinct from public.current_tenant_id() then
    raise exception 'Номер инвойса доступен только своей компании'
      using errcode = '42501', hint = 'access:not_member';
  end if;

  select
      regexp_replace(btrim(coalesce(tenant.invoice_prefix, 'INV')), '[[:space:]-]+$', ''),
      coalesce(tenant.invoice_number_padding, 3),
      coalesce(tenant.invoice_number_yearly_reset, true),
      tenant.invoice_next_number
    into prefix, padding, yearly_reset, next_number
    from public.tenants tenant
   where tenant.id = p_tenant_id;
  if prefix is null or prefix = '' then prefix := 'INV'; end if;

  if yearly_reset then
    select coalesce(max(inv.seq), 0) + 1 into computed
      from public.invoices inv
     where inv.tenant_id = p_tenant_id
       and inv.year = p_year
       and inv.kind = 'invoice';
  else
    -- Сквозная серия: год в номер не входит, счётчик не обнуляется.
    select coalesce(max(inv.seq), 0) + 1 into computed
      from public.invoices inv
     where inv.tenant_id = p_tenant_id
       and inv.kind = 'invoice';
  end if;

  -- «Продолжить с номера» двигает серию только ВПЕРЁД: назад — это дубликат.
  if next_number is not null and next_number > computed then
    computed := next_number;
  end if;

  seq := computed;
  number := public.format_invoice_number(prefix, p_year, computed, padding, yearly_reset);
  return next;
end;
$function$;

revoke execute on function public.next_invoice_number(uuid, integer)
  from public, anon;
