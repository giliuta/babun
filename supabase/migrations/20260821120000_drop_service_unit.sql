-- ЕДИНИЦЫ ИЗМЕРЕНИЯ У УСЛУГИ НЕТ (владелец 2026-08-21).
--
-- Колонка `services.unit` прожила два дня (20260819095608). Владелец, увидев
-- блок «Считаем в» на экране: «я не понимаю, для чего вот это вот… что мы от
-- этого поимеем? если ничего, тогда лучше удалить».
--
-- Проверено ПЕРЕД сносом, а не после:
--   • в счёт, в чек и в PDF единица не попадала ни разу — документ печатает
--     имя услуги, количество и цену, слова «м²» в нём нет нигде;
--   • на деньги не влияла: 120 × €2 считается одинаково, метры это или штуки;
--   • заполнена НИ РАЗУ: 0 услуг из 6 у обоих тенантов (у одной стояло 'шт.'
--     следом легаси-бэкфилла, а не выбором человека);
--   • печатала три слова внутри самого приложения — хвост у цены, слово во
--     фразе лестницы и подпись у степпера количества.
--
-- Возвращать её, когда придёт клининг или отделка, надо не сюда, а СРАЗУ В
-- СТРОКУ СЧЁТА: там единица что-то значит для клиента, а в справочнике она
-- значила только то, что человек лишний раз тапнул.
--
-- ПОРЯДОК ВАЖЕН: обе проекции ролей перестают называть колонку ДО того, как
-- она исчезнет — SECURITY DEFINER падает на первом же вызове. Проекция и её
-- маппер — одна пара: клиентские мапперы правятся тем же коммитом
-- (`features/settings/master-reference.ts`, `features/services/queries.ts`).
-- CREATE OR REPLACE, а не DROP + CREATE: DROP снёс бы гранты.
create or replace function public.list_dispatcher_services_safe()
returns setof jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', s.id,
    'tenant_id', s.tenant_id,
    'team_id', s.team_id,
    'name', s.name,
    'color', s.color,
    'price', s.price,
    'duration_minutes', s.duration_minutes,
    'is_countable', s.is_countable,
    'price_tiers', s.price_tiers,
    'duration_tiers', s.duration_tiers,
    'bulk_threshold', s.bulk_threshold,
    'bulk_price', s.bulk_price,
    'is_active', s.is_active,
    'position', s.position,
    'created_at', s.created_at,
    'updated_at', s.updated_at
  )
    from public.services s
   where public.current_user_role() = 'dispatcher'
     and s.tenant_id = public.current_tenant_id()
     and s.is_active
   order by s.position, s.name, s.id
$function$;

create or replace function public.list_master_services_safe()
returns setof jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', s.id,
    'tenant_id', s.tenant_id,
    'team_id', s.team_id,
    'name', s.name,
    'color', s.color
  )
    from public.services s
   where public.current_user_role() = 'master'
     and s.tenant_id = public.current_tenant_id()
     and s.is_active
     and exists (
       select 1
         from public.appointments a
        where a.tenant_id = s.tenant_id
          and a.kind = 'work'
          and (
            a.master_id = public.current_user_master_id()
            or a.team_id = any(public.current_user_team_ids())
          )
          and (
            coalesce(a.service_ids, '[]'::jsonb) ? s.id
            or exists (
              select 1
                from jsonb_array_elements(
                  case
                    when jsonb_typeof(a.services) = 'array' then a.services
                    else '[]'::jsonb
                  end
                ) line
               where line ->> 'serviceId' = s.id
            )
          )
     )
   order by s.position, s.name, s.id
$function$;

-- Сторож длины уезжает вместе с колонкой (он и был заведён ради неё).
alter table public.services drop column if exists unit;
