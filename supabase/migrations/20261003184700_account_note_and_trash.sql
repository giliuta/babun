-- ЛИСТ СЧЁТА: «ЗАМЕТКА» И «УДАЛЁННЫЕ СЧЕТА» (владелец 03.10).
--
-- «Я должен свайпом вправо удалять счета, они попадают в папку „Удалённые
-- счета" на 30 дней, как клиенты».
--
--   1. «Удалённые счета» — как «Удалённые клиенты». Свайп «Удалить» ставит
--      `deleted_at`; счёт уходит в «Удалённые счета» и восстанавливается
--      оттуда. Правила держит триггер `accounts_trash_rules`, а не экран:
--      • удалить можно только счёт с нулевым остатком (формула сторожа
--        закрытия); удаление само закрывает счёт (`is_active = false`) и
--        снимает «основной» — оплаты, переводы и все пикеры уже обходят
--        закрытые счета. Ограничение `accounts_deleted_is_closed` держит это
--        в базе: удалённый счёт открыть нельзя, только восстановить;
--      • время удаления ставит сервер (`now()`), срок стирания — тоже: счёт
--        БЕЗ истории сотрётся через 30 дней (`purge_at`), счёт С историей
--        (операции, чеки, оплаты записей, инвойсы — `account_has_history`)
--        лежит в «Удалённых» без срока — с историей не стирается, как клиент;
--      • «Восстановить» (`deleted_at = null`) возвращает обычный открытый
--        счёт; срок снимается;
--      • у удалённого счёта не меняется начальный остаток.
--      Кто: те же, кто правит счёт (`accounts_owner_all`,
--      `accounts_update_calendar` — «Счета: Видит и меняет» в его команде).
--      Стирает `purge_expired_accounts()` ночью (pg_cron, 03:37, после
--      клиентов в 03:17); функция — только для планировщика и ещё раз
--      проверяет историю. Имя удалённого счёта не занято: уникальность имени
--      в команде (`ux_accounts_team_name`) — среди неудалённых; восстановить
--      счёт при живом тёзке нельзя, база ответит дублем имени.
--   2. «Заметка» счёта — `accounts.note`: IBAN, последние цифры карты; до
--      500 знаков, без умолчания. Пишут её те же, кто правит счёт.
--
-- «СВЕРИТЬ ОСТАТОК» ЗДЕСЬ НАМЕРЕННО НЕТ: владелец 30.09 убрал пересчёт кассы
-- («не требуется, убери»), и поправка остатка — та же сверка под другим
-- именем.

set local lock_timeout = '5s';

-- ─── 0. Уникальность имени — как прочитана 03.10 ───

do $pre$
begin
  if (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'ux_accounts_team_name')
     is distinct from 'CREATE UNIQUE INDEX ux_accounts_team_name ON public.accounts USING btree (tenant_id, brigade_id, name) WHERE (scope = ''team''::text)' then
    raise exception 'уникальность имени счёта изменилась после чтения 03.10';
  end if;
end
$pre$;

-- ─── 1. Заметка и «Удалённые счета» ───

-- Без умолчаний: ни одной прошлой строке ничего не прошивается.
alter table public.accounts add column if not exists note text;
alter table public.accounts add column if not exists deleted_at timestamptz;
alter table public.accounts add column if not exists purge_at timestamptz;

alter table public.accounts
  add constraint accounts_note_length
  check (note is null or char_length(note) <= 500);

alter table public.accounts
  add constraint accounts_deleted_is_closed
  check (deleted_at is null or is_active = false);

alter table public.accounts
  add constraint accounts_purge_needs_deleted
  check (purge_at is null or deleted_at is not null);

comment on column public.accounts.note is
  'Заметка счёта (IBAN, последние цифры карты) — свободный текст до 500 знаков.';
comment on column public.accounts.deleted_at is
  'Когда счёт ушёл в «Удалённые счета» (ставит сервер). Удалённый счёт всегда закрыт и с нулевым остатком.';
comment on column public.accounts.purge_at is
  'Когда удалённый счёт без истории сотрётся (deleted_at + 30 дней). Пусто у счёта с историей — он не стирается.';

-- Имя удалённого счёта свободно: тёзка заводится, восстановление при живом
-- тёзке отвечает дублем имени.
drop index public.ux_accounts_team_name;
create unique index ux_accounts_team_name
  on public.accounts (tenant_id, brigade_id, name)
  where scope = 'team' and deleted_at is null;

-- История счёта — то, что не даёт его стереть: операции, чеки, оплаты
-- записей (как `guard_account_delete_with_history`) и инвойсы, где счёт
-- напечатан для оплаты (их ссылка `on delete set null` молча стёрла бы его
-- с документа). Читается мимо RLS удаляющего.
create function public.account_has_history(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (select 1 from public.finance_transactions f where f.account_id = p_account_id)
      or exists (select 1 from public.receipts r where r.account_id = p_account_id)
      or exists (select 1 from public.appointments a where a.payment_account_id = p_account_id)
      or exists (select 1 from public.invoices i where i.account_id = p_account_id);
$function$;

create function public.account_trash_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  ledger_balance numeric(14,2);
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is not null or new.purge_at is not null then
      raise exception 'Новый счёт не бывает удалённым'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    -- Удаление: только с нулём на счёте — формула сторожа закрытия.
    select round(
      new.opening_balance + coalesce(sum(
        case
          when t.type = 'expense' then -t.amount
          when t.type = 'refund' then -abs(t.amount)
          else t.amount
        end
      ), 0),
      2
    ) into ledger_balance
    from public.finance_transactions t
    where t.account_id = old.id;
    if ledger_balance <> 0 then
      raise exception 'Счёт с остатком % нельзя удалить; сначала обнулите его', ledger_balance
        using errcode = '23514', hint = 'account:balance';
    end if;
    new.deleted_at := now();
    new.is_active := false;
    new.is_primary := false;
  elsif old.deleted_at is not null and new.deleted_at is null then
    -- «Восстановить»: обычный открытый счёт, срок снят.
    new.is_active := true;
    new.purge_at := null;
    return new;
  elsif old.deleted_at is not null then
    -- Всё ещё в «Удалённых»: время удаления не переписывается, остаток —
    -- ноль, открыть можно только восстановлением.
    new.deleted_at := old.deleted_at;
    if new.is_active then
      raise exception 'Удалённый счёт сначала восстановите'
        using errcode = '23514', hint = 'account:deleted';
    end if;
    if new.opening_balance is distinct from old.opening_balance then
      raise exception 'Удалённый счёт сначала восстановите'
        using errcode = '23514', hint = 'account:deleted';
    end if;
  else
    -- Не удалён — срока стирания не бывает.
    new.purge_at := null;
    return new;
  end if;

  new.purge_at := case
    when public.account_has_history(new.id) then null
    else new.deleted_at + interval '30 days'
  end;
  return new;
end;
$function$;

drop trigger if exists accounts_trash_rules on public.accounts;
create trigger accounts_trash_rules
  before insert or update on public.accounts
  for each row execute function public.account_trash_rules();

-- Ночная очистка: стирает удалённые счета без истории, чей срок вышел.
-- История проверяется ещё раз — срок мог остаться от прошлого.
create function public.purge_expired_accounts()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  removed integer;
begin
  delete from public.accounts a
   where a.deleted_at is not null
     and a.purge_at is not null
     and a.purge_at <= now()
     and not public.account_has_history(a.id);
  get diagnostics removed = row_count;
  return removed;
end;
$function$;

-- ─── 2. Права исполнения и расписание ───

revoke all on function public.account_trash_rules() from public, anon, authenticated;
revoke all on function public.account_has_history(uuid) from public, anon, authenticated;
revoke all on function public.purge_expired_accounts() from public, anon, authenticated;

comment on function public.purge_expired_accounts() is
  'Ночная очистка «Удалённых счетов»: стирает счета без истории, чей срок вышел. Только для pg_cron.';

-- Ночью, после клиентов (03:17). Пере-планирование по тому же имени заменяет
-- расписание, а не заводит второе.
select cron.schedule(
  'purge-expired-accounts',
  '37 3 * * *',
  $$select public.purge_expired_accounts();$$
);

-- ─── 3. Сторож ───

do $guard$
declare
  entry text;
begin
  foreach entry in array array[
    'public.account_trash_rules()', 'public.account_has_history(uuid)', 'public.purge_expired_accounts()'
  ] loop
    if has_function_privilege('anon', entry, 'execute')
       or has_function_privilege('authenticated', entry, 'execute') then
      raise exception 'сторож: служебная % исполнима снаружи', entry;
    end if;
  end loop;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.accounts'::regclass
       and tgname = 'accounts_trash_rules'
       and tgenabled = 'O'
  ) then
    raise exception 'сторож: триггер «Удалённых счетов» не включён';
  end if;

  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.accounts'::regclass
       and attname in ('note', 'deleted_at', 'purge_at')
       and (atthasmissing or atthasdef or attnotnull)
  ) or (
    select count(*) from pg_attribute
     where attrelid = 'public.accounts'::regclass
       and attname in ('note', 'deleted_at', 'purge_at')
       and not attisdropped
  ) <> 3 then
    raise exception 'сторож: колонки счёта не такие, как задуманы (умолчание или прошитое значение)';
  end if;

  if exists (select 1 from public.accounts where deleted_at is not null or purge_at is not null) then
    raise exception 'сторож: прошлые счета оказались удалёнными';
  end if;

  if not exists (
    select 1 from cron.job
     where jobname = 'purge-expired-accounts'
       and schedule = '37 3 * * *'
       and command = 'select public.purge_expired_accounts();'
  ) then
    raise exception 'сторож: ночная очистка счетов не запланирована';
  end if;
end
$guard$;
