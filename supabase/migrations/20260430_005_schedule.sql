-- ─────────────────────────────────────────────────────────────────────
-- STORY-044 — Schedule + calendar settings + day-cities + day-extras
-- → Supabase. Closes the last batch of localStorage state that affects
-- calendar rendering. Multi-device sync covered after this migration
-- + the v352 deploy.
--
-- Layout:
--   1. team_schedules     (jsonb-heavy, one row per (tenant, team))
--   2. calendar_settings  (singleton per tenant, tenant_id is PK)
--   3. day_cities         (normalised, PK = (tenant, team, date))
--   4. day_extras         (normalised, one row per item)
--   5. RLS policies (per STORY-038 pattern; for all to anon, authenticated)
--   6. Updated handle_new_user trigger — inserts default
--      calendar_settings row at signup (decision A4, brief mandate)
--   7. Backfill default calendar_settings for existing tenants
--      (idempotent ON CONFLICT DO NOTHING)
--   8. RPC public.import_schedule(...) — atomic per-tenant import
--      (decision A8). Browser calls supabase.rpc(...) once; all four
--      INSERT/upsert blocks run inside the function body which is one
--      Postgres transaction. SECURITY INVOKER → caller's RLS still
--      applies. Partial-update semantics on calendar_settings via the
--      jsonb `?` (has-key) operator.
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. team_schedules ───────────────────────────────────────────────
create table public.team_schedules (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  team_id     text not null,
  schedule    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index team_schedules_tenant_team_unique
  on public.team_schedules(tenant_id, team_id);

create trigger team_schedules_set_updated_at
  before update on public.team_schedules
  for each row execute function public.set_updated_at();

alter table public.team_schedules enable row level security;

create policy team_schedules_all_own on public.team_schedules for all
  to anon, authenticated
  using      (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ── 2. calendar_settings (singleton per tenant) ─────────────────────
create table public.calendar_settings (
  tenant_id      uuid primary key references public.tenants(id) on delete cascade,
  start_hour     integer not null default 9   check (start_hour between 0 and 23),
  end_hour       integer not null default 20  check (end_hour between 1 and 24),
  grid_step      integer not null default 30  check (grid_step in (15, 30, 60)),
  week_start     text    not null default 'monday' check (week_start in ('monday', 'sunday')),
  timezone       text    not null default 'Europe/Nicosia',
  buffer_minutes integer not null default 0  check (buffer_minutes >= 0),
  hide_cancelled boolean not null default false,
  allow_overtime boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger calendar_settings_set_updated_at
  before update on public.calendar_settings
  for each row execute function public.set_updated_at();

alter table public.calendar_settings enable row level security;

create policy calendar_settings_all_own on public.calendar_settings for all
  to anon, authenticated
  using      (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ── 3. day_cities ───────────────────────────────────────────────────
create table public.day_cities (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  team_id    text not null,
  date       text not null,                       -- YYYY-MM-DD
  city       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, team_id, date)
);

create index day_cities_tenant_date on public.day_cities(tenant_id, date);

create trigger day_cities_set_updated_at
  before update on public.day_cities
  for each row execute function public.set_updated_at();

alter table public.day_cities enable row level security;

create policy day_cities_all_own on public.day_cities for all
  to anon, authenticated
  using      (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ── 4. day_extras ───────────────────────────────────────────────────
create table public.day_extras (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  team_id    text not null,
  date       text not null,
  name       text not null,
  amount     numeric not null check (amount >= 0),
  kind       text not null check (kind in ('income','expense')),
  category   text check (category in ('fuel','food','supplies','other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index day_extras_tenant_date on public.day_extras(tenant_id, date);
create index day_extras_tenant_team_date on public.day_extras(tenant_id, team_id, date);

create trigger day_extras_set_updated_at
  before update on public.day_extras
  for each row execute function public.set_updated_at();

alter table public.day_extras enable row level security;

create policy day_extras_all_own on public.day_extras for all
  to anon, authenticated
  using      (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ── 5. handle_new_user — extended with default calendar_settings ────
-- Atomic transaction inside the trigger function body. Insert order:
--   (a) tenant
--   (b) auth.users.raw_app_meta_data tenant_id stamp
--   (c) 4 default client_tags (STORY-043)
--   (d) 1 default calendar_settings (STORY-044)
-- A failure at any step rolls back the entire signup; trigger raises,
-- the user's INSERT into auth.users is undone too.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_tenant_id uuid;
begin
  -- a) create the tenant
  insert into public.tenants (id, name, vertical, owner_user_id)
  values (
    gen_random_uuid(),
    coalesce(new.raw_user_meta_data->>'business_name', new.email),
    'unknown',
    new.id
  )
  returning id into new_tenant_id;

  -- b) stamp tenant_id into JWT-bound app_metadata
  update auth.users
     set raw_app_meta_data =
           coalesce(raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object('tenant_id', new_tenant_id::text)
   where id = new.id;

  -- c) STORY-043 — default client tags (4 rows)
  insert into public.client_tags (id, tenant_id, name, color) values
    (gen_random_uuid(), new_tenant_id, 'VIP',         '#f59e0b'),
    (gen_random_uuid(), new_tenant_id, 'Новый',       '#3b82f6'),
    (gen_random_uuid(), new_tenant_id, 'Постоянный',  '#10b981'),
    (gen_random_uuid(), new_tenant_id, 'Проблемный',  '#ef4444');

  -- d) STORY-044 — default calendar_settings (column DEFAULTs apply)
  insert into public.calendar_settings (tenant_id) values (new_tenant_id);

  return new;
end;
$$;

-- ── 6. Backfill default calendar_settings for existing tenants ──────
-- ONLY calendar_settings backfilled. team_schedules / day_cities /
-- day_extras start empty by design (the user invokes the import
-- button to populate). Idempotent — re-run is a no-op.
insert into public.calendar_settings (tenant_id)
select t.id from public.tenants t
where t.owner_user_id is not null
on conflict (tenant_id) do nothing;

-- ── 7. RPC: public.import_schedule (atomic transaction, RLS-scoped) ─
-- Caller passes four jsonb payloads matching the localStorage shape.
-- Function body is a single Postgres transaction; any raise rolls
-- back the entire import (test atomicity in G7 step 12).
--
-- SECURITY INVOKER means the caller's JWT determines tenant_id via
-- current_tenant_id(); RLS on each table guarantees a malicious
-- payload can only land in the caller's tenant.
--
-- Null-payload guards: jsonb_each calls wrap COALESCE(..., '{}'::jsonb)
-- so a missing argument or explicit null doesn't error inside the
-- iterator. p_calendar_settings has a separate null-or-jsonb-null
-- check before the upsert.
--
-- Partial-update semantics for calendar_settings: each column's
-- ON CONFLICT DO UPDATE branch checks `p_calendar_settings ? '<key>'`
-- (jsonb has-key) — if the payload omits the key, the existing column
-- value is preserved instead of being clobbered with the system
-- default that the INSERT VALUES path used.
create or replace function public.import_schedule(
  p_schedules         jsonb default '{}'::jsonb,
  p_calendar_settings jsonb default null,
  p_day_cities        jsonb default '{}'::jsonb,
  p_day_extras        jsonb default '{}'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  t_id   uuid := public.current_tenant_id();
  k      text;
  v      jsonb;
  v_text text;
  parts  text[];
  team   text;
  d      text;
  extra  jsonb;
begin
  if t_id is null then
    raise exception 'no tenant_id in JWT' using errcode = '42501';
  end if;

  -- 1. team_schedules — upsert per (tenant, team).
  for k, v in
    select * from jsonb_each(coalesce(p_schedules, '{}'::jsonb))
  loop
    insert into public.team_schedules (tenant_id, team_id, schedule)
    values (t_id, k, v)
    on conflict (tenant_id, team_id) do update set
      schedule   = excluded.schedule,
      updated_at = now();
  end loop;

  -- 2. calendar_settings — singleton upsert with partial-update support.
  if p_calendar_settings is not null and p_calendar_settings <> 'null'::jsonb then
    insert into public.calendar_settings (
      tenant_id,
      start_hour,
      end_hour,
      grid_step,
      week_start,
      timezone,
      buffer_minutes,
      hide_cancelled,
      allow_overtime
    )
    values (
      t_id,
      coalesce((p_calendar_settings->>'startHour')::integer,     9),
      coalesce((p_calendar_settings->>'endHour')::integer,       20),
      coalesce((p_calendar_settings->>'gridStep')::integer,      30),
      coalesce( p_calendar_settings->>'weekStart',               'monday'),
      coalesce( p_calendar_settings->>'timezone',                'Europe/Nicosia'),
      coalesce((p_calendar_settings->>'bufferMinutes')::integer, 0),
      coalesce((p_calendar_settings->>'hideCancelled')::boolean, false),
      coalesce((p_calendar_settings->>'allowOvertime')::boolean, false)
    )
    on conflict (tenant_id) do update set
      start_hour     = case when p_calendar_settings ? 'startHour'
                            then excluded.start_hour
                            else calendar_settings.start_hour end,
      end_hour       = case when p_calendar_settings ? 'endHour'
                            then excluded.end_hour
                            else calendar_settings.end_hour end,
      grid_step      = case when p_calendar_settings ? 'gridStep'
                            then excluded.grid_step
                            else calendar_settings.grid_step end,
      week_start     = case when p_calendar_settings ? 'weekStart'
                            then excluded.week_start
                            else calendar_settings.week_start end,
      timezone       = case when p_calendar_settings ? 'timezone'
                            then excluded.timezone
                            else calendar_settings.timezone end,
      buffer_minutes = case when p_calendar_settings ? 'bufferMinutes'
                            then excluded.buffer_minutes
                            else calendar_settings.buffer_minutes end,
      hide_cancelled = case when p_calendar_settings ? 'hideCancelled'
                            then excluded.hide_cancelled
                            else calendar_settings.hide_cancelled end,
      allow_overtime = case when p_calendar_settings ? 'allowOvertime'
                            then excluded.allow_overtime
                            else calendar_settings.allow_overtime end,
      updated_at     = now();
  end if;

  -- 3. day_cities — upsert per (tenant, team, date). Keys are
  --    "<teamId>:<YYYY-MM-DD>" matching the localStorage shape.
  --    Uses v_text (text) because jsonb_each_text returns (text, text);
  --    binding into v (jsonb) would fail with code 22P02 on the implicit
  --    text→jsonb cast for unquoted city names ("Token X is invalid").
  for k, v_text in
    select * from jsonb_each_text(coalesce(p_day_cities, '{}'::jsonb))
  loop
    parts := string_to_array(k, ':');
    if array_length(parts, 1) <> 2 then
      continue;
    end if;
    team := parts[1];
    d    := parts[2];
    insert into public.day_cities (tenant_id, team_id, date, city)
    values (t_id, team, d, v_text)
    on conflict (tenant_id, team_id, date) do update set
      city       = excluded.city,
      updated_at = now();
  end loop;

  -- 4. day_extras — replace semantics per (team, date). The whole list
  --    for a given (team, date) is dropped first, then re-inserted.
  --    Matches STORY-042 A1 nested-array replacement contract.
  for k, v in
    select * from jsonb_each(coalesce(p_day_extras, '{}'::jsonb))
  loop
    parts := string_to_array(k, ':');
    if array_length(parts, 1) <> 2 then
      continue;
    end if;
    team := parts[1];
    d    := parts[2];
    delete from public.day_extras
      where tenant_id = t_id
        and team_id   = team
        and date      = d;
    for extra in select * from jsonb_array_elements(v) loop
      insert into public.day_extras (
        tenant_id, team_id, date, name, amount, kind, category
      ) values (
        t_id,
        team,
        d,
        extra->>'name',
        (extra->>'amount')::numeric,
        extra->>'kind',
        extra->>'category'
      );
    end loop;
  end loop;
end;
$$;

revoke all on function public.import_schedule(jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.import_schedule(jsonb, jsonb, jsonb, jsonb)
  to authenticated;
