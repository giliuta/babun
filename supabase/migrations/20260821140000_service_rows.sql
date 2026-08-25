-- УСЛУГА = ТАБЛИЦА СТРОК «КОЛИЧЕСТВО · ЦЕНА · ВРЕМЯ» (владелец 2026-08-21).
--
-- «Первая строка — вот количество, одна штука, её менять нельзя, она
-- стандартная: цена такая-то, время такое-то. Нажимаешь кнопку добавить —
-- появляется точно такая же строка… И надо добавить описание — это тоже
-- полезно… описание тоже можно перекинуть в инвойс, типа что входит в это».
--
-- Формат хранения НЕ МЕНЯЕТСЯ: первая строка — это колонки `price` и
-- `duration_minutes`, добавленные — `price_tiers` / `duration_tiers` в прежнем
-- виде. Меняется только контрол ввода, поэтому расчёты записи, снимок
-- `appointments.services[]` и побайтовый сторож оплаченной записи не затронуты.
--
-- ЭТОТ ФАЙЛ — ЗАПИСЬ УЖЕ ПРИМЕНЁННОГО (две миграции на проде:
-- `service_description_columns` и `drop_service_is_countable`). Он безопасен
-- при повторном прогоне: `if not exists` / `if exists` / `create or replace`.

-- 1. Описание услуги и его дорога до бумаги. Две колонки заводятся ОДНОЙ
--    поставкой: по закону 2026-08-21 часть сущности заводим, только если она
--    доходит до КЛИЕНТА или меняет деньги. Описание в справочнике без колонки
--    в строке счёта — это вторая единица измерения, которую снесли накануне.
--    ADD COLUMN, а не UPDATE: строки существующих счетов не переписываются, и
--    триггер, падающий на оплаченных документах, не просыпается.
alter table public.services add column if not exists description text;
alter table public.invoice_lines add column if not exists description text;

-- 2. «Продаём целиком» снесено: флаг спрашивал в СПРАВОЧНИКЕ про поведение
--    ДРУГОГО экрана — степпера «− 1 +» в записи, которого в этот момент не
--    видно. Такой вопрос нельзя задать понятно, его можно только не задавать.
--    Правило расширяется, а не сужается: количество теперь есть у каждой
--    услуги, ни одно уже записанное количество не уменьшается.
--
--    ПОРЯДОК ОБЯЗАТЕЛЕН: обе проекции ролей перестают называть колонку ДО её
--    исчезновения, иначе SECURITY DEFINER отдаёт 500 всему каталогу.
--    Диспетчеру заодно добавляется `description` — счёт собирает он; мастеру
--    описание НЕ отдаём: бумаг он не выставляет.
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
    'description', s.description,
    'price', s.price,
    'duration_minutes', s.duration_minutes,
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

-- 3. Колонка уходит ПОСЛЕДНЕЙ — после обеих проекций и после выката клиента.
--    Писателей у неё было ДВА приложения: мобильное и веб
--    (apps/web/.../teams/[id]/services/page.tsx) — оба правятся тем же коммитом.
alter table public.services drop column if exists is_countable;
