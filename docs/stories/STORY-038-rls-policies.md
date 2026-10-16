# STORY-038 — RLS policies (close the cross-tenant leak)

**Status:** `todo`
**Estimate:** 5 (mostly SQL + one smoke test)
**Dependencies:** STORY-036 (✅ schema), STORY-037 (✅ auth + per-user tenants + JWT stamp).
**Blocks:** removing the `<meta robots noindex>` tag, removing the «trusted-tester only» warning from README/SETUP, opening the URL to a wider audience.

## User story

> **As** a Babun owner,
> **I want** RLS policies on every tenant-scoped table,
> **so that** even if someone opens DevTools and crafts a REST query, they only see their own data — and so we can finally drop the «private dev» warning and let other businesses sign up.

## Why now

STORY-037's smoke test step 9 confirmed the leak: User B's UI correctly shows 0 rows (repository filters by `tenant_id`), but a direct REST query with the publishable key still returns User A's rows. The fix is not in the app code — it's at the database. RLS turns the UI-level filter into a hard rule the publishable key cannot bypass.

## Acceptance criteria

1. RLS is **enabled** on `tenants`, `clients`, `client_tags`, `client_tag_assignments`.
2. Each table has policies for both `anon` and `authenticated` roles (anon → 0 rows by design).
3. User A cannot see User B's data through any path: UI, REST with their session JWT, REST with publishable + session.
4. anon (publishable key, no session) sees 0 rows from any tenant-scoped table.
5. Positive flow not broken: register → list empty → create client → see it → logout → login → still see it.
6. Smoke test 10/10 passes (full table at G4).
7. `<meta name="robots" content="noindex">` removed from `app/layout.tsx`.
8. README.md + docs/SETUP.md «trusted-tester only» warnings removed.
9. `tsc --noEmit` green.
10. Vercel deploy green; production smoke verified.

## Architectural decisions (locked here so the developer doesn't churn)

### A1 — Helper function `public.current_tenant_id()` with JWT-then-DB fallback

```sql
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    -- Fast path: from JWT app_metadata (stamped by handle_new_user
    -- on subsequent sessions). NULL for anon role (no session →
    -- auth.jwt() is null) and for authenticated sessions whose JWT
    -- predates the trigger's stamp (first session post-signup).
    nullif(((auth.jwt() -> 'app_metadata') ->> 'tenant_id'), '')::uuid,
    -- Fallback: lookup by auth.uid(). Catches the first session
    -- after signup, where the JWT was issued BEFORE the trigger
    -- stamped app_metadata. Subsequent token refresh (A2) picks up
    -- the stamp and the fast path takes over.
    (select id from public.tenants where owner_user_id = auth.uid() limit 1)
  );
$$;

revoke all on function public.current_tenant_id() from public;
grant execute on function public.current_tenant_id() to anon, authenticated;
```

**Return value matrix — every case explicit:**

| Caller state | `auth.jwt()` | `auth.uid()` | JWT path | Fallback path | Function returns | Policy outcome |
|---|---|---|---|---|---|---|
| anon (no session) | NULL | NULL | NULL | NULL (NULL = NULL is unknown) | **NULL** | 0 rows ✅ (anon is locked out) |
| authenticated, JWT has stamp | jsonb with `app_metadata.tenant_id` | uuid | uuid | (not evaluated, coalesce short-circuits) | **uuid** ✅ | only own tenant rows |
| authenticated, JWT no stamp, tenant exists (race) | jsonb without claim | uuid | NULL | tenants.id by owner_user_id | **uuid** ✅ | only own tenant rows |
| authenticated, JWT no stamp, NO tenant row (BROKEN) | jsonb without claim | uuid | NULL | NULL (no row matches) | **NULL** ⚠️ | 0 rows |

The last row is the **broken state**: a user exists in `auth.users` but the trigger never inserted a `tenants` row (e.g. trigger was disabled at signup time, manual auth.users creation in Dashboard, or future bug). Policies return 0 rows. The user would see an empty dashboard with no explanation.

**Mitigation: A5** — the server layout's tenant-fetch already returns NULL in this case; we extend the existing `redirect("/login?err=tenant-missing")` to a user-visible explanation rather than a silent loop. See G3.5.

Why **`SECURITY DEFINER`**: the fallback subquery reads `public.tenants`, which now has RLS on. Without `SECURITY DEFINER`, the subquery would call `current_tenant_id()` recursively to satisfy its own RLS policy → infinite loop (or permission denied). Running as the function owner (postgres) bypasses RLS on the lookup. The function itself returns just one uuid — no data leak.

`set search_path = public` blocks schema-shadowing attacks per Postgres SECURITY DEFINER best practice (same hardening we did in STORY-037 G1).

### A2 — Force `refreshSession()` after `signUp()`

The trigger from STORY-037 updates `auth.users.raw_app_meta_data` AFTER the signup transaction commits — but the JWT issued during signup was already minted with the OLD metadata. The first session has no `tenant_id` claim. Without a fix, the user signs up and sees an empty dashboard; the server layout's tenant lookup works (it queries by `auth.uid()`), but every subsequent client REST call goes through RLS, which returns 0 rows because the JWT has no claim.

A1's fallback handles this defensively at the DB layer. **A2 fixes it cleanly at the app layer** — `signUp()` in `auth-client.ts` calls `supabase.auth.refreshSession()` immediately after success, which mints a new JWT with the now-stamped app_metadata.

```ts
export async function signUp(email, password, businessName?) {
  const { error } = await supabase.auth.signUp({ ... });
  if (!error) {
    // Pull the fresh app_metadata.tenant_id stamped by handle_new_user.
    await supabase.auth.refreshSession();
  }
  return unwrap(error);
}
```

A1 + A2 together → fast JWT-claim path is ALWAYS used after the first request. Fallback never fires in practice but stays as belt-and-suspenders.

### A3 — Policies cover all four tables, both roles, all operations

Every tenant-scoped table gets ONE permissive policy for `for all` (SELECT/INSERT/UPDATE/DELETE) keyed off `current_tenant_id()`. Both `anon` and `authenticated` roles are listed:

- For anon (no session): `current_tenant_id()` returns NULL → `tenant_id = NULL` is false → 0 rows. Locked out without a fail-open code path.
- For authenticated: `current_tenant_id()` returns their tenant → only their rows.

The `tenants` table is a special case: there's only ONE row per user, identified by primary key (not `tenant_id`). Policy keys off `id = current_tenant_id()`.

`tenants.delete` is intentionally NOT exposed — users delete their tenant by deleting their auth user (cascade via `owner_user_id` FK). Same for `tenants.insert` — only the trigger creates rows.

### A4 — No code changes to repositories

After audit (G3): every repo function in `@babun/shared/db/repositories/clients.ts` uses the supabase client passed in by the layout, which is the browser/server client backed by the **publishable key + session cookie**. After login, that's the `authenticated` role; before login, it's `anon`. Both roles get the policy. **No service-role bypass needed in app code** — that path is only used by admin/cron tasks (we have none yet).

The `handle_new_user` trigger from STORY-037 is `SECURITY DEFINER` and bypasses RLS by design — already correct, no changes.

### A5 — Broken-tenant fail-loud UX

If the helper returns NULL for an authenticated user (broken state from A1's matrix), we don't want a silent empty dashboard — the user should see a clear error and know to contact support.

The server layout already detects this case (the `tenants` lookup returns NULL when the trigger never fired). We re-purpose its existing `redirect("/login?err=tenant-missing")` branch:

- Param renamed to `?error=tenant_missing` (more conventional, matches Supabase auth callback errors).
- `/login` page reads the param and shows a fail-loud banner above the form: «Аккаунт настроен неправильно. Напиши: airfix.cy@gmail.com».
- After STORY-041 lands a real support form, we'll swap the email link for a deep link into it. For now: hardcoded mailto.

Implementation in G3.5.

## Technical plan

### G0 — Pre-flight repository audit (read-only)

Verify the assumption in A4. Grep:

```bash
grep -rn "SUPABASE_SECRET_KEY\|service_role\|serviceRole\|sb_secret_" babun-crm/apps/web/src
```

Expected: no hits in app code. If any hit appears outside `.env.local`-related files, mark with `// bypass RLS by design` comment in this story's commit, OR refactor to use the publishable client.

**Commit:** none if clean (fold into G1).

### G1 — SQL migration (interactive: stop and ask user to apply)

**File: `apps/web/supabase/migrations/20260429000001_rls_policies.sql`**

```sql
-- ─────────────────────────────────────────────────────────────────────
-- STORY-038 — RLS policies + tenant_id helper.
--
-- After this migration:
--   * RLS is on for tenants, clients, client_tags, client_tag_assignments.
--   * public.current_tenant_id() resolves tenant_id from JWT (fast)
--     with a fallback DB lookup (covers the fresh-signup race where
--     the JWT predates the trigger's app_metadata stamp).
--   * Every tenant-scoped table has one permissive policy keyed off
--     current_tenant_id(). Both anon (→ NULL → 0 rows) and
--     authenticated roles are covered explicitly.
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. Helper ────────────────────────────────────────────────────────
-- SECURITY DEFINER so the fallback subquery on tenants doesn't hit
-- the very RLS policy it's used to evaluate (which would recurse).
-- set search_path blocks schema-shadowing the same way as the STORY-037
-- handle_new_user function.

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(((auth.jwt() -> 'app_metadata') ->> 'tenant_id'), '')::uuid,
    (select id from public.tenants where owner_user_id = auth.uid() limit 1)
  );
$$;

revoke all on function public.current_tenant_id() from public;
grant execute on function public.current_tenant_id() to anon, authenticated;

-- ── 2. Enable RLS ────────────────────────────────────────────────────
alter table public.tenants                enable row level security;
alter table public.clients                enable row level security;
alter table public.client_tags            enable row level security;
alter table public.client_tag_assignments enable row level security;

-- ── 3. Drop any leftover STORY-036 dev policies (none expected, but
--      make idempotent for re-runs).
drop policy if exists tenants_select_own           on public.tenants;
drop policy if exists tenants_update_own           on public.tenants;
drop policy if exists clients_all_own              on public.clients;
drop policy if exists client_tags_all_own          on public.client_tags;
drop policy if exists client_tag_assignments_all_own on public.client_tag_assignments;

-- ── 4. tenants — read + update own row only. No INSERT (handled by
--      handle_new_user trigger), no DELETE (cascade via auth.users
--      delete).

create policy tenants_select_own
  on public.tenants for select
  to anon, authenticated
  using (id = public.current_tenant_id());

create policy tenants_update_own
  on public.tenants for update
  to anon, authenticated
  using (id = public.current_tenant_id())
  with check (id = public.current_tenant_id());

-- ── 5. clients — full CRUD on rows belonging to the caller's tenant.

create policy clients_all_own
  on public.clients for all
  to anon, authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ── 6. client_tags — same shape as clients.

create policy client_tags_all_own
  on public.client_tags for all
  to anon, authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ── 7. client_tag_assignments — junction table; tenant_id is on the
--      junction row itself for fast filtering.

create policy client_tag_assignments_all_own
  on public.client_tag_assignments for all
  to anon, authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ── 8. Sanity check (manual, run after migration):
--   set role anon;
--   select count(*) from public.clients;       -- expect 0
--   reset role;
```

**Apply:** Dashboard SQL Editor (CLI requires PAT we don't have).

**Stop and wait for user confirmation** (`applied`) before moving to G2.

**Commit (after user confirms):** `feat(rls): G1 — RLS policies + current_tenant_id helper`

### G2 — `signUp` refreshes the session

`apps/web/src/lib/supabase/auth-client.ts`:

```ts
export async function signUp(
  email: string,
  password: string,
  businessName?: string,
): Promise<AuthResult> {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.auth.signUp({ email, password, options: { ... } });
  if (error) return unwrap(error);
  // STORY-038 — re-mint the JWT so app_metadata.tenant_id stamped by
  // handle_new_user() lands in the claims. Without this, the first
  // session post-signup goes through current_tenant_id()'s fallback
  // path on every query, which is one extra DB hit per request.
  await supabase.auth.refreshSession();
  return unwrap(null);
}
```

**Commit:** `feat(rls): G2 — refresh JWT after signUp to pick up tenant_id`

### G3 — Repository audit

**Mandatory step — paste the actual grep output into the commit body** so the next reader sees what we checked.

```bash
grep -rn "SUPABASE_SECRET_KEY\|service_role\|sb_secret_\|serviceRole" \
  babun-crm/apps/web/src \
  babun-crm/packages/shared/src
```

Expected result table (fill in actual hits at execution time):

| File | Line | Why | Verdict |
|---|---|---|---|
| (none expected in app source) | | | |
| `apps/web/.env.local.example` | (comment) | template doc | by design |
| `apps/web/.env.local` | (gitignored) | local secret | by design |

If any hit appears in `src/` outside of comments, STOP — that's a leak path. Either refactor to use the publishable client or annotate `// STORY-038: bypass RLS by design (admin operation: <reason>)`.

Add a header comment to `packages/shared/src/db/repositories/clients.ts`:

```ts
// STORY-038 — every function in this file expects a Supabase client
// authenticated as either `anon` (no session) or `authenticated`
// (session cookie). RLS keys off public.current_tenant_id() which
// reads JWT app_metadata.tenant_id (with a DB fallback). Service
// role bypass is intentionally out of scope; admin/cron tasks live
// outside this module.
```

**Commit:** `chore(rls): G3 — repository audit + RLS posture note`

### G3.5 — Broken-tenant fail-loud UX (per A5)

**`apps/web/src/app/dashboard/layout.tsx`** — change the error param:

```ts
if (error || !tenant) {
  redirect("/login?error=tenant_missing");
}
```

**`apps/web/src/app/login/page.tsx`** — read `error` from `searchParams` and forward to the form:

```tsx
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard/clients");
  const { error } = await searchParams;
  return <LoginForm errorCode={error ?? null} />;
}
```

**`apps/web/src/components/auth/LoginForm.tsx`** — accept `errorCode` prop and render a fail-loud banner ABOVE the form when it equals `tenant_missing`:

```tsx
interface LoginFormProps {
  errorCode: string | null;
}

export default function LoginForm({ errorCode }: LoginFormProps) {
  // ... existing state ...
  return (
    <AuthCard title="Babun CRM" subtitle="Войдите, чтобы продолжить">
      {errorCode === "tenant_missing" && (
        <div className="mb-4 rounded-[var(--radius-card)] bg-[rgba(255,59,48,0.08)] border border-[rgba(255,59,48,0.25)] p-3 text-[13px] leading-snug text-[var(--system-red)]">
          <div className="font-semibold mb-1">Аккаунт настроен неправильно</div>
          <div className="text-[var(--label-secondary)]">
            Напиши нам, починим вручную:{" "}
            <a
              href="mailto:airfix.cy@gmail.com?subject=Babun%3A%20tenant_missing"
              className="text-[var(--accent)] font-medium"
            >
              airfix.cy@gmail.com
            </a>
          </div>
        </div>
      )}
      {/* ... existing form ... */}
    </AuthCard>
  );
}
```

(Future STORY-041 swaps the mailto for an in-app support form.)

**Commit:** `feat(rls): G3.5 — fail-loud broken-tenant banner on /login`

### G4 — Smoke test (12 steps via Chrome DevTools + Supabase verification)

Mandatory before G5. **If any step fails, do not remove warnings, do not push.**

| # | Step | Expected | Verify via |
|---|---|---|---|
| 1 | Register User A in incognito ctx «rls-a» (`smoketest-a-{ts}@babun.test`) | redirect `/dashboard/clients`, list empty | Chrome DevTools |
| 2 | User A creates client «AliceTest» | row appears in DB | Supabase REST or SQL Editor |
| 3 | Register User B in NEW incognito ctx «rls-b» (`smoketest-b-{ts}@babun.test`) | redirect `/dashboard/clients`, list empty | Chrome DevTools |
| 4 | User B sees 0 clients in UI | "0 клиентов" + empty state | DOM text |
| 5 | User B's session: direct REST `GET /rest/v1/clients?select=*` | **0 rows** (was 1 before STORY-038) | fetch with apikey + Authorization Bearer of B's session |
| 6 | anon publishable key (no session): direct REST `GET /rest/v1/clients?select=*` | **0 rows** | fetch with apikey only |
| 7 | User A's session: direct REST `GET /rest/v1/clients?select=*` | exactly 1 row, `full_name = 'AliceTest'` | fetch with A's bearer |
| 8 | User B tries `DELETE /rest/v1/clients?id=eq.<AliceTest.id>` and `PATCH` with B's session | both return 0 affected rows / RLS error | fetch with B's bearer |
| 9 | User A updates own tenant name to «Alice's Cleaning» | `tenants.name` updates | UI or REST PATCH |
| 10 | User A tries to PATCH User B's tenant.id | 0 affected rows / RLS denied | fetch with A's bearer, target B's tenant.id |
| 11 | **Race-simulation: broken-tenant UX**. As an admin (Dashboard SQL Editor): `alter trigger on_auth_user_created on auth.users disable;`. Register User C (`smoketest-c-{ts}@babun.test`). Re-enable trigger: `alter trigger on_auth_user_created on auth.users enable;`. Open User C's freshly-issued session in a new incognito ctx «rls-c» — they have an `auth.users` row but NO `tenants` row. | redirect `/login?error=tenant_missing`, fail-loud banner visible with `airfix.cy@gmail.com` mailto | UI snapshot |
| 12 | **Auth flow not broken by RLS**: as User A, sign out. Open `/forgot-password`, submit User A's email. Inspect Supabase Auth logs for `password_recovery_requested`. Open the magic link from logs (or admin-generated link), reset password to a new value, sign in with new password. | reset email logged; reset link works; new password signs in successfully | Supabase Dashboard → Auth → Logs |

For each step, capture the exact response status + body where relevant. Step 5/6/7 are the proof — the previous STORY-037 smoke test showed leaks here; STORY-038 closes them. Step 11 verifies fail-loud UX. Step 12 verifies password recovery still works (RLS shouldn't touch `auth.*` schemas, but worth confirming).

**Cleanup at end of smoke test (mandatory):** delete smoketest users + AliceTest via Dashboard SQL Editor:

```sql
-- Step 11 left a stranded auth.users row for User C with no tenants
-- match. Cleaning auth.users cascades to tenants (FK) and clients
-- (FK).
delete from public.clients where full_name = 'AliceTest';
delete from public.tenants where owner_user_id in (
  select id from auth.users where email like 'smoketest-%@babun.test'
);
delete from auth.users where email like 'smoketest-%@babun.test';

-- Verify orphan cleanup — there shouldn't be any tenants linked to a
-- non-existent owner_user_id either.
select count(*) as orphan_tenants
from public.tenants t
where t.owner_user_id is not null
  and not exists (select 1 from auth.users u where u.id = t.owner_user_id);
-- expect 0
```

If 12/12 pass → proceed to G5. If step 11 fails (banner doesn't appear) — fix the LoginForm prop wiring before continuing. If step 12 fails (password reset broken) — STOP, RLS must be misconfigured for `auth.*`, dig in.

### G5 — Remove warnings + add positive RLS messaging (only after G4 12/12 passes)

This group's commits are NOT pushed yet. We push everything in G6, then verify production, then declare success or revert.

**`apps/web/src/app/layout.tsx`** — drop the entire `<meta robots noindex>` block + its TODO comment.

**`README.md`** — replace the «WARNING — RLS not enabled yet» block with a short positive paragraph:

```md
## Security

Babun is multi-tenant. **Row-Level Security** is on for every
tenant-scoped table — each user only sees their own data, enforced at
the database layer (not just in app code). Even with the publishable
key in the browser bundle, an attacker who opens DevTools and crafts
direct REST queries cannot read other tenants' rows.

What RLS does NOT cover (handled elsewhere):

- **CSRF** — Supabase auth tokens are sent via httpOnly cookies, but
  any future custom POST endpoints will need explicit CSRF tokens
  (tracked separately).
- **Brute-force on login** — Supabase Auth rate-limits sign-in
  attempts out of the box.
- **Session hijacking** — auth cookies are httpOnly + Secure +
  SameSite=lax (Supabase Auth default).

See [docs/SETUP.md](docs/SETUP.md) for local-dev keys.
```

**`docs/SETUP.md`** — drop the warning block at the top. Append a matching short security note:

```md
## Security posture

This deployment is multi-tenant with RLS enforcing isolation at the
DB layer. The publishable key in the browser bundle is safe to
expose. For local dev, you only need the keys listed above —
SUPABASE_SECRET_KEY is server-side only and never sent to the
browser.

(Unchanged) keep the «Confirm email OFF» Dashboard step until
STORY-040 lands a verify-email UI.
```

**Commit:** `chore(rls): G5 — drop noindex + trusted-tester warning post-RLS`

### G6 — Bump + push (then verify production)

- `apps/web/src/app/dashboard/page.tsx` (or `version.ts`) → `BUILD_VERSION = "v346-rls"`
- `apps/web/public/sw.js` → `CACHE_VERSION = "babun-v346"`

**Commit:** `chore(release): G6 — v346-rls`

**Push only after G6 commit.** Single push to `master` carries G1+G2+G3+G3.5+G5+G6. Vercel auto-deploys.

### G6.5 — Production verification (mandatory before declaring closed)

Wait ~60 seconds for Vercel deploy to complete (or watch the deploy in Vercel Dashboard).

Re-run the same G4 12-step smoke against `https://babun2.vercel.app` instead of localhost. Expected: 12/12 same as local.

If any step fails on production:

1. **STOP.** Don't tell the user it's done.
2. `git revert HEAD` (back out v346-rls release commit) and `git revert HEAD~1` (back out warning removal). Push.
3. RLS migration STAYS applied in DB — that's still safe (most-restrictive). The revert just restores the noindex + warnings until we figure out what broke.
4. Surface failure in chat with the failing step + response body.

If 12/12 pass on production → declare **STORY-038 closed**. Update the bottom-of-doc «POST-STORY-038 — public exposure ready» section to reflect verified production status.

## Files touched

### Create

| Path | Purpose |
|---|---|
| `apps/web/supabase/migrations/20260429000001_rls_policies.sql` | helper + RLS + 5 policies |

### Modify

| Path | Change |
|---|---|
| `apps/web/src/lib/supabase/auth-client.ts` | `signUp` calls `refreshSession()` after success |
| `packages/shared/src/db/repositories/clients.ts` | header comment about RLS posture |
| `apps/web/src/app/dashboard/layout.tsx` | error param renamed: `?error=tenant_missing` |
| `apps/web/src/app/login/page.tsx` | accept `searchParams.error`, pass into LoginForm |
| `apps/web/src/components/auth/LoginForm.tsx` | accept `errorCode` prop, render fail-loud `tenant_missing` banner |
| `apps/web/src/app/layout.tsx` | drop `<meta robots noindex>` |
| `README.md` | swap warning for positive RLS posture + threat-model notes |
| `docs/SETUP.md` | swap warning for security posture note; keep Confirm-email-OFF section |
| `packages/shared/src/common/utils/version.ts` | `BUILD_VERSION = "v346-rls"` |
| `apps/web/public/sw.js` | `CACHE_VERSION = "babun-v346"` |

### Delete

None.

## Out of scope (next stories)

- **STORY-039** — teams + roles inside a tenant (relax `tenants.owner_user_id` UNIQUE, add `tenant_members(tenant_id, user_id, role)`, expand RLS to use membership).
- **STORY-040** — onboarding wizard (set business name, default tags, equipment categories).
- **STORY-041** — analytics + feedback funnel.
- **STORY-042** — landing page.
- Email confirmation back to ON — separate decision.

## Risks

**R1 — JWT-stamp race on first session.** Closed by A1's fallback + A2's `refreshSession()`. We test it explicitly in G4 step 1: the brand-new user must see their (empty) clients list, not an RLS-denied error.

**R2 — Helper recursion.** `current_tenant_id()` reads `tenants` (which has RLS). Without `SECURITY DEFINER`, the read would invoke the policy which calls `current_tenant_id()` → infinite. **Mitigation:** SECURITY DEFINER, locked search_path, no dynamic SQL.

**R3 — Existing data orphans.** The `00000000-…-babb` dev tenant has `owner_user_id = NULL`. Its row will be invisible to everyone (NULL never matches `current_tenant_id()`). Same for any leftover clients linked to it ("User1Client" we noticed in the prod smoke). They become invisible in the UI but not deleted. Acceptable. STORY-039 may add a backoffice tool; for now they're inert.

**R4 — Service-role accidental use.** If we ever import `SUPABASE_SECRET_KEY` from a client component, the publishable bundle will leak the secret. **Mitigation:** `.env.local.example` uses `SUPABASE_SECRET_KEY` (no `NEXT_PUBLIC_` prefix), Next bundles it server-side only. G3 audit confirms no current uses. Add a lint hint as a follow-up.

**R5 — `auth.jwt()` shape changes.** Supabase has rotated JWT claim shapes before. If they ever move `tenant_id` out of `app_metadata`, our helper breaks silently. **Mitigation:** the fallback path keeps the app working from the `tenants` table; we'd just lose the fast path. Add a small monitoring SQL `select count(*) from auth.users where (raw_app_meta_data ->> 'tenant_id') is null` to catch drift early — out of scope here.

**R6 — Server layout still uses `tenants.owner_user_id` lookup.** That's still the trustworthy source for the props it passes into `DashboardClientLayout`. No change needed; just be aware that two paths exist (server-layout DB query and helper-function JWT claim) and they MUST agree. They do — both key off the same `auth.uid() → tenants.owner_user_id` relationship.

**R7 — Smoke-test cleanup.** Same as STORY-037: delete smoketest users + AliceTest before declaring success, otherwise auth.users accumulates trash. The brief's order (clients → tenants → auth.users) works; CASCADE FKs also work the other way.

## Working order

1. **architect** (this file) → user reads, says "ок" / "делай".
2. **developer**:
   - **G0** — repository audit (grep). Fold into G1 if clean.
   - **G1** — write migration; print full SQL to chat for review; user pastes into Dashboard SQL Editor; wait for `applied`. Commit.
   - **G2** — `auth-client.signUp` calls `refreshSession()`. Commit.
   - **G3** — repo header comment + paste actual grep output in commit body. Commit.
   - **G3.5** — broken-tenant fail-loud UX (server layout error param + LoginForm banner). Commit.
   - **G4** — smoke test 12 steps (Chrome DevTools + Supabase REST/SQL). **Gate.** Cleanup test users.
   - **G5** — drop noindex + swap warnings for positive RLS messaging. Commit.
   - **G6** — bump versions. Commit. **Single push to master** carrying G1..G6.
   - **G6.5** — production verification (re-run G4 against `babun2.vercel.app`). If 12/12 → declare closed. If anything fails → revert G5+G6, keep migration applied, surface in chat.
3. **reviewer** — `git diff master`:
   - SECURITY DEFINER on helper, set search_path = public
   - helper's NULL-on-broken case matches A1's matrix
   - policies cover both roles (anon, authenticated), both directions (using + with check)
   - signUp's refreshSession is awaited
   - LoginForm `errorCode` prop reaches the banner; mailto link is correct
   - no service-role key import in client bundle (G3 grep output verifies)
   - tsc + eslint green

## Constraints (reminders from CLAUDE.md)

- 400 lines per component (auth pages all under, fine).
- TypeScript strict; no `any`.
- Don't touch ServiceWorkerRegister, swipe / pinch / `touch-action`, calendar, appointments / finance / chats data layers.
- One logical commit per group (G1..G6).
- RU in UI; EN in code.
- Service role key — only for admin/cron operations (none here yet).

---

## ✅ POST-STORY-038 — public exposure ready

Once G4 passes and G5 ships:

- `<meta robots noindex>` is gone.
- README + SETUP warnings are gone.
- The URL is **safe to share with potential customers**.
- New tenants signing up are isolated by RLS — User A cannot see User B no matter what.
- The remaining secrets (SUPABASE_SECRET_KEY) are server-side only.

The deployed instance becomes a real multi-tenant SaaS gate. STORY-039 onward is feature work, not security work.
