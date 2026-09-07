-- МЕТКА ПРИНАДЛЕЖИТ КОМАНДЕ (владелец 2026-08-29).
--
-- «Метка чётко закрепляется за командой — то же самое, как график, то же
--  самое, как услуга. Нельзя поставить метку в другую команду.»
--
-- ДО: `cities` был ОБЩИМ справочником тенанта, а «метки команды» жили в
-- `teams.cities` — массиве ИМЁН, подобранных из этого общего списка. Это был
-- ПОДБОР, а не владение, и он протекал трижды:
--   • две команды не могли завести разные метки с одинаковым именем —
--     мешал `UNIQUE (tenant_id, name)`;
--   • переименование метки в справочнике переписывало её у всех команд;
--   • «свои метки» существовали лишь как фильтр поверх чужого списка, и
--     команда с одним подобранным именем не видела собственную вторую метку.
--
-- ПОСЛЕ: у метки есть `team_id`, и список команды ЕСТЬ её метки. Ровно та же
-- модель, что у услуг (`20260817195637_services_belong_to_one_team`).
--
-- ФАЙЛ ВОССТАНОВЛЕН 2026-08-30. Миграция была применена через MCP и в
-- репозиторий не попала: база ушла вперёд истории, и чистое окружение
-- собралось бы без `cities.team_id` — то есть приложение бы не поднялось.
-- Поэтому здесь всё под `if not exists`: на рабочей базе файл — no-op, на
-- новой — приводит её к тому же состоянию.

alter table public.cities
  add column if not exists team_id text;

-- ДАННЫЕ НЕ ТЕРЯЮТСЯ, А РАЗМНОЖАЮТСЯ. Метка была общей на тенант, а стала
-- собственностью команды — значит одна старая строка обязана превратиться в
-- N строк, по одной на каждую живую команду. Иначе метка досталась бы одной
-- команде, а у остальных календари молча опустели бы.
--
-- Новый id — `<старый id>@<team_id>`: он выводится из старого, поэтому по
-- нему видно, откуда метка взялась, и повторный прогон ничего не задвоит.
insert into public.cities (
  id, tenant_id, team_id, name, country, color, position,
  is_active, weekdays, deleted_at, created_at, updated_at
)
select
  c.id || '@' || t.id, c.tenant_id, t.id, c.name, c.country, c.color,
  c.position, c.is_active, c.weekdays, c.deleted_at, c.created_at, now()
from public.cities c
join public.teams t
  on t.tenant_id = c.tenant_id
 and t.is_active
where c.team_id is null
on conflict do nothing;

-- Общие строки уходят: их место заняли копии команд. Сюда же попадает метка
-- тенанта без единой живой команды — держать её негде, NOT NULL ниже её всё
-- равно не пропустит.
delete from public.cities where team_id is null;

alter table public.cities alter column team_id set not null;

-- ИМЯ УНИКАЛЬНО ВНУТРИ КОМАНДЫ, А НЕ ТЕНАНТА. Старое ограничение и было тем,
-- что не давало двум бригадам завести свой «Лимассол».
alter table public.cities drop constraint if exists cities_tenant_id_name_key;
alter table public.cities drop constraint if exists cities_name_tenant_unique;

create unique index if not exists cities_team_name_uniq
  on public.cities (tenant_id, team_id, lower(name))
  where deleted_at is null;

create index if not exists cities_team_id_idx
  on public.cities (tenant_id, team_id);

-- FK СОСТАВНОЙ, ЧЕРЕЗ tenant_id. Ссылка только по `team_id` пустила бы метку
-- одного тенанта на команду другого — дыра в изоляции, а не опечатка.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cities'::regclass and conname = 'cities_team_fk'
  ) then
    alter table public.cities
      add constraint cities_team_fk
      foreign key (tenant_id, team_id)
      references public.teams (tenant_id, id)
      on delete cascade;
  end if;
end $$;

comment on column public.cities.team_id is
  'Команда-владелец метки. Одноимённые метки разных команд — РАЗНЫЕ метки.';
