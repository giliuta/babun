-- Server-authoritative operational settings for the native CRM.
-- The 14-digit prefix is a unique Supabase CLI migration version.
--
-- 1. Day closure is an owner-only, cents-based ledger snapshot. The expected
--    physical cash is derived from every cash account's opening balance plus
--    the signed canonical ledger movements through the business date.
-- 2. An active closure makes the corresponding ledger history immutable until
--    the owner explicitly reopens the day.
-- 3. Client object/location labels become tenant-scoped server data. Explicit
--    removals are soft-retained; stale snapshots never delete concurrent rows.

begin;

-- ---------------------------------------------------------------------------
-- Day closures

create table if not exists public.day_closures (
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  business_date      date not null,
  is_closed          boolean not null default true,
  expected_cash_cents bigint not null,
  actual_cash_cents   bigint not null,
  delta_cash_cents    bigint not null,
  currency            text not null default 'EUR',
  closed_at           timestamptz not null default now(),
  closed_by           uuid references auth.users(id) on delete set null,
  reopened_at         timestamptz,
  reopened_by         uuid references auth.users(id) on delete set null,
  revision            integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (tenant_id, business_date),
  constraint day_closures_actual_nonnegative check (actual_cash_cents >= 0),
  constraint day_closures_delta_exact
    check (delta_cash_cents = actual_cash_cents - expected_cash_cents),
  constraint day_closures_currency_eur check (currency = 'EUR'),
  constraint day_closures_revision_positive check (revision > 0),
  constraint day_closures_reopen_state check (
    (is_closed and reopened_at is null and reopened_by is null)
    or
    (not is_closed and reopened_at is not null)
  )
);

create index if not exists idx_day_closures_tenant_active_date
  on public.day_closures (tenant_id, business_date desc)
  where is_closed;

alter table public.day_closures enable row level security;
alter table public.day_closures force row level security;

drop policy if exists day_closures_owner_read on public.day_closures;
create policy day_closures_owner_read on public.day_closures
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

revoke all on table public.day_closures from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.day_closures from authenticated;
grant select on table public.day_closures to authenticated;

-- Keep the money calculation in one closed helper so the preview and the
-- committed snapshot can never diverge. Transfer legs are already signed;
-- refunds may be stored either positive or negative, so always subtract abs.
create or replace function public.tenant_cash_ledger_cents(
  p_tenant_id uuid,
  p_as_of_date date
)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  tenant_timezone text;
  ledger_cents bigint;
begin
  select cs.timezone into tenant_timezone
    from public.calendar_settings cs
   where cs.tenant_id = p_tenant_id;
  tenant_timezone := coalesce(nullif(btrim(tenant_timezone), ''), 'Europe/Nicosia');
  begin
    perform current_timestamp at time zone tenant_timezone;
  exception when invalid_parameter_value then
    tenant_timezone := 'Europe/Nicosia';
  end;

  select
    coalesce((
      select sum(round(a.opening_balance * 100)::bigint)
        from public.accounts a
       where a.tenant_id = p_tenant_id
         and a.kind = 'cash'
         and (a.created_at at time zone tenant_timezone)::date <= p_as_of_date
    ), 0)::bigint
    +
    coalesce((
      select sum(
        round(
          case
            when tx.type = 'expense' then -abs(tx.amount)
            when tx.type = 'refund' then -abs(tx.amount)
            else tx.amount
          end * 100
        )::bigint
      )
        from public.finance_transactions tx
        join public.accounts a
          on a.id = tx.account_id
         and a.tenant_id = tx.tenant_id
       where tx.tenant_id = p_tenant_id
         and a.kind = 'cash'
         and tx.occurred_on <= p_as_of_date
    ), 0)::bigint
    into ledger_cents;

  return coalesce(ledger_cents, 0);
end;
$function$;

revoke all on function public.tenant_cash_ledger_cents(uuid, date)
  from public, anon, authenticated;

create or replace function public.tenant_business_date(p_tenant_id uuid)
returns date
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  tenant_timezone text;
begin
  select cs.timezone into tenant_timezone
    from public.calendar_settings cs
   where cs.tenant_id = p_tenant_id;
  tenant_timezone := coalesce(nullif(btrim(tenant_timezone), ''), 'Europe/Nicosia');
  begin
    return (current_timestamp at time zone tenant_timezone)::date;
  exception when invalid_parameter_value then
    return (current_timestamp at time zone 'Europe/Nicosia')::date;
  end;
end;
$function$;

revoke all on function public.tenant_business_date(uuid)
  from public, anon, authenticated;

create or replace function public.read_day_closure(p_business_date date)
returns table (
  tenant_id uuid,
  business_date date,
  is_closed boolean,
  expected_cash_cents bigint,
  actual_cash_cents bigint,
  delta_cash_cents bigint,
  currency text,
  closed_at timestamptz,
  closed_by uuid,
  reopened_at timestamptz,
  reopened_by uuid,
  revision integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
begin
  if auth.uid() is null
     or tenant_uuid is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'Закрытие дня доступно только владельцу';
  end if;
  if p_business_date is null then
    raise exception 'Не удалось определить дату закрытия';
  end if;
  if p_business_date > public.tenant_business_date(tenant_uuid) then
    raise exception 'Нельзя закрыть будущую дату';
  end if;

  return query
    select c.tenant_id, c.business_date, c.is_closed,
           case when c.is_closed then c.expected_cash_cents
                else public.tenant_cash_ledger_cents(tenant_uuid, p_business_date)
            end,
           case when c.is_closed then c.actual_cash_cents else null::bigint end,
           case when c.is_closed then c.delta_cash_cents else null::bigint end,
           c.currency, c.closed_at, c.closed_by, c.reopened_at,
           c.reopened_by, c.revision, c.created_at, c.updated_at
      from public.day_closures c
     where c.tenant_id = tenant_uuid
       and c.business_date = p_business_date;

  if not found then
    return query
      select tenant_uuid, p_business_date, false,
             public.tenant_cash_ledger_cents(tenant_uuid, p_business_date),
             null::bigint, null::bigint, 'EUR'::text,
             null::timestamptz, null::uuid, null::timestamptz, null::uuid,
             0, null::timestamptz, null::timestamptz;
  end if;
end;
$function$;

revoke all on function public.read_day_closure(date) from public, anon;
grant execute on function public.read_day_closure(date) to authenticated;

create or replace function public.close_business_day(
  p_business_date date,
  p_actual_cash_cents bigint
)
returns setof public.day_closures
language plpgsql
security definer
set search_path = public
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  existing_row public.day_closures%rowtype;
  expected_cents bigint;
begin
  if auth.uid() is null
     or tenant_uuid is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'Закрыть день может только владелец';
  end if;
  if p_business_date is null then
    raise exception 'Не удалось определить дату закрытия';
  end if;
  if p_business_date > public.tenant_business_date(tenant_uuid) then
    raise exception 'Нельзя закрыть будущую дату';
  end if;
  if p_actual_cash_cents is null or p_actual_cash_cents < 0 then
    raise exception 'Фактическая сумма кассы не может быть отрицательной';
  end if;
  if p_actual_cash_cents > 9000000000000000 then
    raise exception 'Фактическая сумма кассы слишком велика';
  end if;

  -- The finance write guard takes the same tenant-level lock. This makes the
  -- balance snapshot atomic with every ledger INSERT/UPDATE/DELETE.
  perform pg_advisory_xact_lock(
    hashtextextended(tenant_uuid::text || ':day-closure-ledger', 0)
  );

  select * into existing_row
    from public.day_closures
   where day_closures.tenant_id = tenant_uuid
     and day_closures.business_date = p_business_date
   for update;

  if found and existing_row.is_closed then
    if existing_row.actual_cash_cents <> p_actual_cash_cents then
      raise exception 'День уже закрыт с другой фактической суммой';
    end if;
    return query
      select * from public.day_closures
       where day_closures.tenant_id = tenant_uuid
         and day_closures.business_date = p_business_date;
    return;
  end if;

  expected_cents := public.tenant_cash_ledger_cents(
    tenant_uuid,
    p_business_date
  );

  insert into public.day_closures (
    tenant_id, business_date, is_closed, expected_cash_cents,
    actual_cash_cents, delta_cash_cents, closed_at, closed_by,
    reopened_at, reopened_by, revision
  ) values (
    tenant_uuid, p_business_date, true, expected_cents,
    p_actual_cash_cents, p_actual_cash_cents - expected_cents,
    now(), auth.uid(), null, null,
    coalesce(existing_row.revision, 0) + 1
  )
  on conflict (tenant_id, business_date) do update
    set is_closed = true,
        expected_cash_cents = excluded.expected_cash_cents,
        actual_cash_cents = excluded.actual_cash_cents,
        delta_cash_cents = excluded.delta_cash_cents,
        currency = 'EUR',
        closed_at = excluded.closed_at,
        closed_by = excluded.closed_by,
        reopened_at = null,
        reopened_by = null,
        revision = public.day_closures.revision + 1,
        updated_at = now();

  return query
    select * from public.day_closures
     where day_closures.tenant_id = tenant_uuid
       and day_closures.business_date = p_business_date;
end;
$function$;

revoke all on function public.close_business_day(date, bigint)
  from public, anon;
grant execute on function public.close_business_day(date, bigint)
  to authenticated;

create or replace function public.reopen_business_day(p_business_date date)
returns setof public.day_closures
language plpgsql
security definer
set search_path = public
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  existing_row public.day_closures%rowtype;
begin
  if auth.uid() is null
     or tenant_uuid is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'Открыть день может только владелец';
  end if;
  if p_business_date is null then
    raise exception 'Не удалось определить дату закрытия';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(tenant_uuid::text || ':day-closure-ledger', 0)
  );

  select * into existing_row
    from public.day_closures
   where day_closures.tenant_id = tenant_uuid
     and day_closures.business_date = p_business_date
   for update;

  if not found then
    raise exception 'Этот день ещё не закрыт';
  end if;

  if existing_row.is_closed then
    update public.day_closures
       set is_closed = false,
           reopened_at = now(),
           reopened_by = auth.uid(),
           updated_at = now()
     where day_closures.tenant_id = tenant_uuid
       and day_closures.business_date = p_business_date;
  end if;

  return query
    select * from public.day_closures
     where day_closures.tenant_id = tenant_uuid
       and day_closures.business_date = p_business_date;
end;
$function$;

revoke all on function public.reopen_business_day(date) from public, anon;
grant execute on function public.reopen_business_day(date) to authenticated;

-- An active close protects every historical ledger row through that date.
-- Tenant deletion is deliberately fail-open: FK cascade must remain usable.
create or replace function public.guard_closed_day_finance_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  tenant_uuid uuid;
  old_date date;
  new_date date;
  business_today date;
  protected_date date;
begin
  tenant_uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  old_date := case when tg_op in ('UPDATE', 'DELETE') then old.occurred_on else null end;
  new_date := case when tg_op in ('INSERT', 'UPDATE') then new.occurred_on else null end;

  -- During ON DELETE CASCADE the parent is already invisible to the child
  -- trigger. Do not turn a recoverable tenant removal into an orphaned half.
  if not exists (select 1 from public.tenants t where t.id = tenant_uuid) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(tenant_uuid::text || ':day-closure-ledger', 0)
  );

  business_today := public.tenant_business_date(tenant_uuid);
  if new_date is not null and new_date > business_today then
    raise exception 'Финансовую операцию нельзя датировать будущим числом';
  end if;

  select max(c.business_date) into protected_date
    from public.day_closures c
   where c.tenant_id = tenant_uuid
     and c.is_closed
     and (
       (old_date is not null and old_date <= c.business_date)
       or
       (new_date is not null and new_date <= c.business_date)
     );

  if protected_date is not null then
    raise exception 'Финансы до % закрыты. Сначала откройте день обратно',
      to_char(protected_date, 'DD.MM.YYYY');
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function public.guard_closed_day_finance_write()
  from public, anon, authenticated;

drop trigger if exists finance_transactions_closed_day_guard
  on public.finance_transactions;
create trigger finance_transactions_closed_day_guard
  before insert or update or delete on public.finance_transactions
  for each row execute function public.guard_closed_day_finance_write();

-- Opening balances are part of the same cash ledger. New zero-balance cash
-- buckets are harmless after a close, but changing/removing an existing cash
-- bucket would rewrite the protected snapshot just as surely as editing a
-- transaction. The same advisory lock keeps account and ledger writes ordered.
create or replace function public.guard_closed_day_account_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  tenant_uuid uuid;
  tenant_timezone text;
  effective_date date;
  protected_date date;
  rewrites_cash_history boolean := false;
begin
  tenant_uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;

  if not exists (select 1 from public.tenants t where t.id = tenant_uuid) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select cs.timezone into tenant_timezone
    from public.calendar_settings cs
   where cs.tenant_id = tenant_uuid;
  tenant_timezone := coalesce(nullif(btrim(tenant_timezone), ''), 'Europe/Nicosia');
  begin
    perform current_timestamp at time zone tenant_timezone;
  exception when invalid_parameter_value then
    tenant_timezone := 'Europe/Nicosia';
  end;

  if tg_op = 'INSERT' then
    rewrites_cash_history := new.kind = 'cash' and new.opening_balance <> 0;
    effective_date := (new.created_at at time zone tenant_timezone)::date;
  elsif tg_op = 'UPDATE' then
    rewrites_cash_history :=
      (old.kind = 'cash' or new.kind = 'cash')
      and (
        new.opening_balance is distinct from old.opening_balance
        or new.kind is distinct from old.kind
        or new.brigade_id is distinct from old.brigade_id
        or new.created_at is distinct from old.created_at
      );
    effective_date := (
      least(old.created_at, new.created_at) at time zone tenant_timezone
    )::date;
  else
    rewrites_cash_history := old.kind = 'cash';
    effective_date := (old.created_at at time zone tenant_timezone)::date;
  end if;

  if not rewrites_cash_history then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(tenant_uuid::text || ':day-closure-ledger', 0)
  );

  select max(c.business_date) into protected_date
    from public.day_closures c
   where c.tenant_id = tenant_uuid
     and c.is_closed
     and effective_date <= c.business_date;

  if protected_date is not null then
    raise exception 'Касса до % закрыта. Сначала откройте день обратно',
      to_char(protected_date, 'DD.MM.YYYY');
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function public.guard_closed_day_account_write()
  from public, anon, authenticated;

drop trigger if exists accounts_closed_day_guard on public.accounts;
create trigger accounts_closed_day_guard
  before insert or update or delete on public.accounts
  for each row execute function public.guard_closed_day_account_write();

-- ---------------------------------------------------------------------------
-- Client object/location labels

create table if not exists public.location_labels (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  id          text not null,
  name        text not null,
  position    integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  primary key (tenant_id, id),
  constraint location_labels_id_valid
    check (char_length(btrim(id)) between 1 and 160),
  constraint location_labels_name_valid
    check (char_length(btrim(name)) between 1 and 80),
  constraint location_labels_position_nonnegative check (position >= 0)
);

create unique index if not exists ux_location_labels_active_name
  on public.location_labels (tenant_id, lower(btrim(name)))
  where is_active;

create index if not exists idx_location_labels_tenant_position
  on public.location_labels (tenant_id, position, created_at)
  where is_active;

alter table public.location_labels enable row level security;
alter table public.location_labels force row level security;

drop policy if exists location_labels_operational_read on public.location_labels;
create policy location_labels_operational_read on public.location_labels
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher', 'master')
  );

revoke all on table public.location_labels from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.location_labels from authenticated;
grant select on table public.location_labels to authenticated;

create or replace function public.apply_location_label_changes(
  p_labels jsonb,
  p_remove_ids jsonb default '[]'::jsonb
)
returns setof public.location_labels
language plpgsql
security definer
set search_path = public
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  label_count integer;
begin
  if auth.uid() is null
     or tenant_uuid is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'Настраивать типы объектов может только владелец';
  end if;
  if p_labels is null or jsonb_typeof(p_labels) <> 'array' then
    raise exception 'Список типов объектов имеет неверный формат';
  end if;
  if p_remove_ids is null or jsonb_typeof(p_remove_ids) <> 'array' then
    raise exception 'Список удаляемых типов объектов имеет неверный формат';
  end if;

  label_count := jsonb_array_length(p_labels);
  if label_count > 100 then
    raise exception 'Можно сохранить не больше 100 типов объектов';
  end if;
  if jsonb_array_length(p_remove_ids) > 100 then
    raise exception 'Можно удалить не больше 100 типов объектов за один раз';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_labels) item
     where jsonb_typeof(item) is distinct from 'object'
        or jsonb_typeof(item -> 'id') is distinct from 'string'
        or jsonb_typeof(item -> 'name') is distinct from 'string'
        or char_length(btrim(item ->> 'id')) not between 1 and 160
        or char_length(btrim(item ->> 'name')) not between 1 and 80
        or (
          item ? 'position'
          and not (
            jsonb_typeof(item -> 'position') = 'number'
            and (item ->> 'position') ~ '^[0-9]{1,6}$'
          )
        )
  ) then
    raise exception 'Каждый тип объекта должен иметь идентификатор и название';
  end if;
  if (
    select count(distinct btrim(item ->> 'id'))
      from jsonb_array_elements(p_labels) item
  ) <> label_count then
    raise exception 'Идентификаторы типов объектов не должны повторяться';
  end if;
  if (
    select count(distinct lower(btrim(item ->> 'name')))
      from jsonb_array_elements(p_labels) item
  ) <> label_count then
    raise exception 'Названия типов объектов не должны повторяться';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_remove_ids) item
     where jsonb_typeof(item) is distinct from 'string'
        or char_length(btrim(item #>> '{}')) not between 1 and 160
  ) then
    raise exception 'Список удаляемых типов объектов повреждён';
  end if;
  if (
    select count(distinct btrim(item #>> '{}'))
      from jsonb_array_elements(p_remove_ids) item
  ) <> jsonb_array_length(p_remove_ids) then
    raise exception 'Удаляемые типы объектов не должны повторяться';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_labels) label_item
      join jsonb_array_elements(p_remove_ids) remove_item
        on btrim(label_item ->> 'id') = btrim(remove_item #>> '{}')
  ) then
    raise exception 'Тип объекта нельзя одновременно сохранить и удалить';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(tenant_uuid::text || ':location-labels', 0)
  );

  -- Archive only explicit user removals. Rows omitted from p_labels may have
  -- been created concurrently by another device and must remain untouched.
  update public.location_labels l
     set is_active = false,
         updated_at = now()
   where l.tenant_id = tenant_uuid
     and l.is_active
     and exists (
       select 1
         from jsonb_array_elements(p_remove_ids) item
        where btrim(item #>> '{}') = l.id
     );

  -- Temporarily retire only rows included in this write. This frees their
  -- active-name keys so A↔B name swaps are atomic. A collision with an active
  -- row omitted from this snapshot is a real concurrent conflict: the unique
  -- index aborts and rolls back the whole function instead of deleting it.
  update public.location_labels l
     set is_active = false,
         updated_at = now()
   where l.tenant_id = tenant_uuid
     and l.is_active
     and exists (
       select 1
         from jsonb_array_elements(p_labels) item
        where btrim(item ->> 'id') = l.id
     );

  insert into public.location_labels (
    tenant_id, id, name, position, is_active, created_by
  )
  select tenant_uuid,
         btrim(item.value ->> 'id'),
         btrim(item.value ->> 'name'),
         coalesce(
           (item.value ->> 'position')::integer,
           (item.ordinality - 1)::integer
         ),
         true,
         auth.uid()
    from jsonb_array_elements(p_labels) with ordinality as item(value, ordinality)
  on conflict (tenant_id, id) do update
    set name = excluded.name,
        position = excluded.position,
        is_active = true,
        updated_at = now();

  return query
    select l.*
      from public.location_labels l
     where l.tenant_id = tenant_uuid
       and l.is_active
     order by l.position, l.created_at, l.id;
end;
$function$;

revoke all on function public.apply_location_label_changes(jsonb, jsonb)
  from public, anon;
grant execute on function public.apply_location_label_changes(jsonb, jsonb)
  to authenticated;

comment on table public.day_closures is
  'Owner-controlled, cents-based close/reopen snapshots of canonical cash ledgers.';
comment on table public.location_labels is
  'Tenant-scoped client object type labels; explicit removals are soft-archived.';

-- Deployment-time contract audit. These checks fail the migration rather
-- than leave a partially privileged finance/settings surface behind.
do $audit$
begin
  if has_table_privilege('authenticated', 'public.day_closures', 'INSERT')
     or has_table_privilege('authenticated', 'public.day_closures', 'UPDATE')
     or has_table_privilege('authenticated', 'public.day_closures', 'DELETE') then
    raise exception 'server settings: day_closures direct write leaked';
  end if;
  if has_table_privilege('authenticated', 'public.location_labels', 'INSERT')
     or has_table_privilege('authenticated', 'public.location_labels', 'UPDATE')
     or has_table_privilege('authenticated', 'public.location_labels', 'DELETE') then
    raise exception 'server settings: location_labels direct write leaked';
  end if;
  if has_function_privilege(
       'anon', 'public.close_business_day(date,bigint)', 'EXECUTE'
     )
     or has_function_privilege(
       'anon', 'public.reopen_business_day(date)', 'EXECUTE'
     )
     or has_function_privilege(
       'anon', 'public.apply_location_label_changes(jsonb,jsonb)', 'EXECUTE'
     ) then
    raise exception 'server settings: owner RPC leaked to anon';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.finance_transactions'::regclass
       and tgname = 'finance_transactions_closed_day_guard'
       and not tgisinternal
  ) then
    raise exception 'server settings: closed-day finance guard missing';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.accounts'::regclass
       and tgname = 'accounts_closed_day_guard'
       and not tgisinternal
  ) then
    raise exception 'server settings: closed-day account guard missing';
  end if;
end;
$audit$;

commit;
