-- STORY-101a — ЮРЛИЦА И СЕРИИ НОМЕРОВ ДОКУМЕНТОВ (закон о VAT Кипра).
--
-- Владелец 2026-09-30: у каждого юрлица аккаунта своя сплошная нумерация
-- инвойсов, чеков и кредит-нот, без дыр; номер выдаётся только при выпуске;
-- выпущенный документ неизменяем, отмена — только кредит-нотой. План
-- утверждён («давай делай»), перенос — вариант А: серии продолжаются с уже
-- выданных номеров, ни один документ не удаляется и не перенумеровывается.
--
-- ЧТО ДЕЛАЕТ МИГРАЦИЯ
--   1. `companies` («Реквизиты») → `legal_entities`. Таблица и была юрлицами;
--      колонки `company_id` в документах пока сохраняют имя (переименование —
--      вместе с черновиками, этап 101c).
--   2. У юрлица — префиксы трёх серий и разрядность номера. У существующих
--      юрлиц вид номера прежний (INV / RC / CN, три знака), чтобы серия 2026
--      не сменила вид посередине; новые юрлица — INV / REC / CN, четыре знака.
--   3. У команды — её юрлицо (`teams.legal_entity_id`); инвойс без явно
--      выбранного юрлица берёт юрлицо своей команды, иначе основное.
--   4. `document_sequences` — счётчик (компания, юрлицо, тип, год). Номер
--      выдаёт `next_document_number` одним `insert … on conflict do update …
--      returning` в транзакции выпуска: строка серии заперта до конца
--      транзакции, одновременные выпуски идут по очереди, откат выпуска
--      откатывает и номер. Никаких SEQUENCE и `max(seq) + 1`.
--   5. Выпуск инвойса, кредит-ноты и чека берут номер из серии юрлица. Чек
--      идёт в серию юрлица своего инвойса.
--   6. «Плательщик VAT» — это юрлицо с VAT-номером: инвойс с VAT у юрлица без
--      номера не выпускается.
--   7. Неизменяемость в базе: клиентам закрыты INSERT / UPDATE / DELETE
--      инвойсов, строк инвойса и чеков. Открыты только язык и файл PDF
--      инвойса и статус (переходы статуса сторожит триггер по журналу
--      оплат). «Аннулировать» без кредит-ноты больше нельзя — ни дверью
--      `void_invoice`, ни прямым запросом; исключение — стирание календаря
--      (прежнее поведение, пересматривается в 101c).
--   8. Каждой новой компании юрлицо заводится само — без него документ не
--      получит серию.
--
-- ПЕРЕНОС (вариант А)
--   • Инвойсы и чеки без юрлица привязываются: инвойс — к основному юрлицу
--     (правило «пусто = основное» и раньше действовало в серии), чек — к
--     юрлицу своего инвойса, иначе к основному. Снимки сторон в документах НЕ
--     пересобираются: на время привязки сторожа инвойсов выключены.
--   • Счётчики серий = наибольшие выданные номера (для инвойса — и ручной
--     «следующий номер» реквизитов, если он больше).
--   • Удаляются: ручной счётчик реквизитов (`invoice_next_number/_year`),
--     `next_company_invoice_number`, `next_invoice_number`,
--     `set_company_invoice_next_number`, `invoice_in_series`,
--     `format_invoice_number`. `void_invoice` остаётся заглушкой с понятным
--     отказом для старых сборок.
--
-- ТЕЛА ФУНКЦИЙ правятся вырезом точных кусков из живых тел
-- (`pg_get_functiondef`), каждый кусок обязан встретиться ровно один раз.
-- Правятся: issue_invoice, _issue_credit_note, _issue_receipt_core,
-- resolve_company_id, set_default_company, build_seller_snapshot,
-- prevent_settled_invoice_rewrite.

-- ───────────────────────────── 0. Сторожа входа ─────────────────────────────

do $pre$
declare
  v_bad text;
begin
  select string_agg(t.name, ', ') into v_bad
    from public.tenants t
   where not exists (
     select 1 from public.companies c where c.tenant_id = t.id and c.is_default
   );
  if v_bad is not null then
    raise exception 'сторож: нет основного юрлица у компаний: %', v_bad;
  end if;

  -- Серия теперь всегда с годом; сквозная нумерация без года у кого-то с
  -- документами сменила бы вид номера.
  if exists (
    select 1 from public.tenants t
     where t.invoice_number_yearly_reset is false
       and exists (select 1 from public.invoices i where i.tenant_id = t.id)
  ) then
    raise exception 'сторож: есть компания со сквозной нумерацией и документами';
  end if;
  if exists (select 1 from public.tenants where invoice_next_number is not null) then
    raise exception 'сторож: у компании задан старый «продолжить с номера» — перенос его не учитывает';
  end if;

  -- Привязка документов выключает пользовательские триггеры и включает их
  -- обратно; выключенных заранее быть не должно, иначе включение их оживит.
  if exists (
    select 1 from pg_trigger
     where tgrelid in ('public.invoices'::regclass, 'public.receipts'::regclass)
       and not tgisinternal
       and tgenabled <> 'O'
  ) then
    raise exception 'сторож: у инвойсов или чеков есть выключенный триггер';
  end if;
end
$pre$;

-- ───────────────────────────── 1. Юрлица ─────────────────────────────

alter table public.companies rename to legal_entities;
alter trigger companies_set_updated_at on public.legal_entities
  rename to legal_entities_set_updated_at;
alter policy companies_read on public.legal_entities rename to legal_entities_read;
alter policy companies_write_owner on public.legal_entities rename to legal_entities_write_owner;
alter table public.legal_entities rename constraint companies_pkey to legal_entities_pkey;
alter table public.legal_entities rename constraint companies_tenant_id_fkey to legal_entities_tenant_id_fkey;
alter table public.legal_entities rename constraint companies_color_format to legal_entities_color_format;
alter table public.legal_entities rename constraint companies_icon_format to legal_entities_icon_format;
alter index public.companies_tenant_idx rename to legal_entities_tenant_idx;
alter index public.companies_one_default rename to legal_entities_one_default;

alter table public.legal_entities
  add column invoice_prefix text not null default 'INV',
  add column receipt_prefix text not null default 'REC',
  add column credit_note_prefix text not null default 'CN',
  add column number_padding integer not null default 4;

comment on column public.legal_entities.invoice_prefix is
  'Префикс серии инвойсов юрлица: INV-2026-0001.';
comment on column public.legal_entities.receipt_prefix is
  'Префикс серии чеков юрлица: REC-2026-0001.';
comment on column public.legal_entities.credit_note_prefix is
  'Префикс серии кредит-нот юрлица: CN-2026-0001.';
comment on column public.legal_entities.number_padding is
  'Знаков в номере (3–8); номер длиннее не обрезается.';

-- Существующие юрлица продолжают свои серии в прежнем виде.
update public.legal_entities entity
   set invoice_prefix = case
         when upper(regexp_replace(btrim(coalesce(tenant.invoice_prefix, '')), '[[:space:]-]+$', ''))
              ~ '^[A-Z0-9]{1,10}$'
           then upper(regexp_replace(btrim(tenant.invoice_prefix), '[[:space:]-]+$', ''))
         else 'INV'
       end,
       receipt_prefix = 'RC',
       credit_note_prefix = 'CN',
       number_padding = least(8, greatest(3, coalesce(tenant.invoice_number_padding, 3)))
  from public.tenants tenant
 where tenant.id = entity.tenant_id;

alter table public.legal_entities
  add constraint legal_entities_prefix_format check (
    invoice_prefix ~ '^[A-Z0-9]{1,10}$'
    and receipt_prefix ~ '^[A-Z0-9]{1,10}$'
    and credit_note_prefix ~ '^[A-Z0-9]{1,10}$'
  ),
  add constraint legal_entities_number_padding_range check (number_padding between 3 and 8),
  add constraint legal_entities_tenant_id_id_key unique (tenant_id, id);

-- ───────────────────────────── 2. Команда → юрлицо ─────────────────────────────

alter table public.teams
  add column legal_entity_id uuid,
  add constraint teams_legal_entity_fkey
    foreign key (tenant_id, legal_entity_id)
    references public.legal_entities (tenant_id, id)
    on delete set null (legal_entity_id);

comment on column public.teams.legal_entity_id is
  'Юрлицо команды: от него выпускаются документы её записей. Пусто — основное юрлицо компании.';

update public.teams team
   set legal_entity_id = entity.id
  from public.legal_entities entity
 where entity.tenant_id = team.tenant_id
   and entity.is_default
   and team.legal_entity_id is null;

-- ───────────────────────────── 3. Документы знают своё юрлицо ─────────────────────────────

-- Снимки сторон выпущенных документов не пересобираются: сторожа и
-- снимающий триггер на время привязки выключены (сторож входа проверил, что
-- включать нечего лишнего).
alter table public.invoices disable trigger user;
update public.invoices invoice
   set company_id = entity.id
  from public.legal_entities entity
 where invoice.company_id is null
   and entity.tenant_id = invoice.tenant_id
   and entity.is_default;
alter table public.invoices enable trigger user;

alter table public.receipts disable trigger user;
update public.receipts receipt
   set company_id = coalesce(
     (select invoice.company_id
        from public.invoices invoice
       where invoice.id = receipt.invoice_id
         and invoice.tenant_id = receipt.tenant_id),
     (select entity.id
        from public.legal_entities entity
       where entity.tenant_id = receipt.tenant_id
         and entity.is_default)
   )
 where receipt.company_id is null;
alter table public.receipts enable trigger user;

-- Юрлицо у документа обязательно и из той же компании. Удалить юрлицо с
-- документами нельзя — его серия живёт в бумагах (скрыть можно).
alter table public.invoices
  alter column company_id set not null,
  drop constraint invoices_company_id_fkey,
  add constraint invoices_legal_entity_fkey
    foreign key (tenant_id, company_id) references public.legal_entities (tenant_id, id);
alter table public.receipts
  alter column company_id set not null,
  drop constraint receipts_company_id_fkey,
  add constraint receipts_legal_entity_fkey
    foreign key (tenant_id, company_id) references public.legal_entities (tenant_id, id);

-- Номер чека уникален в серии юрлица, а не компании: у двух юрлиц
-- RC-2026-001 — разные документы.
drop index public.ux_receipts_number;
create unique index ux_receipts_number
  on public.receipts (tenant_id, company_id, year, seq);

-- ───────────────────────────── 4. Серии ─────────────────────────────

create table public.document_sequences (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  legal_entity_id uuid not null,
  doc_type text not null check (doc_type in ('invoice', 'receipt', 'credit_note')),
  year integer not null check (year between 2000 and 2999),
  last_number integer not null default 0 check (last_number between 0 and 99999999),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, legal_entity_id, doc_type, year),
  foreign key (tenant_id, legal_entity_id)
    references public.legal_entities (tenant_id, id) on delete cascade
);

comment on table public.document_sequences is
  'Счётчики серий документов: последний выданный номер (компания, юрлицо, тип, год). Пишет только next_document_number и set_document_series_start.';

-- Без политик: клиенты серию не читают и не пишут, только через двери.
alter table public.document_sequences enable row level security;
revoke all on public.document_sequences from public, anon, authenticated;

insert into public.document_sequences (tenant_id, legal_entity_id, doc_type, year, last_number)
select tenant_id, legal_entity_id, doc_type, year, max(last_number)
  from (
    select invoice.tenant_id,
           invoice.company_id as legal_entity_id,
           case invoice.kind when 'credit_note' then 'credit_note' else 'invoice' end as doc_type,
           invoice.year,
           invoice.seq as last_number
      from public.invoices invoice
    union all
    select receipt.tenant_id, receipt.company_id, 'receipt', receipt.year, receipt.seq
      from public.receipts receipt
    union all
    -- Ручной «следующий номер» реквизитов: серия продолжает с него.
    select entity.tenant_id, entity.id, 'invoice', entity.invoice_next_year,
           entity.invoice_next_number - 1
      from public.legal_entities entity
     where entity.invoice_next_number is not null
       and entity.invoice_next_year is not null
       and entity.invoice_next_number > 1
  ) issued
 group by tenant_id, legal_entity_id, doc_type, year;

alter table public.legal_entities
  drop column invoice_next_number,
  drop column invoice_next_year;

-- ───────────────────────────── 5. Функции серий ─────────────────────────────

create or replace function public.format_document_number(
  p_prefix text,
  p_year integer,
  p_seq integer,
  p_padding integer
)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select p_prefix || '-' || p_year::text || '-'
      || lpad(p_seq::text, greatest(coalesce(p_padding, 4), length(p_seq::text)), '0')
$function$;

create or replace function public.document_prefix(
  p_entity public.legal_entities,
  p_doc_type text
)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case p_doc_type
    when 'invoice' then p_entity.invoice_prefix
    when 'receipt' then p_entity.receipt_prefix
    when 'credit_note' then p_entity.credit_note_prefix
  end
$function$;

-- ЕДИНСТВЕННОЕ МЕСТО, ГДЕ РОЖДАЕТСЯ НОМЕР. Зовётся только из транзакции
-- выпуска (definer-функции); клиентам закрыта — прямой вызов прожёг бы номер.
create or replace function public.next_document_number(
  p_tenant_id uuid,
  p_legal_entity_id uuid,
  p_doc_type text,
  p_year integer
)
returns table(seq integer, number text)
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  entity public.legal_entities%rowtype;
  issued integer;
begin
  if p_doc_type is null or p_doc_type not in ('invoice', 'receipt', 'credit_note') then
    raise exception 'Неизвестный тип документа';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2999 then
    raise exception 'Некорректный год документа';
  end if;
  select * into entity
    from public.legal_entities
   where id = p_legal_entity_id
     and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Юрлицо документа не найдено в этой компании';
  end if;

  insert into public.document_sequences as series
         (tenant_id, legal_entity_id, doc_type, year, last_number)
  values (p_tenant_id, p_legal_entity_id, p_doc_type, p_year, 1)
  on conflict (tenant_id, legal_entity_id, doc_type, year)
  do update set last_number = series.last_number + 1,
                updated_at = now()
  returning series.last_number into issued;

  seq := issued;
  number := public.format_document_number(
    public.document_prefix(entity, p_doc_type), p_year, issued, entity.number_padding
  );
  return next;
end;
$function$;

-- Выпущен ли в серии хоть один документ. Ручной старт серии возможен только
-- до первого документа года: дальше номер двигает лишь выпуск.
create or replace function public.document_series_started(
  p_tenant_id uuid,
  p_legal_entity_id uuid,
  p_doc_type text,
  p_year integer
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case p_doc_type
    when 'receipt' then exists (
      select 1 from public.receipts receipt
       where receipt.tenant_id = p_tenant_id
         and receipt.company_id = p_legal_entity_id
         and receipt.year = p_year
    )
    else exists (
      select 1 from public.invoices invoice
       where invoice.tenant_id = p_tenant_id
         and invoice.company_id = p_legal_entity_id
         and invoice.kind = case p_doc_type when 'credit_note' then 'credit_note' else 'invoice' end
         and invoice.year = p_year
    )
  end
$function$;

create or replace function public.legal_entity_of_team(p_tenant_id uuid, p_team_id text)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select team.legal_entity_id
    from public.teams team
   where team.tenant_id = p_tenant_id
     and team.id = p_team_id
$function$;

-- Предпросмотр: какой номер получит следующий документ серии. Это прогноз —
-- коллега может выпустить свой раньше. `can_set_start` — можно ли задать
-- старт серии (владелец, в серии года ещё нет документов).
create or replace function public.peek_document_number(
  p_legal_entity_id uuid,
  p_doc_type text,
  p_year integer
)
returns table(seq integer, number text, can_set_start boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  entity public.legal_entities%rowtype;
  last_issued integer;
begin
  if tenant_uuid is null then
    raise exception 'Войдите в приложение'
      using errcode = '42501', hint = 'access:not_member';
  end if;
  if p_doc_type is null or p_doc_type not in ('invoice', 'receipt', 'credit_note') then
    raise exception 'Неизвестный тип документа';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2999 then
    raise exception 'Некорректный год документа';
  end if;
  select * into entity
    from public.legal_entities
   where id = public.resolve_company_id(tenant_uuid, p_legal_entity_id)
     and tenant_id = tenant_uuid;
  if not found then
    return;
  end if;

  select series.last_number into last_issued
    from public.document_sequences series
   where series.tenant_id = tenant_uuid
     and series.legal_entity_id = entity.id
     and series.doc_type = p_doc_type
     and series.year = p_year;

  seq := coalesce(last_issued, 0) + 1;
  number := public.format_document_number(
    public.document_prefix(entity, p_doc_type), p_year, seq, entity.number_padding
  );
  can_set_start := public.current_user_role() = 'owner'
    and not public.document_series_started(tenant_uuid, entity.id, p_doc_type, p_year);
  return next;
end;
$function$;

-- Старт серии при переходе из прежней программы: «следующий инвойс — 104».
-- Только владелец и только пока в серии года нет ни одного документа —
-- потом номер двигает лишь выпуск (перескок дал бы дыру, откат — повтор).
create or replace function public.set_document_series_start(
  p_legal_entity_id uuid,
  p_doc_type text,
  p_year integer,
  p_next_number integer
)
returns table(seq integer, number text, can_set_start boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  entity public.legal_entities%rowtype;
begin
  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Нумерацию меняет только владелец'
      using errcode = '42501', hint = 'access:owner_only';
  end if;
  if p_doc_type is null or p_doc_type not in ('invoice', 'receipt', 'credit_note') then
    raise exception 'Неизвестный тип документа';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2999 then
    raise exception 'Некорректный год';
  end if;
  if p_next_number is null or p_next_number < 1 or p_next_number > 99999999 then
    raise exception 'Номер — целое число от 1 до 99999999';
  end if;
  select * into entity
    from public.legal_entities
   where id = p_legal_entity_id
     and tenant_id = tenant_uuid;
  if not found then
    raise exception 'Юрлицо не найдено в этой компании';
  end if;

  -- Строка серии — под замок раньше проверки: выпуск, идущий параллельно,
  -- либо уже виден, либо ждёт, пока старт запишется.
  insert into public.document_sequences (tenant_id, legal_entity_id, doc_type, year, last_number)
  values (tenant_uuid, entity.id, p_doc_type, p_year, 0)
  on conflict (tenant_id, legal_entity_id, doc_type, year) do nothing;
  perform 1
    from public.document_sequences series
   where series.tenant_id = tenant_uuid
     and series.legal_entity_id = entity.id
     and series.doc_type = p_doc_type
     and series.year = p_year
   for update;

  if public.document_series_started(tenant_uuid, entity.id, p_doc_type, p_year) then
    raise exception 'Серия % года уже начата — номер задаётся только до первого документа', p_year;
  end if;

  update public.document_sequences series
     set last_number = p_next_number - 1,
         updated_at = now()
   where series.tenant_id = tenant_uuid
     and series.legal_entity_id = entity.id
     and series.doc_type = p_doc_type
     and series.year = p_year;

  return query
    select peek.seq, peek.number, peek.can_set_start
      from public.peek_document_number(entity.id, p_doc_type, p_year) peek;
end;
$function$;

-- Юрлицо каждой новой компании: без него документ не получит серию.
create or replace function public.create_default_legal_entity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.legal_entities where tenant_id = new.id) then
    insert into public.legal_entities (tenant_id, name, is_default)
    values (new.id, coalesce(nullif(btrim(new.name), ''), 'Компания'), true);
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_tenants_default_legal_entity on public.tenants;
create trigger trg_tenants_default_legal_entity
  after insert on public.tenants
  for each row execute function public.create_default_legal_entity();

revoke all on function public.format_document_number(text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.document_prefix(public.legal_entities, text) from public, anon, authenticated;
revoke all on function public.next_document_number(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.document_series_started(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.legal_entity_of_team(uuid, text) from public, anon, authenticated;
revoke all on function public.create_default_legal_entity() from public, anon, authenticated;
revoke all on function public.peek_document_number(uuid, text, integer) from public, anon;
revoke all on function public.set_document_series_start(uuid, text, integer, integer) from public, anon;
grant execute on function public.peek_document_number(uuid, text, integer) to authenticated;
grant execute on function public.set_document_series_start(uuid, text, integer, integer) to authenticated;

-- ───────────────────────────── 6. Выпуск берёт номер из серии ─────────────────────────────

do $bodies$
declare
  def text;

  -- Живое тело обязано содержать кусок ровно один раз.
  procedure_name text;
begin
  -- resolve_company_id / set_default_company / build_seller_snapshot: имя таблицы.
  foreach procedure_name in array array[
    'public.resolve_company_id(uuid, uuid)',
    'public.set_default_company(uuid)',
    'public.build_seller_snapshot(uuid, uuid)'
  ]
  loop
    def := pg_get_functiondef(procedure_name::regprocedure);
    if position('public.companies' in def) = 0 then
      raise exception 'сторож: в % нет public.companies', procedure_name;
    end if;
    execute replace(def, 'public.companies', 'public.legal_entities');
  end loop;
end
$bodies$;

do $issue$
declare
  def text := pg_get_functiondef(
    'public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text, text)'::regprocedure
  );
  frag_entity text := $frag$  -- Серия номеров — на реквизитах (миграция 20260922050000).
  resolved_company_id := public.resolve_own_company_id(p_company_id);
  perform pg_advisory_xact_lock(hashtextextended(tenant_uuid::text, 0));
$frag$;
  next_entity text := $frag$  -- Серия номеров — у юрлица (STORY-101): выбранного в документе, иначе
  -- юрлица команды, иначе основного. Замок — на юрлицо: выпуски разных
  -- юрлиц друг друга не ждут.
  resolved_company_id := public.resolve_own_company_id(
    coalesce(p_company_id, public.legal_entity_of_team(tenant_uuid, resolved_brigade_id))
  );
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
$frag$;
  frag_number text := $frag$  select tenant.invoice_prefix, tenant.currency
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
    from public.next_company_invoice_number(
      tenant_uuid, resolved_company_id, invoice_year
    ) as numbering;
$frag$;
  next_number text := $frag$  select tenant.currency
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
$frag$;
  frag_counter text := $frag$  update public.companies
     set invoice_next_number = invoice_seq + 1,
         invoice_next_year = invoice_year
   where id = resolved_company_id
     and tenant_id = tenant_uuid
     and invoice_seq < 999999;

  update public.tenants
     set invoice_next_number = null
   where id = tenant_uuid
     and invoice_next_number is not null;

$frag$;
begin
  if (length(def) - length(replace(def, frag_entity, ''))) / length(frag_entity) <> 1 then
    raise exception 'сторож: issue_invoice — кусок «серия на реквизитах» не ровно один';
  end if;
  if (length(def) - length(replace(def, frag_number, ''))) / length(frag_number) <> 1 then
    raise exception 'сторож: issue_invoice — кусок «номер» не ровно один';
  end if;
  if (length(def) - length(replace(def, frag_counter, ''))) / length(frag_counter) <> 1 then
    raise exception 'сторож: issue_invoice — кусок «ручной счётчик» не ровно один';
  end if;
  def := replace(def, frag_entity, next_entity);
  def := replace(def, frag_number, next_number);
  def := replace(def, frag_counter, '');
  execute def;
end
$issue$;

-- Выпуск берёт номер из закрытой клиентам серии — значит, выполняется с
-- правами владельца функции. Все чтения внутри уже ограничены компанией
-- вызывающего (`tenant_uuid`), право — «только владелец» в первой строке.
alter function public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text, text)
  security definer;

do $credit$
declare
  def text := pg_get_functiondef('public._issue_credit_note(uuid, text)'::regprocedure);
  frag_decl text := E'  note_seq integer;\n';
  frag_number text := $frag$  perform pg_advisory_xact_lock(hashtextextended(original.tenant_id::text || ':cn', 0));
  select coalesce(max(seq), 0) + 1 into note_seq
    from public.invoices
   where tenant_id = original.tenant_id
     and year = note_year
     and kind = 'credit_note';
$frag$;
  next_number text := $frag$  -- Серия кредит-нот — у юрлица инвойса (STORY-101).
  select numbering.seq, numbering.number
    into note_seq, note_number
    from public.next_document_number(
      original.tenant_id, original.company_id, 'credit_note', note_year
    ) as numbering;
$frag$;
  frag_value text := $frag$    'CN-' || note_year::text
          || '-' || lpad(note_seq::text, greatest(3, length(note_seq::text)), '0'),
$frag$;
begin
  if (length(def) - length(replace(def, frag_decl, ''))) / length(frag_decl) <> 1
     or (length(def) - length(replace(def, frag_number, ''))) / length(frag_number) <> 1
     or (length(def) - length(replace(def, frag_value, ''))) / length(frag_value) <> 1 then
    raise exception 'сторож: _issue_credit_note — куски номера не ровно по одному';
  end if;
  def := replace(def, frag_decl, E'  note_seq integer;\n  note_number text;\n');
  def := replace(def, frag_number, next_number);
  def := replace(def, frag_value, E'    note_number,\n');
  execute def;
end
$credit$;

do $receipt$
declare
  def text := pg_get_functiondef('public._issue_receipt_core(public.finance_transactions, jsonb, uuid)'::regprocedure);
  frag_decl text := E'  receipt_seq integer;\n';
  frag_number text := $frag$  receipt_year := extract(year from p_tx.occurred_on)::integer;
  perform pg_advisory_xact_lock(hashtextextended(p_tx.tenant_id::text || ':rc', 0));
  select coalesce(max(seq), 0) + 1 into receipt_seq
    from public.receipts
   where tenant_id = p_tx.tenant_id and year = receipt_year;

  company_uuid := public.resolve_company_id(p_tx.tenant_id, p_company_id);
$frag$;
  next_number text := $frag$  receipt_year := extract(year from p_tx.occurred_on)::integer;

  -- ПОВТОР НЕ ТРАТИТ НОМЕР. Операция под замком, готовый чек возвращается
  -- раньше, чем серия выдаст следующий номер: иначе `on conflict do nothing`
  -- ниже проглотил бы уже выданный — дыра в серии.
  perform 1 from public.finance_transactions where id = p_tx.id for update;
  select * into result_row from public.receipts where transaction_id = p_tx.id;
  if found then
    return result_row;
  end if;

  -- Юрлицо чека — юрлицо его инвойса; чек без инвойса — выбранное или основное.
  select invoice.company_id into company_uuid
    from public.invoices invoice
   where invoice.id = p_tx.invoice_id
     and invoice.tenant_id = p_tx.tenant_id;
  if company_uuid is null then
    company_uuid := public.resolve_company_id(p_tx.tenant_id, p_company_id);
  end if;
  select numbering.seq, numbering.number
    into receipt_seq, receipt_number
    from public.next_document_number(
      p_tx.tenant_id, company_uuid, 'receipt', receipt_year
    ) as numbering;
$frag$;
  frag_value text := $frag$    'RC-' || receipt_year::text || '-' || lpad(receipt_seq::text, 3, '0'),
$frag$;
begin
  if (length(def) - length(replace(def, frag_decl, ''))) / length(frag_decl) <> 1
     or (length(def) - length(replace(def, frag_number, ''))) / length(frag_number) <> 1
     or (length(def) - length(replace(def, frag_value, ''))) / length(frag_value) <> 1 then
    raise exception 'сторож: _issue_receipt_core — куски номера не ровно по одному';
  end if;
  def := replace(def, frag_decl, E'  receipt_seq integer;\n  receipt_number text;\n');
  def := replace(def, frag_number, next_number);
  def := replace(def, frag_value, E'    receipt_number,\n');
  execute def;
end
$receipt$;

-- ───────────────────────────── 7. Неизменяемость ─────────────────────────────

do $void$
declare
  def text := pg_get_functiondef('public.prevent_settled_invoice_rewrite()'::regprocedure);
  frag text := $frag$    elsif new.status = 'void' and (old.status <> 'issued' or net_paid > 0) then
$frag$;
  next_frag text := $frag$    elsif new.status = 'void' and not exists (
      select 1 from public._calendar_delete_context ctx
       where ctx.transaction_id = txid_current()
    ) then
      -- STORY-101: выпущенный документ отменяется только кредит-нотой.
      -- «void» без неё — лишь при стирании календаря (прежнее поведение).
      raise exception 'Инвойс отменяется только кредит-нотой';
    elsif new.status = 'void' and (old.status <> 'issued' or net_paid > 0) then
$frag$;
begin
  if (length(def) - length(replace(def, frag, ''))) / length(frag) <> 1 then
    raise exception 'сторож: prevent_settled_invoice_rewrite — ветка «void» не ровно одна';
  end if;
  execute replace(def, frag, next_frag);
end
$void$;

-- Старые сборки зовут «Аннулировать» — отвечаем словами, а не «функция не
-- найдена». Снесётся вместе с прочими дверями документов в 101c.
create or replace function public.void_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
set search_path to 'public'
as $function$
begin
  raise exception 'Инвойс отменяется только кредит-нотой — обновите приложение';
end;
$function$;

-- Документы пишут только двери сервера. Клиенту остаются язык и файл PDF
-- инвойса и статус — переходы статуса сторожит триггер по журналу оплат,
-- «void» — только стирание календаря.
revoke insert, update, delete, truncate, references, trigger
  on public.invoices from anon, authenticated;
grant update (status, language, pdf_url) on public.invoices to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.invoice_lines from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.receipts from anon, authenticated;

-- ───────────────────────────── 8. Старое уходит ─────────────────────────────

drop function if exists public.next_invoice_number(uuid, integer);
drop function if exists public.next_company_invoice_number(uuid, uuid, integer);
drop function if exists public.set_company_invoice_next_number(uuid, integer, integer);
drop function if exists public.invoice_in_series(uuid, uuid, uuid);
drop function if exists public.format_invoice_number(text, integer, integer, integer, boolean);

-- ───────────────────────────── 9. Сторож выхода ─────────────────────────────

do $guard$
declare
  v_left text;
  v_gap text;
begin
  if to_regclass('public.companies') is not null or to_regclass('public.legal_entities') is null then
    raise exception 'сторож: таблица юрлиц не переименована';
  end if;

  select string_agg(p.proname, ', ') into v_left
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.prosrc ~ 'public\.companies\M'
       or p.prosrc ilike '%next_company_invoice_number%'
       or p.prosrc ilike '%set_company_invoice_next_number%'
       or p.prosrc ~ '\mnext_invoice_number\M'
       or p.prosrc ilike '%invoice_in_series%'
       or p.prosrc ilike '%format_invoice_number%'
       or p.prosrc ilike '%invoice_next_number%'
       or p.prosrc ilike '%invoice_next_year%');
  if v_left is not null then
    raise exception 'сторож: старая нумерация ещё живёт в функциях: %', v_left;
  end if;

  select string_agg(p.proname, ', ') into v_left
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosrc ~* 'max\(\s*seq\s*\)';
  if v_left is not null then
    raise exception 'сторож: номер по max(seq) ещё считают: %', v_left;
  end if;

  if exists (select 1 from public.invoices where company_id is null)
     or exists (select 1 from public.receipts where company_id is null) then
    raise exception 'сторож: документ без юрлица';
  end if;
  if exists (
    select 1 from public.tenants t
     where not exists (select 1 from public.legal_entities e where e.tenant_id = t.id and e.is_default)
  ) then
    raise exception 'сторож: компания без основного юрлица';
  end if;
  if exists (select 1 from public.teams where legal_entity_id is null) then
    raise exception 'сторож: команда без юрлица после переноса';
  end if;

  -- Серия не отстаёт ни от одного выданного номера.
  select string_agg(format('%s/%s/%s', gap.legal_entity_id, gap.doc_type, gap.year), ', ') into v_gap
    from (
      select invoice.tenant_id, invoice.company_id as legal_entity_id,
             case invoice.kind when 'credit_note' then 'credit_note' else 'invoice' end as doc_type,
             invoice.year, max(invoice.seq) as top
        from public.invoices invoice group by 1, 2, 3, 4
      union all
      select receipt.tenant_id, receipt.company_id, 'receipt', receipt.year, max(receipt.seq)
        from public.receipts receipt group by 1, 2, 3, 4
    ) gap
   where not exists (
     select 1 from public.document_sequences series
      where series.tenant_id = gap.tenant_id
        and series.legal_entity_id = gap.legal_entity_id
        and series.doc_type = gap.doc_type
        and series.year = gap.year
        and series.last_number >= gap.top
   );
  if v_gap is not null then
    raise exception 'сторож: серия отстаёт от выданных номеров: %', v_gap;
  end if;

  if not (select prosecdef from pg_proc where oid = 'public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text, text)'::regprocedure) then
    raise exception 'сторож: issue_invoice не definer — серия ему закрыта';
  end if;

  if has_function_privilege('authenticated', 'public.next_document_number(uuid, uuid, text, integer)', 'execute')
     or has_function_privilege('anon', 'public.next_document_number(uuid, uuid, text, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.document_series_started(uuid, uuid, text, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.legal_entity_of_team(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.peek_document_number(uuid, text, integer)', 'execute')
     or has_function_privilege('anon', 'public.set_document_series_start(uuid, text, integer, integer)', 'execute') then
    raise exception 'сторож: функции серий открыты не тем';
  end if;
  if not has_function_privilege('authenticated', 'public.peek_document_number(uuid, text, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_document_series_start(uuid, text, integer, integer)', 'execute') then
    raise exception 'сторож: двери серий закрыты от приложения';
  end if;

  if has_table_privilege('authenticated', 'public.invoices', 'INSERT')
     or has_table_privilege('authenticated', 'public.invoices', 'DELETE')
     or has_column_privilege('authenticated', 'public.invoices', 'total', 'UPDATE')
     or has_column_privilege('authenticated', 'public.invoices', 'number', 'UPDATE')
     or has_column_privilege('authenticated', 'public.invoices', 'company_id', 'UPDATE')
     or has_table_privilege('authenticated', 'public.invoice_lines', 'INSERT')
     or has_table_privilege('authenticated', 'public.invoice_lines', 'UPDATE')
     or has_table_privilege('authenticated', 'public.receipts', 'INSERT')
     or has_table_privilege('authenticated', 'public.receipts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.receipts', 'DELETE')
     or has_table_privilege('authenticated', 'public.document_sequences', 'SELECT') then
    raise exception 'сторож: документы пишутся мимо дверей';
  end if;
  if not has_column_privilege('authenticated', 'public.invoices', 'status', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.invoices', 'language', 'UPDATE') then
    raise exception 'сторож: закрыты статус или язык — оплата и язык бумаги сломаются';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.tenants'::regclass
       and tgname = 'trg_tenants_default_legal_entity'
  ) then
    raise exception 'сторож: новой компании юрлицо не заведётся';
  end if;
end
$guard$;
