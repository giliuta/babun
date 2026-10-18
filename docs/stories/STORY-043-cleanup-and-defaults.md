# STORY-043 — Cleanup + Defaults (close STORY-040/042 tails)

**Status:** `done` — closed 2026-04-30 with `f9c4b0e` (`v351-defaults`).
**Estimate:** 2
**Dependencies:** STORY-037 (`handle_new_user` trigger ✅), STORY-042 (appointments in Supabase ✅).
**Supersedes:** the earlier backlog stub `STORY-043-default-tags-on-signup.md` (deleted; this is the merged + scoped version).
**Blocks:** none.

## Why

After STORY-042, Babun's data path is sound (auth + RLS + onboarding + cloud appointments + cloud clients), but two pre-existing artifacts make a brand-new tenant's first session feel wrong:

1. **Mock seed pollutes new tenants' calendars.** `app/dashboard/page.tsx:450` runs a `useEffect` on first dashboard mount that injects 19 hard-coded `MOCK_APPOINTMENTS` into the local `useAppointments()` context — and since STORY-042, those `upsertAppointment` calls hit Supabase. Confirmed during STORY-042 G7 smoke (User1 saw 19 fake appointments without creating any). Multi-device first-visit also amplifies (each device's localStorage gate is independent), so a real tenant ends up with N×19 fake rows. Decision A10 in STORY-042 deferred the fix; this story closes it.

2. **Empty tag taxonomy.** Brand-new tenants land on `/dashboard/clients` with zero tag chips. The four tags we used internally for years — VIP / Новый / Постоянный / Проблемный — are sensible defaults for a service business and lived on the orphan `Babun Dev` tenant until it was deleted post-STORY-041. They should be auto-provisioned for every new signup, and back-filled for AirFix + giluta who registered before the trigger learned this.

After STORY-043, a fresh signup lands with: empty calendar, four ready-to-apply default tags, empty client list, the same 4-step onboarding wizard.

## G0 — Inventory (read-only, completed)

### Mock seed sites

```
apps/web/src/app/dashboard/page.tsx
   line 21:  import { MOCK_APPOINTMENTS, MOCK_SERVICES } from "@babun/shared/local/mock/seed"
   line 91:  const SEED_KEY = "babun-seeded"
   line 450: useEffect(() => { ... seeds MOCK_APPOINTMENTS into upsertAppointment ... }, [])
```

`MOCK_APPOINTMENTS` is the **only** producer that pushes fake calendar rows into the live data path post-STORY-042. The other `MOCK_*` references are unrelated:

- `packages/shared/local/clients.ts` — `loadClients()` returns `MOCK_CLIENTS` as a fallback **for the legacy localStorage reader**, not for the Supabase path. STORY-036 moved clients to `listClients()` from Supabase; the legacy function survives but no longer feeds `useClients()`. Out of scope.
- `components/master/MasterProfileDialog.tsx` — uses `MOCK_SERVICES` / `MOCK_TEAMS` for an internal master profile picker. Out of scope (services + masters are still localStorage; STORY-045+ migrates them).
- `packages/shared/local/mock/seed.ts` — the array definitions themselves. Stays as a `mock/` source file because still consumed by the two out-of-scope places above. We only delete the *call site* in `dashboard/page.tsx`.

### Existing trigger source

`apps/web/supabase/migrations/20260428000001_auth_tenants.sql` defines `public.handle_new_user()`:

- Inserts `tenants` row with `owner_user_id = new.id`.
- Stamps `auth.users.raw_app_meta_data.tenant_id`.
- `SECURITY DEFINER` + `set search_path = public`.

This story modifies the function via `CREATE OR REPLACE` to add a third statement: bulk-insert four `client_tags` rows tied to the new tenant.

### Existing tenant inventory (per STORY-041 cleanup)

```
auth.users         = 2 (airfix.cy + giluta.art)
public.tenants     = 2
public.client_tags = 0   ← post-orphan-deletion, every existing tenant has empty taxonomy
```

Backfill targets: 2 tenants × 4 tags = 8 inserted rows.

## Acceptance criteria

1. `app/dashboard/page.tsx` no longer imports or runs `MOCK_APPOINTMENTS`. The `SEED_KEY` localStorage entry is also no longer written. Existing localStorage flag is left in place (we don't reach into users' browsers to clean it up — it just stops being relevant).
2. Migration `20260430000004_default_tags.sql` extends `handle_new_user()` to insert four default `client_tags` rows in the same transaction as the tenant insert.
3. Same migration back-fills the four default tags for every tenant that doesn't already have a tag with that exact name. Idempotent — re-run is safe.
4. Existing tenants (airfix + giluta) end up with exactly 4 default tags each.
5. A fresh signup ends up with: 4 default tags, empty appointments, empty clients.
6. Production smoke 7/7 (G4 spec) passes locally + on production after deploy.
7. `BUILD_VERSION → v351-defaults`, `CACHE_VERSION → babun-v351`.

## Architectural decisions

### A1 — Variant 1: delete the seed-on-mount call entirely

The user's brief offered two variants; my recommendation is **Variant 1 — full delete**. Rationale:

- The seed has been polluting Supabase since STORY-042 deployed. Keeping it under a `NODE_ENV !== 'production'` guard would still pollute *dev* tenants in the *production* database (we don't have a separate dev Supabase). A guard fixes nothing.
- For local devs who want fake data, the path is to manually create appointments through the UI or run a one-shot SQL seed script. Both are explicit, neither pollutes other developers' shared cloud DB.
- The other `MOCK_*` consumers (clients fallback, master profile dialog) are reading-only and don't pollute the cloud. They stay.

Result: delete lines 449-503 of `app/dashboard/page.tsx` plus the two unused imports and the unused `SEED_KEY` constant.

### A2 — Trigger extension, not a separate trigger

Two ways to wire default tags:

a. Extend `handle_new_user` with `INSERT INTO client_tags ...` after the tenant insert.
b. Create a new trigger `on_tenant_inserted` after insert on `public.tenants`.

**Locked: option a.** Single trigger means a single transactional unit — if any insert fails, the user signup rolls back cleanly. Option b adds a second trigger to chain through, which is harder to reason about and an extra firing on every future tenant insert (e.g. admin tooling). The four `INSERT`s are tiny; folding them into the same function keeps the semantics tight.

### A3 — Backfill via `ON CONFLICT`-equivalent (`NOT EXISTS`)

`client_tags` has no unique constraint on `(tenant_id, name)` (the schema in `20260427000001_init_clients.sql` doesn't define one — STORY-036 didn't anticipate this). A naive `INSERT` of the four defaults for the 2 existing tenants would succeed even on re-run, producing duplicates.

Two options:

a. Add a `UNIQUE(tenant_id, name)` constraint and use `ON CONFLICT DO NOTHING`.
b. Wrap the backfill in a `WHERE NOT EXISTS` guard.

**Locked: option b for THIS story.** Adding the unique constraint is correct long-term but interacts with the `client_tags` repo (the user can already create two tags with the same name through the UI; a backfilled constraint would block future `INSERT`s). Out of scope for STORY-043. The `WHERE NOT EXISTS` guard makes *this migration* idempotent without changing the table contract.

**Customised-colour edge case (locked).** The backfill `WHERE NOT EXISTS` keys on `name` only, not on `(name, color)`. So if a user already renamed their `Постоянный` tag to colour `#84cc16` (a custom green) and kept the name, the backfill skips that row — **the user's customised colour is preserved.** Conversely, if a user renamed the tag to a different name (e.g. `Лояльный`) and deleted `Постоянный`, the backfill *will* recreate `Постоянный` with the default colour, because we have no signal that they made a deliberate rename. Documented; not addressed (correct behaviour for a defaults-population story; if a user wants the tag gone they can delete it again).

### A4 — Backfill goes ONLY for tenants with `owner_user_id IS NOT NULL`

The orphan `Babun Dev` was deleted by hand (post-STORY-041), so today there are 0 orphans — but the backfill query is forward-looking. If a future migration accidentally re-introduces an orphan, we don't want to give it default tags. The `WHERE owner_user_id IS NOT NULL` guard keeps the system clean.

### A5 — `mock/seed.ts` source file stays

Two consumers (`local/clients.ts:loadClients` legacy fallback + `MasterProfileDialog.tsx`) still import `MOCK_*` arrays. Removing the source file would break compile for paths that aren't on this story's hit list. We delete the call site, not the data definitions. STORY-045 (masters → Supabase) and the eventual decommissioning of the legacy `loadClients` fallback can prune the file.

### A6 — `default_tags` payload is hard-coded in the migration, not a config table

For now, four tags is a static list. Promoting them to a `default_tag_templates` table would be premature — we have one product (Babun-for-services) and one set of defaults. If multi-vertical defaults appear in the future (HVAC vs beauty would have different sensible tags), that's its own story. **Locked: hard-coded list inside the trigger function + the backfill INSERT.**

## Group plan

### G1 — Remove MOCK_APPOINTMENTS seed-on-mount

`apps/web/src/app/dashboard/page.tsx`:

- Drop the `MOCK_APPOINTMENTS, MOCK_SERVICES` import (line 21). `MOCK_SERVICES` was only used inside the seed loop — it stays unreferenced after, so it goes too.
- Drop `const SEED_KEY = "babun-seeded"` (line 91).
- Delete the entire `useEffect` body that reads `appointmentsRef`, iterates `MOCK_APPOINTMENTS`, builds `Appointment` objects, calls `upsertRef.current(apt)`, and sets `SEED_KEY` (lines 449-503 inclusive).
- Re-run typecheck. Any unused-variable warnings get cleaned up at the same time.

No corresponding test changes — there were none for the seed path to begin with.

### G2 — Migration `20260430000004_default_tags.sql` (review-required before apply)

Two statements in order:

1. `CREATE OR REPLACE FUNCTION public.handle_new_user()` with the new body that inserts the tenant, stamps app_metadata, AND inserts the four default tags. The trigger itself is unchanged (still `on_auth_user_created` AFTER INSERT on `auth.users`).
2. The back-fill `INSERT INTO public.client_tags (...) SELECT ... FROM public.tenants t CROSS JOIN (VALUES ...) WHERE owner_user_id IS NOT NULL AND NOT EXISTS (...)`.

Body sketch (final SQL written before apply):

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_tenant_id uuid;
begin
  insert into public.tenants (id, name, vertical, owner_user_id)
  values (
    gen_random_uuid(),
    coalesce(new.raw_user_meta_data->>'business_name', new.email),
    'unknown',
    new.id
  )
  returning id into new_tenant_id;

  -- STORY-043 — default tags. Four rows per new tenant.
  insert into public.client_tags (id, tenant_id, name, color) values
    (gen_random_uuid(), new_tenant_id, 'VIP',         '#f59e0b'),
    (gen_random_uuid(), new_tenant_id, 'Новый',       '#3b82f6'),
    (gen_random_uuid(), new_tenant_id, 'Постоянный',  '#10b981'),
    (gen_random_uuid(), new_tenant_id, 'Проблемный',  '#ef4444');

  update auth.users
     set raw_app_meta_data =
           coalesce(raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object('tenant_id', new_tenant_id::text)
   where id = new.id;

  return new;
end;
$$;

-- ── Back-fill for existing tenants ───────────────────────────────────
insert into public.client_tags (id, tenant_id, name, color)
select gen_random_uuid(), t.id, tag.name, tag.color
from public.tenants t
cross join (values
  ('VIP',         '#f59e0b'),
  ('Новый',       '#3b82f6'),
  ('Постоянный',  '#10b981'),
  ('Проблемный',  '#ef4444')
) as tag(name, color)
where t.owner_user_id is not null
  and not exists (
    select 1 from public.client_tags ct
    where ct.tenant_id = t.id and ct.name = tag.name
  );
```

Apply path: paste into Supabase Dashboard SQL Editor (same `monaco.editor.getModels()[0].setValue()` workaround used in STORY-042 G1). After apply, verify with `SELECT count(*) FROM public.client_tags GROUP BY tenant_id;` — should return 4 per tenant for both airfix and giluta.

### G3 — Smoke (executed during the migration session, before code changes deploy)

These probes run **immediately after** the migration applies — before any Vercel deploy — because they only touch the DB:

1. **Backfill correctness**: `SELECT t.name, count(ct.*) FROM tenants t LEFT JOIN client_tags ct ON ct.tenant_id = t.id WHERE t.owner_user_id IS NOT NULL GROUP BY t.name;` → both rows show `count = 4`.
2. **Trigger fires for new signup**: register test user `defaults-smoke-…@story043.test`. Then `SELECT name, color FROM client_tags WHERE tenant_id = (SELECT id FROM tenants WHERE owner_user_id = (SELECT id FROM auth.users WHERE email = '<test email>'));` → 4 rows: VIP/Новый/Постоянный/Проблемный with the locked colours.
3. **Appointments empty for new signup**: `SELECT count(*) FROM appointments WHERE tenant_id = '<test tenant>'` → 0. Confirms G1 + G2 don't accidentally seed anything.
4. **Backfill idempotent**: re-run only the `INSERT ... WHERE NOT EXISTS` block; verify `count = 4` per tenant unchanged.
5. **Test user delete cascades the new tags**: hit Settings → Опасная зона → УДАЛИТЬ on the test user; verify `SELECT count(*) FROM client_tags WHERE tenant_id = '<test tenant>'` → 0.
6. **Calendar UI on a brand-new browser context**: open `/dashboard` for a fresh test user (no localStorage) — calendar grid renders with zero blocks.
7. **Tag picker shows defaults**: open a client (after creating one), open the tag picker — 4 default tags visible.

Steps 6-7 require a deploy of the G1 change (the seed only stops firing once the new bundle ships). So G3.6 + G3.7 actually run during G6 (post-deploy production verification). G3.1 through G3.5 run pre-deploy on the migration alone.

### G4 — Implementation deltas summary

```
M  apps/web/src/app/dashboard/page.tsx                        (~57 lines deleted)
A  apps/web/supabase/migrations/20260430000004_default_tags.sql (~50 lines)
M  packages/shared/src/common/utils/version.ts                 (v350 → v351)
M  apps/web/public/sw.js                                       (babun-v350 → babun-v351)
```

No new TypeScript files. No repo changes. No layout changes. Surface area is small.

### G5 — Bump + commit + push

- `BUILD_VERSION = "v351-defaults"`
- `CACHE_VERSION = "babun-v351"`
- Commit: `feat(defaults): G1-G3 — remove fake seed + default tags trigger + backfill`
- Push to master, await Vercel deploy. The migration was already applied during G2 — deploy only ships the `app/dashboard/page.tsx` cleanup.

### G6 — Production verification

After Vercel deploy of v351:

a. Visit `https://babun.app/dashboard` as one of the live users (airfix or giluta) — grid renders without injecting MOCK_APPOINTMENTS (the legacy 19 rows that they accumulated during STORY-042 are still in DB; this story doesn't retroactively delete them).
b. **Full new-user regression sweep.** Register a fresh test user `prod-defaults-…@story043.test`. Walk through every onboarding step:
   - Step 1 (business name): pre-fills email or empty; type a name; «Далее» enables.
   - Step 2 (vertical): 5 options; pick one; «Далее» enables.
   - Step 3 (city): optional, can skip; «Далее» enables.
   - Step 4 (done): atomic commit; «Перейти к панели» lands on `/dashboard/clients`.
   - `/dashboard/clients` renders with 0 clients but the tag picker shows 4 default tags.
   - `/dashboard` (calendar) renders empty (no seed).
   - Sidebar shows the live tenant name + the test email (STORY-041 G3 regression check).
c. SQL verify on production: `SELECT count(*) FROM client_tags WHERE tenant_id = '<test tenant>'` → 4. `SELECT count(*) FROM appointments WHERE tenant_id = '<test tenant>'` → 0. Names + colours match the locked palette.
d. Cleanup: account-delete the test user. Verify `client_tags` and tenants both cascade-cleaned.

### G7 — Optional housekeeping (not in scope, just noted)

- Existing airfix tenant has the 19 mock appointments still in DB from earlier STORY-042 testing. Could offer a one-shot "Очистить демо-данные" button in Settings for them. **Out of scope** — they can delete manually if they want.
- Could add `UNIQUE(tenant_id, name)` to `client_tags` as a follow-up. Would require a UI change to surface the conflict on rename. **Out of scope.**

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Trigger insert of 4 tags slows signup | Negligible — 4 INSERTs of 60-byte rows. <5ms added to the trigger. |
| User-deleted default tag returns on next migration | Migrations apply once. Re-running this exact migration during a recovery would re-create deleted defaults — acceptable behaviour for "defaults", documented in A3. |
| existing tags on airfix / giluta with same names but different colours | Backfill `WHERE NOT EXISTS` keys on `name` only — different colour with same name skips the insert. Acceptable: we don't want to override the user's chosen palette. |
| Seed removal breaks dev workflow | Locally devs can register a fresh user OR run an ad-hoc SQL `INSERT` if they want demo data. The product code path stays clean. |
| `mock/seed.ts` ends up with unreferenced `MOCK_APPOINTMENTS` after the import is dropped | Two existing consumers (`MasterProfileDialog`, `local/clients.ts`) still pull `MOCK_SERVICES`/`MOCK_TEAMS`/`MOCK_CLIENTS` from it; `MOCK_APPOINTMENTS` becomes dead-but-not-unreachable. TypeScript / ESLint will flag it as unused export. Out of scope to delete the array — minor noise; STORY-045 cleans up. |

## Open question (decide before G2)

**Q1.** The brief says back-fill should NOT skip a tenant that's missing only one or two of the four defaults — it should top them up. The `NOT EXISTS` guard does exactly that (per-tag, not per-tenant). Confirm this is the intended behaviour. **My default: yes, top-up per-tag.** If you want all-or-nothing per-tenant, the SQL changes shape.

**Q2.** Should I add a unit test for `handle_new_user` (e.g. via a temporary `auth.users` insert in a transaction that rolls back)? The codebase has no Supabase function tests today; doing it now bootstraps a precedent. **My default: no, skip — this story doesn't justify the test infra. Verify via G3 smoke instead.**

## What to do next

Awaiting `ok` to start implementation. Recommended order: G1 (code) → G2 (SQL paste-review-apply) → G3 (DB-only smoke) → G5 (bump + commit + push) → G6 (post-deploy verification on babun.app).
