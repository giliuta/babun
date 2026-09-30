-- ПРАВА ВЫДАЮТСЯ НА КАЛЕНДАРЬ. Шаг первый: только добавления.
--
-- Владелец 2026-09-10: «календарь — это и есть основной актив: в календарь
-- привязывается клиент, в календарь привязываются финансы, и права я выдаю
-- исключительно на этот календарь. Если мне надо выдать права диспетчера — я
-- выдаю их на каждый календарь, а не на всё сразу».
--
-- Сегодня прав на календарь не существует. Есть роль на ВСЮ компанию
-- (`tenant_members.role`, PK (tenant_id, user_id) — то есть физически одна
-- роль на человека), и есть экран
-- `calendar/masters/[id]/access.tsx` с тридцатью одной галочкой, который
-- пишет их в `masters.profile.permissions` — а сервер про эти галочки НЕ ЗНАЕТ
-- НИЧЕГО: в миграциях слово permissions рядом с мастерами не встречается ни
-- разу. Владелец может снять галочку «видит финансы», и мастер всё равно
-- увидит финансы, потому что доступ решает роль. Это ложное обещание
-- безопасности, и оно живёт в продукте прямо сейчас.
--
-- ЭТА МИГРАЦИЯ НИЧЕГО НЕ МЕНЯЕТ В ДОСТУПЕ. Она заводит место, где права будут
-- жить, функцию, которая их читает, и переносит сегодняшнюю картину доступов
-- один в один. Ни одна политика на неё пока не смотрит — значит накат
-- безопасен для боевой базы, а включение поедет отдельным шагом, где каждая
-- политика получает предикат «старое ИЛИ календарное» и прод не теряет доступ
-- ни на секунду.
--
-- ПОЧЕМУ НЕ jsonb В КАРТОЧКЕ МАСТЕРА. Права читает RLS на каждый запрос: это
-- обязано быть индексируемой строкой, а не разбором json внутри профиля. И
-- права принадлежат ПАРЕ «человек × календарь», а карточка мастера — одна на
-- человека: в jsonb такую пару не выразить, не заведя массив массивов.

create table if not exists public.calendar_members (
  tenant_id  uuid        not null references public.tenants(id) on delete cascade,
  team_id    text        not null,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  -- Карточка мастера, если человек ей соответствует. Нужна, чтобы связать
  -- права с расписанием и выплатами; у владельца и диспетчера карточки может
  -- не быть вовсе.
  master_id  text,
  grants     text[]      not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid,
  primary key (tenant_id, team_id, user_id),
  foreign key (tenant_id, team_id)
    references public.teams(tenant_id, id) on delete cascade,
  -- Словарь прав закрыт: опечатка в гранте не должна тихо превращаться в
  -- «права нет» — она должна не примениться вовсе.
  constraint calendar_members_grants_known check (
    grants <@ array[
      'view',      -- видеть календарь и его записи
      'book',      -- создавать записи
      'edit_all',  -- править чужие записи (без него — только свои)
      'clients',   -- видеть клиентов этого календаря
      'phones',    -- видеть контакты клиента
      'finance',   -- видеть деньги календаря
      'close_day', -- закрывать день
      'settings'   -- менять настройки календаря
    ]::text[]
  )
);

comment on table public.calendar_members is
  'Права человека в КОНКРЕТНОМ календаре. Заменяет роль на всю компанию как '
  'источник прав; tenant_members.role остаётся смыслом компанейским '
  '(подписка, профиль компании, выдача прав).';

-- Главный запрос по этой таблице — «мои календари»: user_id + tenant_id.
create index if not exists idx_calendar_members_user
  on public.calendar_members (user_id, tenant_id);

alter table public.calendar_members enable row level security;

-- ЧИТАЕТ ЧЕЛОВЕК СВОИ СТРОКИ, ВЛАДЕЛЕЦ — ВСЕ. Политика НЕ зовёт
-- current_user_calendar_ids(): функция сама читает эту таблицу, и вызов из её
-- же политики — рекурсия.
drop policy if exists calendar_members_select on public.calendar_members;
create policy calendar_members_select on public.calendar_members
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      user_id = auth.uid()
      or public.current_user_role() = 'owner'
    )
  );

drop policy if exists calendar_members_write_owner on public.calendar_members;
create policy calendar_members_write_owner on public.calendar_members
  for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

-- «МОИ КАЛЕНДАРИ» — ОДНА ФУНКЦИЯ НА ВЕСЬ ПРОДУКТ.
--
-- ВЫЗЫВАТЬ ТОЛЬКО ПОДЗАПРОСОМ: `team_id = any (select
-- public.current_user_calendar_ids('finance'))`. В такой форме планировщик
-- считает её ОДИН раз на запрос (InitPlan); без подзапроса —
-- `= any(public.current_user_calendar_ids(...))` — она считается на КАЖДУЮ
-- строку, и это выглядит не как ошибка прав, а как зависшее приложение.
create or replace function public.current_user_calendar_ids(
  p_grant text default null
)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    array_agg(cm.team_id order by cm.team_id),
    array[]::text[]
  )
    from public.calendar_members cm
   where cm.user_id = auth.uid()
     and cm.tenant_id = public.current_tenant_id()
     and (p_grant is null or cm.grants @> array[p_grant])
$$;

revoke all on function public.current_user_calendar_ids(text) from public, anon;
grant execute on function public.current_user_calendar_ids(text) to authenticated;

comment on function public.current_user_calendar_ids(text) is
  'Календари активной компании, где у вызывающего есть доступ (и, если задан, '
  'конкретное право). Звать ТОЛЬКО подзапросом — иначе считается на каждую '
  'строку.';

-- ПЕРЕНОС СЕГОДНЯШНЕЙ КАРТИНЫ, ОДИН В ОДИН.
--
-- Владелец — все календари и все права. Диспетчер — все календари, но без
-- денег, закрытия дня и настроек: ровно то, что ему разрешает нынешняя роль
-- (`role-policy.ts`: у диспетчера нет view-finances, close-day,
-- manage-calendar-settings). Мастер — только те календари, где он назначен, и
-- только «видеть»: свои записи он и сегодня правит через безопасную функцию,
-- а не через прямой доступ.
--
-- Назначение мастера собирается из четырёх разных мест — `masters.team_id` и
-- три jsonb-списка в самой команде. Это не красиво, но это ровно та логика,
-- по которой сегодня работает `current_user_team_ids()`, и переносить надо
-- её, а не идеальную.
insert into public.calendar_members (tenant_id, team_id, user_id, master_id, grants)
select tm.tenant_id,
       t.id,
       tm.user_id,
       tm.master_id,
       case tm.role
         when 'owner' then array[
           'view','book','edit_all','clients','phones','finance','close_day','settings'
         ]::text[]
         when 'dispatcher' then array[
           'view','book','edit_all','clients','phones'
         ]::text[]
         else array['view']::text[]
       end
  from public.tenant_members tm
  join public.teams t on t.tenant_id = tm.tenant_id
 where tm.role in ('owner', 'dispatcher')
    or (
      tm.role = 'master'
      and tm.master_id is not null
      and (
        exists (
          select 1 from public.masters m
           where m.tenant_id = tm.tenant_id
             and m.id = tm.master_id
             and m.team_id = t.id
        )
        or coalesce(t.lead_ids, '[]'::jsonb) ? tm.master_id
        or coalesce(t.helper_ids, '[]'::jsonb) ? tm.master_id
        or exists (
          select 1
            from jsonb_array_elements(
              case when jsonb_typeof(t.members) = 'array'
                   then t.members else '[]'::jsonb end
            ) member
           where case jsonb_typeof(member)
                   when 'string' then member #>> '{}'
                   when 'object' then coalesce(member ->> 'master_id', member ->> 'id')
                   else null
                 end = tm.master_id
        )
      )
    )
    on conflict (tenant_id, team_id, user_id) do nothing;

do $$
declare
  v_members integer;
  v_owners  integer;
begin
  select count(*) into v_members from public.calendar_members;
  select count(*) into v_owners
    from public.tenant_members tm
    join public.teams t on t.tenant_id = tm.tenant_id
   where tm.role = 'owner';

  if v_members < v_owners then
    raise exception 'calendar_members: владельцы перенесены не полностью (% из %)',
      v_members, v_owners;
  end if;

  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'current_user_calendar_ids'
  ) then
    raise exception 'current_user_calendar_ids: функция не встала';
  end if;

  -- Ни одна политика не имеет права уже смотреть на эту таблицу: включение —
  -- отдельный шаг, и он не здесь.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename <> 'calendar_members'
       and qual like '%current_user_calendar_ids%'
  ) then
    raise exception 'calendar_members: доступ уже переключён — это шаг только на добавление';
  end if;
end $$;
