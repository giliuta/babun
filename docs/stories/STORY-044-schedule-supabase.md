# STORY-044 — Schedule + calendar settings + day-cities + day-extras → Supabase

**Status:** `done` — closed 2026-04-30 with `c66da6f` (`v352-schedule-cloud`) + RPC fix.
**Estimate:** 5
**Dependencies:** STORY-038 (`current_tenant_id()` helper ✅), STORY-042 (jsonb-heavy migration pattern + import-button UX ✅), STORY-043 (`handle_new_user` trigger extension pattern ✅).
**Blocks:** STORY-045 (masters / teams in Supabase) eventually wants to FK `team_id` columns introduced here.

## User story

> **As** a multi-device Babun tenant,
> **I want** my schedule, calendar settings, day-city overrides, and day-extra line items to follow me across devices,
> **so that** the calendar I see on my phone in the field is the calendar my dispatcher sees on the iPad — same work hours, same vacations, same per-day city assignments, same extra income/expense entries.

## Why now

After STORY-042, appointments sync. But every other piece of "what the calendar looks like" still lives in localStorage:

- A dispatcher edits work hours on the iPad. Technician on the phone sees the old hours next morning.
- AirFix's vacation week is set on Dima's laptop. The phone calendar shows technicians as "available" during the vacation.
- "Чаевые €50" added on the laptop after a job. Same row missing from the closing-day report on the phone.

This is the last batch of localStorage state that materially changes how the calendar renders. After STORY-044 ships, **localStorage holds only ephemeral UI state** (haptic prefs, sidebar expand flag, install-prompt dismissal, view-mode pref) plus 30-day import backups. Everything that affects the business view follows the user.

## G0 — Inventory (read-only, completed)

### Entity 1 — `babun-team-schedules` (`packages/shared/src/local/schedule.ts`)

Per-team work hours + breaks + per-weekday overrides + per-date overrides + vacations.

```ts
type ScheduleMap = Record<string /* teamId */, TeamSchedule>;
interface TeamSchedule {
  start: string;           // "HH:MM" general start
  end: string;             // "HH:MM" general end
  breaks?: ScheduleBreak[];
  overrides?: Partial<Record<WeekdayKey, DaySchedule>>;
  date_overrides?: Record<string /* YYYY-MM-DD */, DaySchedule>;
  vacations?: VacationRange[];
}
interface DaySchedule { is_working: boolean; start: string; end: string; breaks: ScheduleBreak[]; }
interface VacationRange { start: string; end: string; reason?: string; }
interface ScheduleBreak { start: string; end: string; }
```

Heavily nested. Three levels of fallback (general → weekday → date → vacation). Already on the order of 1–2 KB JSON per team.

### Entity 2 — `babun2:settings:calendar` (`packages/shared/src/local/calendar-settings.ts`)

Singleton per tenant — one `CalendarSettings` object, no nesting.

```ts
interface CalendarSettings {
  startHour: number;       // 0-23
  endHour: number;         // 1-24
  gridStep: 15 | 30 | 60;
  weekStart: "monday" | "sunday";
  timezone: string;        // e.g. "Europe/Nicosia"
  bufferMinutes?: number;
  hideCancelled?: boolean;
  allowOvertime?: boolean;
}
```

Single object, ~120 bytes. Defaults shipped from the type module: `{startHour:9, endHour:20, gridStep:30, weekStart:"monday", timezone:"Europe/Nicosia", bufferMinutes:0, hideCancelled:false, allowOvertime:false}`.

### Entity 3 — `babun-day-cities` (`packages/shared/src/local/day-cities.ts`)

```ts
type DayCityMap = Record<string /* "teamId:YYYY-MM-DD" */, string /* city name */>;
```

A flat key-value map. Each entry says "team T on date D worked in city X". Cardinality grows daily but is bounded — 365 days × N teams × 1 active assignment per day. AirFix at 2 teams over 2 years is ~1500 entries; well under any DB stress.

### Entity 4 — `babun-day-extras` (`packages/shared/src/local/day-extras.ts`)

```ts
type DayExtrasMap = Record<string /* "teamId:YYYY-MM-DD" */, DayExtra[]>;
interface DayExtra {
  id: string;
  name: string;            // "Чаевые", "Заправка"
  amount: number;          // positive
  kind: "income" | "expense";
  category?: "fuel" | "food" | "supplies" | "other"; // expenses only
}
```

Each entry is a structured line item — id, name, amount, kind, category. The map keys group by team/date.

### Storage writers (single funnel through context)

```
babun-crm/apps/web/src/components/layout/DashboardClientLayout.tsx
  - useEffect mount: load{Schedules,CalendarSettings,DayCities,DayExtras}()
  - handle{Schedules,CalendarSettings,DayCities,DayExtras}Change: save<X>()
```

All four entities are 100% routed through the React context (`useSchedules / useCalendarSettings / useDayCities / useDayExtras`). The context-swap pattern from STORY-036 (clients) and STORY-042 (appointments) applies cleanly.

### Context consumers (read-only callers, no direct storage writes)

```
app/dashboard/page.tsx                       — calendar grid render
app/dashboard/close-day/page.tsx             — day-extras totals
app/dashboard/finances/page.tsx              — day-extras aggregation
app/dashboard/settings/calendar/page.tsx     — calendar-settings editor
app/dashboard/teams/[id]/page.tsx            — team schedule editor entry
app/dashboard/teams/[id]/schedule/page.tsx   — per-team schedule editor
```

7 consumers. None reach into localStorage directly — all go through `useX()`. After this story they all keep working unchanged.

### Default-values seeding for new tenants

- **calendar-settings**: `DEFAULT_CALENDAR_SETTINGS` constant in `local/calendar-settings.ts` — clients that don't have storage get the defaults at read time. Migration to Supabase needs to either insert a default row at signup OR keep the same "fall back to defaults if no row" semantic at the repo layer. Decision A4 below.
- **schedule / day-cities / day-extras**: empty by default, no seed needed.

## Acceptance criteria

1. Four new tables: `team_schedules`, `calendar_settings`, `day_cities`, `day_extras`. RLS enabled on each, policy `<table>_all_own FOR ALL ... USING tenant_id = current_tenant_id() WITH CHECK (...)`.
2. `Database` types extended; repos in `packages/shared/db/repositories/{schedule,calendar-settings,day-cities,day-extras}.ts` mirror the appointments pattern.
3. `DashboardClientLayout` reads/writes via repos; localStorage hydration removed for these 4 keys.
4. New signups land with one default `calendar_settings` row (decision A4). The other three tables stay empty until the user touches them.
5. Existing AirFix + giluta tenants have their localStorage migrated via the **import button** (decision A5), with the same 30-day local backup pattern as STORY-042.
6. Multi-device sync verified for each entity (G7).
7. RLS read isolation + write-block on `tenant_id` verified (G7).
8. Cascade delete via account-delete cleans all 4 tables (verified by SQL).
9. `BUILD_VERSION → v352-schedule-cloud`, `CACHE_VERSION → babun-v352`.

## Architectural decisions

### A1 — Schema shape: jsonb-heavy for `team_schedules`, normalised for the other three

| Table | Shape | Rationale |
|---|---|---|
| `team_schedules` | One row per `(tenant_id, team_id)` with the entire `TeamSchedule` (`start`, `end`, `breaks[]`, `overrides`, `date_overrides`, `vacations[]`) as a single jsonb column | Three levels of fallback nesting; splitting into tables (`schedule_breaks`, `schedule_weekday_overrides`, `schedule_date_overrides`, `vacations`) would add 4 round-trips per fetch and leak the resolution semantics into SQL. Same call as `clients.locations` / `appointments.services`. |
| `calendar_settings` | One row per `tenant_id` (singleton), top-level columns for each setting | Tiny payload, no nesting, top-level columns let migrations evolve cleanly when a new option lands. |
| `day_cities` | One row per `(tenant_id, team_id, date)` | Flat key-value map collapses naturally. Indexing by `(tenant_id, date)` makes the calendar grid query a single index range scan. |
| `day_extras` | One row per `DayExtra` item, keyed by `(tenant_id, team_id, date, id)` | Each item is structured (id/name/amount/kind/category); we already get aggregate sums — a normalised table is just better. |

**Locked.** Mixing approaches — heavy nesting → jsonb, flat structure → normalised — keeps each table optimal for its access pattern.

### A2 — `team_schedules.team_id` stays `text` (not FK)

Same rationale as STORY-042 A8 / appointments. Masters and teams still live in localStorage; FK'ing `team_id` is a problem for STORY-045. Make `team_id` a nullable `text` column with the local id, add an index on `(tenant_id, team_id)`. When STORY-045 migrates teams, it adds the FK in its own migration.

Same applies to `day_cities.team_id` and `day_extras.team_id`.

### A3 — `calendar_settings` singleton: PRIMARY KEY = `tenant_id`, upsert via `ON CONFLICT (tenant_id) DO UPDATE`

Each tenant has at most one row. Two ways to enforce:

a. `id uuid PRIMARY KEY default gen_random_uuid()` + `UNIQUE(tenant_id)`, and the repo does `select…maybeSingle` then chooses insert vs update.
b. **`tenant_id uuid PRIMARY KEY references tenants(id) on delete cascade`** — no separate id, the tenant_id IS the key. Repo uses a single `upsert({tenant_id, …}, {onConflict: 'tenant_id'})` call.

**Locked: option b.** Cleaner repo, fewer round-trips, race-safe at the database level. The downside (no separate `id` column for analytics) is irrelevant for a per-tenant singleton.

### A4 — Default `calendar_settings` row inserted by the trigger, not faked at the repo layer

When a tenant has no `calendar_settings` row, two options:

a. Repo's `getCalendarSettings` returns `DEFAULT_CALENDAR_SETTINGS` if the row is missing.
b. Trigger `handle_new_user` inserts a default row at signup.

**Locked: option b.** Same pattern as the default tags from STORY-043. Means the table is the source of truth — no "implicit defaults" hiding in TS code that drift from the SQL defaults. Implication: backfill migration also inserts a default row for every existing tenant that doesn't have one (idempotent `ON CONFLICT DO NOTHING`).

### A5 — Existing tenants migrate via the import button (manual), not auto-migration on first load

Brief presented two options:

a. Auto-migration on first load (clients pattern from STORY-036).
b. Manual via Settings → Опасная зона import button (appointments pattern from STORY-042).

**Locked: option b.** Three reasons:
- These four entities affect calendar rendering. An auto-migration race during page hydration could trigger flicker or partial views before the local-to-cloud merge resolves.
- The user already learned the import-button mental model from STORY-042 G6. Reusing it is consistent.
- The export/backup safety net from STORY-042 is built and tested. We extend that section to include schedule entities, instead of building a different one-shot flow.

### A8 — Atomicity for the import: a single Postgres RPC (`public.import_schedule`)

The brief mandates atomic-across-entities: «либо все 4 entities в БД либо ни одной». PostgREST does NOT support multi-statement transactions over REST — each `INSERT` is its own transaction. Three options:

a. Server-side Next.js route handler that runs the four INSERTs inside one Postgres transaction (via the user-scoped `pg` client).
b. **A `plpgsql` RPC `public.import_schedule(p_schedules jsonb, p_calendar jsonb, p_day_cities jsonb, p_day_extras jsonb)` invoked via `supabase.rpc(...)`.** Function body is automatically a single transaction; if any INSERT raises, the whole call rolls back. `SECURITY INVOKER` so the caller's RLS still applies — they can only write into their own tenant.
c. A Supabase Edge Function running TypeScript with the postgres client.

**Locked: option b.** Cleanest, browser → REST → RPC, all atomicity guaranteed by Postgres, no extra Next.js server code, RLS enforces tenant isolation. The function body is in the same migration file as the table DDL — see G1.

### A6 — Single import button covers all 4 entities atomically

The Settings page already has `ImportLocalAppointmentsSection`. We extend it (or add a sibling section) so a single click migrates all four schedule-related keys in one click. Reasons:

- A user who runs "import schedule" but not "import day-cities" leaves the calendar in an inconsistent state — schedule says "team T works Monday 09-18" but day-cities still localStorage-only, so the column doesn't show the city tint.
- Simpler UI surface — one CTA, not four.

The existing appointments import section keeps its own button. So Settings → Опасная зона ends up with **two** import sections: one for appointments (STORY-042), one for the four schedule entities (this story). Both follow the same backup-30-days pattern.

### A7 — Realtime out of scope

Same call as STORY-042 A4. Multi-device sync via reload is sufficient for AirFix today; realtime is a follow-up story.

## Group plan

### G1 — SQL migration (`20260430000005_schedule.sql`) — review-required before apply

Four `CREATE TABLE` blocks + `set_updated_at` triggers + RLS policies + the trigger extension + the backfill of default `calendar_settings` rows. Final SQL written before apply; here's the shape:

```sql
-- 1. team_schedules ------------------------------------------------
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

-- 2. calendar_settings (singleton per tenant) ---------------------
create table public.calendar_settings (
  tenant_id      uuid primary key references public.tenants(id) on delete cascade,
  start_hour     integer not null default 9   check (start_hour between 0 and 23),
  end_hour       integer not null default 20  check (end_hour between 1 and 24),
  grid_step      integer not null default 30  check (grid_step in (15, 30, 60)),
  week_start     text    not null default 'monday' check (week_start in ('monday', 'sunday')),
  timezone       text    not null default 'Europe/Nicosia',
  buffer_minutes integer not null default 0,
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

-- 3. day_cities ----------------------------------------------------
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

-- 4. day_extras ----------------------------------------------------
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

-- 5. Trigger extension: insert default calendar_settings on signup
-- (Re-CREATE OR REPLACE handle_new_user — adds one INSERT after the
-- existing tenant + tags inserts. Order: tenant → metadata stamp →
-- tags → calendar_settings.)

-- 6. Backfill default calendar_settings for existing tenants
insert into public.calendar_settings (tenant_id)
select t.id from public.tenants t
where t.owner_user_id is not null
on conflict (tenant_id) do nothing;
```

### G2 — Regenerate `Database` types in `packages/shared/db/database.types.ts`

Hand-add four new entries to `Tables` (mirror the SQL columns). No bulk regen via Supabase MCP — types are hand-maintained per STORY-036's convention.

### G3 — Repositories (4 files)

Files: `packages/shared/src/db/repositories/{schedule,calendar-settings,day-cities,day-extras}.ts`. Each follows the appointments-repo shape:

| File | Public functions | Notes |
|---|---|---|
| `schedule.ts` | `listScheduleEntries(supabase, tenantId)` returns `ScheduleMap`; `upsertScheduleEntry(supabase, tenantId, teamId, schedule)`; `deleteScheduleEntry(supabase, tenantId, teamId)` | jsonb round-trip via adapters; key on `(tenant_id, team_id)` for upsert ON CONFLICT |
| `calendar-settings.ts` | `getCalendarSettings(supabase, tenantId)`; `updateCalendarSettings(supabase, tenantId, partial)` | Single row per tenant, `upsert` ON CONFLICT (tenant_id) — see A3 |
| `day-cities.ts` | `listDayCities(supabase, tenantId)` returns `DayCityMap`; `setDayCity(supabase, tenantId, teamId, date, city)` (passing empty string deletes); `clearDayCity(supabase, tenantId, teamId, date)` | One row per assignment; map collapse on read via adapter |
| `day-extras.ts` | `listDayExtras(supabase, tenantId)` returns `DayExtrasMap`; `setDayExtras(supabase, tenantId, teamId, date, extras[])` (full replace per `(team, date)`) | Replace semantics — caller passes the whole list for a given day; same atomicity as STORY-042 A1 |

Adapters (`rowTo<X>`, `<x>ToInsert`) live in each file. Repos hide upsert semantics from callers.

### G4 — Wire `DashboardClientLayout` context to repos

Replace `loadX/saveX` calls with the new async repo functions, mirroring STORY-042 G4:

- Hydrate via `Promise.all([listScheduleEntries, getCalendarSettings, listDayCities, listDayExtras])` on mount, gated by `tenantId`.
- `set<X>` becomes async; race-safe upserts in repo.
- Drop the localStorage `loadX/saveX` imports from the layout (keep the type imports from the same module).
- The legacy save<X>() local functions stay in `packages/shared/local/<entity>.ts` for the import button to read; the layout no longer calls them.

### G5 — Default values via the trigger + backfill

Extend `handle_new_user` to add one `INSERT INTO public.calendar_settings (tenant_id) VALUES (new_tenant_id)` after the existing tenant + tags inserts. The defaults from the column declarations apply automatically (`start_hour=9`, etc.). Idempotent backfill (`ON CONFLICT DO NOTHING`) covers existing tenants.

The other three tables don't need seeding — empty is the correct initial state.

### G6 — Import section (extends STORY-042 G6 file)

Add `ImportLocalScheduleSection.tsx` next to `ImportLocalAppointmentsSection.tsx` under Settings → Опасная зона. Behaviour:

- Detects presence of any of the four legacy keys: `babun-team-schedules`, `babun2:settings:calendar`, `babun-day-cities`, `babun-day-extras`.
- Single button «Импортировать локальное расписание (N entities)».
- On click → modal listing what will move (schedule for X teams, calendar settings, K city assignments, M day-extras).
- On confirm → atomic per-entity import using the four repos.
- On 100% success → rename live keys to `babun:schedule:backup-<YYYY-MM-DD>`, etc.
- 30-day prune scan on mount (same helper as STORY-042 G6).
- Backup card per backup key with manual «Удалить» button.

### G7 — Smoke (14 steps)

1. `tsc --noEmit` green.
2. Register fresh test User1; immediate SQL: `calendar_settings WHERE tenant_id = ?` → 1 row with locked defaults; the other three tables → 0 rows.
3. UI: Settings → Calendar → change `gridStep` to 60 → save. SQL: row updated, `updated_at` advanced.
4. UI: edit team schedule (Teams → [id] → Schedule) → set vacation range. SQL: `team_schedules` row created with vacation in jsonb.
5. UI: tap a calendar day, change city → save. SQL: `day_cities (tenant, team, date)` row created.
6. UI: open day-finance modal, add «Чаевые €25» income. SQL: `day_extras` row created with kind=income, amount=25.
7. **Multi-device sync — singleton `calendar_settings`**: open same User1 account in second isolated context → confirm `gridStep=60` after reload. Then in the second context bump `bufferMinutes` to 15, save → reload first context → first context sees `bufferMinutes=15`. Demonstrates the upsert-on-`tenant_id` PK round-trip, no two rows.
8. Multi-device sync — others: changes from steps 4–6 visible in the second context after reload (read-side check).
9. Register User2 (RLS isolation). User2's `calendar_settings` row exists; User2 can't see User1's via direct REST query.
10. RLS write-block: User2 attempts UPDATE on User1's `team_schedules.tenant_id` → 403 with `42501` (WITH CHECK fires).
11. Import button smoke: as User2, populate localStorage with 1 schedule entry + custom calendar_settings + 3 day_cities + 2 day_extras → click import → all rows in DB, backup keys created with `-<date>` suffix.
12. **Atomicity smoke**: as User2, populate localStorage with valid schedule + valid calendar_settings + valid day_cities + **deliberately broken `day_extras`** (e.g. one entry with `amount = -1` to trip the `check (amount >= 0)`). Click import. Expect: RPC raises, transaction rolls back, **none of the 4 entities present in DB after the failure**, error surfaced in the import section with the Postgres message. Live local key NOT moved to backup (so user can fix and retry). Verify via SQL `select count(*) from team_schedules where tenant_id = <user2>` → 0, same for the other three.
13. Cascade delete: User2 → account-delete. SQL verifies `team_schedules`, `calendar_settings`, `day_cities`, `day_extras` for that tenant all = 0.
14. Final state: airfix + giluta back to baseline (only their own rows + 1 calendar_settings each from backfill).

### G8 — Bump + commit + push

`BUILD_VERSION = "v352-schedule-cloud"`, `CACHE_VERSION = "babun-v352"`. Commit message: `feat(schedule): G1-G6 — schedule + calendar_settings + day_cities + day_extras to Supabase (STORY-044)`.

### G9 — Production verification

Repeat G7 against the deployed v352 on https://babun.app. Same shape as STORY-042 G6 / STORY-043 G6.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| jsonb in `team_schedules` grows unboundedly with date_overrides over years | Cap not enforced in DB; UI keeps the schedule editor capped at a 12-month window. Worst case for AirFix: ~50 KB jsonb per team per year — fine. |
| Race on `calendar_settings` upsert from two devices | PRIMARY KEY = tenant_id + ON CONFLICT atomic; Postgres serialises. UI is "last write wins" which is the right semantic here. |
| Import button dual section UX gets crowded | Two sections under Опасная зона + the existing «Удалить аккаунт». ~3 cards. Acceptable; iOS settings pages stack many cards. |
| Existing AirFix tenant has no `calendar_settings` row at deploy | G5 backfill `ON CONFLICT DO NOTHING` runs in the same migration; covered. |
| `day_cities`/`day_extras` cardinality grows | At AirFix's pace (~2 teams × 365 days × 2 years = 1460 rows max for cities, ~3000 for extras), well under any threshold. Indexed by `(tenant_id, date)`. |
| Repo round-trip count on calendar grid mount | One `Promise.all` of 4 fetches at hydration. Worst case ~250 KB total. Acceptable; same as STORY-042 hydration cost. |

## Open questions (decide before G1)

**Q1.** `day_cities` PK = `(tenant_id, team_id, date)` — fine when `team_id` is non-null. But STORY-042's `day_cities` storage allows `team_id = null` for a "default city for the day across all teams" path? Let me re-read… `day-cities.ts:setDayCity` always requires a team_id. **My default: column is NOT NULL.** Confirm.

**Q2.** Should we also migrate `babun-recurring` (service follow-up reminders) in this same story? It's another localStorage key feeding the dashboard sidebar badge. Strictly speaking it's not a calendar-rendering concern, but it shares the migration + import-button infra. **My default: skip — keep STORY-044 about calendar rendering only. `babun-recurring` gets its own story when reminders ship as a feature.** **Confirmed.** Documented as a known limitation: `babun-recurring` continues to live in localStorage post-STORY-044; multi-device drift on the recurring badge is accepted until that future story.

**Q3.** When a user customises `calendar_settings` and we later add a new field, should the migration default-populate that field for all existing rows, or rely on the column DEFAULT clause? **My default: column DEFAULT covers it (Postgres fills in on existing rows when ALTER TABLE adds a column with DEFAULT). Document the convention.**

## What to do next

Awaiting `ok` to start implementation. Recommended order: G1 (SQL — paste-review-apply) → G2 (types) → G3 (4 repos) → G4 (context wiring) → G5 (default in trigger + backfill — folded into G1 as a single migration) → G6 (import section) → G7 (smoke local) → G8 (bump + push) → G9 (production verification).
