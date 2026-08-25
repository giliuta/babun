-- ЕДИНИЦА ИЗМЕРЕНИЯ ВОЗВРАЩАЕТСЯ — И СРАЗУ ДОЕЗЖАЕТ ДО БУМАГИ КЛИЕНТА.
--
-- Её снесли 21 августа (`20260821120000_drop_service_unit.sql`) по закону
-- продукта: «часть сущности заводим, только если она доходит до КЛИЕНТА или
-- меняет деньги». Та же миграция назвала условие возврата дословно:
-- «Возвращать её надо не сюда, а СРАЗУ В СТРОКУ СЧЁТА: там единица что-то
-- значит для клиента».
--
-- Условие наступило, и не гипотетически: на проде лежит живая строка счёта
-- «Трасса, 4 м» с количеством 4 — человек вписал метры в НАЗВАНИЕ, потому что
-- колонка «Кол-во» печатает голое «4». Поэтому единица заводится ОДНОЙ
-- ПОСТАВКОЙ с бумагой: у услуги, у строки счёта, в PDF и на экранном зеркале.
-- Владелец 2026-08-24: «вернуть вместе со счётом».
--
-- ЕДИНИЦА НЕ УЧАСТВУЕТ НИ В ОДНОМ РАСЧЁТЕ. 120 × €2 считается одинаково,
-- метры это или штуки, — довод сноса остаётся верным. Она подпись к числу.
alter table public.services add column if not exists unit text;

-- Строка счёта хранит СВОЮ единицу: выставленный документ заморожен, и смена
-- единицы в прайсе через месяц не переписывает бумагу, которую клиент уже
-- получил. ТОЛЬКО ADD COLUMN: ни одного UPDATE по существующим строкам —
-- иначе проснётся `assert_invoice_lines_mutable` на оплаченном счёте.
alter table public.invoice_lines add column if not exists unit text;

-- ЧИСЛА ЛИСТА — «ЗА ВСЁ» ИЛИ «ЗА ОДНУ», ОДНИМ ПЕРЕКЛЮЧАТЕЛЕМ НА УСЛУГУ.
-- Владелец 2026-08-24: «нажимаю на блок цена — открывается менюшка, там можно
-- выбрать цена за всё или цена за количество… если цена за всё, значит и
-- расход за всё».
--
-- Переключателей ровно один, а не три: цена «за всё» рядом с расходом «за
-- одну» убивает единственное, ради чего расход поставили рядом с ценой, —
-- вычитание глазом. Хранение при этом НЕ МЕНЯЕТСЯ ни на байт: в базе цена и
-- расход ступени по-прежнему за одну, а `price_entry` — это линза показа.
alter table public.services
  add column if not exists price_entry text not null default 'total';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'services_price_entry_check'
  ) then
    alter table public.services
      add constraint services_price_entry_check
      check (price_entry in ('total', 'unit'));
  end if;
end $$;

-- ПРОЕКЦИЯ ДИСПЕТЧЕРА получает единицу, режим и дни недели: он выбирает услугу
-- в записи и обязан видеть то же, что владелец, — кроме себестоимости.
-- `create or replace`, а не drop+create: drop снёс бы гранты.
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
    'unit', s.unit,
    'price_entry', s.price_entry,
    'available_weekdays', s.available_weekdays,
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

-- ПРОЕКЦИЯ МАСТЕРА получает только единицу: количество в наряде без неё
-- читается как «4 чего?». Экономику мастеру не отдаём — ни цены, ни режима.
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
    'color', s.color,
    'unit', s.unit
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
                  -- НЕ coalesce: `services` бывает не массивом, и тогда
                  -- jsonb_array_elements падает вместе со всем каталогом
                  -- мастера. Защита живёт на проде — сохраняем дословно.
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
