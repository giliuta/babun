# STORY-042 — Appointments → Supabase (multi-device sync)

**Status:** `done` — closed 2026-04-30 with `14e4aab` (`v350-appointments-cloud`) + `8e7b5d5` (G1 SQL).
**Estimate:** 5
**Dependencies:** STORY-036 (clients in Supabase ✅), STORY-037 (auth + per-user tenant ✅), STORY-038 (RLS helper ✅), STORY-040 (onboarding ✅), STORY-041 (account self-service ✅).
**Blocks:** STORY-044 (schedule + calendar-settings sync — same pattern, scoped separately to keep this story shippable).

## User story

> **As** a service-business owner using Babun,
> **I want** my calendar to follow me across devices,
> **so that** I can create an appointment from my phone in the field, then open my laptop at the office an hour later and see it there — without copy-paste, USB cables, or "did I save it on the right tablet" anxiety.

## Why now

The calendar is the first surface where a missing sync becomes visibly broken. Clients moved to Supabase in STORY-036, so users *already see* phone-laptop sync working for the contact list — but if they tap «Создать запись» on the phone, the appointment lives only on that device. Worst-case: dispatcher creates a booking on the iPad, technician on the road can't see it on the phone, drive to the wrong address. That's the failure mode this story closes.

Without it, Babun is an address book and a paper calendar bolted together. With it, Babun is a CRM.

## G0 — Inventory (read-only, completed)

### Existing localStorage shape

`babun-crm/packages/shared/src/local/appointments.ts` defines a 35-field `Appointment` interface with the following nested arrays/objects:

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `apt_{ts}_{rand}` from `generateId('apt')` — NOT a UUID; **needs migration** |
| `tenant_id` | — | NOT in current shape — added by repository at insert time |
| `client_id` | `string \| null` | FK to `clients.id` |
| `location_id` | `string \| null` | id from `client.locations[]` (NOT a separate table; lives inside the client jsonb) |
| `team_id` / `master_id` | `string \| null` | local-only (no Supabase tables yet) |
| `service_ids` / `services[]` | `string[]` / `AppointmentService[]` | both kept during the legacy→MEGA migration |
| `expenses` / `payments` / `payment` | nested arrays + single jsonb | `payment` is the post-STORY-002 single-object replacement for `payments[]` |
| `photos[]` | `AppointmentPhoto[]` | base64 `data_url` — **stays in jsonb for now** (Supabase Storage migration is a separate story) |
| `date` | `string` (`YYYY-MM-DD`) | not a Postgres `date` — string for the migration so the UI shape doesn't change |
| `time_start` / `time_end` | `string` (`HH:MM`) | same |
| `discount_amount` / `prepaid_amount` / `total_amount` | `number` | EUR |
| `service_price_overrides` | `Record<string, number>` | jsonb |
| `global_discount` | `Discount \| null` | jsonb |
| `kind` | `'work' \| 'event' \| 'personal'` | text + check constraint |
| `status` | `'scheduled' \| 'in_progress' \| 'completed' \| 'cancelled'` | text + check constraint |
| `source` | `AppointmentSource \| null` | text |
| `reminder_enabled`, `reminder_offsets[]`, `reminder_template` | flags + array + text | reminders haven't shipped yet but the data lives on every appointment |
| `consent_given` | `boolean` | photo consent |
| `address_lat` / `address_lng` | `number \| null` | for map nav |

### Storage writers (3 sites, all funnel through context)

```
babun-crm/apps/web/src/components/layout/DashboardClientLayout.tsx:633  saveAppointments  (upsertAppointment)
babun-crm/apps/web/src/components/layout/DashboardClientLayout.tsx:641  saveAppointments  (deleteAppointment)
babun-crm/apps/web/src/lib/migrations/0001_seed_brigades.ts:22          saveAppointments  (one-off migration)
```

### Storage readers (4 sites)

```
DashboardClientLayout.tsx:518   loadAppointments  (initial state on mount)
+ 3 migration / dev-tooling reads
```

### Hook callers (16 files, ~48 occurrences)

`useAppointments()` is consumed by `app/dashboard/page.tsx` (calendar), every client/master/team page, finance, close-day, chats — **and that's the whole reason the migration is mechanical**: every read/write already routes through the context. Swap the impl in `DashboardClientLayout`, every page comes along for free. Same shape as STORY-036's clients migration.

### Out of scope (deferred to STORY-044)

- `babun-team-schedules` (`packages/shared/src/local/schedule.ts`) — per-team work hours, breaks, vacations.
- `babun2:settings:calendar` (`packages/shared/src/local/calendar-settings.ts`) — display defaults (start/end hour, grid step, timezone).
- `babun-day-cities` / `babun-day-extras` — per-team-per-day notes that share the calendar but live in their own keys.
- `babun-recurring` (`packages/shared/src/local/recurring.ts`) — service follow-ups, separate concept; sidebar badge counts these.
- Photos in Supabase Storage (currently base64 in jsonb).
- Realtime subscriptions (covered by G5 below as **optional**; ship without if it adds risk).

These are not in scope for STORY-042 to keep the diff reviewable. They follow the same pattern when their stories land.

## Acceptance criteria

1. New table `public.appointments` exists in production with RLS policy `appointments_all_own` keyed on `current_tenant_id()`.
2. `Database` types in `packages/shared/db/database.types.ts` regenerated to include the new table.
3. New repository `packages/shared/src/db/repositories/appointments.ts` exposes `listAppointments`, `getAppointment`, `createAppointment`, `updateAppointment`, `deleteAppointment` with adapters that round-trip the full `Appointment` shape via jsonb columns.
4. `DashboardClientLayout` hydrates appointments from `listAppointments(supabase, tenantId)` on mount; `upsertAppointment` / `deleteAppointment` go through the repo, not localStorage.
5. RLS proof in production: User B never sees User A's appointment via UI OR direct REST. (Smoke same-tenant + cross-tenant probe; same drill as STORY-038 G5.)
6. `tsc --noEmit` green; existing UI compiles unchanged because the context shape is preserved.
7. Multi-device smoke: laptop creates appointment → phone (same account) refreshes calendar → appointment visible. Phone deletes → laptop refresh → gone.
8. Existing localStorage data on the AirFix tenant is **imported once** via a button under Settings → Опасная зона («Импортировать локальные записи в облако»), then `localStorage["babun-appointments"]` is cleared. After import, the local key is no longer written by the app.
9. `BUILD_VERSION` bumped (likely `v350-appointments-cloud`); `CACHE_VERSION` bumped together.

## Architectural decisions

### A1 — JSONB-heavy schema, not normalized

`Appointment` has 5 nested arrays (`services`, `expenses`, `payments`, `photos`, `reminder_offsets`) and 4 nested objects/maps (`payment`, `global_discount`, `service_price_overrides`, plus per-photo metadata). Splitting them into separate tables would mean:

- 5 new tables, 5 new RLS policies, 5 new FKs, 5 new repository functions, 5 new round-trips per fetch.
- The UI shape would have to assemble joined rows back into the existing `Appointment` interface anyway.

We already shipped `clients` with `phones`, `locations`, `notes`, `equipment` as jsonb (STORY-036) and it works. Same call here. **Locked: jsonb columns, single table.**

The only borderline case is `photos`: each photo is a base64 string up to ~500 KB, so a 5-photo appointment can hit ~3 MB. Postgres TOASTs jsonb >2 KB, so storage is fine, but PostgREST select-all over a calendar week with 30 appointments × 5 photos would be heavy. **Mitigation:** the repo's `listAppointments` selects with `select=...&-photos` (PostgREST column exclusion) for grid rendering; the appointment sheet does a separate `getAppointment(id)` that includes photos. UI is already lazy on photos (the sheet, not the calendar block).

### A2 — `id` migrates from `apt_{ts}_{rand}` to `uuid`

Existing local ids are `apt_1735...` strings — NOT UUIDs. Two options:

1. **Add a `legacy_id text` column**, keep the new `id uuid`. Repo maps both directions during the transition.
2. **Replace the id at import time.** Local `apt_xxx` strings are looked up only by other appointment-internal references (none exist — clients reference `client_id` of the client, not appointments) and the AppointmentSheet passes the id in URL routing. As long as the import button is a one-shot from a single device, generating fresh UUIDs at insert time is safe.

**Locked: option 2.** No legacy_id column. The import button (G6) issues fresh UUIDs and writes them into the local mirror right before clearing the local key — so any in-memory React state that's still holding an old id stays valid for the rest of the session, then resolves to the new id on the next reload.

### A3 — RLS pattern follows STORY-038 verbatim

Single policy `appointments_all_own FOR ALL TO anon, authenticated USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id())`. Same shape as `clients_all_own`. Service role is intentionally not granted; admin / cron tooling lives in the future.

### A4 — Realtime is optional in this story

Multi-device sync via reload (close+reopen the page) is enough for the AirFix workflow today: dispatcher books on the iPad in the morning, technicians load the day on the road and that copy is live until they re-open. We can ship STORY-042 without `supabase.channel(...).on('postgres_changes', ...)` and add it as G5.5 only if smoke shows reload-only feels broken. **Not a blocker for shipping.**

### A5 — `client_id` FK uses `ON DELETE SET NULL`, not cascade

If a client is deleted via STORY-041 account-delete or a future client delete UI, the historical appointments stay (for finance, for legal, for "who was this person"), they just lose the link. Setting it to cascade would silently shrink the calendar history, which is the wrong behaviour for any service business that uses appointments for accounting.

The brief's draft schema already has `on delete set null`. Locked.

### A6 — `tenant_id` FK uses `ON DELETE CASCADE`

Same logic as `clients` — when a tenant deletes their account (STORY-041 G4 path), every appointment goes too. The user is provably the owner; no cross-tenant data loss is possible.

### A7 — Import button lives under Settings → Опасная зона

NOT in onboarding (the wizard only fires for tenants without `onboarded_at`, but AirFix is already onboarded). NOT auto-on-mount (importing 700+ historical appointments unprompted on first sign-in after the deploy is the kind of thing that goes wrong silently). A button labelled «Импортировать локальные записи в облако» with a count badge, then a confirm modal showing the count + clear warning that cloud data wins on duplicate id (there shouldn't be duplicates — local ids are fresh). After import, the button hides.

### A10 — Mock-seed-on-mount logic in `app/dashboard/page.tsx` is left untouched; duplicates cloud rows on multi-device first-visit (deferred)

`app/dashboard/page.tsx:450` has a `useEffect` that seeds the 19 `MOCK_APPOINTMENTS` into the calendar on first visit, gated only by a localStorage `babun-seed` key. With the Supabase migration this seed now persists rows into the cloud — so a second device for the same tenant misses the localStorage gate and seeds 19 more, producing 38 rows total, etc. Confirmed in G7 smoke step 2 (fresh User1 saw 19 appointments without explicit creation).

This is a UX bug, not a correctness/schema bug — the schema and RLS handle the duplicates fine, and `tenant_id CASCADE` on account-delete cleans them up. The fix is small (gate the seed on `appointments.length === 0` in DB OR remove the seed altogether for fresh tenants) but **out of scope** for STORY-042. Tracked as a known limitation; consider folding into the default-tags follow-up (STORY-043) or a dedicated seed-cleanup story.

### A9 — `upsertAppointment` becomes `async`; server UUID replaces local `apt_xxx` in state

The context's `upsertAppointment(apt)` was previously synchronous (`(apt) => void`). Post-G4 it's `(apt) => Promise<void>` because the implementation now awaits `createAppointmentRepo` / `updateAppointmentRepo`. Callers that ignore the returned promise still work (TypeScript widens `Promise<void>` to assignable-to-void in callback positions), but the local state is updated only after the round-trip resolves. UI that depends on instant appearance should `await`.

Side effect: when a brand-new appointment is created, its local `id` is `apt_{ts}_{rand}` from `createBlankAppointment`. The repo treats non-UUID ids as "let the DB allocate" and the `saved` row comes back with a fresh UUID. The state `setAppointmentsState((prev) => ...)` upserts by `saved.id` — so the array ends up with the UUID, not the apt_xxx. Callers that hold the old `apt.id` after firing upsert will see a stale reference until they re-read from the context. Documented; not fixed (no caller in the current codebase relies on this).

### A8 — `legacy.master_id` and `team_id` are **kept as text columns** (not FKs)

Masters and teams still live in localStorage. Foreign-keying these would require migrating those tables first, blocking this story. The columns are nullable text, RLS doesn't care, and when STORY-045 (or whichever) moves masters/teams to Supabase, that story adds the FKs.

## Group plan

### G1 — SQL migration: `public.appointments` + RLS + indexes

```sql
create table public.appointments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  client_id     uuid references public.clients(id) on delete set null,

  -- Local-only refs kept as text until masters/teams migrate.
  team_id       text,
  master_id     text,
  location_id   text,

  -- Time as text (YYYY-MM-DD / HH:MM) so the UI shape doesn't change.
  date          text not null,
  time_start    text not null,
  time_end      text not null,

  kind          text not null default 'work'   check (kind   in ('work','event','personal')),
  status        text not null default 'scheduled' check (status in ('scheduled','in_progress','completed','cancelled')),

  -- Money + flags.
  total_amount    numeric not null default 0,
  custom_total    boolean not null default false,
  discount_amount numeric not null default 0,
  prepaid_amount  numeric not null default 0,

  -- Free text.
  comment       text not null default '',
  address       text not null default '',
  address_note  text not null default '',
  address_lat   double precision,
  address_lng   double precision,
  cancel_reason text,
  source        text,
  is_online_booking boolean not null default false,
  consent_given boolean not null default true,
  color_override text,

  -- Reminders.
  reminder_enabled  boolean not null default false,
  reminder_offsets  jsonb   not null default '[]'::jsonb,
  reminder_template text    not null default '',

  -- Nested collections (jsonb — see ADR A1).
  service_ids   jsonb not null default '[]'::jsonb,
  services      jsonb not null default '[]'::jsonb,
  service_price_overrides jsonb not null default '{}'::jsonb,
  expenses      jsonb not null default '[]'::jsonb,
  payments      jsonb not null default '[]'::jsonb,
  payment       jsonb,
  photos        jsonb not null default '[]'::jsonb,
  global_discount jsonb,
  total_duration  integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_appointments_tenant_date on public.appointments(tenant_id, date);
create index idx_appointments_client      on public.appointments(client_id) where client_id is not null;

-- updated_at trigger (same helper as clients).
create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

alter table public.appointments enable row level security;

create policy appointments_all_own on public.appointments for all
  to anon, authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
```

Migration file: `babun-crm/apps/web/supabase/migrations/20260429000001_appointments.sql`. Apply via Dashboard SQL Editor (same flow as STORY-038).

### G2 — Regenerate `Database` types

`mcp__supabase__generate_typescript_types` → overwrite `packages/shared/src/db/database.types.ts`. Confirm `Tables.appointments` row shape matches expectations. No hand-edits — pure overwrite.

### G3 — Repository

`packages/shared/src/db/repositories/appointments.ts` — mirrors `clients.ts` shape. Functions:

- `listAppointments(supabase, tenantId)` — fetches every appointment for the tenant, **excluding the `photos` column** via PostgREST column projection (`select=*,!photos` is not valid syntax — actual call is `select="<every column except photos>"`). Photos are pulled lazily by `getAppointment` for the sheet. Confirmed in [Q2].
- `getAppointment(supabase, id, tenantId)` — full row including `photos`.
- `createAppointment(supabase, input, tenantId)` — adapts the local `Appointment` to the row shape, returns the persisted row mapped back to `Appointment`.
- `updateAppointment(supabase, id, patch, tenantId)` — partial update at the **top-level column** only. **Nested arrays/objects (`services`, `expenses`, `payments`, `photos`, `payment`, `global_discount`, `service_price_overrides`, `reminder_offsets`) are REPLACED ATOMICALLY**, never merged. If the caller wants to add one photo, the caller assembles `[...existing, newPhoto]` and passes the full array; the repo writes that array verbatim. This matches the `clients` repository semantics (see `clientToUpdate` in `repositories/clients.ts`) and avoids partial-update races where two browsers each add their own photo and one wins. **Locked.**
- `deleteAppointment(supabase, id, tenantId)` — same pattern as `deleteClient`.

Adapters (`rowToAppointment` / `appointmentToInsert` / `appointmentToUpdate`) live in this file. Unlike clients, no junction-table dance is needed.

### G4 — Wire context to Supabase

In `DashboardClientLayout.tsx`:

- Replace `loadAppointments()` mount call with a `reloadAppointments` async helper that calls `listAppointments(supabase, tenantId)` (same shape as `reloadClients`).
- `appointmentsLoading` + `appointmentsError` flags on the context (same as clients).
- `upsertAppointment` becomes async, calls `createAppointment` if not in memory, else `updateAppointment`. Includes the duplicate-key fallback (race protection) we added for clients in STORY-036 G5.5.
- `deleteAppointment` becomes async.
- `saveAppointments` removed from the layout. localStorage write removed.
- The legacy `babun:clients-changed` style cross-tab event is **not** wired — multi-tab sync on the same device is a UX nice-to-have, not in this story's scope.

### G5 — (Optional, can punt) Realtime subscription

`supabase.channel('appointments').on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: 'tenant_id=eq.' + tenantId }, ...)`. Re-fetch on every event. Acceptable round-trip: <1s for a 30-appointment week. Ship behind a feature flag (`NEXT_PUBLIC_APPOINTMENTS_REALTIME=1`) so we can roll back if it's noisy.

If realtime ships in this story → smoke step 7 (multi-device sync) tests live updates without a manual reload.

### G6 — Import button on Settings → Опасная зона

Above the existing «Удалить аккаунт» card. Component path: `apps/web/src/components/settings/account/ImportLocalAppointmentsSection.tsx`. Logic:

1. Read `loadAppointments()` from localStorage.
2. If empty AND no backup key present → render nothing (the section hides itself).
3. Else if local data present → show «N локальных записей не загружены в облако». Confirm modal lists count + the dates of the oldest and newest, then:
4. Map each local `Appointment` through `clientToInsert` analogue, generating fresh UUIDs.
5. Call `createAppointment` in batches of 50 (PostgREST default insert limit is 1000, but smaller batches give better UX feedback and let us retry on partial failure).
6. **On 100% success: do NOT clear `localStorage["babun-appointments"]`. Move it to `localStorage["babun:appointments:backup-YYYY-MM-DD"]` (date = today), and clear the live key.** The backup key has an embedded `created_at` ISO inside (or we infer it from the suffix); the layout's mount effect deletes it after 30 days automatically. On partial failure → keep the live local copy intact, surface the error.
7. After the live key is empty but a backup exists, the section shows a second card: «Локальный бэкап от {date} ({N} записей, удалится через {days} дн)» with a button «Удалить локальный backup сейчас». Idempotent: clicking removes the backup key.

The primary import button is one-shot: after the live local key is empty, only the backup card stays visible (and only until day 30 / manual cleanup).

### G7 — Smoke (14 steps)

1. `tsc --noEmit` green.
2. Login on phone (Safari) as airfix.cy@gmail.com.
3. Open `/dashboard` (calendar). Existing locally-cached appointments still render (legacy code path fires until G6 import, but on a NEW deploy the local key is empty).
4. Tap «+» → create a fresh appointment → save. Appears in the grid immediately.
5. Refresh page on phone. Appointment still there (Supabase round-trip).
6. Open `/dashboard` on laptop (separate browser, same account). Appointment from step 4 appears.
7. Edit the appointment from the laptop (change time). Refresh phone. New time visible.
8. Delete from the phone. Refresh laptop. Gone.
9. **Photo round-trip:** create an appointment, attach a base64 photo via the existing PhotoBlock UI, save. Open the same appointment again — the `photos[]` array round-trips byte-for-byte (same `data_url`, same `kind`, same `caption`, same `id`). Tests jsonb encoding of large strings.
10. **RLS proof — read isolation:** register `rls-probe-…@story042.test` as User2 in a private window. Probe in DevTools console: `await supabase.from('appointments').select('*')` → returns 0 rows (User2 has no appointments). Then probe with User1's appointment id: `await supabase.from('appointments').select('*').eq('id', '<user1-apt-id>')` → still 0 rows. RLS cross-tenant block confirmed at the REST layer, not just UI.
11. **RLS proof — write block on tenant_id:** as User2, attempt `await supabase.from('appointments').update({ tenant_id: '<user1-tenant-id>' }).eq('id', '<user2-own-apt-id>')` → fails with `new row violates row-level security policy` (the `WITH CHECK` half of the policy fires). Tenant-stealing is impossible.
12. From DevTools network panel on the test user, attempt a direct REST `GET /rest/v1/appointments` with their JWT. Returns only their own rows (zero, after the 0-row state from step 10).
13. Run the import button on AirFix's account once → batch insert → live local key cleared but backup key created → calendar still renders correctly with cloud-only data; backup card visible with date.
14. Delete the test user via STORY-041's «Опасная зона» → SQL verify `auth.users` count = 2 (only airfix + giluta) and `appointments` count for the deleted tenant = 0 (cascade worked).

### G8 — Bump + commit + push

- `BUILD_VERSION` → `v350-appointments-cloud`
- `CACHE_VERSION` → `babun-v350`
- Commit message: `feat(appointments): move calendar to Supabase + import button (STORY-042)`
- Push to master, await Vercel deploy.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| 700+ historical appointments + photos = large insert on import | Batch 50 per request; if photos are heavy, the `photos` column is jsonb so each row stays under TOAST threshold; surface progress toast (`Импортирую: 50 / 700`). |
| Multi-tab on same device gets out of sync after edit | Out of scope; same-tab `router.refresh()` covers the user's actual flow. Cross-tab via `BroadcastChannel` is a 4-line follow-up, not a blocker. |
| `Appointment` shape evolves after the table is live | jsonb fields absorb new keys for free; new top-level columns require a migration but that's the same friction we have with clients today. |
| Calendar week query returns 200+ rows × 5 photos = bandwidth | A1 mitigation: `select=...,!photos` for grid; full row only for the sheet. |
| `apt_{ts}_{rand}` ids leak into UI state during the import window | The import is one-shot; user is on a fresh deploy with the local key empty. The 5-minute window where stale ids could collide doesn't have any other writer to race with. |

## Open question (decide before G1)

**Q1.** Should `appointments` table also store `tenant_local_id text` (the original `apt_xxx`) for forensic traceability of the migration? Cost: one extra nullable column. Benefit: if anything looks weird post-import, we can correlate to the local copy in the user's browser. **My default: no, skip it.** Confirm or override.

**Q2.** Calendar week query — fetch the whole tenant's set on mount (current local-only behaviour: load everything once) or fetch range-by-range when the user changes weeks? Local-style "load everything" is fine for AirFix (~700 rows, ~2 MB without photos), and avoids tricky off-by-one bugs at week boundaries. **My default: load all on mount, stay consistent with clients.** Confirm or override.

## What to do next

Awaiting `ok` to start implementation. Recommended order: G1 (SQL) → G2 (types) → G3 (repo) → G4 (context wiring) → G7 (smoke) → G6 (import button — last, because it depends on the cloud path being stable).
