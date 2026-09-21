-- ЗАКАЛКА ПОСЛЕ АУДИТА ПРАВ (2026-09-21).
--
-- Аудит прошёл по вчерашним миграциям документов и нашёл семь вещей. Шесть из
-- них — следы МОИХ ЖЕ вчерашних правок, и чинятся здесь. Каждая названа
-- своим именем.

begin;

set local lock_timeout = '5s';

-- ─── 1. ДВЕ ДВЕРИ ИНВОЙСА ПОТЕРЯЛИ `search_path` ────────────────────────────
--
-- У `issue_invoice` он стоял с 20260720210005, у `update_invoice_draft` — с
-- 20260915120000. Обе двери вчера пересоздавались через `drop` + `create`
-- (ради нового параметра, иначе вышла бы перегрузка), и при перепечатке
-- заголовка пин не воспроизвели. Эскалации это не давало — обе функции
-- SECURITY INVOKER, и все таблицы в телах написаны с `public.`, — но
-- единственным замком осталась дисциплина автора тела.
--
-- `alter function` меняет ТОЛЬКО заголовок: тело не переписывается, значит и
-- сломать его нечем.
alter function public.issue_invoice(
  uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid
) set search_path = public;

alter function public.update_invoice_draft(
  uuid, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid
) set search_path = public;

-- ─── 2. РЕКВИЗИТЫ ВЫБИРАЕТ ТОТ, КОМУ ОНИ ВИДНЫ ──────────────────────────────
--
-- `companies_read` пускает в справочник реквизитов только владельца и
-- диспетчера (20260920200000). А дверь чека принимала `p_company_id` от
-- ЛЮБОГО вошедшего: мастер мог указать чужой ему набор и вынуть его IBAN и
-- номер НДС из снимка собственного чека. Проверка живёт в лестнице — там,
-- где набор и выбирается, и потому закрывает обе двери разом.
--
-- РОЛЬ NULL — НЕ ОТКАЗ: так выглядит служебный путь (`service_role` при
-- удалении арендатора), у которого роли в ленте нет вовсе. Дверей наружу у
-- функции нет: права на неё отозваны у всех, кроме владельца базы.
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
  caller_role text;
begin
  if p_tenant_id is null then
    return null;
  end if;

  if p_company_id is not null then
    caller_role := public.current_user_role();
    if caller_role is not null and caller_role not in ('owner', 'dispatcher') then
      raise exception 'Выбирать реквизиты может владелец или диспетчер';
    end if;
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

-- ─── 3. ЗАКРЫТЫЙ СЧЁТ НА БУМАГЕ — ЭТО ТУПИК ДЛЯ КЛИЕНТА ─────────────────────
--
-- Сторож смотрел только на арендатора. Экран и так показывает лишь живые
-- кассы команды (`accountsForTeam`), но у галочки «счёт закрыт» не было
-- серверного зеркала: инвойс мог уйти клиенту со словами «платите сюда» на
-- счёт, которого у компании больше нет.
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
  if not exists (
    select 1 from public.accounts
     where id = p_account_id
       and tenant_id = p_tenant_id
       and is_active
  ) then
    raise exception 'Счёт закрыт — на него нельзя ждать оплату';
  end if;
end;
$$;

revoke all on function public.assert_invoice_account(uuid, uuid) from public, anon, authenticated;

-- ─── 4. КРЕДИТ-НОТА ПРОХОДИЛА МИМО ПРОВЕРКИ СЧЁТА ──────────────────────────
--
-- Ветка кредит-ноты в триггере возвращала строку ДО `assert_invoice_account`,
-- и в своей строке можно было оставить `account_id` чужого арендатора.
-- Прочитать по этой ссылке чужой счёт нельзя (RLS), но указатель в другой
-- тенант — это сломанная целостность: чужое удаление счёта молча правило бы
-- наш документ. Проверка поднята ДО ветвления, чтобы её нельзя было обойти
-- ни одним путём вставки.
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
    -- ПЕРВОЙ СТРОКОЙ, ДО ЛЮБОГО ВЕТВЛЕНИЯ: счёт проверяется у всякой новой
    -- строки, включая кредит-ноту.
    perform public.assert_invoice_account(new.tenant_id, new.account_id);

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

-- ─── 5. СНИМОК ЧЕКА СУЖАЕТСЯ ДО ТОГО, ЧТО ЧЕК ПЕЧАТАЕТ ─────────────────────
--
-- Вчера чек и инвойс свели на один сборщик, и снимок чека вырос с семи ключей
-- до девятнадцати. А строки `receipts` видны ШИРЕ, чем справочник реквизитов:
-- политика `receipts_read_own_money` пускает к чеку всякого, кому видна его
-- проводка, — то есть мастера с правом на «Доходы и расходы» своего
-- календаря. Так к нему уехали контакты, логотип, город, страна и внутренние
-- идентификаторы набора.
--
-- Здесь снимок чека обрезан ровно до того, что печатает его бумага
-- (`receipt-document.ts`). Сборщик остаётся ОДИН — обрезается результат.
--
-- ⚠️ ЧТО ЭТО НЕ ЧИНИТ: `iban`, `vat_number`, `legal_name` и адрес юрлица
-- видны мастеру через чек и БЕЗ вчерашнего расширения — так было с 09.08.
-- Это отдельная работа: поколоночного RLS в Postgres нет, и чеку нужен либо
-- свой читающий вид, либо снимок без банковских полей. Владельцу сказано.
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
  select jsonb_object_agg(entry.key, entry.value)
    into seller
    from jsonb_each(public.build_seller_snapshot(p_tx.tenant_id, company_uuid)) as entry
   where entry.key in (
     'name', 'address', 'vat_number', 'reg_number',
     'iban', 'bank_name', 'vat_mode', 'currency'
   );

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

-- ─── 6. ГОСТЯ НЕ ЗАСТАВЛЯЮТ СЧИТАТЬ ВЛАДЕЛЬЧЕСКУЮ ЛОГИКУ ───────────────────
--
-- Политика `receipts_read` объявлена без `to`, то есть действует и на `anon`.
-- Утечки нет: у гостя нет права выполнить `current_user_role`, и запрос
-- падает отказом. Но закрыто это случайностью, а не адресатом политики.
-- Выражение не меняется ни на символ — меняется только роль.
drop policy if exists receipts_read on public.receipts;
create policy receipts_read on public.receipts
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = any (array['owner', 'dispatcher'])
  );

-- ─── 7. ОТКРЫТАЯ ДВЕРЬ — ЭТО ПРИГЛАШЕНИЕ СТУЧАТЬ ───────────────────────────
--
-- `record_invoice_payment` отзывали только у `PUBLIC`, а Supabase выдаёт
-- EXECUTE ИМЕНОВАННОЙ роли `anon` — её `revoke … from public` не трогает. Роль
-- и арендатора функция проверяет первой строкой, так что дыры нет; закрываем
-- поверхность атаки по правилу самого продукта.
revoke execute on function public.record_invoice_payment(
  uuid, uuid, numeric, uuid, text, date, text
) from anon;

-- ─── 8. ПОСЛЕДНИЙ СТОРОЖ ОПЛАЧЕННОГО ИНВОЙСА ЗНАЕТ ПРО ДВЕ НОВЫЕ КОЛОНКИ ───
--
-- `prevent_settled_invoice_rewrite` сравнивает кортеж денежных колонок и
-- отбивает правку документа с платежами. `company_id` и `account_id` в этот
-- кортеж вчера не добавили, и у смены реквизитов оплаченного инвойса остался
-- ОДИН заслон (триггер снимков) вместо двух. Тело ниже — живое, снятое из
-- базы, изменено ровно двумя строками в каждом из двух кортежей.
create or replace function public.prevent_settled_invoice_rewrite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
    new.company_id,
    new.account_id,
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
    old.company_id,
    old.account_id,
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
$$;

-- ─── ПРОВЕРКА ПОСЛЕ НАКАТА ─────────────────────────────────────────────────
--
-- Её не хватало вчерашним миграциям: «перегрузки быть не должно» было выводом
-- из файла, а не фактом из каталога. Этот блок роняет накат, если хоть одно
-- утверждение не выполнено.
do $audit$
declare
  n integer;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'issue_invoice';
  if n <> 1 then
    raise exception 'issue_invoice в каталоге не одна, а %', n;
  end if;

  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'update_invoice_draft';
  if n <> 1 then
    raise exception 'update_invoice_draft в каталоге не одна, а %', n;
  end if;

  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('issue_invoice', 'update_invoice_draft')
     and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%';
  if n <> 0 then
    raise exception 'дверь инвойса без search_path: %', n;
  end if;

  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('issue_invoice', 'update_invoice_draft', 'record_invoice_payment',
                       'issue_receipt', 'next_invoice_number', 'cancel_invoice')
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n <> 0 then
    raise exception 'anon держит право на % дверях документов', n;
  end if;

  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('resolve_company_id', 'build_seller_snapshot', 'assert_invoice_account')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if n <> 0 then
    raise exception 'служебные функции реквизитов доступны authenticated: %', n;
  end if;

  select count(*) into n from pg_policy pol join pg_class c on c.oid = pol.polrelid
   where c.relname = 'receipts' and pol.polname = 'receipts_read'
     and pol.polroles::regrole[]::text[] = array['authenticated'];
  if n <> 1 then
    raise exception 'receipts_read адресована не authenticated';
  end if;
end;
$audit$;

commit;
