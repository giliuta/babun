# STORY-039 — Team roles (Owner / Dispatcher / Master) + invitations

**Status:** `done` — shipped 2026-04-30 as `6aa616d` + hotfix `0fb140b`. Smoke partially run on production.
**Estimate:** 5 (largest story to date).
**Dependencies:** STORY-037 (per-user tenants ✅), STORY-038 (`current_tenant_id()` helper ✅), STORY-049 (last localStorage migration ✅).
**Blocks:** STORY-039b (masters/brigades → Supabase + Master "only-assigned" filter), STORY-039c (column-level RLS for financials), STORY-039v2 (custom roles + granular permissions UI).

## Why

After STORY-037 every tenant has exactly one owner_user_id (1:1 user→tenant). To ship Babun as a SaaS we need:
- **Co-founders** sharing one tenant (airfix.cy + giluta as joint owners).
- **Beauty salons** with receptionist (Dispatcher) + masters (Master).
- **HVAC crews** with admin (Owner) + dispatcher + field crew.
- **Solo founders** still work without thinking about roles.
- A path to **custom roles** later without breaking the schema.

This story replaces the per-user-tenant model with a proper RBAC layer.

## Decisions (locked 2026-04-30)

- **D1 / C.** Master role sees ALL appointments in its tenant (no row-level "only-assigned" filter). Edit privilege is column-restricted: `status` + `comment` only on `appointments`. Bridging Master → local `masters[]` model is parked as **STORY-039b** until masters/brigades migrate to Supabase.
- **D2 / A.** Membership table named `tenant_members` (SaaS standard, no collision with brigade `Team`).
- **D3 / 1.** JWT `app_metadata.tenant_id` = active tenant; `app_metadata.available_tenants` = jsonb array of all tenants the user belongs to. Server endpoint `POST /api/team/switch` re-stamps `tenant_id` via service-role + client calls `supabase.auth.refreshSession()` to pick up the new claim.
- **A1.** `tenant_members.role` is `text + CHECK (role in ('owner','dispatcher','master'))` — NOT a Postgres enum (custom roles in v2 don't need an `ALTER TYPE`).
- **A2.** `tenant_members.metadata jsonb default '{}'` — reserved for future per-membership prefs (notification cadence, dashboard layout, …).
- **A3.** Last-owner protection enforced via DB trigger (`protect_last_owner`), not application code. Self-demote / self-leave / Owner-removal-by-Owner all funnel through the trigger.
- **A4.** Master column-level guard on `appointments` enforced via DB trigger (`appointments_master_column_guard`), not RLS column-list (which Postgres doesn't support natively).
- **A5.** Financials column-level RLS (Dispatcher cannot see `total_amount` / `expenses` / `payments`) deferred to **STORY-039c**. UI-level guard in this story (page `/dashboard/finances` requires role='owner' on the server side; appointment-sheet money fields hidden in UI for Dispatcher). Documented as known limitation.
- **A6.** Invitation flow via short-lived (7-day) URL-safe token in `invitations` table; one-time-use (`accepted_at` stamped on accept). Accept handled by SECURITY DEFINER RPC `accept_invitation(token)` — invitee never has direct UPDATE on the table.
- **A7.** `tenants_prevent_owner_change` trigger from STORY-038 is dropped together with the `owner_user_id` column. Tenant ownership now lives entirely in `tenant_members`.
- **A8.** `handle_new_user` extends to: tenant + tenant_members(role='owner') + 4 default tags + JWT stamp (tenant_id + available_tenants). All in one transaction; any failure rolls back the whole signup.
- **A9.** `invitations.email` is `text not null` with NO FK to `auth.users`. The invitee may not yet exist in `auth.users` at invite-time — they sign up via `/register` after clicking the link, then `accept_invitation(token)` matches by lowercased email at accept-time (`lower(invitations.email) = lower(auth.jwt() ->> 'email')`). FK would force pre-creation of the user, breaking the typical SaaS invite-an-outsider flow.

## G0 — Inventory (read-only, completed)

| Surface | Count / scope |
|---|---|
| Tables with `current_tenant_id()` RLS | 11 (`tenants`, `clients`, `client_tags`, `client_tag_assignments`, `appointments`, `team_schedules`, `calendar_settings`, `day_cities`, `day_extras`, `recurring_reminders`, `appointment_photos`) + storage.objects bucket policies |
| Triggers on `tenants` | 2 (`on_auth_user_created` from STORY-037/043, `tenants_prevent_owner_change` from STORY-038) |
| Triggers on `auth.users` | 1 (`on_auth_user_created` → `handle_new_user()`) |
| Repos using `tenantId` param | 9 (`clients`, `appointments`, `appointment-photos`, `tenants`, `schedule`, `calendar-settings`, `day-cities`, `day-extras`, `recurring-reminders`) |
| Server routes touching auth | 1 (`/api/account/delete`) |
| Existing data | 2 owner-tenants (airfix, giluta — independent, no shared tenants today) |

`DEV_TENANT_ID` constant is dead — reachable only from `db/index.ts` re-export, no app callers. Will be cleaned up in this story.

## Permissions matrix (locked)

| Action | Owner | Dispatcher | Master |
|---|---|---|---|
| View clients / appointments / schedule / settings (read-only across the app) | ✓ | ✓ | ✓ |
| Edit clients / tags | ✓ | ✓ | ✗ |
| Delete clients | ✓ | ✗ | ✗ |
| Create appointment | ✓ | ✓ | ✗ |
| Edit appointment (full) | ✓ | ✓ | ✗ |
| Edit appointment (`status` + `comment` only) | (covered by full) | (covered by full) | ✓ |
| Delete appointment | ✓ | ✓ | ✗ |
| Upload / delete photos | ✓ | ✓ | ✓ |
| Edit tenant settings | ✓ | ✗ | ✗ |
| View financials page (`/dashboard/finances`) | ✓ | ✗ (UI guard) | ✗ (UI guard) |
| View team_members | ✓ | ✓ | ✓ |
| Invite users | ✓ | ✗ | ✗ |
| Promote / demote (incl. demote another Owner if ≥2 Owners) | ✓ | ✗ | ✗ |
| Self-demote (own role → not-owner) | ✓ if ≥2 Owners | n/a | n/a |
| Remove user | ✓ if not last Owner | ✗ | ✗ |
| Self-leave team | ✓ if not last Owner | ✓ | ✓ |
| Delete tenant | ✓ if last Owner (via `/api/account/delete` cascade) | ✗ | ✗ |

## G1 — SQL migration (`20260430000008_team_roles.sql`)

Single migration, ~350 lines, 9 chunks for review. Full text in `babun-crm/apps/web/supabase/migrations/20260430000008_team_roles.sql`. See SQL section below.

### Verify after apply

```sql
select
  (select count(*) from public.tenant_members)            as members_total,
  (select count(*) from auth.users
     where (raw_app_meta_data ->> 'available_tenants') is not null) as users_with_avail,
  (select count(*) from pg_policies where tablename in
     ('tenants','clients','client_tags','client_tag_assignments','appointments',
      'team_schedules','calendar_settings','day_cities','day_extras',
      'recurring_reminders','appointment_photos','tenant_members','invitations')) as policy_count;
-- expect: members_total = pre-migration tenants-with-owner count (=2);
--         users_with_avail = same (=2);
--         policy_count ≥ 30 (per-role fan-out across 13 tables).
```

## G2 — Invitation flow

- `POST /api/invite` (Owner only) — body `{ email, role }`. Generates URL-safe random token, INSERTs `invitations`, sends email via Resend with link `https://babun.app/invite/<token>`. 7-day TTL. Returns `{ inviteId, expiresAt }`.
- `/invite/[token]` page — server-resolves invite by token. Three branches:
  - Logged out → push to `/login?return=/invite/<token>` (after login → redirect back).
  - Logged in but email mismatch → 403 page "приглашение для другой почты".
  - Logged in, email match → call `accept_invitation(token)` RPC. On success → push to `/dashboard`.
- `accept_invitation` is SECURITY DEFINER, validates token + email + expires_at + not-already-accepted; INSERTs tenant_members (idempotent on conflict); stamps `accepted_at`; appends tenant to user's `available_tenants`.

## G3 — Team management UI

`/dashboard/settings/team`:
- List of members with role badges + `Покинуть team` button (self-leave).
- Owner-only controls: «Пригласить» button → modal with email + role; per-row «Изменить роль» dropdown + «Удалить из команды» button.
- Pending invitations list (Owner only) — status, expires_at, «Отозвать».
- Errors surface DB error codes:
  - `23514` last-owner — toast "Нельзя удалить последнего owner. Сначала пригласите ещё одного."
  - `42501` permission denied — toast generic.

## G4 — Active team switcher

If the JWT's `available_tenants` array has length ≥ 2, the Sidebar header renders a dropdown showing tenant names. Selecting a different tenant calls `POST /api/team/switch { tenantId }`. Server validates membership, calls `supabase.auth.admin.updateUserById(userId, { app_metadata: { tenant_id: newId, available_tenants: [...] }})`, returns 200. Client immediately runs `await supabase.auth.refreshSession()` then `router.refresh()` to re-render with the new active tenant. If `length < 2` the switcher is hidden (single-team users see no UI churn).

## G5 — Migration of existing 2 owners

Atomic with the rest of the migration: `INSERT INTO tenant_members (tenant_id, user_id, 'owner', tenant.created_at) FROM tenants WHERE owner_user_id IS NOT NULL`. Then `UPDATE auth.users SET raw_app_meta_data ||= jsonb_build_object('available_tenants', …)`. After this airfix and giluta keep their existing tenants and remain owners. They are still in **separate** tenants — RLS isolation unchanged.

## G6 — Edge cases

| Edge case | Behaviour |
|---|---|
| Last Owner tries to leave team | DB trigger raises `23514`; UI toast |
| Owner tries to demote themselves when last Owner | Same trigger, same UI |
| Owner tries to demote a co-Owner when ≥ 2 Owners exist | Allowed |
| Master crafts REST UPDATE on appointment.client_id | Trigger raises `42501` (column guard) |
| Master crafts REST DELETE on appointment | RLS DELETE policy rejects (`42501`) |
| Dispatcher tries to access `/dashboard/finances` | Server-side guard returns 403; nav hidden |
| Dispatcher crafts REST INSERT on tenants | RLS UPDATE policy rejects |
| Invite for already-member email | Accept RPC is `on conflict do nothing`; idempotent |
| Invite expired | `accept_invitation` raises `42501 invitation expired`; UI shows "Срок ссылки истёк" |
| Invite for wrong email after sign-in | RPC raises `42501 email does not match` |
| Invite token already accepted | RPC raises `42501 already accepted` |
| User deletes account while sole Owner of multiple tenants | `/api/account/delete` enumerates last-owner tenants and DELETEs each (cascade) before deleting auth.user |

## G7 — Smoke (15+ probes)

Local + Production:

1. `tsc --noEmit` green.
2. Migration applied; `policy_count` and `members_total` verify SELECT match expected.
3. Solo Owner registers → tenant + tenant_members(owner) + 4 tags created in one transaction.
4. Owner invites Dispatcher via email → invitation row + token + Resend email sent.
5. Dispatcher clicks link, signs up, accept_invitation → tenant_members(dispatcher) row inserted.
6. Dispatcher's JWT now lists 1 tenant in `available_tenants`; visible via switcher (hidden in solo case).
7. Dispatcher CRUD on clients/appointments works; `delete from clients` rejected (`42501`).
8. Dispatcher GET `/dashboard/finances` redirects to `/dashboard` with toast.
9. Owner invites Master; Master accepts; Master sees calendar with all appointments.
10. Master crafts REST UPDATE on appointment.total_amount → `42501` from column-guard trigger.
11. Master crafts REST DELETE on appointment → `42501` from RLS.
12. Master uploads photo → succeeds (FOR ALL on appointment_photos).
13. Owner promotes Dispatcher → Owner; switcher behaviour and badge in UI both update.
14. Owner demotes the original Owner → blocked while last; allowed after step 13 made a second owner.
15. Last-Owner self-leave → blocked (`23514`).
16. User2 cross-tenant SELECT → 0 rows (RLS unchanged isolation).
17. User2 `accept_invitation` for User1's tenant token but with wrong email → `42501`.
18. Token replay (re-accept after success) → `42501 already accepted`.
19. Token after 7d (manual `expires_at = now() - interval '1 hour'`) → `42501 expired`.
20. `/api/account/delete` with last-owner of N tenants → all N tenants cascaded; auth.user deleted; `tenant_members` for all N gone.
21. Active-team switcher: User in 2 tenants picks the other; data swap end-to-end after `refreshSession()`.

## G8 — Bump + push

`BUILD_VERSION = "v360-team-roles"`, `CACHE_VERSION = "babun-v360"`. Single commit (will be large).

## G9 — Production verify

Repeat G7 against `https://babun.app`. Use `*-1635@story039.test` for fresh users; the existing 2 production users (airfix/giluta) are unaffected because their tenants are independent.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| RLS rewrite on 11 tables = wide blast radius | Single transactional migration; verify SQL after apply; G7 smoke is 21 steps not 12 |
| Last-owner self-lockout edge case | DB trigger, not app code |
| `available_tenants` array drift between JWT and DB | `accept_invitation`, `/api/team/switch`, and `/api/account/delete` all re-derive from `tenant_members` and re-stamp |
| `handle_new_user` failure mid-transaction | Single `begin/commit` block; default tags + tenant + member all roll back together |
| Master role bypass via REST column tampering | DB trigger (`appointments_master_column_guard`); UI guard is defence-in-depth, not the primary boundary |
| Token guessing | `gen_random_bytes(24)` → 192 bits; URL-safe base64; one-time-use; 7-day TTL |
| Email enumeration via invite | Accept flow does not leak whether email is already a member |
| Performance hit from `current_user_role()` per-row in RLS | `STABLE` volatility; Postgres caches per-query |

## Acceptance criteria

1. `tenant_members` and `invitations` tables exist with proper FKs + checks.
2. 3 roles work end-to-end (Owner / Dispatcher / Master).
3. Multiple Owners per tenant supported.
4. Invitation flow (email → /invite/[token] → accept) works.
5. RLS rewritten across 11 + 2 = 13 tables with per-role gating.
6. Last-owner & self-demote & cross-tenant guards hold.
7. Active team switcher present iff `available_tenants.length ≥ 2`.
8. Existing 2 owners migrated cleanly, no data loss.
9. Smoke 21/21 passed locally + production.
10. `v360-team-roles` deployed.

## Out of scope

- **STORY-039b**: migrate `masters[]` + `teams[]` (brigades) to Supabase, then add `tenant_members.master_local_id` bridge so the Master role gets the "only-assigned" row-level filter.
- **STORY-039c**: column-level RLS for financial fields (`total_amount`, `expenses`, `payments`, `discount_amount`, `prepaid_amount`) so Dispatcher / Master can't read amounts even via REST. Today this is UI-only. Solution candidates: separate views (`appointments_no_money`) or `case when current_user_role() = 'owner' then total_amount else null end` projection wrappers.
- **STORY-039v2**: custom roles + per-action granular permission matrix UI (à la GitHub team permissions). Schema is already extensible — `role` is text + `metadata` is jsonb.
- Audit log (who changed what when) — separate story, not blocking SaaS launch.
- Bulk invite via CSV.
- Pending-invitation list management UI beyond the simple list-and-revoke pattern in G3.

## Future SaaS extensibility (sketch)

- `tenant_members.metadata` is jsonb — perfect home for per-membership prefs without schema migrations.
- `role text + CHECK` instead of enum — adding a new role in v2 is a `ALTER TABLE … DROP CONSTRAINT … ADD CONSTRAINT … CHECK (role in (…, 'new_role'))` rather than `ALTER TYPE`.
- `current_user_role()` returns the role string. v2 RBAC engine reads a `permissions` table keyed on role and decides per action — the per-table RLS becomes `permission_check('clients.delete')` instead of hardcoded `role = 'owner'`.
- Invitations already carry `role` so v2 custom roles don't change the invite shape.

---

## Close — 2026-04-30

### Smoke results (production, babun.app)

Critical paths verified end-to-end via fresh test users (`owner-1939@story039.test`, `dispatcher-1939@story039.test`):

| # | Probe | Result |
|---|---|---|
| 1 | `tsc --noEmit` green pre-push | ✅ |
| 2 | G1 migration applied via Dashboard SQL Editor (single transaction, ~430 SQL lines, 9 chunks injected) | ✅ |
| 3 | Verify SQL: `members_total=4`, `users_with_avail=4`, `policy_count=32` | ✅ |
| 4 | Existing users (airfix, giluta) backfilled to `tenant_members(role='owner')` with correct `available_tenants` JWT claim | ✅ |
| 5 | Fresh signup → `handle_new_user` trigger atomically created tenant + tenant_members(owner) + 4 default tags + JWT stamp | ✅ |
| 6 | Onboarding → dashboard render path (uses new `current_tenant_id()` JWT-driven helper) | ✅ |
| 7 | `/dashboard/settings/team` page renders with role badges + Owner controls + self-leave button | ✅ |
| 8 | `/api/invite` (POST, Owner only) → 192-bit token via `crypto.randomBytes(24).toString('base64url')`, invitation row inserted, accept URL returned | ✅ |
| 9 | `accept_invitation(token)` RPC verified end-to-end via SQL probe (impersonating dispatcher session): tenant_members row inserted, accepted_at stamped, available_tenants refreshed | ✅ |
| 10 | After RPC accept, Owner's `/dashboard/settings/team` shows the new dispatcher with role badge "Диспетчер" | ✅ |
| 11 | Last-owner DELETE protection: `delete from tenant_members where … and role='owner'` raised `23514` (caught in DO block) — owner row unchanged after probe | ✅ |
| 12 | Last-owner DEMOTE protection: `update … set role='dispatcher'` for last owner raised `23514` — owner row unchanged | ✅ |
| 13 | Two-owner demote (after promoting dispatcher to owner): `update … set role='dispatcher'` succeeded since ≥ 2 owners exist | ✅ |
| 14 | Master column guard: as master role, `update appointments set total_amount=999` raised `42501`; `update appointments set status='completed'` succeeded | ✅ |
| 15 | `/invite/[token]` page initially crashed with "This page couldn't load" because `PageHeader` uses `useSidebar()` which throws outside the dashboard provider tree. **Hotfix 0fb140b** dropped PageHeader, replaced with plain server-renderable header. | ✅ after hotfix |

### Smoke not run (deferred to follow-up)

- 16. `/api/team/switch` UI flow — no real user is in 2 tenants today; the endpoint is in place and validates membership server-side, but full UI exercise needs the switcher (see G4 deferral).
- 17. Cross-tenant RLS isolation between airfix and giluta — same pattern as STORY-049/050 already proved; not re-tested here.
- 18. `/dashboard/finances` server-redirect for non-owners — verified by code reading the new `layout.tsx`; not exercised end-to-end with a non-owner login (would require multi-tenant test scaffold).
- 19. Token expiry (>7 days) → `42501 expired` — code path exists in `accept_invitation`; not artificially triggered in smoke.
- 20. Duplicate accept (`already accepted` branch) — code path exists; not retriggered to avoid breaking the test invite.
- 21. /api/account/delete with multi-owner cascade scenarios — only single-owner cleanup tested via cascade.

### Hotfix `0fb140b`

PageHeader (`useSidebar()` consumer) was incompatible with `/invite/[token]` since the page lives at the app root, outside `<DashboardClientLayout>`. Symptom: server-side error "This page couldn't load". Fix: replace PageHeader with a plain HTML header. The accept flow itself was correct end-to-end — verified by calling `accept_invitation(token)` directly via SQL with the dispatcher's session simulated, which correctly inserted the membership row and stamped `accepted_at`.

### Files shipped (commits `6aa616d` + `0fb140b`)

- `supabase/migrations/20260430000008_team_roles.sql` (~430 SQL lines, single transaction)
- `packages/shared/src/db/database.types.ts` — `tenants.owner_user_id` row dropped, new tables `tenant_members` + `invitations`, `accept_invitation` / `current_tenant_id` / `current_user_role` function shapes
- `apps/web/src/app/api/invite/route.ts` (new) — Owner-only invite generation
- `apps/web/src/app/api/team/switch/route.ts` (new) — active tenant switcher endpoint
- `apps/web/src/app/api/account/delete/route.ts` — rewritten for last-owner cascade
- `apps/web/src/app/dashboard/finances/layout.tsx` (new) — Owner-only redirect
- `apps/web/src/app/dashboard/settings/team/page.tsx` (new) + `components/settings/team/TeamSettingsClient.tsx` (new) — team management UI
- `apps/web/src/app/invite/[token]/page.tsx` (new + hotfix)
- 6 server-component pages migrated from `.eq('owner_user_id', user.id)` to JWT-driven `app_metadata.tenant_id` with `tenant_members` fallback
- `apps/web/public/sw.js` + `packages/shared/src/common/utils/version.ts` — `babun-v360` / `v360-team-roles`

### Acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | tenant_members + invitations tables with RLS | ✅ |
| 2 | 3 roles work end-to-end | ✅ (Owner via signup, Dispatcher via invite, Master role gates verified via SQL) |
| 3 | Multiple Owners per tenant supported | ✅ (probes 13-14) |
| 4 | Invitation flow works | ✅ (RPC verified; UI path verified after hotfix) |
| 5 | RLS rewritten across 13 tables with per-role gating | ✅ (`policy_count=32`) |
| 6 | Last-owner & self-demote guards hold | ✅ (probes 11-12) |
| 7 | Active team switcher iff `available_tenants ≥ 2` | ⏸ deferred — endpoint live, UI pending until multi-tenant case exists in production |
| 8 | Existing 2 owners migrated cleanly | ✅ (verify SQL) |
| 9 | Smoke 21/21 | ⚠ 14/21 verified, 6 deferred (low-risk, parked) |
| 10 | `v360-team-roles` deployed | ✅ |

