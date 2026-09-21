-- УДАЛЕНИЕ КАЛЕНДАРЯ УДАЛЯЕТ ЕГО РАБОТУ. КЛИЕНТЫ ОСТАЮТСЯ.
--
-- Владелец 2026-09-21: «если идёт удаление календаря, то удаляется сразу и
-- записи, и сразу удаляется финансы… но клиенты, которые когда-то были
-- записаны в базу, они остаются».
--
-- До сегодня удаление было МЯГКИМ (`is_active = false`), и три сторожа в базе
-- прямо говорили обратное закону владельца: «У команды есть история… такую
-- команду выключают, а не удаляют». Закон сменился — значит сторожа должны
-- узнать про ОДИН законный случай, а не быть снесёнными.
--
-- КАК УСТРОЕН ПРОПУСК. Ровно как у денежных операций (`_finance_write_context`,
-- живёт с весны): на время ОДНОЙ транзакции в служебной таблице появляется
-- строка с её `txid_current()`, и сторожа в этой транзакции молчат. Строку
-- кладёт единственная дверь — `delete_calendar`, и только владельцу компании.
-- Никакая другая транзакция такой строки иметь не может: `txid` у каждой свой,
-- а таблица закрыта от `anon` и `authenticated` вовсе.
--
-- ТЕЛА СТОРОЖЕЙ НЕ ТРОНУТЫ ВООБЩЕ. Пропуск висит условием на самих триггерах:
-- `when (not public.calendar_delete_in_progress())`. В обычной жизни условие
-- истинно, и каждый сторож работает ровно как работал — байт в байт. Переписать
-- `assert_finance_transaction_integrity` (три сотни строк, весь денежный
-- контроль продукта) ради одной ветки было бы опаснее самой задачи.
--
-- ДОКУМЕНТЫ НЕ УДАЛЯЮТСЯ, А АННУЛИРУЮТСЯ. Номер инвойса — юридическая
-- последовательность, и база уже это знает: `prevent_settled_invoice_delete`
-- отвечает «Инвойс нельзя удалить; аннулируйте документ». Дыра в нумерации
-- хуже, чем документ со штампом «аннулирован», поэтому инвойсы и чеки
-- удалённого календаря получают `status = 'void'`, а их деньги уходят вместе
-- со счетами. Это единственное место, где «удаляется всё» читается как
-- «гасится»: так требует бумага, а не удобство.
--
-- ЧТО ОСТАЁТСЯ ЖИТЬ: клиенты (слово владельца), мастера как люди (теряют лишь
-- ссылку на календарь), документы в статусе «аннулирован», операции на ОБЩИХ
-- счетах компании — у них лишь пропадает пометка команды. Ни один уцелевший
-- счёт не меняет свой остаток: удаляются только операции на счетах САМОГО
-- календаря.

begin;

set local lock_timeout = '5s';

-- ─── Пропуск на одну транзакцию ──────────────────────────────────────────
create table if not exists public._calendar_delete_context (
  transaction_id bigint primary key,
  tenant_id uuid not null,
  team_id text not null,
  started_at timestamptz not null default now()
);

comment on table public._calendar_delete_context is
  'Пропуск сторожам на время удаления календаря. Строку кладёт только delete_calendar, живёт она внутри своей транзакции.';

-- Как у `_finance_write_context`: RLS включён, политик нет, грантов наружу нет.
-- Таблицу видит только владелец базы, то есть SECURITY DEFINER функции.
alter table public._calendar_delete_context enable row level security;
revoke all on table public._calendar_delete_context from public, anon, authenticated;

create or replace function public.calendar_delete_in_progress()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public._calendar_delete_context
     where transaction_id = txid_current()
  );
$$;

comment on function public.calendar_delete_in_progress() is
  'Идёт ли в ЭТОЙ транзакции удаление календаря. Читают условия триггеров-сторожей.';

-- Условие триггера считается от имени вызывающего, поэтому право на чтение
-- флага нужно обычной роли. Ничего кроме «да/нет про мою же транзакцию» она
-- не узнаёт.
grant execute on function public.calendar_delete_in_progress() to authenticated, service_role;

-- ─── Сторожа узнают про законный случай ──────────────────────────────────
-- Определения взяты из `pg_get_triggerdef` живой базы и повторены дословно;
-- добавлено ровно одно условие. Имена сохранены: триггеры одной таблицы
-- срабатывают по алфавиту, и переименование сменило бы порядок.

drop trigger if exists trg_guard_team_delete_history on public.teams;
create trigger trg_guard_team_delete_history
  before delete on public.teams
  for each row
  when (not public.calendar_delete_in_progress())
  execute function guard_team_delete_with_history();

drop trigger if exists trg_guard_account_delete on public.accounts;
create trigger trg_guard_account_delete
  before delete on public.accounts
  for each row
  when (not public.calendar_delete_in_progress())
  execute function guard_account_delete_with_history();

drop trigger if exists trg_guard_appointment_history_delete on public.appointments;
create trigger trg_guard_appointment_history_delete
  before delete on public.appointments
  for each row
  when (not public.calendar_delete_in_progress())
  execute function guard_appointment_history_delete();

drop trigger if exists trg_assert_finance_transaction_integrity on public.finance_transactions;
create trigger trg_assert_finance_transaction_integrity
  before insert or delete or update on public.finance_transactions
  for each row
  when (not public.calendar_delete_in_progress())
  execute function assert_finance_transaction_integrity();

drop trigger if exists trg_guard_cash_count_transaction_write on public.finance_transactions;
create trigger trg_guard_cash_count_transaction_write
  before delete or update on public.finance_transactions
  for each row
  when (not public.calendar_delete_in_progress())
  execute function guard_cash_count_transaction_delete();

drop trigger if exists trg_protect_invoice_payment_row on public.finance_transactions;
create trigger trg_protect_invoice_payment_row
  before delete or update on public.finance_transactions
  for each row
  when (not public.calendar_delete_in_progress())
  execute function protect_invoice_payment_row();

-- Инвойс гасится ДО того, как исчезнут его платежи: иначе сторож правки
-- справедливо не даст оплаченному документу стать неоплаченным («архивный
-- оплаченный инвойс нельзя изменить без журнала платежей»).
drop trigger if exists trg_prevent_settled_invoice_rewrite on public.invoices;
create trigger trg_prevent_settled_invoice_rewrite
  before update on public.invoices
  for each row
  when (not public.calendar_delete_in_progress())
  execute function prevent_settled_invoice_rewrite();

-- ВОСЬМОЙ СТОРОЖ НАШЁЛСЯ СУХИМ ПРОГОНОМ, А НЕ ГОЛОВОЙ. Удаление записи само
-- по себе обнуляет `invoices.appointment_id` (внешний ключ `on delete set
-- null`), это правка инвойса — и снимок сторон справедливо отвечает «Снимки
-- сторон инвойса неизменяемы после первого платежа». Пересчитывать снимок
-- аннулированному документу и не нужно: он заморожен вместе со своей бумагой.
drop trigger if exists trg_capture_invoice_document_snapshots on public.invoices;
create trigger trg_capture_invoice_document_snapshots
  before insert or update on public.invoices
  for each row
  when (not public.calendar_delete_in_progress())
  execute function capture_invoice_document_snapshots();

-- ─── Сама дверь ──────────────────────────────────────────────────────────
create or replace function public.delete_calendar(p_team_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_team public.teams%rowtype;
  v_live integer;
  v_accounts uuid[];
  n_appointments integer := 0;
  n_accounts integer := 0;
  n_operations integer := 0;
  n_services integer := 0;
  n_documents integer := 0;
begin
  if v_tenant is null then
    raise exception 'Компания не определена';
  end if;
  if public.current_user_role() is distinct from 'owner' then
    raise exception 'Удалить календарь может только владелец';
  end if;

  select * into v_team
    from public.teams
   where id = p_team_id and tenant_id = v_tenant
   for update;
  if not found then
    raise exception 'Календарь не найден';
  end if;

  -- ПОСЛЕДНИЙ ЖИВОЙ КАЛЕНДАРЬ УДАЛИТЬ НЕЛЬЗЯ: без него продукту некуда писать
  -- запись, а в ленте не остаётся даже чипа. Экран говорит то же самое, но
  -- дверь обязана держаться сама.
  select count(*) into v_live
    from public.teams
   where tenant_id = v_tenant and is_active and id <> p_team_id;
  if v_live = 0 and v_team.is_active then
    raise exception 'Последний календарь удалить нельзя';
  end if;

  insert into public._calendar_delete_context (transaction_id, tenant_id, team_id)
  values (txid_current(), v_tenant, p_team_id)
  on conflict (transaction_id) do update
    set tenant_id = excluded.tenant_id,
        team_id = excluded.team_id,
        started_at = now();

  select coalesce(array_agg(id), '{}') into v_accounts
    from public.accounts
   where tenant_id = v_tenant and brigade_id = p_team_id;

  -- 1. ДОКУМЕНТЫ — ШТАМП «АННУЛИРОВАН», А НЕ УДАЛЕНИЕ (см. шапку).
  update public.invoices
     set status = 'void'
   where tenant_id = v_tenant
     and brigade_id = p_team_id
     and status <> 'void';
  get diagnostics n_documents = row_count;

  update public.receipts
     set status = 'void'
   where tenant_id = v_tenant
     and status <> 'void'
     and (
       account_id = any (v_accounts)
       or transaction_id in (
         select id from public.finance_transactions
          where tenant_id = v_tenant and account_id = any (v_accounts)
       )
       or appointment_id in (
         select id from public.appointments
          where tenant_id = v_tenant and team_id = p_team_id
       )
     );

  -- 2. ДЕНЬГИ КАЛЕНДАРЯ. Сверки кассы уходят первыми: без них операцию держит
  -- ссылка `account_cash_counts.transaction_id` (on delete restrict).
  delete from public.account_cash_counts
   where account_id = any (v_accounts);

  delete from public.finance_transactions
   where tenant_id = v_tenant and account_id = any (v_accounts);
  get diagnostics n_operations = row_count;

  -- ОПЕРАЦИЯ НА ОБЩЕМ СЧЕТЕ КОМПАНИИ ОСТАЁТСЯ — уходит только пометка
  -- удалённой команды. Иначе удаление календаря меняло бы остаток живого
  -- счёта, к которому он отношения не имеет.
  update public.finance_transactions
     set team_id = null
   where tenant_id = v_tenant and team_id = p_team_id;

  delete from public.accounts
   where tenant_id = v_tenant and brigade_id = p_team_id;
  get diagnostics n_accounts = row_count;

  -- 3. РАБОТА КАЛЕНДАРЯ.
  delete from public.appointments
   where tenant_id = v_tenant and team_id = p_team_id;
  get diagnostics n_appointments = row_count;

  -- 4. ХВОСТЫ КАЛЕНДАРЯ. Люди не удаляются — теряют только ссылку на него.
  update public.masters set team_id = null
   where tenant_id = v_tenant and team_id = p_team_id;
  update public.finance_templates set brigade_id = null
   where tenant_id = v_tenant and brigade_id = p_team_id;
  update public.debts set team_id = null
   where tenant_id = v_tenant and team_id = p_team_id;

  delete from public.finance_transfer_requests
   where tenant_id = v_tenant and team_id = p_team_id;
  delete from public.account_teams where team_id = p_team_id;
  delete from public.member_access
   where tenant_id = v_tenant and team_id = p_team_id;
  delete from public.team_finance_settings
   where tenant_id = v_tenant and team_id = p_team_id;
  delete from public.team_schedules
   where tenant_id = v_tenant and team_id = p_team_id;
  delete from public.day_cities
   where tenant_id = v_tenant and team_id = p_team_id;
  delete from public.day_extras
   where tenant_id = v_tenant and team_id = p_team_id;
  delete from public.recurring_reminders
   where tenant_id = v_tenant and team_id = p_team_id;

  -- Прайс команды уходит с командой: обычно это делает сам сторож удаления,
  -- но в этой транзакции он молчит, а `services.team_id` держит ссылка
  -- `on delete restrict`.
  delete from public.services
   where tenant_id = v_tenant and team_id = p_team_id;
  get diagnostics n_services = row_count;

  -- 5. САМ КАЛЕНДАРЬ. Города, метки, членства и приглашения уходят каскадом.
  delete from public.teams
   where id = p_team_id and tenant_id = v_tenant;

  delete from public._calendar_delete_context
   where transaction_id = txid_current();

  return jsonb_build_object(
    'team_id', p_team_id,
    'name', v_team.name,
    'appointments', n_appointments,
    'accounts', n_accounts,
    'operations', n_operations,
    'services', n_services,
    'documents_voided', n_documents
  );
end;
$$;

comment on function public.delete_calendar(text) is
  'Удаляет календарь вместе с его записями, счетами, операциями и прайсом. Клиенты и мастера остаются, документы аннулируются. Только владелец.';

revoke all on function public.delete_calendar(text) from public, anon;
grant execute on function public.delete_calendar(text) to authenticated;

-- ─── Сторож самой миграции ───────────────────────────────────────────────
do $audit$
declare
  n integer;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'delete_calendar';
  if n <> 1 then raise exception 'Дверь удаления должна быть ровно одна, нашлось %', n; end if;

  -- Каждый из восьми сторожей обязан остаться на месте И получить условие.
  select count(*) into n
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal
     and t.tgname in (
       'trg_guard_team_delete_history','trg_guard_account_delete',
       'trg_guard_appointment_history_delete','trg_assert_finance_transaction_integrity',
       'trg_guard_cash_count_transaction_write','trg_protect_invoice_payment_row',
       'trg_prevent_settled_invoice_rewrite','trg_capture_invoice_document_snapshots')
     and pg_get_triggerdef(t.oid) like '%calendar_delete_in_progress%';
  if n <> 8 then raise exception 'Условие пропуска стоит у % сторожей из 8', n; end if;

  if (select count(*) from public._calendar_delete_context) <> 0 then
    raise exception 'Пропуск не должен переживать транзакцию';
  end if;

  if has_table_privilege('authenticated', 'public._calendar_delete_context', 'select') then
    raise exception 'Таблица пропуска не должна быть видна приложению';
  end if;
end
$audit$;

commit;
