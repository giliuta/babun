-- STORY-071, хвост: закрытие дня — в валюте бизнеса, а не жёстко в евро.
-- Владелец 2026-09-06 разрешил бизнесу любую валюту (tenants.currency, любой
-- код ISO 4217). Закрытие дня оставалось прибитым к EUR: ограничением на
-- колонке, литералом в close_business_day и в фолбэке read_day_closure.
-- Теперь строка закрытия берёт валюту тенанта; ограничение проверяет форму
-- кода. Тела функций — те же, что в 20260811110000 и 20260720210009, изменены
-- только строки про currency.

alter table public.day_closures drop constraint if exists day_closures_currency_eur;
alter table public.day_closures drop constraint if exists day_closures_currency_check;
alter table public.day_closures
  add constraint day_closures_currency_check check (currency ~ '^[A-Z]{3}$');

create or replace function public.tenant_currency(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(
    (select upper(t.currency) from public.tenants t where t.id = p_tenant_id),
    'EUR'
  );
$function$;

revoke all on function public.tenant_currency(uuid) from public, anon;
grant execute on function public.tenant_currency(uuid) to authenticated;

create or replace function public.close_business_day(p_business_date date)
returns setof public.day_closures
language plpgsql
security definer
set search_path = public
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  existing_row public.day_closures%rowtype;
  counted_cents bigint;
  expected_cents bigint;
  tenant_ccy text;
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

  perform pg_advisory_xact_lock(
    hashtextextended(tenant_uuid::text || ':day-closure-ledger', 0)
  );

  select * into existing_row
    from public.day_closures
   where day_closures.tenant_id = tenant_uuid
     and day_closures.business_date = p_business_date
   for update;

  if found and existing_row.is_closed then
    return query
      select * from public.day_closures
       where day_closures.tenant_id = tenant_uuid
         and day_closures.business_date = p_business_date;
    return;
  end if;

  select
    coalesce(sum(round(day_counts.counted * 100))::bigint, 0),
    coalesce(sum(round(day_counts.expected * 100))::bigint, 0)
    into counted_cents, expected_cents
    from (
      select distinct on (c.account_id) c.counted, c.expected
        from public.account_cash_counts c
       where c.tenant_id = tenant_uuid
         and c.business_date = p_business_date
       order by c.account_id, c.counted_at desc, c.created_at desc
    ) as day_counts;

  tenant_ccy := public.tenant_currency(tenant_uuid);

  insert into public.day_closures (
    tenant_id, business_date, is_closed, expected_cash_cents,
    actual_cash_cents, delta_cash_cents, currency, closed_at, closed_by,
    reopened_at, reopened_by, revision
  ) values (
    tenant_uuid, p_business_date, true, expected_cents,
    counted_cents, counted_cents - expected_cents, tenant_ccy,
    now(), auth.uid(), null, null,
    coalesce(existing_row.revision, 0) + 1
  )
  on conflict (tenant_id, business_date) do update
    set is_closed = true,
        expected_cash_cents = excluded.expected_cash_cents,
        actual_cash_cents = excluded.actual_cash_cents,
        delta_cash_cents = excluded.delta_cash_cents,
        currency = excluded.currency,
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
             null::bigint, null::bigint, public.tenant_currency(tenant_uuid),
             null::timestamptz, null::uuid, null::timestamptz, null::uuid,
             0, null::timestamptz, null::timestamptz;
  end if;
end;
$function$;
