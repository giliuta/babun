-- НОВАЯ ЗАПИСЬ ПАРТНЁРА БЕЗ «СУММЫ» — ПО ЦЕНАМ КАТАЛОГА (аудит 035, cab/R-03).
--
-- «Сумма и услуги записи: Скрыта/Видит» значит «цен и суммы не меняет».
-- `member_appointment_create` проверял только скидки, свою сумму и ручные
-- цены строк, а `total_amount` и цены строк в `services` писал как пришли:
-- запрос мимо экрана ставил записи итог 1 или 99999 — это долг клиента,
-- оплата и доход.
--
-- Теперь без «Суммы: Меняет» сервер сам ставит строкам цены каталога —
-- той же формулой, что форма (`unitPriceFor` → `pricePerUnit`,
-- `packages/shared/src/local/services.ts`): ступени по количеству
-- (`price_tiers`, `min_qty ≥ 2`), иначе оптовая цена от порога, иначе базовая;
-- `originalPrice` — цена каталога, `totalPrice` — до цента; итог записи —
-- сумма строк. Форма такому партнёру и так шлёт каталожные цены, поэтому
-- честная запись не меняется. Строка без услуги каталога («своя услуга») —
-- это ручная цена: без «Суммы» отказ, как у прочих денежных полей.
-- С «Суммой: Меняет» — как было.
--
-- Тело `member_appointment_create` правится по якорю в живом определении.

create or replace function public.catalog_unit_price(
  p_price numeric,
  p_tiers jsonb,
  p_bulk_threshold integer,
  p_bulk_price numeric,
  p_qty integer
)
returns numeric
language plpgsql
immutable
set search_path = public
as $function$
declare
  base numeric := case when p_price is not null and p_price >= 0 then p_price else 0 end;
  qty integer := greatest(1, coalesce(p_qty, 1));
  unit numeric := base;
  tier jsonb;
  has_tiers boolean := false;
begin
  if jsonb_typeof(p_tiers) = 'array' then
    for tier in
      select t.value
        from jsonb_array_elements(p_tiers) t
       where jsonb_typeof(t.value) = 'object'
         and (t.value ->> 'min_qty') ~ '^[0-9]+$'
         and (t.value ->> 'min_qty')::integer >= 2
         and (t.value ->> 'price_per_unit') ~ '^[0-9]+(\.[0-9]+)?$'
       order by (t.value ->> 'min_qty')::integer
    loop
      has_tiers := true;
      if qty >= (tier ->> 'min_qty')::integer then
        unit := (tier ->> 'price_per_unit')::numeric;
      end if;
    end loop;
    if has_tiers then
      return unit;
    end if;
  end if;
  if coalesce(p_bulk_threshold, 0) >= 2 and coalesce(p_bulk_price, 0) > 0 and qty >= p_bulk_threshold then
    return p_bulk_price;
  end if;
  return base;
end;
$function$;

comment on function public.catalog_unit_price(numeric, jsonb, integer, numeric, integer) is
  'Цена единицы услуги при количестве — та же формула, что pricePerUnit в packages/shared/src/local/services.ts.';

revoke all on function public.catalog_unit_price(numeric, jsonb, integer, numeric, integer) from public, anon;
grant execute on function public.catalog_unit_price(numeric, jsonb, integer, numeric, integer) to authenticated;

create or replace function public.member_catalog_priced(p_rest jsonb, p_team text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  lines jsonb := case when jsonb_typeof(p_rest -> 'services') = 'array' then p_rest -> 'services' else '[]'::jsonb end;
  priced jsonb := '[]'::jsonb;
  line jsonb;
  svc public.services%rowtype;
  qty integer;
  unit numeric;
  total numeric := 0;
begin
  if not (p_rest ? 'services' or p_rest ? 'total_amount') then
    return p_rest;
  end if;
  for line in select value from jsonb_array_elements(lines) loop
    select * into svc
      from public.services s
     where s.tenant_id = public.current_tenant_id()
       and s.id = line ->> 'serviceId';
    if not found then
      raise exception 'access:block:record.amount' using errcode = '42501';
    end if;
    qty := greatest(1, floor(coalesce(nullif(line ->> 'quantity', '')::numeric, 1))::integer);
    unit := public.catalog_unit_price(svc.price, svc.price_tiers, svc.bulk_threshold, svc.bulk_price, qty);
    line := line || jsonb_build_object(
      'quantity', qty,
      'pricePerUnit', unit,
      'originalPrice', coalesce(svc.price, 0),
      'totalPrice', round(unit * qty, 2)
    );
    total := total + round(unit * qty, 2);
    priced := priced || jsonb_build_array(line);
  end loop;
  return p_rest || jsonb_build_object('services', priced, 'total_amount', total);
end;
$function$;

comment on function public.member_catalog_priced(jsonb, text) is
  'Строки и итог новой записи партнёра без «Суммы: Меняет» — по ценам каталога.';

revoke all on function public.member_catalog_priced(jsonb, text) from public, anon, authenticated;

do $migration$
declare
  d text := pg_get_functiondef('public.member_appointment_create(jsonb)'::regprocedure);
  anchor constant text := E'  insert into public.appointments (id, tenant_id, team_id, kind, date, time_start, time_end,\n';
  block constant text := E'  -- Без «Суммы: Меняет» цены строк и итог — каталожные (`member_catalog_priced`).\n'
    || E'  if v_kind = ''work'' and not public.member_can(''record.amount'', ''write'', v_team) then\n'
    || E'    v_rest := public.member_catalog_priced(v_rest, v_team);\n'
    || E'  end if;\n\n';
begin
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'member_appointment_create: якорь вставки записи не найден ровно один раз';
  end if;
  execute replace(d, anchor, block || anchor);
end;
$migration$;
