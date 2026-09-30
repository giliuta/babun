-- ИНВОЙС ПОДПИСЫВАЕТСЯ ВЫБРАННЫМИ РЕКВИЗИТАМИ И ЗНАЕТ, КУДА ЖДЁТ ДЕНЬГИ.
--
-- Владелец 2026-09-20 про инвойс: «сделать блок реквизиты… также выбор счёта,
-- куда должны зачисляться деньги». До этой миграции инвойс не умел ни того ни
-- другого: продавца ему собирал триггер ИЗ `tenants`, мимо справочника
-- реквизитов (`companies`, 20260920200000), а счёт назывался только в момент
-- платежа.
--
-- ДЫРА, КОТОРУЮ ЭТО ЗАКРЫВАЕТ. С 20.09 чек уже берёт продавца из справочника,
-- а инвойс — из арендатора. Значит по ОДНОЙ работе два документа могли назвать
-- РАЗНЫХ продавцов, и правка юрлица в справочнике инвойс не меняла вовсе.
--
-- ОДНА ЛЕСТНИЦА И ОДИН СБОРЩИК НА ОБА ДОКУМЕНТА. Раньше ладдер «выбранные →
-- основные → первые живые → реквизиты арендатора» стоял ВНУТРИ
-- `_issue_receipt_core`; здесь он становится `resolve_company_id`, а снимок
-- продавца — `build_seller_snapshot`, и чек переезжает на них же. Две копии
-- этого правила разошлись бы на первой же правке: канон «берём готовое».
--
-- СНИМОК ОСТАЁТСЯ ГЛАВНЫМ. `company_id` — это ССЫЛКА «чем подписали», а
-- печатается всё равно `seller_snapshot`: удалят набор реквизитов — выданная
-- бумага не изменится ни буквой.

begin;

set local lock_timeout = '5s';

-- ─── 1. Лестница выбора реквизитов ──────────────────────────────────────────
--
-- Архив ПРЯЧЕТ набор из выбора, но НЕ отменяет его подпись под уже идущей
-- бумагой: поэтому выбранный и основной берутся независимо от `archived_at`, и
-- только «первый живой» — среди живых. Молчаливая подмена набора здесь была бы
-- хуже отказа: клиент получил бы бумагу с чужим IBAN.
create or replace function public.resolve_company_id(
  p_tenant_id uuid,
  p_company_id uuid
) returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  resolved uuid;
begin
  if p_tenant_id is null then
    return null;
  end if;

  if p_company_id is not null then
    select id into resolved
      from public.companies
     where id = p_company_id
       and tenant_id = p_tenant_id;
    if resolved is null then
      -- Чужой набор реквизитов — отказ, а не тихая подстановка своего.
      raise exception 'Реквизиты не найдены в этой компании';
    end if;
    return resolved;
  end if;

  select id into resolved
    from public.companies
   where tenant_id = p_tenant_id
     and is_default;
  if resolved is not null then
    return resolved;
  end if;

  select id into resolved
    from public.companies
   where tenant_id = p_tenant_id
     and archived_at is null
   order by position, created_at
   limit 1;
  return resolved;
end;
$$;

revoke all on function public.resolve_company_id(uuid, uuid) from public, anon, authenticated;

comment on function public.resolve_company_id(uuid, uuid) is
  'Какими реквизитами подписать документ: выбранные → основные → первые живые. '
  'Служебная: зовут только триггеры и двери документов.';

-- ─── 2. Снимок продавца — один на чек и на инвойс ───────────────────────────
--
-- Форма снимка — ПРЕЖНЯЯ ИНВОЙСОВАЯ, со всеми её ключами: бумага инвойса их
-- уже читает, и терять ни один нельзя. Чек читает подмножество (`name`,
-- `address`, `vat_number`, `reg_number`, `iban`, `bank_name`), поэтому лишние
-- ключи ему не мешают, а логотип и контакты он сможет печатать позже.
--
-- ЧТО БЕРЁТСЯ У НАБОРА, А ЧТО У АРЕНДАТОРА. Юридическое имя, адрес, номер НДС,
-- регистрационный номер и банк — ТОЛЬКО у набора: подставить сюда чужой номер
-- НДС значит выпустить подделку. Логотип, город и страна живут у арендатора —
-- в наборе их нет вовсе. Контакты берутся у набора, а если он молчит — у
-- арендатора: клиенту нужно куда-то позвонить.
create or replace function public.build_seller_snapshot(
  p_tenant_id uuid,
  p_company_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when company.id is null then
      jsonb_build_object(
        'schema_version', 1,
        'tenant_id', tenant.id,
        'company_id', null,
        'name', coalesce(nullif(btrim(tenant.legal_name), ''), nullif(btrim(tenant.name), '')),
        'display_name', nullif(btrim(tenant.name), ''),
        'legal_name', nullif(btrim(tenant.legal_name), ''),
        'vat_number', nullif(btrim(tenant.vat_number), ''),
        'reg_number', null,
        'business_address', nullif(btrim(tenant.business_address), ''),
        'address', coalesce(
          nullif(btrim(tenant.business_address), ''),
          nullif(concat_ws(', ', nullif(btrim(tenant.address), ''), nullif(btrim(tenant.city), '')), '')
        ),
        'city', nullif(btrim(tenant.city), ''),
        'country', nullif(btrim(tenant.country), ''),
        'contact_email', nullif(btrim(tenant.contact_email), ''),
        'contact_phone', nullif(btrim(tenant.contact_phone), ''),
        'iban', nullif(btrim(tenant.iban), ''),
        'bank_name', nullif(btrim(tenant.bank_name), ''),
        'logo_url', nullif(btrim(tenant.logo_url), ''),
        'currency', nullif(btrim(tenant.currency), ''),
        'vat_mode', tenant.vat_mode
      )
    else
      jsonb_build_object(
        'schema_version', 1,
        'tenant_id', tenant.id,
        'company_id', company.id,
        'name', coalesce(nullif(btrim(company.legal_name), ''), nullif(btrim(company.name), '')),
        'display_name', nullif(btrim(company.name), ''),
        'legal_name', nullif(btrim(company.legal_name), ''),
        'vat_number', nullif(btrim(company.vat_number), ''),
        'reg_number', nullif(btrim(company.reg_number), ''),
        'business_address', nullif(btrim(company.business_address), ''),
        'address', coalesce(
          nullif(btrim(company.business_address), ''),
          nullif(concat_ws(', ', nullif(btrim(tenant.address), ''), nullif(btrim(tenant.city), '')), '')
        ),
        'city', nullif(btrim(tenant.city), ''),
        'country', nullif(btrim(tenant.country), ''),
        'contact_email', coalesce(nullif(btrim(company.contact_email), ''), nullif(btrim(tenant.contact_email), '')),
        'contact_phone', coalesce(nullif(btrim(company.contact_phone), ''), nullif(btrim(tenant.contact_phone), '')),
        'iban', nullif(btrim(company.iban), ''),
        'bank_name', nullif(btrim(company.bank_name), ''),
        'logo_url', nullif(btrim(tenant.logo_url), ''),
        'currency', nullif(btrim(tenant.currency), ''),
        'vat_mode', tenant.vat_mode
      )
  end
    from public.tenants tenant
    left join public.companies company
      on company.id = p_company_id
     and company.tenant_id = tenant.id
   where tenant.id = p_tenant_id
$$;

revoke all on function public.build_seller_snapshot(uuid, uuid) from public, anon, authenticated;

comment on function public.build_seller_snapshot(uuid, uuid) is
  'Снимок продавца для чека и инвойса. Юр. имя, адрес, НДС, рег. номер и банк — '
  'из набора реквизитов; логотип, город и страна — у арендатора.';

-- Прежняя однопараметрическая остаётся ТОНКОЙ ОБЁРТКОЙ: её зовёт триггер
-- старых кредит-нот и, возможно, чужой код. Теперь она проходит ту же
-- лестницу — то есть инвойс, выставленный без выбора, подписывается ОСНОВНЫМИ
-- реквизитами, а не реквизитами арендатора. Для всех 19 арендаторов основной
-- набор перенесён из их же реквизитов (20260920200000), поэтому текст бумаги
-- не меняется ни на букву.
create or replace function public.build_invoice_seller_snapshot(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.build_seller_snapshot(
    p_tenant_id,
    public.resolve_company_id(p_tenant_id, null)
  )
$$;

revoke all on function public.build_invoice_seller_snapshot(uuid) from public, anon, authenticated;

-- ─── 3. Колонки инвойса ─────────────────────────────────────────────────────
--
-- ОБЕ БЕЗ `default`: `add column … default` вычисляется один раз и прошивает
-- значение во ВСЕ прошлые строки (см. 20260914 про `auth.uid()`). У старых
-- инвойсов реквизитов и счёта не выбирали — там честный `null`.
alter table public.invoices
  add column if not exists company_id uuid references public.companies(id) on delete set null;

alter table public.invoices
  add column if not exists account_id uuid references public.accounts(id) on delete set null;

comment on column public.invoices.company_id is
  'Какими реквизитами подписан инвойс. Печатается всё равно seller_snapshot — '
  'он заморожен в момент выставления.';
comment on column public.invoices.account_id is
  'Куда клиент должен заплатить. Подсказка платежу, а не сам платёж: деньги '
  'приходят через record_invoice_payment со своим счётом.';

create index if not exists invoices_company_idx
  on public.invoices (company_id)
  where company_id is not null;

-- Счёт проверяется ОДНОЙ функцией на вставку и на правку: два одинаковых
-- условия в двух ветках триггера — это два разных условия через месяц.
create or replace function public.assert_invoice_account(
  p_tenant_id uuid,
  p_account_id uuid
) returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_account_id is null then
    return;
  end if;
  if not exists (
    select 1 from public.accounts
     where id = p_account_id
       and tenant_id = p_tenant_id
  ) then
    raise exception 'Счёт не найден или недоступен';
  end if;
end;
$$;

revoke all on function public.assert_invoice_account(uuid, uuid) from public, anon, authenticated;

-- ─── 4. Триггер снимков знает про набор реквизитов и про счёт ───────────────
create or replace function public.capture_invoice_document_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
      -- Сторно подписано ТЕМ ЖЕ набором, что инвойс: иначе встречный документ
      -- вышел бы от другого юрлица.
      new.company_id := source_invoice.company_id;
      return new;
    end if;

    new.company_id := public.resolve_company_id(new.tenant_id, new.company_id);
    new.seller_snapshot := public.build_seller_snapshot(new.tenant_id, new.company_id);
    if new.seller_snapshot is null then
      raise exception 'Компания для инвойса не найдена';
    end if;
    perform public.assert_invoice_account(new.tenant_id, new.account_id);
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

  -- `company_id` И `account_id` — В СРАВНЕНИИ. Без них смена набора реквизитов
  -- на черновике прошла бы МОЛЧА: колонка новая, снимок старый, и бумага
  -- печатала бы прежнего продавца.
  document_changed := row(
    new.number,
    new.year,
    new.seq,
    new.issued_on,
    new.due_on,
    new.client_id,
    new.appointment_id,
    new.brigade_id,
    new.company_id,
    new.account_id,
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
    old.company_id,
    old.account_id,
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
  new.company_id := public.resolve_company_id(new.tenant_id, new.company_id);
  new.seller_snapshot := public.build_seller_snapshot(new.tenant_id, new.company_id);
  if new.seller_snapshot is null then
    raise exception 'Компания для инвойса не найдена';
  end if;
  perform public.assert_invoice_account(new.tenant_id, new.account_id);
  new.client_snapshot := case
    when new.client_id is null then null
    else public.build_invoice_client_snapshot(new.tenant_id, new.client_id)
  end;
  if new.client_id is not null and new.client_snapshot is null then
    raise exception 'Клиент для инвойса не найден в этой компании';
  end if;
  return new;
end;
$$;

-- ─── 5. Чек переезжает на ту же лестницу и тот же сборщик ───────────────────
--
-- Тело ниже — ЖИВОЕ `_issue_receipt_core` ДОСЛОВНО (снято из базы), кроме
-- одного места: вместо трёх собственных `select` по `companies` и двух
-- `jsonb_build_object` стоят `resolve_company_id` и `build_seller_snapshot`.
-- Всё остальное — замок, идемпотентность через `on conflict`, молчаливый
-- выход на чужой проводке — не тронуто ни буквой.
--
-- СНИМОК ЧЕКА СТАНОВИТСЯ ШИРЕ: к прежним ключам добавляются `reg_number`,
-- контакты, логотип, город и страна. Бумага чека читает подмножество, поэтому
-- печать не меняется, а регистрационный номер она уже умеет печатать — теперь
-- он до неё доедет.
-- УМОЛЧАНИЯ ПАРАМЕТРОВ — ТЕ ЖЕ, ЧТО У ЖИВОЙ ФУНКЦИИ. `create or replace` не
-- умеет снимать `default` с существующего параметра и отбивает всю миграцию
-- («cannot remove parameter defaults from existing function») — поймано сухим
-- прогоном. Зовут её и с двумя аргументами, поэтому умолчания обязаны стоять.
create or replace function public._issue_receipt_core(
  p_tx public.finance_transactions,
  p_lines jsonb default null,
  p_company_id uuid default null
) returns public.receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  receipt_year integer;
  receipt_seq integer;
  seller jsonb;
  buyer jsonb;
  company_uuid uuid;
  result_row public.receipts%rowtype;
begin
  if p_tx.type <> 'income' or p_tx.client_id is null or p_tx.amount <= 0 then
    return null;
  end if;

  receipt_year := extract(year from p_tx.occurred_on)::integer;
  perform pg_advisory_xact_lock(hashtextextended(p_tx.tenant_id::text || ':rc', 0));
  select coalesce(max(seq), 0) + 1 into receipt_seq
    from public.receipts
   where tenant_id = p_tx.tenant_id and year = receipt_year;

  company_uuid := public.resolve_company_id(p_tx.tenant_id, p_company_id);
  seller := public.build_seller_snapshot(p_tx.tenant_id, company_uuid);

  select jsonb_build_object('name', c.full_name, 'phone', c.phone)
    into buyer
    from public.clients c where c.id = p_tx.client_id;

  insert into public.receipts (
    tenant_id, number, year, seq, issued_on, amount, currency,
    vat_rate, vat_amount, client_id, appointment_id, invoice_id,
    transaction_id, account_id, payment_method, seller_snapshot, client_snapshot,
    lines, company_id
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
    public._receipt_lines_snapshot(p_lines),
    company_uuid
  )
  on conflict (transaction_id) where transaction_id is not null do nothing
  returning * into result_row;

  if not found then
    select * into result_row from public.receipts where transaction_id = p_tx.id;
  end if;
  return result_row;
end;
$$;

-- ─── 6. Двери инвойса принимают реквизиты и счёт ────────────────────────────
--
-- СНАЧАЛА `drop`, ПОТОМ `create`: `create or replace` с новым параметром
-- заводит ВТОРУЮ функцию-перегрузку, а не заменяет прежнюю (поймано аудитом
-- 20.09 на `issue_receipt`). Тогда PostgREST выбирал бы одну из двух по числу
-- ключей в теле запроса — молча и не ту.
drop function if exists public.issue_invoice(
  uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid
);

create function public.issue_invoice(
  p_request_id uuid,
  p_issued_on date,
  p_due_on date,
  p_client_id uuid,
  p_appointment_id uuid,
  p_brigade_id text,
  p_vat_mode text,
  p_vat_percent numeric,
  p_lines jsonb,
  p_notes text,
  p_link_to_tx_id uuid,
  p_company_id uuid default null,
  p_account_id uuid default null
) returns public.invoices
language plpgsql
as $$
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
    total, currency, status, notes, created_by, vat_mode,
    company_id, account_id
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
    -- Триггер `capture_invoice_document_snapshots` проходит лестницу и
    -- проверяет счёт: здесь передаём ровно то, что выбрал человек.
    p_company_id,
    p_account_id
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
$$;

-- ДВЕРЬ НЕ ДЛЯ ГОСТЯ. `anon` держал право выполнения на обеих дверях: роль
-- внутри отбивает, но открытая дверь — это приглашение стучать.
revoke all on function public.issue_invoice(
  uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid
) from public, anon;
grant execute on function public.issue_invoice(
  uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid
) to authenticated;

-- ПРАВКУ ЧЕРНОВИКА (`update_invoice_draft`) ЭТА МИГРАЦИЯ НЕ ТРОГАЕТ, И ЭТО
-- НАРОЧНО. Дверь правки не знает про реквизиты и счёт, значит при правке
-- черновика она их не передаёт — а триггер выше пройдёт лестницу заново и
-- вернёт ТЕ ЖЕ значения, что уже стоят в строке. Поведение правки не меняется
-- ни на шаг. Выбор реквизитов У ВЫСТАВЛЕННОГО инвойса — отдельная работа и
-- отдельная миграция: сейчас его задают при выставлении.

commit;
