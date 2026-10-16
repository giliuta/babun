# STORY-050 — Recurring reminders → Supabase

**Status:** `done` — shipped 2026-04-30, full smoke 10/10 passed in production.
**Estimate:** 1
**Dependencies:** STORY-038 (`current_tenant_id()` ✅), STORY-042 (appointments cloud ✅), STORY-049 (last storage migration ✅).
**Blocks:** none. Closes the last localStorage entity.

## Why

After STORY-042 / 044 / 049, the only domain still living on the device is `babun-recurring`: the HVAC follow-up reminder inbox ("we cleaned the A/C six months ago, time to call back"). Today every reminder is invisible to a second device — if Dima creates the reminder on his iPhone, the office laptop never sees it; if he reinstalls the PWA, the queue is gone.

This is the trivial closing migration: **lift-and-shift the existing model unchanged**. We are NOT building an RFC 5545 RRULE engine — see G0 inventory below for why that wasn't actually the missing piece.

## G0 — Inventory (read-only, completed)

The existing "recurring" feature is a **single-shot follow-up reminder inbox**, not a recurring-event engine. Total scope: ~482 lines across 4 files.

### Data model (`packages/shared/src/local/recurring.ts:14-32`)

```ts
RecurringReminder {
  id, client_id, client_name, phone, team_id,
  service_ids[], service_summary,
  last_date,           // YYYY-MM-DD when the seeding visit happened
  interval_months,     // 3 / 6 / 12 (kept for UI/history; effectively use-once after INSERT)
  next_due_date,       // last_date + interval_months (clamped to last day of target month)
  status: 'pending' | 'booked' | 'dismissed',
  note, created_at
}
```

`client_name` and `phone` are denormalised so deleting a client doesn't drop the reminder (an explicit comment in the source).

### Producers (1 site)

| File:line | Trigger |
|---|---|
| `apps/web/src/components/appointment/AppointmentSheet.tsx:74,1167-` | When an appointment is `completed`, the ⋯ menu shows "Повторить через…". `RepeatReminderSheet` collects months + note → `createRecurring()` from local repo. |

### Consumers (3 sites)

| File:line | Read |
|---|---|
| `apps/web/src/app/dashboard/recurring/page.tsx:9-15` | The inbox page — `loadRecurring()` + `dueReminders()` (within 14 days) + `markStatus()` + `removeRecurring()`. |
| `apps/web/src/components/layout/Sidebar.tsx:16,77-98,183-188` | Sidebar badge — `dueReminders().length` count, refreshes on `babun:recurring-changed` event. |
| `apps/web/src/components/appointment/RepeatReminderSheet.tsx:4` | Imports `addMonthsYYYYMMDD` (pure date math, stays in `local/recurring.ts`). |

### Generation logic

There **isn't any**. Each reminder is a one-shot row; once `booked` or `dismissed` it disappears from the inbox, and the next cycle is created when a new visit completes and the dispatcher taps "Повторить" again. No occurrence engine, no RRULE, no series-vs-instance edit model.

### What does NOT exist (and is therefore explicitly out of scope)

- RFC 5545 RRULE patterns (frequency / byweekday / bymonthday)
- Multi-occurrence generation in date range
- "Edit only this instance" semantics
- Auto-creation of next reminder when current is booked (today's flow is fully manual)

## Decisions (locked)

- **A1.** Schema mirrors the existing `RecurringReminder` shape verbatim. No RRULE columns. `interval_months` is kept (display + history), even though the workflow uses it only at INSERT.
- **A2.** Table name: `recurring_reminders` (plural, matches `appointments` / `clients` / `appointment_photos` convention; the local file is also called `recurring.ts` plural-implied).
- **A3.** RLS pattern STORY-038: single `recurring_reminders_all_own` policy with both `USING` and `WITH CHECK` against `tenant_id = current_tenant_id()`. `to anon, authenticated` — anon get 0 rows because the function returns NULL outside a session.
- **A4.** Hard delete (not soft) for `removeRecurring`. The `dismissed` status already covers "leave the row, hide it"; the X button on the inbox is explicitly destructive (with a `confirm()` modal).
- **A5.** `client_id` is a real FK to `clients(id)` with `on delete set null`. The denormalised `client_name`/`phone` already cover the dangling-reference case. Symmetric with `appointments.client_id`.
- **A6.** `team_id` stays as nullable text (no FK), same as `appointments.team_id`. Teams still live in localStorage as of 2026-04-30.
- **A7.** Update semantics: `updateReminderStatus(id, status)` is the only mutation other than create/delete (matches today's `markStatus`). No `updateReminder` for the body — the existing UI doesn't edit notes/dates after creation.
- **A8.** `babun:recurring-changed` DOM event stays. Sidebar already listens; cloud writes dispatch it after a successful round-trip so the badge updates without waiting for `focus`.

## G1 — SQL migration (`20260430000007_recurring_reminders.sql`)

Full text in `babun-crm/apps/web/supabase/migrations/20260430000007_recurring_reminders.sql`. Sections:

1. CREATE TABLE `public.recurring_reminders` with the columns above.
2. Three indexes: `(tenant_id)`, `(client_id) where client_id is not null`, `(tenant_id, status, next_due_date)` for the inbox query.
3. `set_updated_at` trigger (reuses helper from `20260427000001_init_clients.sql`).
4. `enable row level security` + single all-own policy.

No data migration needed — production count is 0 (feature was localStorage-only before today). Existing tenants who used the inbox locally can lift their queue with the G5 import button.

### Verify after apply (run through SQL editor)

```sql
select
  -- table
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='recurring_reminders') as tbl,
  -- rls on
  (select rowsecurity from pg_tables
     where schemaname='public' and tablename='recurring_reminders') as rls,
  -- 1 policy
  (select count(*) from pg_policies
     where schemaname='public' and tablename='recurring_reminders') as policies,
  -- indexes (pkey + 3 ours = 4)
  (select count(*) from pg_indexes
     where schemaname='public' and tablename='recurring_reminders') as idx,
  -- trigger
  (select count(*) from pg_trigger
     where tgname='recurring_reminders_set_updated_at') as trg;
-- expect: tbl=1, rls=true, policies=1, idx=4, trg=1
```

## G2 — Generate types

```bash
npx supabase gen types typescript --project-id ... > packages/shared/src/db/database.types.ts
```

Adds the `recurring_reminders` table to `Database['public']['Tables']`.

## G3 — Repository (`packages/shared/src/db/repositories/recurring-reminders.ts`)

```ts
listRecurringReminders(sb)                              // all rows for tenant, sorted by next_due_date
getRecurringReminder(sb, id)
createRecurringReminder(sb, tenantId, input)            // input mirrors CreateRecurringInput
updateReminderStatus(sb, id, status)                    // 'pending' | 'booked' | 'dismissed'
deleteRecurringReminder(sb, id)
```

Adapters `rowToReminder` / `reminderToInsert` mirror the local-shape ↔ row-shape pattern from `appointments.ts`. `dueReminders()` and `pendingCount()` stay as pure functions in `local/recurring.ts` (they take an array and a date, no I/O).

## G4 — Context wiring

Two call sites switch from localStorage to repo + tenant context:

- `app/dashboard/recurring/page.tsx`:
  - `loadRecurring()` → `listRecurringReminders(sb)` in an effect, into `useState<RecurringReminder[]>`.
  - `markStatus(id, status)` → `updateReminderStatus(...)` then optimistic local update.
  - `removeRecurring(id)` → `deleteRecurringReminder(...)` then optimistic local update.
  - Keep `babun:recurring-changed` event dispatch on every mutation (sidebar listens).
- `components/appointment/AppointmentSheet.tsx`:
  - `createRecurring(input)` → `createRecurringReminder(sb, tenantId, input)`. Uses the same `useTenantId()` hook introduced in STORY-049.
  - Dispatch `babun:recurring-changed` on success.
- `components/layout/Sidebar.tsx`:
  - `loadRecurring()` → `listRecurringReminders(sb)` lazily on mount + on `babun:recurring-changed`.
  - `dueReminders(items).length` → unchanged (pure helper from `local/recurring.ts`).

`local/recurring.ts` keeps `addMonthsYYYYMMDD`, `dueReminders`, `pendingCount`, `RecurringReminder` type, `CreateRecurringInput` type, `RecurringStatus` type. Drop `loadRecurring` / `saveRecurring` / `createRecurring` / `markStatus` / `removeRecurring` — these were the localStorage shims and get replaced by repo calls.

## G5 — Import button (Settings → Опасная зона)

Pattern from STORY-042 / 044:

- "Импортировать локальные напоминания" button + count of localStorage rows.
- On click: confirm → read all `babun-recurring`, batch-INSERT, write `babun-recurring:backup-{YYYY-MM-DD}` to localStorage, clear `babun-recurring`.
- Auto-prune the backup after 30 days (matches the other 4 entities).

## G6 — Smoke (10 steps, run on local then production)

1. `tsc --noEmit` green.
2. Create reminder via AppointmentSheet flow on a completed appointment ("⋯ → Повторить через 6 мес"). Verify a row landed in `recurring_reminders` with the right `tenant_id` / `client_id` / `next_due_date`.
3. Open `/dashboard/recurring` — the new card is visible (within 14-day window or "Show more" expansion).
4. Sidebar badge shows `1` (or higher if other reminders are due).
5. Tap "Записано" → row's `status='booked'` in DB → card disappears from inbox → badge decrements.
6. Create another, tap × → confirm → row hard-deleted → card disappears.
7. Multi-device: log in as the same user on a second isolated browser context. Reload `/dashboard/recurring`. Reminders created on context A are visible on context B.
8. RLS isolation: log in as User2 (different tenant). `from('recurring_reminders').select('*')` → 0 rows. No leak from User1.
9. RLS write block: as User2, `from('recurring_reminders').insert({ tenant_id: USER1_TENANT_ID, ... })` → expect `42501` (RLS WITH CHECK violation).
10. Import button: clear `recurring_reminders` for the test tenant. Set `localStorage.setItem('babun-recurring', JSON.stringify([f1,f2,f3]))`. Trigger import. Verify 3 rows in DB, `babun-recurring` cleared, `babun-recurring:backup-{date}` populated.

## G7 — Bump + commit + push

`BUILD_VERSION = "v355-recurring-reminders"`, `CACHE_VERSION = "babun-v355"`. Single commit covering G1+G2+G3+G4+G5 + bump.

## G8 — Production verification

Repeat G6 against `https://babun.app` after Vercel deploy is green. Use a `prod-recurring-…@story050.test` test user and `prod-recurring-other-…@story050.test` for the cross-tenant probe; tear down via account-delete after.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Sidebar/inbox refresh races (cloud writes are async) | Optimistic local update + `babun:recurring-changed` event after the round-trip. Same pattern as `clients.ts` repo. |
| Existing localStorage data on Dima's devices is forgotten | Import button (G5). Single click, takes seconds, backed up to a dated key. Auto-prune after 30 days. |
| `client_id` FK breaks if a client is deleted | `on delete set null` plus the denormalised `client_name`/`phone` already in the row preserve UX. |
| Sidebar mounts before tenant context is ready | Same guard as `clients.ts` consumers — bail out of the effect when `tenantId === null`. |

## Acceptance criteria

1. `recurring_reminders` table exists in Supabase with RLS enabled and the all-own policy active.
2. Repository CRUD functions work end-to-end against the cloud.
3. `/dashboard/recurring`, AppointmentSheet "Повторить через" flow, and Sidebar badge all read/write through the repo (no `loadRecurring`/`saveRecurring` left).
4. Multi-device sync verified.
5. RLS isolation + write-block verified (probes 8-9).
6. Import button works and backs up.
7. Smoke 10/10 passed locally, then in production.
8. `v355-recurring-reminders` deployed.

## Out of scope

- RFC 5545 RRULE recurring **appointments** (separate hypothetical fea­ture; the existing inbox is reminder-only).
- Auto-create next reminder when one is booked (still manual via AppointmentSheet).
- iCal export, push notifications, email reminders.
- Editing notes/dates after creation (current UI doesn't expose this).

---

## Close — 2026-04-30

### G6 + G8 smoke results (combined run against production)

All 10 functional smoke probes passed against `babun.app` after `v355-recurring-reminders` deploy:

| # | Probe | Result |
|---|---|---|
| 1 | `tsc --noEmit` green | ✅ |
| 2 | Reminder INSERT round-trip via repo path | ✅ (id `80419593-…`) |
| 3 | `/dashboard/recurring` page renders the card lazily fetched via `listRecurringReminders` | ✅ |
| 4 | Sidebar badge: 0 → 2 → 1 reflects DB pending+due-soon count, refreshes on `babun:recurring-changed` | ✅ |
| 5 | "Записано" → `updateReminderStatus(id,'booked')` → row's `status='booked'`, card disappears from inbox, header drops `(2)→(1)` | ✅ (latency 36s, DB confirmed) |
| 6 | × → confirm modal → `deleteRecurringReminder` → row hard-deleted, badge 2→1 | ✅ |
| 7 | Multi-device: same user logged into a second isolated context → reload `/dashboard/recurring` shows the same survivor + badge `Напоминания 1` | ✅ |
| 8 | RLS read isolation: User2 (different tenant) `select count(*) from recurring_reminders` → 0; explicit `where tenant_id = USER1_TENANT` → 0 | ✅ |
| 9 | RLS write block: User2 `insert into recurring_reminders (tenant_id = USER1_TENANT, …)` → `42501 insufficient_privilege` (caught as `rls_violation_42501_ok`) | ✅ |
| 10 | Settings → Опасная зона "Импортировать 3 напоминаний в облако": 3 INSERTs land for the user's tenant, `babun-recurring` cleared, `babun:recurring:backup-2026-04-30` populated, "Удалится через 30 дн." | ✅ |

### Cleanup verified

After `/api/account/delete` cascade for both test users:

```
auth_users         = 0
tenants            = 0
residual_reminders = 0
```

`recurring_reminders.tenant_id ... on delete cascade` worked end-to-end — no janitor needed.

### Files shipped (commits `6e2bb8a` + close)

- `supabase/migrations/20260430000007_recurring_reminders.sql` (76 lines)
- `packages/shared/src/db/repositories/recurring-reminders.ts` (181 lines, new)
- `packages/shared/src/db/database.types.ts` — `recurring_reminders` table types
- `packages/shared/src/local/recurring.ts` — localStorage writers removed; `loadRecurring` + pure helpers retained
- `apps/web/src/app/dashboard/recurring/page.tsx` — repo wiring + optimistic UI
- `apps/web/src/components/layout/Sidebar.tsx` — badge fetches via `listRecurringReminders`
- `apps/web/src/components/appointment/AppointmentSheet.tsx` — "Повторить через" calls `createRecurringReminder`
- `apps/web/src/components/settings/account/ImportLocalRecurringSection.tsx` (new) + mounted in `account/page.tsx`
- `apps/web/public/sw.js` + `packages/shared/src/common/utils/version.ts` — `babun-v355` / `v355-recurring-reminders`

### Closing note: localStorage migration is now complete

This was the last domain still on the device. After STORY-036 (clients), 042 (appointments), 044 (schedule + calendar settings + day-cities + day-extras), 049 (photos to Storage), and **050 (recurring reminders)**, every customer-facing data domain except a few UI prefs (`babun-sidebar-expanded`, `babun-draft-clients` cleanup vestige, current-master selector) lives in Supabase with multi-device sync + RLS isolation.

