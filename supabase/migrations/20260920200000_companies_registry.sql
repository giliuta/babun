-- СПРАВОЧНИК КОМПАНИЙ: ОТ КОГО ВЫПИСАН ДОКУМЕНТ.
--
-- Владелец 2026-09-20: «в одном приложении я могу управлять несколькими
-- компаниями, я могу выставлять чек с нескольких компаний… создай страницу в
-- кабинете, блок компании — по сути она будет выглядеть так же, как услуги,
-- только информация другая; когда я выставляю чек, я могу выбрать компанию
-- либо сразу добавить новую».
--
-- ДО ЭТОЙ МИГРАЦИИ реквизиты продавца были ОДНИ на компанию-арендатора и
-- лежали колонками в `tenants` (`legal_name`, `business_address`,
-- `vat_number`, `iban`, `bank_name`). Документы печатали их без выбора:
-- `_issue_receipt_core` снимал снимок прямо из `tenants`. Одно юрлицо на
-- аккаунт — и всё.
--
-- ЧТО ДЕЛАЕТСЯ. Заводится `public.companies` — юрлица, от имени которых
-- выписывают бумаги. Справочник, как услуги: свой список, свой порядок,
-- архив вместо удаления. Одна строка помечается умолчанием — её и
-- подставляют документы, пока человек не выбрал другую.
--
-- СТАРЫЕ РЕКВИЗИТЫ НЕ ТЕРЯЮТСЯ: §2 переносит их первой строкой справочника
-- и делает её умолчанием. Колонки в `tenants` НЕ СНОСЯТСЯ — на них завязаны
-- инвойсы и уже выданные чеки; их снос — отдельная работа, когда все
-- документы научатся жить на `companies`.
--
-- АРХИВ, А НЕ УДАЛЕНИЕ. Выданный документ ссылается на компанию, от которой
-- выписан; стереть её значит оставить бумагу без продавца. `archived_at`
-- убирает компанию из выбора, оставляя историю целой.

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Как компанию называют ВНУТРИ, коротко: это строка списка и строка выбора.
  name text not null,
  -- Как она называется НА БУМАГЕ. Пусто — печатаем `name`.
  legal_name text,
  business_address text,
  vat_number text,
  reg_number text,
  iban text,
  bank_name text,
  contact_phone text,
  contact_email text,
  position integer not null default 0,
  -- ОДНО УМОЛЧАНИЕ НА КОМПАНИЮ, И ЭТО СТЕРЕЖЁТ БАЗА, А НЕ ЭКРАН (частичный
  -- уникальный индекс ниже). Две строки с `is_default` означали бы, что
  -- документ печатает то одно юрлицо, то другое, смотря что прочиталось
  -- первым.
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.companies is
  'Юрлица компании-арендатора: от кого выписан чек или инвойс (владелец '
  '2026-09-20). Справочник, как услуги: порядок, архив вместо удаления, одна '
  'строка по умолчанию (см. частичный уникальный индекс companies_one_default).';

create index if not exists companies_tenant_idx
  on public.companies (tenant_id, position, created_at);

create unique index if not exists companies_one_default
  on public.companies (tenant_id) where is_default;

alter table public.companies enable row level security;

-- ЧИТАЮТ ВЛАДЕЛЕЦ И ДИСПЕТЧЕР, ПИШЕТ ВЛАДЕЛЕЦ.
--
-- ЗДЕСЬ БЫЛО `to authenticated` БЕЗ РОЛИ, и это отменяло границу, которую
-- продукт охраняет намеренно и с собственным сторожем. Аудит прав 2026-09-20:
--   • `tenants_select_owner` (20260720210003) — строку `tenants` читает ТОЛЬКО
--     владелец;
--   • `current_tenant_profile_safe` (20260914180000) отдаёт сотруднику 17
--     полей и СОЗНАТЕЛЬНО не отдаёт `iban`, `bank_name`, `vat_number`,
--     `legal_name`, `business_address`, а на накате стоит проверка, которая
--     роняет миграцию, если они просочатся.
-- Новая таблица копирует ровно эти колонки. Открыв её всем вошедшим, я обошёл
-- бы и политику, и сторожа — сторож смотрит ТЕЛО функции, а не новую дверь, и
-- промолчал бы. Любой мастер, открывший «Новый чек», унёс бы на устройство
-- банковский счёт компании.
--
-- Тот же круг, что у чеков (`receipts_read`): владелец и диспетчер. Мастер
-- реквизиты не выбирает — его чек подпишется умолчанием, и это правильно:
-- выбор юрлица есть решение о подписи под документом.
drop policy if exists companies_read on public.companies;
create policy companies_read on public.companies
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) in ('owner', 'dispatcher')
  );

drop policy if exists companies_write_owner on public.companies;
create policy companies_write_owner on public.companies
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'owner'
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'owner'
  );

-- Отметка времени правки — как у остальных таблиц схемы: без триггера
-- `updated_at` застыл бы на времени создания и врал бы в первом же разборе
-- «кто когда менял реквизиты».
drop trigger if exists companies_set_updated_at on public.companies;
create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

-- ПЕРЕКЛЮЧЕНИЕ УМОЛЧАНИЯ — ОДНИМ ДВИЖЕНИЕМ, А НЕ ДВУМЯ.
--
-- Экран снимал старое умолчание и ставил новое двумя запросами подряд, и
-- между ними у компании не было ни одного набора по умолчанию. Чек,
-- выписанный в эту щель, подписывался «первым живым юрлицом по порядку» —
-- не тем, что выбрали (аудит прав 2026-09-20). Одна транзакция закрывает
-- окно; заодно здесь же живёт проверка «это твоя компания», которой у
-- двух отдельных `update` не было.
create or replace function public.set_default_company(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  tenant_uuid uuid := public.current_tenant_id();
begin
  if auth.uid() is null or tenant_uuid is null then
    raise exception 'Войдите в приложение';
  end if;
  if public.current_user_role() <> 'owner' then
    raise exception 'Основные реквизиты выбирает владелец';
  end if;
  if not exists (
    select 1 from public.companies
     where id = p_company_id and tenant_id = tenant_uuid
  ) then
    raise exception 'Реквизиты не найдены';
  end if;

  -- Порядок важен: сначала снять, потом поставить. Обратный порядок упёрся бы
  -- в частичный уникальный индекс на первом же шаге.
  update public.companies
     set is_default = false
   where tenant_id = tenant_uuid and is_default and id <> p_company_id;
  update public.companies
     set is_default = true
   where id = p_company_id;
end;
$$;

revoke all on function public.set_default_company(uuid) from public, anon;
grant execute on function public.set_default_company(uuid) to authenticated;

-- ─── 2. ПЕРЕНОС УЖЕ ЗАПОЛНЕННЫХ РЕКВИЗИТОВ ──────────────────────────────
-- Первая строка справочника у каждой компании — то, что уже введено в
-- «Реквизитах». Человек не должен вводить это второй раз, а документы не
-- должны на день остаться без продавца.
--
-- Переносим ВСЕМ тенантам, даже тем, у кого реквизиты пусты: пустая карточка
-- с именем компании честнее, чем пустой справочник, из которого нечего
-- выбрать. `on conflict` не нужен — вставляем только там, где строк ещё нет.
insert into public.companies (
  tenant_id, name, legal_name, business_address, vat_number, iban, bank_name,
  contact_phone, contact_email, is_default, position
)
select t.id,
       coalesce(nullif(btrim(t.legal_name), ''), t.name),
       t.legal_name,
       t.business_address,
       t.vat_number,
       t.iban,
       t.bank_name,
       t.contact_phone,
       t.contact_email,
       true,
       0
  from public.tenants t
 where not exists (select 1 from public.companies c where c.tenant_id = t.id);

-- ─── 3. ЧЕК ЗНАЕТ, ОТ КОГО ВЫПИСАН ──────────────────────────────────────
-- Колонка-ссылка, а НЕ замена снимку: `seller_snapshot` остаётся главным на
-- бумаге (компанию переименуют, а выданный чек обязан остаться прежним).
-- Ссылка отвечает на другой вопрос — «по какому юрлицу собрать отчёт».
alter table public.receipts
  add column if not exists company_id uuid references public.companies(id);

create index if not exists idx_receipts_company
  on public.receipts (tenant_id, company_id);

comment on column public.receipts.company_id is
  'От какого юрлица выписан чек. Печатается всё равно seller_snapshot — он '
  'снимок момента выдачи; ссылка нужна для отбора документов по юрлицу.';

-- ─── 4. ЯДРО БЕРЁТ ПРОДАВЦА ИЗ ВЫБРАННОЙ КОМПАНИИ ───────────────────────
drop function if exists public._issue_receipt_core(public.finance_transactions, jsonb);

create or replace function public._issue_receipt_core(
  p_tx public.finance_transactions,
  p_lines jsonb default null,
  p_company_id uuid default null
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
  company public.companies%rowtype;
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

  -- ВЫБРАННАЯ КОМПАНИЯ, ИНАЧЕ УМОЛЧАНИЕ, ИНАЧЕ СТАРЫЕ РЕКВИЗИТЫ. Чужую
  -- компанию не возьмём: `tenant_id` в условии — не формальность, а граница.
  if p_company_id is not null then
    select * into company from public.companies
     where id = p_company_id and tenant_id = p_tx.tenant_id;
  end if;
  -- УМОЛЧАНИЕ БЕРЁТСЯ ДАЖЕ ИЗ АРХИВА. Сухой прогон поймал: с условием
  -- `archived_at is null` заархивированное умолчание оставляло чек вообще без
  -- компании — и снимок продавца уходил клиенту БЕЗ номера НДС, IBAN и банка,
  -- молча. Архив прячет компанию из ВЫБОРА, а не отменяет её подпись под уже
  -- идущей бумагой. Если умолчания нет вовсе — берём первое живое юрлицо, и
  -- только когда справочник пуст, падаем на старые реквизиты арендатора.
  if company.id is null then
    select * into company from public.companies
     where tenant_id = p_tx.tenant_id and is_default;
  end if;
  if company.id is null then
    select * into company from public.companies
     where tenant_id = p_tx.tenant_id and archived_at is null
     order by position, created_at
     limit 1;
  end if;

  if company.id is not null then
    select jsonb_build_object(
             'name', coalesce(nullif(btrim(company.legal_name), ''), company.name),
             'address', company.business_address,
             'vat_number', company.vat_number,
             'iban', company.iban,
             'bank_name', company.bank_name,
             'vat_mode', t.vat_mode,
             'currency', t.currency
           )
      into seller
      from public.tenants t where t.id = p_tx.tenant_id;
  else
    select jsonb_build_object(
             'name', coalesce(t.legal_name, t.name),
             'address', t.business_address,
             'vat_mode', t.vat_mode,
             'currency', t.currency
           )
      into seller
      from public.tenants t where t.id = p_tx.tenant_id;
  end if;

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
    company.id
  )
  on conflict (transaction_id) where transaction_id is not null do nothing
  returning * into result_row;

  if not found then
    select * into result_row from public.receipts where transaction_id = p_tx.id;
  end if;
  return result_row;
end;
$$;

revoke all on function public._issue_receipt_core(public.finance_transactions, jsonb, uuid)
  from public, anon, authenticated;

-- ─── 5. ДВЕРЬ ПРИНИМАЕТ КОМПАНИЮ ────────────────────────────────────────
-- Тело — то же, что в 20260920190000, слово в слово; меняются подпись и один
-- вызов ядра. Снос перед созданием обязателен: список типов другой, и без
-- него в каталоге осталась бы вторая дверь (см. урок той же миграции).
drop function if exists public.issue_receipt(uuid, jsonb);

create or replace function public.issue_receipt(
  p_transaction_id uuid,
  p_lines jsonb default null,
  p_company_id uuid default null
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
    -- `is null` ЗДЕСЬ БЫЛ НЕ СУЖЕНИЕМ, А ПРОПУСКОМ. Аудит прав 2026-09-20:
    -- проводка с пустыми командой, счётом и долгом оказывалась разрешена
    -- ЛЮБОМУ вошедшему, включая мастера с выключенными финансами, а дверь
    -- возвращает строку чека целиком — с именем и телефоном клиента.
    -- Достижимо: `finance_transactions.account_id` объявлен `on delete set
    -- null`, то есть закрытие счёта снимало проверку счёта у всех его
    -- проводок. Теперь пусто значит «нет права»; владелец сюда не доходит —
    -- он ушёл первой веткой выше.
    allowed :=
      tx.team_id is not null
      and tx.team_id = any(public.access_calendars('finance.operations', 'write'))
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

  result_row := public._issue_receipt_core(tx, p_lines, p_company_id);
  if result_row.id is null then
    select * into result_row from public.receipts where transaction_id = tx.id;
  end if;
  if result_row.id is null then
    raise exception 'Не удалось выписать чек';
  end if;
  return result_row;
end;
$$;

revoke all on function public.issue_receipt(uuid, jsonb, uuid) from public, anon;
grant execute on function public.issue_receipt(uuid, jsonb, uuid) to authenticated;

-- ─── 6. Проверки после наката ───────────────────────────────────────────
do $audit$
declare
  door_oid oid;
  core_oid oid;
  tenants_count integer;
  companies_count integer;
begin
  if (select count(*) from pg_proc
       where proname = 'issue_receipt' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'companies: дверей issue_receipt должно остаться ровно одна';
  end if;
  if (select count(*) from pg_proc
       where proname = '_issue_receipt_core' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'companies: ядер _issue_receipt_core должно остаться ровно одно';
  end if;
  select p.oid into door_oid from pg_proc p
   where p.proname = 'issue_receipt' and p.pronamespace = 'public'::regnamespace;
  select p.oid into core_oid from pg_proc p
   where p.proname = '_issue_receipt_core' and p.pronamespace = 'public'::regnamespace;
  if has_function_privilege('anon', door_oid, 'EXECUTE') then
    raise exception 'companies: issue_receipt доступна anon';
  end if;
  if not has_function_privilege('authenticated', door_oid, 'EXECUTE') then
    raise exception 'companies: issue_receipt недоступна authenticated';
  end if;
  if has_function_privilege('authenticated', core_oid, 'EXECUTE') then
    raise exception 'companies: ядро исполнимо напрямую authenticated';
  end if;

  -- У КАЖДОГО ТЕНАНТА РОВНО ОДНА КОМПАНИЯ ПО УМОЛЧАНИЮ, И НИ ОДИН НЕ ОСТАЛСЯ
  -- БЕЗ СПРАВОЧНИКА: иначе документ печатался бы без продавца.
  select count(*) into tenants_count from public.tenants;
  select count(distinct tenant_id) into companies_count
    from public.companies where is_default;
  if tenants_count <> companies_count then
    raise exception 'companies: умолчание есть не у всех компаний (% из %)',
      companies_count, tenants_count;
  end if;
  if exists (
    select tenant_id from public.companies where is_default
     group by tenant_id having count(*) > 1
  ) then
    raise exception 'companies: у кого-то два умолчания — индекс не сработал';
  end if;
  if exists (select 1 from public.companies where btrim(coalesce(name, '')) = '') then
    raise exception 'companies: перенос оставил компанию без имени';
  end if;

  -- ПОЛОЖИТЕЛЬНАЯ ПРОВЕРКА ИНДЕКСА. Проверки «двух умолчаний не бывает» мало:
  -- индекс БЕЗ `where is_default` её тоже проходит — при нём второй компании
  -- просто не существует. Сухой прогон показал это мутантом, поэтому здесь
  -- заводится и сносится вторая НЕ-умолчательная строка: она обязана лечь.
  begin
    insert into public.companies (tenant_id, name, is_default)
    select id, '__проверка индекса__', false from public.tenants limit 1;
  exception when unique_violation then
    raise exception 'companies: индекс уникальности ловит не только умолчание — вторая компания не заводится';
  end;
  delete from public.companies where name = '__проверка индекса__';

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'receipts' and column_name = 'company_id'
  ) then
    raise exception 'companies: у чека нет ссылки на компанию';
  end if;
  if exists (select 1 from public.receipts where company_id is not null) then
    raise exception 'companies: старым чекам прописали компанию — они её не знали';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'companies' and policyname = 'companies_read'
  ) or not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'companies' and policyname = 'companies_write_owner'
  ) then
    raise exception 'companies: политики не на месте';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.companies'::regclass) then
    raise exception 'companies: RLS не включена — справочник открыт всем';
  end if;
  -- Круг чтения обязан остаться узким: в таблице лежат IBAN и налоговый
  -- номер, которые `current_tenant_profile_safe` намеренно не отдаёт
  -- сотруднику. Политика без проверки роли — это обход той границы.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'companies'
       and policyname = 'companies_read'
       and qual like '%current_user_role%'
  ) then
    raise exception 'companies: чтение справочника открыто без проверки роли — IBAN уедет сотруднику';
  end if;
end;
$audit$;
