# STORY-055 — Personal-event RLS isolation

**Status:** todo
**Estimate:** 3 points
**Dependencies:** STORY-038 (RLS policies), STORY-039 (team roles), STORY-042 (appointments-supabase)

## User story

As a **master who shares a tenant with other masters**, I want my personal events (`kind='event'`/`'personal'`) to be invisible to my colleagues at the database level, so that **a malicious or curious teammate cannot dump my private calendar via a direct Supabase query**.

## Why now

UI privacy already exists ([dashboard/page.tsx](babun-crm/apps/web/src/app/dashboard/page.tsx) filters `visibleAppointments` by `master_id === currentMasterId`), but the row-level guarantee is missing. Anyone authenticated against the tenant can run `supabase.from('appointments').select()` from devtools and see every personal event in the tenant. With v447–v458 turning the personal calendar into a real first-class surface (titles, notes, locations, URLs), the risk is no longer hypothetical — that data is now sensitive enough to warrant DB-level enforcement before this ships to a second tenant.

## Acceptance criteria

- [ ] Master A cannot see Master B's `kind='event'` rows via direct `supabase.from('appointments').select()` on the same tenant
- [ ] Master A cannot UPDATE or DELETE Master B's personal events (RLS rejects)
- [ ] Master A can INSERT their own personal events (previously blocked — INSERT was owner/dispatcher only)
- [ ] Master can UPDATE / DELETE only events where `created_by = auth.uid()`
- [ ] Owner / dispatcher continue to SELECT / INSERT / UPDATE / DELETE `kind='work'` appointments exactly as before — zero regression on the dispatcher flow
- [ ] `PersonalEventSheet.tsx`, `createBlankAppointment`, and `appointmentsCached` need **zero** TS changes — `created_by` is auto-filled by the BEFORE INSERT trigger from `auth.uid()`
- [ ] Service role (used by Edge Functions like `send_push`) continues to bypass RLS as designed
- [ ] Existing 1 production event row is back-filled with the tenant's first owner; no orphaned `created_by IS NULL` rows remain after migration
- [ ] `npx tsc --noEmit` and `npx eslint src` are clean
- [ ] Smoke test on staging: 2 users → master A creates event → master B logs in via incognito → master B sees no event A row

## Technical plan

### DB layer (one migration, no rollback)

`babun-crm/apps/web/supabase/migrations/20260508000001_personal_event_rls.sql`:

1. **Column**

   ```sql
   ALTER TABLE public.appointments
     ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);
   CREATE INDEX IF NOT EXISTS appointments_created_by_idx
     ON public.appointments(created_by) WHERE created_by IS NOT NULL;
   ```

2. **Auto-fill trigger** (`SECURITY DEFINER` + locked search_path so it can read `auth.uid()` regardless of caller's search path)

   ```sql
   CREATE OR REPLACE FUNCTION public.set_appointment_created_by()
   RETURNS TRIGGER AS $$
   BEGIN
     IF NEW.created_by IS NULL THEN
       NEW.created_by := auth.uid();
     END IF;
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

   DROP TRIGGER IF EXISTS trg_appointments_set_created_by ON public.appointments;
   CREATE TRIGGER trg_appointments_set_created_by
     BEFORE INSERT ON public.appointments
     FOR EACH ROW EXECUTE FUNCTION public.set_appointment_created_by();
   ```

3. **Backfill** existing rows where `kind IN ('event','personal')` (currently 1 row in prod). Best-guess heuristic: assign to the first owner of the tenant. This is a one-shot — the only row at risk is the test event with `master_id='master-moujpopm-k61mg'`; if the assignment is wrong the user can fix it manually in Studio.

   ```sql
   UPDATE public.appointments a
   SET created_by = (
     SELECT user_id FROM public.tenant_members tm
     WHERE tm.tenant_id = a.tenant_id AND tm.role = 'owner'
     ORDER BY tm.joined_at LIMIT 1
   )
   WHERE a.kind IN ('event','personal') AND a.created_by IS NULL;
   ```

4. **Policy rewrite** — drop the four old policies, install four new ones. Refinement vs the user-provided SQL: schema-qualify `public.appointments`, restore explicit `to anon, authenticated` / `to authenticated` role clauses (the existing convention from [20260430000008_team_roles.sql](babun-crm/apps/web/supabase/migrations/20260430000008_team_roles.sql)).

   ```sql
   DROP POLICY IF EXISTS appointments_select_member            ON public.appointments;
   DROP POLICY IF EXISTS appointments_insert_owner_or_dispatcher ON public.appointments;
   DROP POLICY IF EXISTS appointments_update_member            ON public.appointments;
   DROP POLICY IF EXISTS appointments_delete_owner_or_dispatcher ON public.appointments;

   CREATE POLICY appointments_select ON public.appointments FOR SELECT
     TO anon, authenticated
     USING (
       tenant_id = public.current_tenant_id()
       AND (kind = 'work' OR created_by = auth.uid())
     );

   CREATE POLICY appointments_insert ON public.appointments FOR INSERT
     TO authenticated
     WITH CHECK (
       tenant_id = public.current_tenant_id()
       AND (
         (kind = 'work' AND public.current_user_role() IN ('owner','dispatcher'))
         OR (kind IN ('event','personal') AND (created_by IS NULL OR created_by = auth.uid()))
       )
     );

   CREATE POLICY appointments_update ON public.appointments FOR UPDATE
     TO authenticated
     USING      (tenant_id = public.current_tenant_id() AND (kind = 'work' OR created_by = auth.uid()))
     WITH CHECK (tenant_id = public.current_tenant_id() AND (kind = 'work' OR created_by = auth.uid()));

   CREATE POLICY appointments_delete ON public.appointments FOR DELETE
     TO authenticated
     USING (
       tenant_id = public.current_tenant_id()
       AND (
         (kind = 'work' AND public.current_user_role() IN ('owner','dispatcher'))
         OR (kind IN ('event','personal') AND created_by = auth.uid())
       )
     );
   ```

### TS layer

**No changes required.** The trigger fills `created_by` server-side, so `appointmentToInsert` in [appointments repo](babun-crm/packages/shared/src/db/repositories/appointments.ts) does not need a new field. The new INSERT policy has a fallback `created_by IS NULL OR created_by = auth.uid()` so a legacy client that doesn't send the column still passes.

### Verification (post-deploy)

1. `npx tsc --noEmit` — green (no TS surface change)
2. `npx eslint src` — green
3. Run `mcp__supabase__list_tables` to confirm `created_by` exists, `mcp__supabase__execute_sql` `SELECT count(*) FROM appointments WHERE kind IN ('event','personal') AND created_by IS NULL` returns 0
4. Smoke test with two real auth sessions:
   - Login as user A on tenant T → create personal event
   - Login as user B on tenant T (incognito) → calendar shows no events from A → run `supabase.from('appointments').select('*').eq('kind','event')` from devtools → returns only B's events (or empty)
5. Bump `BUILD_VERSION` (next free) + `CACHE_VERSION` in `public/sw.js` so PWA forces an SW update; the hidden auth-flow change is enough reason to ship a new SW even though no UI changed

## Files touched

| File | Action | Notes |
|---|---|---|
| `babun-crm/apps/web/supabase/migrations/20260508000001_personal_event_rls.sql` | Create | New migration described above |
| `babun-crm/packages/shared/src/common/utils/version.ts` | Modify | `BUILD_VERSION` bump |
| `babun-crm/apps/web/public/sw.js` | Modify | `CACHE_VERSION` bump |
| `docs/stories/STORY-055-personal-event-rls.md` | Create | This file |
| `babun-crm/packages/shared/src/db/database.types.ts` | Modify (optional) | Add `created_by: string \| null` to `appointments.Row`/`Insert` for type accuracy |

## Out of scope

- UI changes — the personal-event sheet is on v458 and not affected by this story
- Push delivery infrastructure — STORY-053b owns that
- Onboarding fork-state for first-run — STORY-085 owns that
- Master ↔ user_id mapping — explicitly **not needed** for this story; we route privacy through `created_by = auth.uid()` instead of through `master_id`. A future story can layer master-aware sharing (e.g. "dispatcher can see master B's calendar with B's permission") on top, but it is not blocking
- Multi-author event sharing (e.g. "owner can read all personal events") — could be added with an OR clause in the SELECT policy later if compliance / on-call workflows require it

## Risks

- **Backfill heuristic:** the one existing personal event in production gets attributed to the tenant's first owner. If that owner is not the actual author, the row will be invisible to the real author after the migration lands. Mitigation: it's a test event; the user can re-assign or delete it via Studio if needed.
- **`SECURITY DEFINER` trigger** — standard supabase pattern but worth keeping the explicit `SET search_path = public` in the function definition to avoid search-path injection. Already in the SQL.
- **Trigger fires on every INSERT, including `kind='work'`.** That is intentional and harmless — `created_by` is set on work rows too, but the SELECT/DELETE policies for `kind='work'` ignore it. No downstream filter consults `created_by` on work rows.
- **Service-role bypass:** Edge Functions using the service role key continue to bypass RLS as expected; the new policies don't change that. Verified by inspection — `send_push` (when it ships) reads `event_push_at` and `event_push_offsets` columns directly, not gated by RLS.
- **Realtime subscriptions** — the existing realtime channel for `appointments` will now deliver fewer rows to non-author masters. That's the desired behavior; the reload effect on the dashboard will see one less row, no error path.
- **Already-running PWA sessions** with cached realtime subscriptions will keep the old subscription until SW reload. Bumping `CACHE_VERSION` forces the activate, draining the connection.

---

**Next step (after approval):** apply migration via Supabase MCP, bump versions, commit, push. No TS code edits, no UI change, no data loss.
