-- «УДАЛЁННЫЕ ОПЕРАЦИИ» (владелец 03.10: «да, удалённые операции добавляем —
-- это отлично»; дверь — шестерёнка «Финансов», блок «Деньги»).
--
-- Удалённая операция 30 дней лежит в «Удалённых операциях» и возвращается
-- оттуда кнопкой «Вернуть» — как счёт и клиент.
--
-- УСТРОЙСТВО — ЯЩИК, А НЕ ПОМЕТКА НА СТРОКЕ. Операцию читают лента, остатки
-- счетов, аналитика, выгрузка, сторож закрытия счёта, итоги долгов и
-- инвойсов — десятки мест в клиенте и на сервере. Пометка `deleted_at` на
-- строке `finance_transactions` обязала бы каждое из них не считать
-- помеченное, и одно забытое место молча вернуло бы удалённые деньги в
-- остаток. Поэтому операция удаляется по-настоящему (все прежние триггеры
-- отрабатывают как раньше), а её снимок целиком уходит в отдельную таблицу
-- `deleted_operations`. «Вернуть» вставляет снимок обратно с тем же id.
--
--   1. В ящик попадает только то, что человек удалил сам, — через
--      `delete_operation(p_id)` (правила прежнего `.delete()` клиента: ручная
--      операция, не перевод, без инвойса; права — те же политики удаления,
--      функция исполняется от лица звонящего). Флаг транзакции
--      `babun.operation_trash` отличает такое удаление от стирания календаря
--      (`delete_calendar`), отмены перевода и каскада удалённой компании —
--      их строки в ящик не идут. Переводы не входят: у перевода своя отмена
--      с квитанцией запроса (`delete_account_transfer`).
--   2. «Вернуть» (`restore_deleted_operation`) — тоже от лица звонящего:
--      вставка проходит политики создания операции и все сторожа вставки
--      (дата, тариф, целостность, VAT). Ссылки, исчезнувшие за время в ящике,
--      ведут себя как у живой операции (`on delete set null`): категория,
--      клиент, запись, долг. Счёт — нет: операция без своего счёта меняет
--      остатки, поэтому удалённый или стёртый счёт сначала возвращают
--      (`hint = 'operation:account_deleted'`).
--   3. Видит ящик и стирает из него насовсем: владелец — всё в своей
--      компании; партнёр — то, что удалил сам, и только в командах, где у
--      него и сейчас «меняет» на этот вид денег.
--   4. Через 30 дней снимок стирает `purge_deleted_operations()` (pg_cron,
--      03:47, после клиентов в 03:17 и счетов в 03:37).

set local lock_timeout = '5s';

-- ─── 1. Ящик ───

create table public.deleted_operations (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  team_id text not null,
  type text not null,
  operation jsonb not null,
  deleted_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz not null default now(),
  purge_at timestamptz not null
);

comment on table public.deleted_operations is
  '«Удалённые операции»: снимок удалённой ручной операции (to_jsonb строки finance_transactions), 30 дней до стирания.';
comment on column public.deleted_operations.operation is
  'Строка finance_transactions на момент удаления; «Вернуть» вставляет её обратно с тем же id.';

create index deleted_operations_team_idx
  on public.deleted_operations (tenant_id, team_id, deleted_at desc);
create index deleted_operations_purge_idx
  on public.deleted_operations (purge_at);

alter table public.deleted_operations enable row level security;

-- Пишет в ящик только триггер (definer). Снаружи — чтение и «удалить
-- насовсем», и то по политикам ниже.
revoke all on table public.deleted_operations from anon, authenticated;
grant select, delete on table public.deleted_operations to authenticated;

-- Владелец — всё; партнёр — своё и только там, где сейчас «меняет» этот вид
-- денег (доступ сняли — снимок ушёл из виду вместе с ним). Каждая ветка со
-- скалярным подзапросом: помощник прав считается раз на запрос, а не на
-- строку.
create policy deleted_operations_select on public.deleted_operations
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or (
        deleted_by = (select auth.uid())
        and (
          (operation->>'debt_id' is null and type = 'income'
            and team_id in (select unnest(public.access_calendars('finance.income', 'write'))))
          or (operation->>'debt_id' is null and type = 'expense'
            and team_id in (select unnest(public.access_calendars('finance.expense', 'write'))))
          or (operation->>'debt_id' is not null
            and team_id in (select unnest(public.access_calendars('finance.debts', 'write'))))
        )
      )
    )
  );

create policy deleted_operations_delete on public.deleted_operations
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or (
        deleted_by = (select auth.uid())
        and (
          (operation->>'debt_id' is null and type = 'income'
            and team_id in (select unnest(public.access_calendars('finance.income', 'write'))))
          or (operation->>'debt_id' is null and type = 'expense'
            and team_id in (select unnest(public.access_calendars('finance.expense', 'write'))))
          or (operation->>'debt_id' is not null
            and team_id in (select unnest(public.access_calendars('finance.debts', 'write'))))
        )
      )
    )
  );

-- ─── 2. Удаление в ящик ───

create function public.trash_deleted_operation()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- Только удаление «Удалить» из приложения (`delete_operation`): стирание
  -- календаря, отмена перевода и каскад компании флага не ставят.
  if coalesce(current_setting('babun.operation_trash', true), '') <> 'on' then
    return old;
  end if;
  insert into public.deleted_operations
    (id, tenant_id, team_id, type, operation, deleted_by, deleted_at, purge_at)
  values
    (old.id, old.tenant_id, old.team_id, old.type, to_jsonb(old), auth.uid(),
     now(), now() + interval '30 days');
  return old;
end;
$function$;

create trigger trg_trash_deleted_operation
  after delete on public.finance_transactions
  for each row execute function public.trash_deleted_operation();

-- Правила — те же, что у прежнего `.delete()` клиента. От лица звонящего:
-- что удалять, решают политики удаления `finance_transactions`.
create function public.delete_operation(p_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $function$
declare
  removed uuid;
begin
  perform set_config('babun.operation_trash', 'on', true);
  delete from public.finance_transactions
   where id = p_id
     and source = 'manual'
     and type <> 'transfer'
     and invoice_id is null
  returning id into removed;
  perform set_config('babun.operation_trash', 'off', true);
  if removed is null then
    raise exception 'Операция недоступна или связана с инвойсом'
      using errcode = 'P0002', hint = 'operation:not_found';
  end if;
  return removed;
end;
$function$;

-- ─── 3. «Вернуть» ───

-- Снимок, готовый к вставке: исчезнувшие ссылки — пусто, как сделал бы
-- `on delete set null` с живой операцией. Проверяет СУЩЕСТВОВАНИЕ, а не
-- видимость: под RLS партнёра чужая категория выглядела бы удалённой и
-- молча слетела бы с операции. Узнать так можно только про id, которые
-- звонящий и так держит в своём снимке.
create function public.deleted_operation_ready(p_operation jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  ready jsonb := p_operation;
  account uuid := nullif(p_operation->>'account_id', '')::uuid;
begin
  if account is not null and not exists (
    select 1 from public.accounts a where a.id = account and a.deleted_at is null
  ) then
    raise exception 'Счёт этой операции удалён — сначала верните его из «Удалённых счетов»'
      using errcode = '23503', hint = 'operation:account_deleted';
  end if;
  if ready->>'category_id' is not null and not exists (
    select 1 from public.finance_categories c where c.id = (ready->>'category_id')::uuid
  ) then
    ready := jsonb_set(ready, '{category_id}', 'null');
  end if;
  if ready->>'client_id' is not null and not exists (
    select 1 from public.clients c where c.id = (ready->>'client_id')::uuid
  ) then
    ready := jsonb_set(ready, '{client_id}', 'null');
  end if;
  if ready->>'appointment_id' is not null and not exists (
    select 1 from public.appointments a where a.id = (ready->>'appointment_id')::uuid
  ) then
    ready := jsonb_set(ready, '{appointment_id}', 'null');
  end if;
  if ready->>'debt_id' is not null and not exists (
    select 1 from public.debts d where d.id = (ready->>'debt_id')::uuid
  ) then
    ready := jsonb_set(ready, '{debt_id}', 'null');
  end if;
  return ready;
end;
$function$;

create function public.restore_deleted_operation(p_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $function$
declare
  trashed public.deleted_operations%rowtype;
begin
  -- Снимок ЗАБИРАЕТСЯ из ящика удалением — под RLS звонящего (чужого он не
  -- найдёт) и без права UPDATE, которого у приложения на ящик нет. Два
  -- «Вернуть» разом не вставят операцию дважды: второе ждёт строку первого и
  -- находит пустоту. Отказ вставки ниже откатывает и это удаление.
  delete from public.deleted_operations
   where id = p_id
  returning * into trashed;
  if not found then
    raise exception 'Операции нет в «Удалённых»'
      using errcode = 'P0002', hint = 'operation:not_in_trash';
  end if;
  -- Вставка — под политиками создания операции и всеми сторожами вставки.
  insert into public.finance_transactions
  select (jsonb_populate_record(
    null::public.finance_transactions,
    public.deleted_operation_ready(trashed.operation)
  )).*;
  return p_id;
end;
$function$;

-- ─── 4. Ночная очистка ───

create function public.purge_deleted_operations()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  removed integer;
begin
  delete from public.deleted_operations where purge_at <= now();
  get diagnostics removed = row_count;
  return removed;
end;
$function$;

comment on function public.purge_deleted_operations() is
  'Ночная очистка «Удалённых операций»: стирает снимки, чей срок вышел. Только для pg_cron.';

select cron.schedule(
  'purge-deleted-operations',
  '47 3 * * *',
  $$select public.purge_deleted_operations();$$
);

-- ─── 5. Права исполнения ───

revoke all on function public.trash_deleted_operation() from public, anon, authenticated;
revoke all on function public.purge_deleted_operations() from public, anon, authenticated;
revoke all on function public.delete_operation(uuid) from public, anon;
revoke all on function public.restore_deleted_operation(uuid) from public, anon;
revoke all on function public.deleted_operation_ready(jsonb) from public, anon;
grant execute on function public.delete_operation(uuid) to authenticated;
grant execute on function public.restore_deleted_operation(uuid) to authenticated;
-- «Вернуть» исполняется от лица звонящего и зовёт помощника сам.
grant execute on function public.deleted_operation_ready(jsonb) to authenticated;

-- ─── 6. Сторож ───

do $guard$
declare
  entry text;
begin
  foreach entry in array array[
    'public.trash_deleted_operation()', 'public.purge_deleted_operations()'
  ] loop
    if has_function_privilege('anon', entry, 'execute')
       or has_function_privilege('authenticated', entry, 'execute') then
      raise exception 'сторож: служебная % исполнима снаружи', entry;
    end if;
  end loop;

  foreach entry in array array[
    'public.delete_operation(uuid)', 'public.restore_deleted_operation(uuid)',
    'public.deleted_operation_ready(jsonb)'
  ] loop
    if has_function_privilege('anon', entry, 'execute') then
      raise exception 'сторож: % исполнима без входа', entry;
    end if;
    if not has_function_privilege('authenticated', entry, 'execute') then
      raise exception 'сторож: % закрыта для приложения', entry;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.deleted_operations', 'select')
     or has_table_privilege('authenticated', 'public.deleted_operations', 'insert')
     or has_table_privilege('authenticated', 'public.deleted_operations', 'update') then
    raise exception 'сторож: ящик операций пишется снаружи';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.finance_transactions'::regclass
       and tgname = 'trg_trash_deleted_operation'
       and tgenabled = 'O'
  ) then
    raise exception 'сторож: триггер «Удалённых операций» не включён';
  end if;

  if not exists (
    select 1 from cron.job
     where jobname = 'purge-deleted-operations'
       and schedule = '47 3 * * *'
       and command = 'select public.purge_deleted_operations();'
  ) then
    raise exception 'сторож: ночная очистка операций не запланирована';
  end if;
end
$guard$;
