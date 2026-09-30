-- МАТЕРИАЛЫ ЗАПИСИ ЗАМОРАЖИВАЮТСЯ ПРИ ЗАКРЫТИИ (аудит финансов 2026-09-30).
--
-- Расход «Материалы» считался по СЕГОДНЯШНЕЙ себестоимости услуги из
-- справочника: поменял цену химии — и прибыль прошлых месяцев переписалась
-- задним числом. Теперь в момент, когда запись становится выполненной, сервер
-- кладёт в неё строки материалов по ценам этого дня (`material_lines`), и
-- приложение считает прибыль закрытой записи по ним.
--
-- ПРАВИЛО РАСЧЁТА — ЗЕРКАЛО `appointmentMaterialCostLines`
-- (packages/shared/src/local/finance/appointment-calc.ts) и `costPerUnit`
-- (packages/shared/src/local/services.ts), строка в строку:
--   • количество — сумма `quantity` строк услуг записи (число > 0, вниз до
--     целого, не меньше 1; иначе 1); старые записи без строк — по одной за
--     каждый `service_ids`, которого нет в строках;
--   • расход одной штуки — `cost_per_unit`, если он > 0 или именных строк
--     `material_costs` нет; иначе сумма их `amount`;
--   • лестница `cost_tiers`: действует расход последней ступени с
--     `min_qty <= количество` (ступени — целые от 2, расход ≥ 0, повтор
--     порога — последняя запись);
--   • строка с нулевым расходом не пишется.
-- Одинаковость проверена прогоном на наборе примеров, общим с тестом
-- приложения (`appointment-calc.test.ts`, «зеркало сервера»).
--
-- КОЛОНКА ПРИНАДЛЕЖИТ СЕРВЕРУ. Приложение её не пишет; присланное значение
-- триггер возвращает к прежнему — иначе подделанные материалы подделали бы
-- прибыль. Пересчёт — при закрытии, при правке услуг закрытой записи и при
-- первом касании уже закрытой записи после этой миграции. Ушла из
-- «выполнена» — снимок снимается, считается живьём, как раньше.
--
-- ПРОШЛЫЕ ЗАПИСИ НЕ ПЕРЕСЧИТЫВАЮТСЯ МАССОВО: обновление каждой закрытой
-- записи запустило бы на ней сверку денег и SMS-триггеры. Без снимка запись
-- считается по справочнику, как до этой миграции; снимок ляжет при первой её
-- правке.

alter table public.appointments add column if not exists material_lines jsonb;

comment on column public.appointments.material_lines is
  'Материалы выполненной записи по ценам дня закрытия: [{serviceId, serviceName, quantity, unitCost, totalCost}]. Пишет только сервер (freeze_appointment_materials); null — считать по справочнику.';

-- Number() из JavaScript для скаляра jsonb: так приложение читает ступени
-- лестницы («3» и 3 — одно и то же, null — ноль, отсутствие — не число).
create or replace function public._js_number(p jsonb)
returns numeric
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  s text;
begin
  if p is null then
    return null;
  end if;
  case jsonb_typeof(p)
    when 'number' then
      return (p #>> '{}')::numeric;
    when 'null' then
      return 0;
    when 'boolean' then
      return case when (p #>> '{}')::boolean then 1 else 0 end;
    when 'string' then
      s := btrim(p #>> '{}', E' \t\n\r');
      if s = '' then
        return 0;
      end if;
      if s ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$' then
        return s::numeric;
      end if;
      return null;
    else
      return null;
  end case;
end;
$function$;

create or replace function public.appointment_material_lines(
  p_tenant uuid,
  p_services jsonb,
  p_service_ids jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  qty jsonb := '{}'::jsonb;
  order_ids text[] := array[]::text[];
  snapshot_ids text[] := array[]::text[];
  item jsonb;
  sid text;
  q integer;
  svc record;
  rows_total numeric;
  unit numeric;
  tier record;
  lines jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_services) = 'array' then
    for item in select value from jsonb_array_elements(p_services)
    loop
      if jsonb_typeof(item) <> 'object'
         or jsonb_typeof(item -> 'serviceId') is distinct from 'string'
         or (item ->> 'serviceId') = '' then
        continue;
      end if;
      sid := item ->> 'serviceId';
      if not (sid = any(snapshot_ids)) then
        snapshot_ids := snapshot_ids || sid;
      end if;
      q := case
        when jsonb_typeof(item -> 'quantity') = 'number'
             and (item ->> 'quantity')::numeric > 0
          then greatest(1, floor((item ->> 'quantity')::numeric))::integer
        else 1
      end;
      if not (qty ? sid) then
        order_ids := order_ids || sid;
      end if;
      qty := qty || jsonb_build_object(sid, coalesce((qty ->> sid)::integer, 0) + q);
    end loop;
  end if;

  if jsonb_typeof(p_service_ids) = 'array' then
    for item in select value from jsonb_array_elements(p_service_ids)
    loop
      if jsonb_typeof(item) <> 'string' or (item #>> '{}') = '' then
        continue;
      end if;
      sid := item #>> '{}';
      if sid = any(snapshot_ids) then
        continue;
      end if;
      if not (qty ? sid) then
        order_ids := order_ids || sid;
      end if;
      qty := qty || jsonb_build_object(sid, coalesce((qty ->> sid)::integer, 0) + 1);
    end loop;
  end if;

  foreach sid in array order_ids
  loop
    select s.name, s.cost_per_unit, s.cost_tiers, s.material_costs
      into svc
      from public.services s
     where s.tenant_id = p_tenant
       and s.id = sid;
    if not found then
      continue;
    end if;
    q := (qty ->> sid)::integer;

    select coalesce(sum((r ->> 'amount')::numeric), 0)
      into rows_total
      from jsonb_array_elements(
        case when jsonb_typeof(svc.material_costs) = 'array' then svc.material_costs else '[]'::jsonb end
      ) r
     where jsonb_typeof(r) = 'object'
       and jsonb_typeof(r -> 'amount') = 'number'
       and (r ->> 'amount')::numeric >= 0;

    unit := case
      when svc.cost_per_unit is not null
           and svc.cost_per_unit >= 0
           and (svc.cost_per_unit > 0 or rows_total = 0)
        then svc.cost_per_unit
      else rows_total
    end;

    for tier in
      select distinct on (m) m, c
        from (
          select public._js_number(t -> 'min_qty') as m,
                 public._js_number(t -> 'cost_per_unit') as c,
                 ord
            from jsonb_array_elements(
              case when jsonb_typeof(svc.cost_tiers) = 'array' then svc.cost_tiers else '[]'::jsonb end
            ) with ordinality as x(t, ord)
           where jsonb_typeof(t) = 'object'
        ) parsed
       where m is not null
         and m = trunc(m)
         and m >= 2
         and m <= 9007199254740991
         and c is not null
         and c >= 0
       order by m, ord desc
    loop
      if q >= tier.m then
        unit := tier.c;
      end if;
    end loop;

    if unit * q > 0 then
      lines := lines || jsonb_build_array(jsonb_build_object(
        'serviceId', sid,
        'serviceName', coalesce(nullif(btrim(svc.name), ''), 'Услуга'),
        'quantity', q,
        'unitCost', unit,
        'totalCost', unit * q
      ));
    end if;
  end loop;

  return lines;
end;
$function$;

create or replace function public.freeze_appointment_materials()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Колонка сервера: присланное приложением не принимается.
  if tg_op = 'INSERT' then
    new.material_lines := null;
  elsif new.material_lines is distinct from old.material_lines then
    new.material_lines := old.material_lines;
  end if;

  if new.status = 'completed' then
    if tg_op = 'INSERT'
       or old.status is distinct from 'completed'
       or new.services is distinct from old.services
       or new.service_ids is distinct from old.service_ids
       or new.material_lines is null then
      new.material_lines := public.appointment_material_lines(
        new.tenant_id, new.services, new.service_ids
      );
    end if;
  else
    new.material_lines := null;
  end if;
  return new;
end;
$function$;

-- Расчёт читает справочник любой компании по параметру — клиентам не
-- открывать; функция-триггер звать напрямую некому.
revoke all on function public._js_number(jsonb) from public, anon, authenticated;
revoke all on function public.appointment_material_lines(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.freeze_appointment_materials() from public, anon, authenticated;

drop trigger if exists trg_appointments_freeze_materials on public.appointments;
create trigger trg_appointments_freeze_materials
  before insert or update on public.appointments
  for each row execute function public.freeze_appointment_materials();

do $guard$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'appointments' and column_name = 'material_lines'
  ) then
    raise exception 'сторож: нет колонки material_lines';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.appointments'::regclass
       and tgname = 'trg_appointments_freeze_materials'
       and not tgisinternal
  ) then
    raise exception 'сторож: нет триггера заморозки материалов';
  end if;
  if has_function_privilege('anon', 'public.appointment_material_lines(uuid, jsonb, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.appointment_material_lines(uuid, jsonb, jsonb)', 'execute') then
    raise exception 'сторож: расчёт материалов открыт клиентам';
  end if;
end
$guard$;
