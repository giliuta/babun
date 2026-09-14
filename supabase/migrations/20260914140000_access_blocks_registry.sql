-- ПРАВА ПО БЛОКАМ, ЭТАП 1: РЕЕСТР, ПРИВЯЗКА К КАЛЕНДАРЯМ, УРОВНИ, ПИСАТЕЛИ.
--
-- План и контракт: docs/PLAN-ACCESS-BLOCKS-2026-09-14.md, раздел «Контракт v1».
-- Решения владельца 14.09: права ставятся КАЖДОМУ человеку ПО БЛОКАМ; у блока три
-- положения — off (скрыт, данные не приходят) · read · write; новый сотрудник —
-- всё off; календари только явно выданные; изменение доходит мгновенно.
--
-- ЭТОТ ЭТАП НИ НА КОГО НЕ ВЛИЯЕТ. Все блоки заводятся с `live = false`: ни одна
-- политика и ни одна функция доступа уровни ещё не читает, `my_access_map()`
-- отдаёт пустые словари, `set_member_access` отвечает `access:not_live`.
-- Блоки оживают этапами 2, 5, 7, 8 — вместе с серверной проверкой.
--
-- ПРИВЯЗКА К КАЛЕНДАРЮ ОТДЕЛЬНО ОТ УРОВНЕЙ (сессия 008, 14.09). Владелец заводит
-- мастера в «Команду 1», и при «всё выключено» этот человек обязан быть виден
-- владельцу в людях этой команды — иначе ему нечего настраивать. Поэтому
-- «прикреплён к календарю» — своя таблица, а уровни календарных блоков возможны
-- только у прикреплённого календаря; открепили — уровни этого календаря стёрты.
--
-- ЧТО ЗАВОДИТСЯ
--   access_blocks      реестр блоков, общий для всех компаний; пишут только миграции.
--   member_calendars   человек прикреплён к календарю (без прав).
--   member_access      уровни людей: нет строки = первое значение из levels.
--                      Увольнение и открепление стирают уровни каскадом.
--   tenant_members.access_version  растёт при любой смене прикрепления или уровней.
--   my_access_map / list_member_access / set_member_access / set_member_calendars.
--   Приватный broadcast-канал `access:<user_id>`: `access_changed {tenant_id, version}`
--   и `membership_removed {tenant_id}`. Слушать канал может только сам человек.
--
-- ПЕРЕНОС СЕГОДНЯШНИХ ПРАВ. На боевой один сотрудник (мастер с `view` на один
-- календарь). Он прикрепляется к своим календарям, его сегодняшняя видимость
-- записывается уровнями — чтобы «до = после» выполнилось в день, когда блоки
-- оживут. Владельцам строк не пишется. Хранятся только значения не по умолчанию.

-- ─── Реестр ─────────────────────────────────────────────────────────────

create table public.access_blocks (
  key text primary key,
  area text not null check (area in ('calendar', 'finance', 'clients', 'company', 'owner')),
  scope text not null check (scope in ('calendar', 'company')),
  levels text[] not null check (cardinality(levels) >= 1),
  title_ru text not null,
  owner_only boolean not null default false,
  live boolean not null default false,
  enforced_by text[] not null default '{}',
  position integer not null
);

comment on table public.access_blocks is
  'Реестр блоков прав. Первое значение levels — умолчание (нет строки в member_access). '
  'live = сервер уже проверяет блок; только такие видны в картах прав и на экране владельца.';

alter table public.access_blocks enable row level security;
create policy access_blocks_read on public.access_blocks
  for select to authenticated using (true);
revoke all on public.access_blocks from anon;
revoke insert, update, delete on public.access_blocks from authenticated;
grant select on public.access_blocks to authenticated;

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, position) values
  ('calendar.records',     'calendar', 'calendar', array['off','read','write'], 'Календарь и записи',      false, 10),
  ('calendar.create',      'calendar', 'calendar', array['off','write'],        'Новые записи',            false, 20),
  ('record.status',        'calendar', 'calendar', array['off','read','write'], 'Статус и заметка',        false, 30),
  ('record.amount',        'calendar', 'calendar', array['off','read','write'], 'Сумма записи',            false, 40),
  ('record.payment',       'calendar', 'calendar', array['off','read','write'], 'Оплата в записи',         false, 50),
  ('calendar.day_labels',  'calendar', 'calendar', array['off','read','write'], 'Метка дня',               false, 60),
  ('calendar.settings',    'calendar', 'company',  array['off','read','write'], 'Настройки календаря',     false, 70),
  ('finance.operations',   'finance',  'calendar', array['off','read','write'], 'Доходы и расходы',        false, 110),
  ('finance.accounts',     'finance',  'calendar', array['off','read','write'], 'Счета и остатки',         false, 120),
  ('finance.debts',        'finance',  'calendar', array['off','read','write'], 'Долги',                   false, 130),
  ('finance.documents',    'finance',  'calendar', array['off','read','write'], 'Инвойсы и чеки',          false, 140),
  ('finance.close_day',    'finance',  'calendar', array['off','write'],        'Закрытие дня',            false, 150),
  ('finance.settings',     'finance',  'company',  array['off','read','write'], 'Категории, шаблоны, НДС', false, 160),
  ('clients',              'clients',  'company',  array['off','read','write'], 'Клиенты',                 false, 210),
  ('clients.scope',        'clients',  'company',  array['own','all'],          'Какие клиенты',           false, 220),
  ('clients.contacts',     'clients',  'company',  array['off','read'],         'Телефоны и контакты',     false, 230),
  ('services',             'company',  'company',  array['off','read','write'], 'Услуги и цены',           false, 310),
  ('masters',              'company',  'company',  array['off','read','write'], 'Мастера',                 false, 320),
  ('company.currency',     'company',  'company',  array['read','write'],       'Валюта',                  false, 330),
  ('company.profile',      'company',  'company',  array['off','read','write'], 'Реквизиты',               false, 340),
  ('owner.access',         'owner',    'company',  array['off'],                'Приглашать сотрудников',  true,  410),
  ('owner.billing',        'owner',    'company',  array['off'],                'Тариф и оплата',          true,  420);

-- ─── Привязка к календарям ──────────────────────────────────────────────

alter table public.tenant_members
  add column access_version bigint not null default 0;

create table public.member_calendars (
  tenant_id uuid not null,
  user_id uuid not null,
  team_id text not null,
  attached_by uuid,
  attached_at timestamptz not null default now(),
  primary key (tenant_id, user_id, team_id),
  constraint member_calendars_member_fkey foreign key (tenant_id, user_id)
    references public.tenant_members(tenant_id, user_id) on delete cascade,
  constraint member_calendars_team_fkey foreign key (tenant_id, team_id)
    references public.teams(tenant_id, id) on delete cascade
);

comment on table public.member_calendars is
  'Человек прикреплён к календарю — без прав. Прикреплённый с уровнями off виден владельцу '
  'в людях календаря, но сам ничего не видит. Пишет только set_member_calendars (и миграции).';

alter table public.member_calendars enable row level security;
create policy member_calendars_select_own_or_owner on public.member_calendars
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      user_id = (select auth.uid())
      or (select public.current_user_role()) = 'owner'
    )
  );
revoke all on public.member_calendars from anon;
revoke insert, update, delete on public.member_calendars from authenticated;
grant select on public.member_calendars to authenticated;

-- ─── Уровни людей ───────────────────────────────────────────────────────

create table public.member_access (
  tenant_id uuid not null,
  user_id uuid not null,
  block text not null references public.access_blocks(key) on update cascade,
  team_id text,
  level text not null,
  set_by uuid,
  set_at timestamptz not null default now(),
  constraint member_access_member_fkey foreign key (tenant_id, user_id)
    references public.tenant_members(tenant_id, user_id) on delete cascade,
  -- MATCH SIMPLE: у строк блоков компании team_id пуст, и ссылка не проверяется.
  constraint member_access_calendar_fkey foreign key (tenant_id, user_id, team_id)
    references public.member_calendars(tenant_id, user_id, team_id) on delete cascade
);

create unique index member_access_unique
  on public.member_access (tenant_id, user_id, block, team_id) nulls not distinct;

comment on table public.member_access is
  'Уровни блоков у человека в компании. Нет строки = первое значение access_blocks.levels. '
  'Пишет только set_member_access (и миграции). Увольнение и открепление стирают строки каскадом.';

alter table public.member_access enable row level security;
create policy member_access_select_own_or_owner on public.member_access
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      user_id = (select auth.uid())
      or (select public.current_user_role()) = 'owner'
    )
  );
revoke all on public.member_access from anon;
revoke insert, update, delete on public.member_access from authenticated;
grant select on public.member_access to authenticated;

create or replace function public.member_access_validate()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  b public.access_blocks%rowtype;
begin
  select * into b from public.access_blocks where key = new.block;
  if not found then
    raise exception 'неизвестный блок %', new.block using errcode = '22023', hint = 'access:bad_block';
  end if;
  if b.owner_only then
    raise exception 'блок % выдаётся только владельцу', new.block using errcode = '42501', hint = 'access:owner_only';
  end if;
  if b.scope = 'calendar' and new.team_id is null then
    raise exception 'у блока % нужен календарь', new.block using errcode = '22023', hint = 'access:bad_team';
  end if;
  if b.scope = 'company' and new.team_id is not null then
    raise exception 'блок % действует на всю компанию', new.block using errcode = '22023', hint = 'access:bad_team';
  end if;
  if b.scope = 'calendar' and not exists (
    select 1 from public.member_calendars mc
     where mc.tenant_id = new.tenant_id and mc.user_id = new.user_id and mc.team_id = new.team_id
  ) then
    raise exception 'человек не прикреплён к календарю %', new.team_id using errcode = '22023', hint = 'access:not_attached';
  end if;
  if not (new.level = any(b.levels)) then
    raise exception 'у блока % нет положения %', new.block, new.level using errcode = '22023', hint = 'access:bad_level';
  end if;
  if exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = new.tenant_id and tm.user_id = new.user_id and tm.role = 'owner'
  ) then
    raise exception 'владелец не ограничивается' using errcode = '42501', hint = 'access:target_owner';
  end if;
  return new;
end;
$function$;

create trigger member_access_validate
  before insert or update on public.member_access
  for each row execute function public.member_access_validate();

-- ─── Мгновенный сигнал ──────────────────────────────────────────────────

create or replace function public.member_access_bump()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  row_tenant uuid := coalesce(new.tenant_id, old.tenant_id);
  row_user uuid := coalesce(new.user_id, old.user_id);
  next_version bigint;
begin
  update public.tenant_members
     set access_version = access_version + 1
   where tenant_id = row_tenant and user_id = row_user
  returning access_version into next_version;
  -- Строка членства уже удаляется (каскад увольнения) — сигнал даёт её триггер.
  if next_version is not null then
    perform realtime.send(
      jsonb_build_object('tenant_id', row_tenant, 'version', next_version),
      'access_changed',
      'access:' || row_user::text,
      true
    );
  end if;
  return null;
end;
$function$;

create trigger member_access_bump
  after insert or update or delete on public.member_access
  for each row execute function public.member_access_bump();

create trigger member_calendars_bump
  after insert or update or delete on public.member_calendars
  for each row execute function public.member_access_bump();

create or replace function public.tenant_members_removed_signal()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform realtime.send(
    jsonb_build_object('tenant_id', old.tenant_id),
    'membership_removed',
    'access:' || old.user_id::text,
    true
  );
  return null;
end;
$function$;

create trigger tenant_members_removed_signal
  after delete on public.tenant_members
  for each row execute function public.tenant_members_removed_signal();

revoke all on function public.member_access_bump() from public, anon, authenticated;
revoke all on function public.tenant_members_removed_signal() from public, anon, authenticated;
revoke all on function public.member_access_validate() from public, anon, authenticated;

-- Слушать канал `access:<user_id>` может только сам человек.
create policy access_channel_only_the_person on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'access:' || (select auth.uid())::text
  );

-- ─── Функции контракта ──────────────────────────────────────────────────

create or replace function public.access_map_for(p_tenant_id uuid, p_user_id uuid, p_include_off boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  member_role text;
  member_version bigint;
  company_levels jsonb;
  calendar_levels jsonb;
  attached jsonb;
begin
  select tm.role, tm.access_version
    into member_role, member_version
    from public.tenant_members tm
   where tm.tenant_id = p_tenant_id and tm.user_id = p_user_id;

  if member_role is null then
    return null;
  end if;

  if member_role = 'owner' then
    return jsonb_build_object(
      'tenant_id', p_tenant_id, 'is_owner', true, 'version', member_version,
      'company', '{}'::jsonb, 'calendars', '{}'::jsonb
    );
  end if;

  select coalesce(jsonb_object_agg(b.key, coalesce(ma.level, b.levels[1])), '{}'::jsonb)
    into company_levels
    from public.access_blocks b
    left join public.member_access ma
      on ma.tenant_id = p_tenant_id
     and ma.user_id = p_user_id
     and ma.block = b.key
     and ma.team_id is null
   where b.live and b.scope = 'company' and not b.owner_only;

  select coalesce(jsonb_object_agg(per_team.team_id, per_team.blocks), '{}'::jsonb)
    into calendar_levels
    from (
      select mc.team_id,
             jsonb_object_agg(b.key, coalesce(ma.level, b.levels[1])) as blocks,
             coalesce(max(coalesce(ma.level, b.levels[1])) filter (where b.key = 'calendar.records'), 'off') as records_level
        from public.member_calendars mc
        cross join public.access_blocks b
        left join public.member_access ma
          on ma.tenant_id = mc.tenant_id
         and ma.user_id = mc.user_id
         and ma.block = b.key
         and ma.team_id = mc.team_id
       where mc.tenant_id = p_tenant_id
         and mc.user_id = p_user_id
         and b.live
         and b.scope = 'calendar'
       group by mc.team_id
    ) per_team
   where p_include_off or per_team.records_level <> 'off';

  if p_include_off then
    select coalesce(jsonb_agg(mc.team_id order by mc.team_id), '[]'::jsonb)
      into attached
      from public.member_calendars mc
     where mc.tenant_id = p_tenant_id and mc.user_id = p_user_id;
    return jsonb_build_object(
      'tenant_id', p_tenant_id, 'is_owner', false, 'version', member_version,
      'attached_calendars', attached,
      'company', company_levels, 'calendars', calendar_levels
    );
  end if;

  return jsonb_build_object(
    'tenant_id', p_tenant_id, 'is_owner', false, 'version', member_version,
    'company', company_levels, 'calendars', calendar_levels
  );
end;
$function$;

revoke all on function public.access_map_for(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function public.my_access_map()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  active_tenant uuid := public.current_tenant_id();
  result jsonb;
begin
  if auth.uid() is null or active_tenant is null then
    raise exception 'нет членства в компании' using errcode = '42501', hint = 'access:not_member';
  end if;
  result := public.access_map_for(active_tenant, auth.uid(), false);
  if result is null then
    raise exception 'нет членства в компании' using errcode = '42501', hint = 'access:not_member';
  end if;
  return result;
end;
$function$;

create or replace function public.list_member_access(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  active_tenant uuid := public.current_tenant_id();
  result jsonb;
begin
  if auth.uid() is null or active_tenant is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'права сотрудников видит владелец' using errcode = '42501', hint = 'access:not_owner';
  end if;
  result := public.access_map_for(active_tenant, p_user_id, true);
  if result is null then
    raise exception 'человек не состоит в компании' using errcode = '22023', hint = 'access:not_member';
  end if;
  return result;
end;
$function$;

-- Общая проверка писателей: вызывает владелец, цель — не владелец и не он сам.
create or replace function public.access_writer_target(p_user_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  active_tenant uuid := public.current_tenant_id();
  target_role text;
begin
  if auth.uid() is null or active_tenant is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'права меняет владелец' using errcode = '42501', hint = 'access:not_owner';
  end if;
  select tm.role into target_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant and tm.user_id = p_user_id;
  if target_role is null then
    raise exception 'человек не состоит в компании' using errcode = '22023', hint = 'access:not_member';
  end if;
  if p_user_id = auth.uid() or target_role = 'owner' then
    raise exception 'владелец не ограничивается' using errcode = '42501', hint = 'access:target_owner';
  end if;
  return active_tenant;
end;
$function$;

revoke all on function public.access_writer_target(uuid) from public, anon, authenticated;

create or replace function public.set_member_calendars(p_user_id uuid, p_team_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  active_tenant uuid := public.access_writer_target(p_user_id);
  wanted text[] := coalesce(p_team_ids, array[]::text[]);
  foreign_team text;
begin
  select w into foreign_team
    from unnest(wanted) as w
   where not exists (select 1 from public.teams t where t.tenant_id = active_tenant and t.id = w)
   limit 1;
  if foreign_team is not null then
    raise exception 'календарь % не из этой компании', foreign_team using errcode = '22023', hint = 'access:bad_team';
  end if;

  delete from public.member_calendars mc
   where mc.tenant_id = active_tenant
     and mc.user_id = p_user_id
     and not (mc.team_id = any(wanted));

  insert into public.member_calendars (tenant_id, user_id, team_id, attached_by, attached_at)
  select distinct active_tenant, p_user_id, w, auth.uid(), now()
    from unnest(wanted) as w
  on conflict (tenant_id, user_id, team_id) do nothing;

  return public.access_map_for(active_tenant, p_user_id, true);
end;
$function$;

create or replace function public.set_member_access(p_user_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  active_tenant uuid := public.access_writer_target(p_user_id);
  change jsonb;
  b public.access_blocks%rowtype;
  change_team text;
  change_level text;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'изменения — массив' using errcode = '22023', hint = 'access:bad_changes';
  end if;

  for change in select value from jsonb_array_elements(p_changes) loop
    select * into b from public.access_blocks where key = change ->> 'block';
    if not found then
      raise exception 'неизвестный блок %', change ->> 'block' using errcode = '22023', hint = 'access:bad_block';
    end if;
    if b.owner_only then
      raise exception 'блок % выдаётся только владельцу', b.key using errcode = '42501', hint = 'access:owner_only';
    end if;
    if not b.live then
      raise exception 'блок % ещё не проверяется сервером', b.key using errcode = '42501', hint = 'access:not_live';
    end if;

    change_team := nullif(change ->> 'team_id', '');
    change_level := change ->> 'level';

    if b.scope = 'calendar' then
      if change_team is null or not exists (
        select 1 from public.teams t where t.tenant_id = active_tenant and t.id = change_team
      ) then
        raise exception 'календарь не из этой компании' using errcode = '22023', hint = 'access:bad_team';
      end if;
      if not exists (
        select 1 from public.member_calendars mc
         where mc.tenant_id = active_tenant and mc.user_id = p_user_id and mc.team_id = change_team
      ) then
        raise exception 'человек не прикреплён к календарю' using errcode = '22023', hint = 'access:not_attached';
      end if;
    elsif change_team is not null then
      raise exception 'блок % действует на всю компанию', b.key using errcode = '22023', hint = 'access:bad_team';
    end if;

    if change_level is null or not (change_level = any(b.levels)) then
      raise exception 'у блока % нет положения %', b.key, change_level using errcode = '22023', hint = 'access:bad_level';
    end if;

    if change_level = b.levels[1] then
      delete from public.member_access ma
       where ma.tenant_id = active_tenant
         and ma.user_id = p_user_id
         and ma.block = b.key
         and ma.team_id is not distinct from change_team;
    else
      insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
      values (active_tenant, p_user_id, b.key, change_team, change_level, auth.uid(), now())
      on conflict (tenant_id, user_id, block, team_id)
      do update set level = excluded.level, set_by = excluded.set_by, set_at = excluded.set_at;
    end if;
  end loop;

  -- Двойная запись в calendar_members (её читают сегодняшние политики) включается
  -- на этапе 2 вместе с первыми живыми блоками. Пока живых блоков нет, сюда не дойти.

  return public.access_map_for(active_tenant, p_user_id, true);
end;
$function$;

-- Люди компании или календаря — вход в экран прав (сессия 008: одно тело, без
-- временной склейки tenant_members + masters на экране). Телефон до этапа SMS
-- лежит в user_metadata и помечен неподтверждённым.
create or replace function public.list_members(p_team_id text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  active_tenant uuid := public.current_tenant_id();
  result jsonb;
begin
  if auth.uid() is null or active_tenant is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'людей компании видит владелец' using errcode = '42501', hint = 'access:not_owner';
  end if;
  if p_team_id is not null and not exists (
    select 1 from public.teams t where t.tenant_id = active_tenant and t.id = p_team_id
  ) then
    raise exception 'календарь не из этой компании' using errcode = '22023', hint = 'access:bad_team';
  end if;

  select coalesce(jsonb_agg(person order by person->>'name'), '[]'::jsonb)
    into result
    from (
      select jsonb_build_object(
               'user_id', tm.user_id,
               'role', tm.role,
               'name', coalesce(
                 nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                 nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
                 split_part(u.email, '@', 1)
               ),
               'email', u.email,
               'phone', coalesce(nullif(u.phone, ''), nullif(btrim(u.raw_user_meta_data ->> 'phone'), '')),
               'phone_verified', u.phone_confirmed_at is not null and coalesce(u.phone, '') <> '',
               'calendars', coalesce((
                 select jsonb_agg(mc.team_id order by mc.team_id)
                   from public.member_calendars mc
                  where mc.tenant_id = tm.tenant_id and mc.user_id = tm.user_id
               ), '[]'::jsonb),
               'joined_at', tm.joined_at
             ) as person
        from public.tenant_members tm
        join auth.users u on u.id = tm.user_id
       where tm.tenant_id = active_tenant
         and (
           p_team_id is null
           or exists (
             select 1 from public.member_calendars mc
              where mc.tenant_id = tm.tenant_id and mc.user_id = tm.user_id and mc.team_id = p_team_id
           )
         )
    ) people;

  return result;
end;
$function$;

revoke all on function public.my_access_map() from public, anon;
revoke all on function public.list_member_access(uuid) from public, anon;
revoke all on function public.set_member_access(uuid, jsonb) from public, anon;
revoke all on function public.set_member_calendars(uuid, text[]) from public, anon;
revoke all on function public.list_members(text) from public, anon;
grant execute on function public.my_access_map() to authenticated, service_role;
grant execute on function public.list_member_access(uuid) to authenticated, service_role;
grant execute on function public.set_member_access(uuid, jsonb) to authenticated, service_role;
grant execute on function public.set_member_calendars(uuid, text[]) to authenticated, service_role;
grant execute on function public.list_members(text) to authenticated, service_role;

-- ─── Перенос сегодняшних прав ───────────────────────────────────────────
-- Только не-владельцы, только значения не по умолчанию.

insert into public.member_calendars (tenant_id, user_id, team_id)
select cm.tenant_id, cm.user_id, cm.team_id
  from public.calendar_members cm
  join public.tenant_members tm on tm.tenant_id = cm.tenant_id and tm.user_id = cm.user_id
 where tm.role <> 'owner'
on conflict do nothing;

insert into public.member_access (tenant_id, user_id, block, team_id, level)
select cm.tenant_id, cm.user_id, 'calendar.records', cm.team_id,
       case when cm.grants @> array['edit_all'] then 'write' else 'read' end
  from public.calendar_members cm
  join public.tenant_members tm on tm.tenant_id = cm.tenant_id and tm.user_id = cm.user_id
 where tm.role <> 'owner'
   and cm.grants && array['view', 'edit_all']
on conflict do nothing;

insert into public.member_access (tenant_id, user_id, block, team_id, level)
select cm.tenant_id, cm.user_id, 'calendar.create', cm.team_id, 'write'
  from public.calendar_members cm
  join public.tenant_members tm on tm.tenant_id = cm.tenant_id and tm.user_id = cm.user_id
 where tm.role <> 'owner' and cm.grants @> array['book']
on conflict do nothing;

insert into public.member_access (tenant_id, user_id, block, team_id, level)
select cm.tenant_id, cm.user_id, 'record.amount', cm.team_id, 'write'
  from public.calendar_members cm
  join public.tenant_members tm on tm.tenant_id = cm.tenant_id and tm.user_id = cm.user_id
 where tm.role <> 'owner' and cm.grants @> array['edit_all']
on conflict do nothing;

insert into public.member_access (tenant_id, user_id, block, team_id, level)
select cm.tenant_id, cm.user_id, blk.key, cm.team_id, blk.level
  from public.calendar_members cm
  join public.tenant_members tm on tm.tenant_id = cm.tenant_id and tm.user_id = cm.user_id
  cross join (values ('finance.operations', 'write'), ('finance.accounts', 'read'), ('record.payment', 'write')) as blk(key, level)
 where tm.role <> 'owner' and cm.grants @> array['finance']
on conflict do nothing;

-- Мастер сегодня двигает статус и пишет заметку в своих календарях.
insert into public.member_access (tenant_id, user_id, block, team_id, level)
select cm.tenant_id, cm.user_id, 'record.status', cm.team_id, 'write'
  from public.calendar_members cm
  join public.tenant_members tm on tm.tenant_id = cm.tenant_id and tm.user_id = cm.user_id
 where tm.role = 'master' and cm.grants && array['view', 'edit_all']
on conflict do nothing;

-- Блоки компании: то, что человек сегодня читает через безопасные функции.
insert into public.member_access (tenant_id, user_id, block, team_id, level)
select tm.tenant_id, tm.user_id, blk.key, null,
       case
         when blk.key = 'clients' and exists (
           select 1 from public.calendar_members cm
            where cm.tenant_id = tm.tenant_id and cm.user_id = tm.user_id
              and cm.grants @> array['clients']
         ) then 'write'
         else 'read'
       end
  from public.tenant_members tm
  cross join (values ('clients'), ('clients.contacts'), ('services'), ('masters')) as blk(key)
 where tm.role in ('master', 'dispatcher')
on conflict do nothing;

-- ─── Сторож ─────────────────────────────────────────────────────────────

do $guard$
declare
  owner_rows integer;
  live_blocks integer;
  default_rows integer;
  unattached integer;
begin
  select count(*) into owner_rows
    from public.member_access ma
    join public.tenant_members tm on tm.tenant_id = ma.tenant_id and tm.user_id = ma.user_id
   where tm.role = 'owner';
  if owner_rows > 0 then
    raise exception 'миграция: у владельцев % строк уровней', owner_rows;
  end if;

  select count(*) into live_blocks from public.access_blocks where live;
  if live_blocks > 0 then
    raise exception 'миграция: на этапе 1 живых блоков быть не должно, найдено %', live_blocks;
  end if;

  select count(*) into default_rows
    from public.member_access ma
    join public.access_blocks b on b.key = ma.block
   where ma.level = b.levels[1];
  if default_rows > 0 then
    raise exception 'миграция: % строк хранят умолчание', default_rows;
  end if;

  select count(*) into unattached
    from public.calendar_members cm
    join public.tenant_members tm on tm.tenant_id = cm.tenant_id and tm.user_id = cm.user_id
   where tm.role <> 'owner'
     and not exists (
       select 1 from public.member_calendars mc
        where mc.tenant_id = cm.tenant_id and mc.user_id = cm.user_id and mc.team_id = cm.team_id
     );
  if unattached > 0 then
    raise exception 'миграция: % календарей сотрудников не перенесены в прикрепление', unattached;
  end if;
end
$guard$;
