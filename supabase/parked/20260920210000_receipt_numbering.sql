-- НУМЕРАЦИЯ ЧЕКОВ: ПРАВИЛО СЕРИИ И НОМЕР РУКОЙ.
--
-- Владелец 2026-09-20 выбрал «правило серии» и тут же добавил: «хотелось бы
-- нумерацию чека выполнять по-другому — чтоб рукой можно было написать».
-- Значит нужно и то и другое: правило, по которому номера идут сами, и
-- возможность перебить номер в отдельной бумаге.
--
-- ДО ЭТОЙ МИГРАЦИИ формат был зашит в `_issue_receipt_core` строкой
-- 'RC-' || год || '-' || lpad(seq, 3, '0'), и поменять в нём было нечего.
-- У инвойсов настройки серии давно есть (`tenants.invoice_prefix`,
-- `invoice_number_padding`, `invoice_number_yearly_reset`) — чек получает
-- такие же, теми же именами, чтобы два документа одной компании не
-- настраивались по-разному.
--
-- УМОЛЧАНИЯ ПОДОБРАНЫ ТАК, ЧТОБЫ НИЧЕГО НЕ ИЗМЕНИЛОСЬ: 'RC', три цифры,
-- сброс по году — ровно то, что зашито сегодня. Колонки с `not null default`
-- прописываются всем строкам разом, и здесь это ЖЕЛАЕМОЕ: значение —
-- константа, одинаковая для всех, а не что-то, вычисленное на момент наката
-- (урок `add column … default` 2026-09-19 был про `default auth.uid()`).

alter table public.tenants
  add column if not exists receipt_prefix text not null default 'RC',
  add column if not exists receipt_number_padding integer not null default 3,
  add column if not exists receipt_number_yearly_reset boolean not null default true,
  -- С КАКОГО НОМЕРА НАЧАТЬ. Переезжают из другой программы, где чеки дошли
  -- до 250, — новая серия обязана продолжить, а не начать с единицы.
  add column if not exists receipt_start_seq integer not null default 1;

-- ОГРАНИЧИТЕЛИ ДЕРЖИТ БАЗА, А НЕ ЭКРАН. Ширина в сто знаков и пустой префикс
-- — не «свобода настройки», а сломанный документ у клиента на руках.
alter table public.tenants
  drop constraint if exists tenants_receipt_number_padding_check;
alter table public.tenants
  add constraint tenants_receipt_number_padding_check
  check (receipt_number_padding between 1 and 12);

alter table public.tenants
  drop constraint if exists tenants_receipt_prefix_check;
alter table public.tenants
  add constraint tenants_receipt_prefix_check
  -- Длина меряется ПОСЛЕ обрезки пробелов: '  RC  ' — шесть знаков в поле и
  -- два на бумаге, и в настройках было бы видно одно, а в документе другое.
  check (btrim(receipt_prefix) <> '' and length(btrim(receipt_prefix)) <= 12);

alter table public.tenants
  drop constraint if exists tenants_receipt_start_seq_check;
alter table public.tenants
  add constraint tenants_receipt_start_seq_check
  check (receipt_start_seq between 1 and 1000000);

comment on column public.tenants.receipt_start_seq is
  'С какого номера начинается серия чеков. Планка действует ТОЛЬКО пока серия '
  'пуста (переезд из другой программы); у непустой серии номер идёт от '
  'последнего, и смена планки задним числом ничего не двигает.';

-- ─── НОМЕР СОБИРАЕТСЯ ОДНИМ ТЕЛОМ ───────────────────────────────────────
-- Формула жила в двух местах — в ядре и в подсказке `next_receipt_number`, —
-- и обязана была совпадать до символа. Две копии одной строки расходятся
-- всегда; здесь они расходились бы молча, и человек видел бы один номер, а на
-- бумагу вставал другой.
--
-- `lpad` ОБРЕЗАЕТ СПРАВА. `lpad('1000', 3, '0')` = '100' — не ошибка Postgres,
-- а его правило. Пока до тысячного чека надо было дорасти годами, это никого
-- не задевало; с настройкой «начать с номера» владелец ставит 1000 при ширине
-- 3 и получает на бумаге RC-2025-100 при seq=1000. Ширина берётся не меньше
-- самого числа (сухой прогон 2026-09-20).
create or replace function public._receipt_number_text(
  p_prefix text,
  p_year integer,
  p_seq integer,
  p_padding integer
)
returns text
language sql
immutable
as $$
  select coalesce(nullif(btrim(p_prefix), ''), 'RC')
      || '-' || p_year::text
      || '-' || lpad(
           p_seq::text,
           greatest(coalesce(p_padding, 3), length(p_seq::text), 1),
           '0'
         );
$$;

revoke all on function public._receipt_number_text(text, integer, integer, integer)
  from public, anon, authenticated;

-- НОМЕР УНИКАЛЕН СТРОКОЙ, А НЕ ТОЛЬКО ПАРОЙ (год, seq). Пока номер собирал
-- сервер, уникальности (tenant, year, seq) хватало. Как только номер можно
-- вписать рукой, двум чекам ничего не мешает получить один и тот же текст —
-- и это ровно то, чего не должно быть в серии. Индекс СОЗДАЁТСЯ ДО того, как
-- появляется ручной ввод: иначе первая же опечатка стала бы историей.
create unique index if not exists ux_receipts_number_text
  on public.receipts (tenant_id, number);

-- ─── ЯДРО: НОМЕР ПО ПРАВИЛУ ИЛИ РУКОЙ ───────────────────────────────────
drop function if exists public._issue_receipt_core(public.finance_transactions, jsonb, uuid);

create or replace function public._issue_receipt_core(
  p_tx public.finance_transactions,
  p_lines jsonb default null,
  p_company_id uuid default null,
  p_number text default null
)
returns public.receipts
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  receipt_year integer;
  receipt_seq integer;
  last_seq integer;
  had_any boolean;
  receipt_number text;
  seller jsonb;
  buyer jsonb;
  company public.companies%rowtype;
  settings public.tenants%rowtype;
  result_row public.receipts%rowtype;
begin
  if p_tx.type <> 'income' or p_tx.client_id is null or p_tx.amount <= 0 then
    return null;
  end if;

  select * into settings from public.tenants where id = p_tx.tenant_id;
  receipt_year := extract(year from p_tx.occurred_on)::integer;
  perform pg_advisory_xact_lock(hashtextextended(p_tx.tenant_id::text || ':rc', 0));

  -- СБРОС ПО ГОДУ — ЭТО ОТВЕТ НА ВОПРОС «СРЕДИ ЧЕГО ИСКАТЬ max(seq)»: внутри
  -- года или за всю жизнь компании. `year` в строке остаётся в обоих случаях
  -- — это год документа, а не способ нумерации.
  if settings.receipt_number_yearly_reset then
    select max(seq) into last_seq
      from public.receipts
     where tenant_id = p_tx.tenant_id and year = receipt_year;
  else
    select max(seq) into last_seq
      from public.receipts
     where tenant_id = p_tx.tenant_id;
  end if;
  -- ПЛАНКА — ПРО ПЕРВЫЙ ЧЕК КОМПАНИИ, А НЕ ПРО ПЕРВЫЙ ЧЕК ГОДА. Проверка
  -- «серия пуста» при годовом сбросе означала бы «каждое 1 января», и
  -- владелец, поставивший 250 ради переезда и забывший её, в январе начинал
  -- бы с 250 вместо единицы (сухой прогон 2026-09-20). Смотрим на ВСЮ
  -- историю компании: переезд бывает один раз.
  select exists (select 1 from public.receipts where tenant_id = p_tx.tenant_id)
    into had_any;

  if last_seq is null and not had_any then
    receipt_seq := greatest(coalesce(settings.receipt_start_seq, 1), 1);
  else
    receipt_seq := coalesce(last_seq, 0) + 1;
  end if;

  -- РУЧНОЙ НОМЕР НЕ СДВИГАЕТ СЕРИЮ: `seq` всё равно берётся следующим, и
  -- порядок документов остаётся тем же. Вписанный текст — это ПОДПИСЬ на
  -- бумаге, а не место в очереди.
  if nullif(btrim(coalesce(p_number, '')), '') is not null then
    receipt_number := btrim(p_number);
    -- НОМЕР ПРИХОДИТ С УСТРОЙСТВА И ВСТАЁТ НА БУМАГУ КЛИЕНТА. Проверяем форму,
    -- а не доверяем: аудит прав 2026-09-20 показал, что без этого в номер
    -- можно вписать перевод строки, чужую серию целиком или строку длиннее
    -- индекса (btree падал сырым `54000`, минуя понятный отказ).
    if length(receipt_number) > 40 then
      raise exception 'Номер чека длиннее 40 знаков — так его не примет ни одна проверка';
    end if;
    if receipt_number !~ '^[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9 /._-]*$' then
      raise exception 'В номере чека можно использовать буквы, цифры, пробел и знаки / . _ -';
    end if;
  else
    -- ЗАНЯТЫЙ НОМЕР ПЕРЕШАГИВАЕТСЯ, А НЕ РОНЯЕТ КНОПКУ. Прогон показал: стоит
    -- один раз вписать рукой «RC-2026-016», когда серия стояла на 15, — и
    -- СЛЕДУЮЩИЙ чек, которого никто руками не нумеровал, падал с «номер уже
    -- выписан». Отказ прилетал невиновному, а лечился в настройках. Теперь
    -- автоматический номер просто идёт дальше, пока не найдёт свободный.
    loop
      receipt_number := public._receipt_number_text(
        settings.receipt_prefix, receipt_year, receipt_seq, settings.receipt_number_padding
      );
      exit when not exists (
        select 1 from public.receipts
         where tenant_id = p_tx.tenant_id and number = receipt_number
      );
      receipt_seq := receipt_seq + 1;
      -- Страховка от вечного круга: тысяча занятых подряд означает не
      -- «ищем дальше», а что-то сломанное, и молчать об этом нельзя. Потолок
      -- считается ОТ ТОЧКИ СТАРТА, а не от `last_seq`: на пустой серии с
      -- планкой 5000 потолок был бы 1000, и перешагивание не случалось бы
      -- вовсе (сухой прогон 2026-09-20).
      if receipt_seq > greatest(coalesce(last_seq, 0), coalesce(settings.receipt_start_seq, 1)) + 1000 then
        raise exception 'Не удалось подобрать свободный номер чека — проверьте настройки серии';
      end if;
    end loop;
  end if;

  if p_company_id is not null then
    select * into company from public.companies
     where id = p_company_id and tenant_id = p_tx.tenant_id;
  end if;
  -- УМОЛЧАНИЕ БЕРЁТСЯ ДАЖЕ ИЗ АРХИВА, и только потом — первое живое юрлицо.
  -- Причина та же, что в 20260920200000: заархивированное умолчание иначе
  -- оставляло бы чек без компании, и снимок продавца уходил бы клиенту без
  -- номера НДС, IBAN и банка, молча.
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
    seller := jsonb_build_object(
      'name', coalesce(nullif(btrim(company.legal_name), ''), company.name),
      'address', company.business_address,
      'vat_number', company.vat_number,
      'iban', company.iban,
      'bank_name', company.bank_name,
      'vat_mode', settings.vat_mode,
      'currency', settings.currency
    );
  else
    seller := jsonb_build_object(
      'name', coalesce(settings.legal_name, settings.name),
      'address', settings.business_address,
      'vat_mode', settings.vat_mode,
      'currency', settings.currency
    );
  end if;

  select jsonb_build_object('name', c.full_name, 'phone', c.phone)
    into buyer
    from public.clients c where c.id = p_tx.client_id;

  begin
    insert into public.receipts (
      tenant_id, number, year, seq, issued_on, amount, currency,
      vat_rate, vat_amount, client_id, appointment_id, invoice_id,
      transaction_id, account_id, payment_method, seller_snapshot, client_snapshot,
      lines, company_id
    ) values (
      p_tx.tenant_id,
      receipt_number,
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
  exception when unique_violation then
    -- На `receipts` уникальностей ДВЕ: номер строкой и пара (год, seq). Вторая
    -- сегодня недостижима (замок плюс монотонный seq), но говорить за неё «чек
    -- с таким номером уже есть» было бы неправдой — поэтому разбираем.
    if sqlerrm like '%ux_receipts_number_text%' then
      raise exception 'Чек с номером % уже выписан', receipt_number;
    end if;
    raise;
  end;

  if not found then
    select * into result_row from public.receipts where transaction_id = p_tx.id;
  end if;
  return result_row;
end;
$$;

revoke all on function public._issue_receipt_core(public.finance_transactions, jsonb, uuid, text)
  from public, anon, authenticated;

-- ─── ДВЕРЬ ПРИНИМАЕТ НОМЕР ──────────────────────────────────────────────
drop function if exists public.issue_receipt(uuid, jsonb, uuid);

create or replace function public.issue_receipt(
  p_transaction_id uuid,
  p_lines jsonb default null,
  p_company_id uuid default null,
  p_number text default null
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
    -- проводка, у которой и команда, и счёт, и долг пусты, оказывалась
    -- разрешена ЛЮБОМУ вошедшему — включая мастера с выключенными финансами.
    -- Достижимо не в теории: `finance_transactions.account_id` объявлен
    -- `on delete set null`, то есть закрытие счёта зануляло проверку счёта у
    -- всех его проводок. А дверь возвращает строку чека целиком — с именем и
    -- телефоном клиента.
    --
    -- Теперь пусто значит «нет права»: команда обязана быть и обязана быть
    -- твоей. Владелец сюда не попадает — он ушёл первой веткой выше.
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

  result_row := public._issue_receipt_core(tx, p_lines, p_company_id, p_number);
  if result_row.id is null then
    select * into result_row from public.receipts where transaction_id = tx.id;
  end if;
  if result_row.id is null then
    raise exception 'Не удалось выписать чек';
  end if;
  return result_row;
end;
$$;

revoke all on function public.issue_receipt(uuid, jsonb, uuid, text) from public, anon;
grant execute on function public.issue_receipt(uuid, jsonb, uuid, text) to authenticated;

-- ─── СЛЕДУЮЩИЙ НОМЕР — ЧТОБЫ ПОКАЗАТЬ ЕГО НА ЧЕРНОВИКЕ ──────────────────
-- Зеркало чека печатает не «Черновик», а номер, который встанет на бумагу.
-- Это ПОДСКАЗКА, а не бронь: настоящий номер назначается под замком в момент
-- выписки, и между показом и нажатием кто-то мог выписать свой. Поэтому
-- функция только читает и ничего не занимает — врать она может лишь в ту
-- сторону, где номер окажется больше.
create or replace function public.next_receipt_number(p_year integer default null)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  tenant_uuid uuid := public.current_tenant_id();
  settings public.tenants%rowtype;
  target_year integer;
  next_seq integer;
  last_seq integer;
  had_any boolean;
  candidate text;
begin
  -- ПОДСКАЗКА ЧИТАЕТ `tenants` И `receipts` В ОБХОД ИХ ПОЛИТИК (она
  -- `security definer`), поэтому круг у неё тот же, что у самих чеков:
  -- владелец и диспетчер. Иначе мастер с выключенными финансами одним вызовом
  -- узнавал бы префикс компании и точное число выписанных ею чеков за год
  -- (аудит прав 2026-09-20).
  if auth.uid() is null or tenant_uuid is null then
    return null;
  end if;
  if public.current_user_role() not in ('owner', 'dispatcher') then
    return null;
  end if;
  select * into settings from public.tenants where id = tenant_uuid;
  if not found then
    return null;
  end if;
  target_year := coalesce(p_year, extract(year from current_date)::integer);
  if settings.receipt_number_yearly_reset then
    select max(seq) into last_seq
      from public.receipts where tenant_id = tenant_uuid and year = target_year;
  else
    select max(seq) into last_seq
      from public.receipts where tenant_id = tenant_uuid;
  end if;
  -- Та же лестница, что в ядре: планка только у самого первого чека компании.
  select exists (select 1 from public.receipts where tenant_id = tenant_uuid)
    into had_any;
  if last_seq is null and not had_any then
    next_seq := greatest(coalesce(settings.receipt_start_seq, 1), 1);
  else
    next_seq := coalesce(last_seq, 0) + 1;
  end if;

  -- ТОТ ЖЕ ПЕРЕШАГ ЧЕРЕЗ ЗАНЯТЫЕ НОМЕРА, ЧТО И В ЯДРЕ. Показать один номер, а
  -- выписать другой — хуже, чем не показывать вовсе: человек поверит
  -- показанному и станет искать его на бумаге.
  loop
    candidate := public._receipt_number_text(
      settings.receipt_prefix, target_year, next_seq, settings.receipt_number_padding
    );
    exit when not exists (
      select 1 from public.receipts
       where tenant_id = tenant_uuid and number = candidate
    );
    next_seq := next_seq + 1;
    if next_seq > greatest(coalesce(last_seq, 0), coalesce(settings.receipt_start_seq, 1)) + 1000 then
      return null;
    end if;
  end loop;
  return candidate;
end;
$$;

revoke all on function public.next_receipt_number(integer) from public, anon;
grant execute on function public.next_receipt_number(integer) to authenticated;

-- ─── ПОПУТНО: ДЕНЕЖНЫЕ ДВЕРИ ИНВОЙСА ЗАКРЫВАЮТСЯ ОТ `anon` ──────────────
-- Аудит прав 2026-09-20, проверено живьём публичным ключом: `revoke ... from
-- public` НЕ снимает именной грант, который Supabase раздаёт новым функциям
-- ролям `anon, authenticated, service_role`. Три денежные двери инвойса
-- входили в исполнение от имени `anon` и упирались не в свой грант, а в то,
-- что `current_user_role()` случайно оказалась закрыта. Один грант этой
-- функции — и неаутентифицированный вызов дошёл бы до тела.
--
-- Чиню здесь, а не отдельной миграцией: это одна строка на дверь, и держать
-- её открытой лишний день незачем. Чековые двери этот класс не повторяют — у
-- них `from public, anon` с самого начала.
do $close$
declare
  fn text;
begin
  foreach fn in array array[
    'public.record_invoice_payment',
    'public.void_invoice',
    'public.issue_invoice'
  ] loop
    execute format(
      'revoke all on function %s(%s) from anon',
      fn,
      (select pg_get_function_identity_arguments(p.oid)
         from pg_proc p
        where p.oid = to_regproc(fn))
    );
  end loop;
end;
$close$;

-- ─── Проверки после наката ──────────────────────────────────────────────
do $audit$
declare
  door_oid oid;
  core_oid oid;
  dup integer;
begin
  if (select count(*) from pg_proc
       where proname = 'issue_receipt' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'numbering: дверей issue_receipt должно остаться ровно одна';
  end if;
  if (select count(*) from pg_proc
       where proname = '_issue_receipt_core' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'numbering: ядер _issue_receipt_core должно остаться ровно одно';
  end if;
  select p.oid into door_oid from pg_proc p
   where p.proname = 'issue_receipt' and p.pronamespace = 'public'::regnamespace;
  select p.oid into core_oid from pg_proc p
   where p.proname = '_issue_receipt_core' and p.pronamespace = 'public'::regnamespace;
  if has_function_privilege('anon', door_oid, 'EXECUTE') then
    raise exception 'numbering: issue_receipt доступна anon';
  end if;
  if not has_function_privilege('authenticated', door_oid, 'EXECUTE') then
    raise exception 'numbering: issue_receipt недоступна authenticated';
  end if;
  if has_function_privilege('authenticated', core_oid, 'EXECUTE') then
    raise exception 'numbering: ядро исполнимо напрямую authenticated';
  end if;
  if has_function_privilege('anon', 'public.next_receipt_number(integer)', 'EXECUTE') then
    raise exception 'numbering: next_receipt_number доступна anon';
  end if;

  -- Умолчания обязаны повторять зашитый сегодня формат, иначе накат СМЕНИТ
  -- нумерацию у всех молча.
  if exists (
    select 1 from public.tenants
     where receipt_prefix <> 'RC'
        or receipt_number_padding <> 3
        or receipt_number_yearly_reset <> true
        or receipt_start_seq <> 1
  ) then
    raise exception 'numbering: умолчания разошлись с прежним форматом RC-<год>-<NNN>';
  end if;

  -- Двери инвойса закрыты от анонима — проверяем, а не надеемся.
  if has_function_privilege('anon', 'public.void_invoice(uuid)', 'EXECUTE') then
    raise exception 'numbering: void_invoice всё ещё исполнима anon';
  end if;

  -- ФОРМУЛА НОМЕРА ПРОВЕРЯЕТСЯ ЗДЕСЬ, НА НАКАТЕ. Здесь стояла проверка,
  -- повторявшая check-ограничители и ничего не доказывавшая про саму формулу
  -- («сторож, который не падал»). Теперь проверяется то, что действительно
  -- ломалось: обрезание справа и умолчания.
  if public._receipt_number_text('RC', 2026, 1000, 3) <> 'RC-2026-1000' then
    raise exception 'numbering: широкий номер обрезается — на бумаге встанет не тот';
  end if;
  if public._receipt_number_text('RC', 2026, 7, 3) <> 'RC-2026-007' then
    raise exception 'numbering: узкий номер не дополняется нулями';
  end if;
  if public._receipt_number_text('  ', 2026, 7, null) <> 'RC-2026-007' then
    raise exception 'numbering: пустой префикс не падает на RC';
  end if;

  -- Индекс уникальности номера обязан существовать ДО первого ручного ввода.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'receipts'
       and indexname = 'ux_receipts_number_text'
  ) then
    raise exception 'numbering: нет уникальности номера — ручной ввод создаст двойников';
  end if;
  select count(*) into dup from (
    select tenant_id, number from public.receipts group by 1, 2 having count(*) > 1
  ) d;
  if dup > 0 then
    raise exception 'numbering: в базе уже % повторяющихся номеров', dup;
  end if;
end;
$audit$;
