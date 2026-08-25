-- У УСЛУГИ ОДНО ИМЯ (владелец 2026-08-20).
--
-- «Имя для клиента» (services.invoice_note) задумывалось вторым названием той
-- же работы: в прайсе бригады «Чистка 2 блока б/у», в счёте — человеческое.
-- Идея приходила на экран дважды («Название в счёте», потом «Имя для
-- клиента») и оба раза провалилась: владелец 2026-08-20 — «что значит кнопка
-- добавить имя для клиента, но нихуя не понятно, не это надо».
--
-- Факты на момент сноса: колонка заполнена 0 раз из 6 услуг у обоих тенантов,
-- читатель во всём продукте один (сборка строки счёта), а формулировку для
-- клиента и так правят руками в самой строке документа — там она и замерзает
-- вместе со счётом, тогда как справочник переименуют задним числом.
--
-- ПОРЯДОК ВАЖЕН: сначала проекция диспетчера перестаёт называть колонку,
-- потом колонка исчезает. Наоборот — SECURITY DEFINER падает на первом же
-- вызове. CREATE OR REPLACE, а не DROP + CREATE: DROP снёс бы гранты.
-- Тело снято с прода (pg_get_functiondef) и отличается от него ровно одной
-- удалённой строкой — заодно возвращает в репозиторий актуальный текст RPC
-- с team_id и unit.
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
    'unit', s.unit,
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

-- `if exists`: миграции, добавившей колонку, в репозитории нет — она уехала
-- на прод отдельно (дрейф 2026-08-17..19).
alter table public.services drop column if exists invoice_note;
