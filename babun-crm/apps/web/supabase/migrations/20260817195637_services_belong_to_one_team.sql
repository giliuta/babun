-- УСЛУГА ПРИНАДЛЕЖИТ РОВНО ОДНОЙ КОМАНДЕ (владелец 2026-08-17: «услуга
-- принадлежит только одной команде, во второй команде это их услуги»).
--
-- ЭТОТ ФАЙЛ — ЗАПИСЬ УЖЕ ПРИМЕНЁННОГО. Миграция ушла на прод 17 августа
-- (`schema_migrations` = 20260817195637) и файлом в репозитории не появилась.
-- Версия в имени совпадает с прод-версией НАМЕРЕННО: так прод её пропустит как
-- применённую, а чистая среда получит.
--
-- ПОЧЕМУ ЭТО РАБОТА №0, А НЕ УБОРКА (аудит 2026-08-21).
-- В репозитории `services` создаётся без `team_id` (20260624_001), а два уже
-- лежащих здесь файла — `20260821120000_drop_service_unit.sql:35,67` и
-- `20260821140000_service_rows.sql` — обе проекции ролей строят с `s.team_id`.
-- Значит среда, поднятая из чистого репозитория, падала на миграциях, а если бы
-- прошла — мобильное приложение не смогло бы завести НИ ОДНОЙ услуги: вставка
-- всегда шлёт `team_id`, а каталог фильтрует по нему. Это авария класса
-- `city_manual`, которая в этом продукте уже случалась.
--
-- ОСТАЛЬНЫЕ ТРИ ПРОД-МИГРАЦИИ ПО УСЛУГАМ ФАЙЛОВ НЕ ТРЕБУЮТ — проверено, и
-- записано здесь, чтобы следующий заход не «восстановил» их задним числом:
--   · 20260818112332 `service_color_returns_with_readers`      — тело проекции;
--   · 20260818134932 `master_services_projection_returns_color` — тело проекции.
--     Оба перекрыты: `create or replace` тех же функций стоит в файлах от 21.08,
--     и чистая среда получает СРАЗУ конечные тела. Колонка `color` в репозитории
--     есть с 20260624_001 (`not null default '#3b82f6'`), заводить нечего.
--   · 20260819095608 `service_unit_of_measure` — заводила `services.unit`,
--     которую 21.08 снесли обратно (`drop column if exists unit`). Завести её
--     файлом значило бы вернуть в чистую среду колонку, которой нет на проде.

-- 1. Колонка приходит НЕНУЛЕВОЙ, чтобы бэкфилл было куда положить.
alter table public.services add column if not exists team_id text;

-- 2. БЭКФИЛЛ ПО ИСТОРИИ ПРОДАЖ, А НЕ ПО АЛФАВИТУ. Услуга уходит той бригаде,
--    которая ей РЕАЛЬНО работала в последний раз: команда из самой свежей
--    записи, где эта услуга стоит (в `service_ids` или в снимке `services[]`).
--    Так прайс делится по факту, а не по случайности порядка команд.
update public.services s
   set team_id = last_sale.team_id
  from (
    select distinct on (a.tenant_id, x.service_id)
           a.tenant_id, x.service_id, a.team_id
      from public.appointments a
      cross join lateral (
        select jsonb_array_elements_text(coalesce(a.service_ids, '[]'::jsonb)) as service_id
        union
        select line ->> 'serviceId'
          from jsonb_array_elements(
                 case when jsonb_typeof(a.services) = 'array' then a.services
                      else '[]'::jsonb end
               ) line
      ) x
     where a.team_id is not null
       and x.service_id is not null
     order by a.tenant_id, x.service_id, a.date desc, a.created_at desc
  ) last_sale
 where s.tenant_id = last_sale.tenant_id
   and s.id = last_sale.service_id
   and s.team_id is null;

-- 3. Кого не продавали ни разу — первой команде тенанта. Другого честного
--    признака у такой услуги нет, а без владельца она не появится ни в одном
--    каталоге записи.
update public.services s
   set team_id = first_team.id
  from (
    select distinct on (t.tenant_id) t.tenant_id, t.id
      from public.teams t
     order by t.tenant_id, t.position, t.created_at, t.id
  ) first_team
 where s.tenant_id = first_team.tenant_id
   and s.team_id is null;

-- 4. Услуга тенанта, у которого НЕТ НИ ОДНОЙ команды, существовать не может:
--    её не покажет ни один каталог. Гасим, а не удаляем — имя работы живёт
--    только здесь, и из него потом читают старые записи и счета.
update public.services
   set team_id = null, is_active = false
 where team_id is null;

delete from public.services where team_id is null and is_active = false
   and not exists (select 1 from public.teams t where t.tenant_id = services.tenant_id);

-- 5. Замок ставится ТОЛЬКО когда пустых не осталось — иначе миграция падает на
--    середине и оставляет базу в половинчатом состоянии.
do $$
begin
  if not exists (select 1 from public.services where team_id is null) then
    alter table public.services alter column team_id set not null;
  end if;
end $$;

-- 6. ССЫЛКА СОСТАВНАЯ, по (tenant_id, team_id): у `teams` первичный ключ
--    составной, и ссылка по одному `team_id` пустила бы услугу одного тенанта
--    к бригаде другого.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
     where cl.relname = 'services' and c.conname = 'services_team_fk'
  ) then
    -- ВНИМАНИЕ, ON DELETE CASCADE ЗДЕСЬ — НЕ РЕКОМЕНДАЦИЯ, А СНИМОК ПРОДА.
    -- Аудит 2026-08-21 показал, чем он обошёлся: удаление бригады сносит её
    -- прайс ЖЁСТКО, мимо мягкого удаления, на котором стоит весь продукт. Так
    -- уже исчезли 4 услуги, и 17 ссылок записей из 20 ведут в никуда. Волна 2
    -- того же аудита меняет это поведение ОТДЕЛЬНОЙ миграцией; здесь оно
    -- воспроизведено как есть, чтобы файл не расходился с продом.
    alter table public.services
      add constraint services_team_fk
      foreign key (tenant_id, team_id)
      references public.teams(tenant_id, id)
      on delete cascade;
  end if;
end $$;

-- 7. Каталог всегда читается «услуги ЭТОЙ команды, живые» — под это и индекс.
create index if not exists idx_services_tenant_team
  on public.services(tenant_id, team_id) where is_active;
