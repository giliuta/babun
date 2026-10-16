# STORY-037 — Supabase Auth (real login, register, reset, per-user tenant)

**Status:** `todo`
**Estimate:** 8 (heavy — split if it overflows)
**Dependencies:** STORY-036 (✅ done — clients on Supabase, hardcoded `DEV_TENANT_ID`)
**Blocks:** STORY-038 (RLS — can't policy by `auth.tenant_id()` until users exist), STORY-039 (teams/roles), STORY-040 (onboarding wizard), removal of `<meta robots noindex>` and the README/SETUP warnings.

## User story

> **As** the Babun owner (and future tenants),
> **I want** real email/password sign-in for my account,
> **so that** the deployed instance stops being a public read-only window into the data, and so each business gets its own isolated tenant.

## Why now

The DB is currently publicly readable (no RLS, single `DEV_TENANT_ID`). The temporary Basic Auth gate in STORY-036b never reached parity and was reverted. We need real Supabase Auth as the prerequisite for STORY-038's RLS policies — until users exist with stable identity, RLS can't gate by tenant. We're keeping a strict scope here: **only auth + per-user tenant**. RLS lands in the very next story so the window of "auth without isolation" is short.

## Acceptance criteria

1. `babun2.vercel.app/register` lets a new user create an account; redirects to `/dashboard/clients` (empty list).
2. Logout from the sidebar clears the session and redirects to `/login`.
3. `/login` works with the just-created credentials and routes back to `/dashboard/clients`.
4. Direct GET on any `/dashboard/...` URL without a session → server-side redirect to `/login`.
5. `/forgot-password` accepts an email, sends a Supabase password-reset link; clicking the link lands on `/reset-password` and lets the user set a new password.
6. Every new user gets exactly one `tenants` row (created by a trigger on `auth.users`); the user's tenant_id is what the dashboard reads from now on.
7. `tsc --noEmit` green; no new `any`.
8. Vercel deploy green with **no new env vars** (Supabase URL + publishable + secret + dev tenant id were already added in STORY-036).
9. `DEV_TENANT_ID` constant deleted from the codebase; the only remaining reference is a SQL row in `tenants` that's safe to leave or drop.

## Architectural decisions (locked here so the developer doesn't churn)

### A1 — Server-component auth gate, **not** a Next middleware/proxy.

After the STORY-036b proxy.ts fiasco (deprecated `middleware.ts` convention + Edge runtime hash mismatches we never tracked down), the cleanest pattern in Next 16 is:

- Make `/dashboard/layout.tsx` an **async server component** that calls `await getSupabaseServer()` → `supabase.auth.getUser()`.
- If `user` is `null` → `redirect('/login')`.
- Fetch the user's tenant on the server, pass `tenantId` (and `userEmail`) into the existing client layout as props.

This avoids:
- Edge runtime quirks we hit in 036b (`crypto.subtle`, env var inlining, deprecated file convention).
- PWA service-worker interference (middleware can serve cached responses with stale auth state).
- The need to wire `Authorization` headers for client-side fetches (Supabase JS handles cookies automatically through `@supabase/ssr`).

Cost: one extra `supabase.auth.getUser()` round-trip per dashboard render. Acceptable — Supabase caches sessions on the user's cookie, and the request is single-digit ms most of the time. We can add a cookie-only fast path in STORY-038/039 if it shows up in profiling.

### A2 — Per-user tenant via SECURITY DEFINER trigger on `auth.users`.

The trigger does two things:

1. Inserts a row into `public.tenants` for the new user (with `owner_user_id = NEW.id`).
2. Stamps `tenant_id` into `auth.users.raw_app_meta_data` so it lands in the JWT under `app_metadata.tenant_id`. This is **a nice-to-have for STORY-038's RLS helper** — `auth.tenant_id()` can read the JWT claim instead of joining `tenants` on every check.

The server layout in G5 still uses the `tenants` table as the **source of truth** (it queries by `owner_user_id`); the JWT stamp is purely a performance hint for STORY-038 onward.

`SECURITY DEFINER` is required because the trigger fires in the auth schema's context as the auth-admin role, which does NOT have INSERT on `public.tenants` or UPDATE on `auth.users`. The function is owned by `postgres` (default for migrations), so it runs with postgres privileges.

`set search_path = public` blocks schema-based hijacking — without it, an attacker who can create a function in a writable schema could shadow `gen_random_uuid` etc.

Schema change: `tenants.owner_user_id uuid references auth.users(id) on delete cascade`, plus a partial unique index on `owner_user_id where owner_user_id is not null` (the `00000000-...-babb` dev tenant has NULL owner — partial index lets it coexist). STORY-039 relaxes the unique constraint when teams arrive.

**Full SQL is in G1 below — every block is annotated.**

### A3 — Email confirmation: OFF for dev tenancy, document the trade-off.

Supabase's default "Confirm email" ON is the safe production setting but blocks the smoke-test we'll run in this story. **Plan: turn it OFF in Dashboard → Authentication → Providers → Email → "Confirm email" toggle.** This is a one-time Dashboard click (not a code change). We document it in `docs/SETUP.md` and add a TODO marker for STORY-040 to revisit when we add an "Verify your email" UI flow.

### A4 — Existing `DEV_TENANT_ID` row.

The `00000000-...-babb` tenant row stays in the DB (its `owner_user_id` will be NULL — that's OK, `unique` index treats NULL as distinct in Postgres). Existing clients table rows referencing it become orphans — that's the brief's "data is throwaway" stance. STORY-038 might cascade-delete them when RLS is enabled.

The `DEV_TENANT_ID` *constant* is removed from the codebase as per acceptance criterion #9.

## Technical plan

### G0 — Pre-flight (clean slate before auth lands)

Read the current state of `apps/web/src/app/login/page.tsx`. After STORY-036b revert, it's a stub that just navigates to `/dashboard`. We'll rewrite it in G3 — confirm there are no leftover proxy/middleware references that would fight the new flow.

Verify:
- No `apps/web/src/middleware.ts` or `apps/web/src/proxy.ts` (STORY-036b removed proxy.ts).
- No `BASIC_AUTH_HASH` references anywhere in `src/` or `.env*.example`.

If any leftover found → fix in this group.

**Commit:** `chore: pre-flight clean for STORY-037`

(Likely empty — fold into G1 if so.)

### G1 — SQL migration (interactive: stop and ask user to apply)

**File: `apps/web/supabase/migrations/20260428000001_auth_tenants.sql`**

```sql
-- ─────────────────────────────────────────────────────────────────────
-- STORY-037 — per-user tenants + signup trigger.
--
-- After this migration:
--   * Every row in auth.users has exactly one matching public.tenants
--     row with owner_user_id = auth.users.id (created by trigger).
--   * tenant_id also lives in auth.users.raw_app_meta_data so it ends
--     up in the JWT for STORY-038's auth.tenant_id() helper.
--   * The legacy 00000000-…-babb tenant from STORY-036 stays in place
--     with owner_user_id = NULL; it's an orphan, harmless, ignored
--     by the partial unique index.
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. Schema change: tenants.owner_user_id ──────────────────────────
-- Each tenant maps back to its owning auth user. on delete cascade
-- means deleting an auth user nukes their tenant + (eventually,
-- under STORY-038 RLS) all their data through fk cascades from
-- tenants → clients → appointments → …

alter table public.tenants
  add column if not exists owner_user_id uuid
    references auth.users(id) on delete cascade;

-- ── 2. Partial unique index ──────────────────────────────────────────
-- Enforces one tenant per user FOR NOW. The `where … is not null`
-- clause lets the legacy DEV tenant (owner_user_id NULL) coexist.
-- STORY-039 will replace this with a team-membership table.

create unique index if not exists tenants_owner_user_id_unique
  on public.tenants(owner_user_id)
  where owner_user_id is not null;

-- ── 3. Signup trigger function ───────────────────────────────────────
-- Fires AFTER INSERT on auth.users. SECURITY DEFINER → runs as
-- postgres so it can write to public.tenants and update
-- auth.users.raw_app_meta_data. set search_path = public blocks
-- schema-shadowing attacks (without it, an attacker who can create
-- a function in another writable schema could hijack gen_random_uuid).
--
-- Body in two steps:
--   a) insert the tenant
--   b) stamp tenant_id into raw_app_meta_data. The current session's
--      JWT was already issued by this point so it does NOT contain the
--      stamp; the stamp matters from the next sign-in onward (STORY-038
--      RLS reads it). The server-side layout in G5 always re-queries
--      `tenants where owner_user_id = user.id` as the source of truth,
--      so first-session ergonomics aren't impacted.

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

  -- b) stamp tenant_id into the JWT-bound app_metadata.
  -- raw_app_meta_data is the admin-only metadata bucket — users
  -- can NOT mutate it from the client (unlike raw_user_meta_data),
  -- so it's safe to trust on the server.
  update auth.users
     set raw_app_meta_data =
           coalesce(raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object('tenant_id', new_tenant_id::text)
   where id = new.id;

  return new;
end;
$$;

-- ── 4. The trigger itself ────────────────────────────────────────────
-- drop-then-create idiom keeps the migration idempotent if it ever
-- gets re-run (which Supabase CLI sometimes does on drift detection).

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 5. Defensive grants ──────────────────────────────────────────────
-- SECURITY DEFINER already runs as postgres which has full rights,
-- but explicit grants make the intent auditable in pg_dump.
grant insert on public.tenants to postgres;
grant update on auth.users to postgres;
```

**Apply:** CLI fallback ladder same as STORY-036 G2 — try `npx supabase db push` from `apps/web/`; if it fails (likely, no PAT), fall back to Dashboard SQL Editor.

**Plus a Dashboard config click — not SQL:**
> Dashboard → Authentication → Providers → Email → toggle **"Confirm email" OFF** for now (architectural decision A3).

**Stop and wait for user confirmation** (`applied`) before moving to G2.

**Commit (after user confirms):** `feat(auth): G1 — SQL trigger for per-user tenants`

### G2 — Auth client helpers

`apps/web/src/lib/supabase/auth-client.ts`:

```ts
"use client";
import { getSupabaseBrowser } from "./client";

export async function signUp(email: string, password: string) {
  const supabase = getSupabaseBrowser();
  return supabase.auth.signUp({ email, password });
}

export async function signIn(email: string, password: string) {
  const supabase = getSupabaseBrowser();
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  const supabase = getSupabaseBrowser();
  await supabase.auth.signOut();
}

export async function requestPasswordReset(email: string, redirectTo: string) {
  const supabase = getSupabaseBrowser();
  return supabase.auth.resetPasswordForEmail(email, { redirectTo });
}

export async function updatePassword(newPassword: string) {
  const supabase = getSupabaseBrowser();
  return supabase.auth.updateUser({ password: newPassword });
}
```

These are pure Supabase passthroughs — kept in their own file so the auth pages don't reach into `getSupabaseBrowser()` directly and the surface stays small.

**Commit:** `feat(auth): G2 — auth client helpers`

### G3 — Auth pages

**Visual language (locked here so the developer doesn't drift).**

All five auth pages share one Babun-style template — iOS-like, function-first, no marketing copy. The landing page lives in STORY-042; here we just need a clean entry point trusted-testers feel at home in:

- **Background:** solid `var(--surface-grouped)` (the same grey we use everywhere else). No gradient — it'd fight the calendar's accent blue when the user lands on `/dashboard` next.
- **Logo block at top center:** the 80×80px Babun «B» rounded square (already used at `/login` today) — `bg-[var(--accent)]` + soft drop shadow. Text below: «Babun CRM» 28px bold, then a 15px `var(--label-secondary)` sub-line that varies per page («Войдите, чтобы продолжить» / «Создайте аккаунт» / «Сброс пароля» / etc.).
- **Form card:** `bg-[var(--surface-card)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)]`. Inputs have `divide-y` separators to match the iOS grouped-list look. Inputs are `h-12`, 15px text, no border by default.
- **Primary CTA:** full-width pill `h-[50px] rounded-[var(--radius-pill)] bg-[var(--accent)]`. White text, 17px semibold. Disabled state at 50% opacity.
- **Ghost link row:** below the CTA, 14px `var(--accent)` text — used for cross-page navigation («Нет аккаунта? Зарегистрироваться», «Забыли пароль?», «Уже есть аккаунт? Войти»).
- **Footer:** the existing «AirFix © 2026 · Babun CRM» 12px tertiary line — keep it for tenant trust until we have a real footer.
- **Inline error:** 13px `var(--system-red)` text below the form card, centered. No toast — keep modals/toasts for the dashboard.

Reuse the existing `/login` markup (it's 90% there already) — just refactor it into a small shared `<AuthCard title subtitle>{children}</AuthCard>` wrapper at `apps/web/src/components/auth/AuthCard.tsx` so the five pages don't copy-paste the layout.

Five routes:

**`/login` (rewrite)** — `apps/web/src/app/login/page.tsx`. Email + password form, calls `signIn`. On success → `router.push('/dashboard/clients')`. On error → inline message. "Забыли пароль?" link → `/forgot-password`. "Нет аккаунта? Зарегистрироваться" link → `/register`.

**`/register` (new)** — `apps/web/src/app/register/page.tsx`. Email + password form, calls `signUp` with `options.data.business_name` (optional input). On success: if email confirmation is OFF (which is our A3 setting), the user is auto-signed-in → `router.push('/dashboard/clients')`. If confirmation is ON, show "Проверь почту" message instead (defensive — if Dashboard setting drifts, UI doesn't break).

**`/forgot-password` (new)** — `apps/web/src/app/forgot-password/page.tsx`. Email-only form, calls `requestPasswordReset(email, ${origin}/reset-password)`. Always shows "Если такой email есть, мы отправили ссылку." (don't leak existence).

**`/reset-password` (new)** — `apps/web/src/app/reset-password/page.tsx`. The Supabase reset link drops the user back here with a session already established (the URL hash carries the access token; `@supabase/ssr` picks it up automatically on first render). Page shows password + confirm fields, calls `updatePassword`. On success → `router.push('/dashboard/clients')`.

**`/auth/callback` (new)** — `apps/web/src/app/auth/callback/route.ts`. PKCE/exchange route handler for Supabase's password-reset and (future) magic-link flows. Pattern from Supabase docs:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await getSupabaseServer();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL("/dashboard/clients", req.url));
}
```

All five pages reuse the existing Telegram-style card from the current `/login` stub for visual consistency.

**Commit:** `feat(auth): G3 — register + login + forgot/reset pages`

### G4 — Logout wiring

The sidebar already has a "Выход" button (`apps/web/src/app/dashboard/layout.tsx` calls `handleLogout` → `router.push('/login')`). Replace with:

```ts
const handleLogout = async () => {
  await signOut();
  router.push("/login");
  router.refresh(); // force the server layout to re-check, drop cached user data
};
```

**Commit:** `feat(auth): G4 — wire signOut to sidebar Выход`

### G5 — Server-side auth gate (the architectural change)

#### Pattern decision: prop-drilling tenantId from server → client (no Context, no per-fetch re-query)

Three approaches we considered:

| Approach | Verdict |
|---|---|
| **Server component fetches user + tenant, passes as prop into client layout** | ✅ **chosen** — single source of truth, race-free by construction |
| React Context populated lazily by a client `useEffect(() => supabase.auth.getUser())` | ❌ flicker on first render (tenantId undefined for one frame), race when user logs out and the effect hasn't unsubscribed yet |
| `supabase.auth.getUser()` on every fetch from the repository | ❌ N+1 round-trip per repo call, and cross-tenant leak risk if a stale session cookie sneaks in |

**Why prop-drilling is race-free here:** every dashboard request goes through the server layout. Server-rendered HTML already contains the resolved tenantId (baked into the React tree as a prop on `<DashboardClientLayout>`). The client never has to "discover" tenantId — it arrives as a prop, just like any other piece of server data. When the user logs out: `signOut()` calls `router.refresh()`, which re-runs the server layout, which redirects to `/login` before any client tree mounts.

#### Code sketch

1. **Rename** the current 935-line client component to `apps/web/src/components/layout/DashboardClientLayout.tsx`. Keep its content identical but accept two new props: `tenantId: string` and `userEmail: string`. Drop the `tenantId = process.env.NEXT_PUBLIC_DEV_TENANT_ID ?? DEV_TENANT_ID` block.

2. **Replace** `apps/web/src/app/dashboard/layout.tsx` with a thin async server component:

```ts
// apps/web/src/app/dashboard/layout.tsx — SERVER component (no "use client")
import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import DashboardClientLayout from "@/components/layout/DashboardClientLayout";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await getSupabaseServer();

  // 1. Resolve the user. getUser() validates the cookie against
  //    Supabase Auth — defends against forged JWTs that getSession()
  //    would naively accept.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // 2. Resolve the tenant. The handle_new_user() trigger guarantees
  //    one row per user — but use maybeSingle so a missing row doesn't
  //    crash the request, it redirects back to /login with a flag.
  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("id")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (error || !tenant) {
    redirect("/login?err=tenant-missing");
  }

  // 3. Render. Both tenantId and userEmail are immutable props from
  //    here on — the client cannot accidentally read another user's
  //    tenant because the value is baked into the SSR HTML.
  return (
    <DashboardClientLayout tenantId={tenant.id} userEmail={user.email ?? ""}>
      {children}
    </DashboardClientLayout>
  );
}
```

```ts
// apps/web/src/components/layout/DashboardClientLayout.tsx — CLIENT
"use client";
// existing 935 lines, with these adjustments:
//   * accept { tenantId: string; userEmail: string; children } in props
//   * remove the env-fallback line; replace `tenantId` references with the prop
//   * useEffect(reloadClients) reads the prop instead of the constant
//   * Выход button calls await signOut() then router.refresh()
```

3. **Inverse gate on auth pages** (`/login`, `/register`, `/forgot-password`, `/reset-password`): if a user IS already signed in, redirect to `/dashboard/clients`. Pattern at the top of each page file:

```ts
// e.g. apps/web/src/app/login/page.tsx
import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import LoginForm from "@/components/auth/LoginForm";

export default async function LoginPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard/clients");
  return <LoginForm />;
}
```

The existing client form moves into `LoginForm.tsx` (same with the other four pages). This keeps the route file as a thin server gate.

#### PWA service-worker compatibility checklist (verify as part of G5)

The service worker can keep serving stale auth pages after sign-in if not handled. **Three gates** the developer must verify before marking G5 complete:

- [ ] **SW does NOT cache `/login`, `/register`, `/forgot-password`, `/reset-password`, `/auth/callback`.** Open `apps/web/public/sw.js` — confirm the runtime cache pattern excludes these paths (or doesn't cache HTML at all). If it caches them, the user signs in, hits cached `/login`, gets redirected back to dashboard from server but client SW serves the cached login HTML. Patch sw.js: add an early return for any path in `["/login", "/register", "/forgot-password", "/reset-password", "/auth/callback"]`.
- [ ] **SW does NOT cache `/dashboard/*`** under the runtime cache. Already true today (it caches static assets only) but re-verify by inspecting the fetch handler.
- [ ] **CACHE_VERSION bump in G9 invalidates the old cache** so any user on the v344 SW gets a fresh tree.

After G5 ships, run this manual check:

1. Sign in. Open DevTools → Application → Service Workers → confirm `babun-v345-runtime` cache is populated only with static assets.
2. Hit "Offline" toggle in DevTools, reload `/dashboard/clients`. App should render from cache (existing offline behavior). If it redirects to `/login` in an infinite loop, the SW is intercepting auth-gate redirects — fix.
3. Hit "Online", click Выход. Should land on `/login` immediately, no flash of dashboard content.

**Commit:** `feat(auth): G5 — server-side auth gate at /dashboard/layout`

### G6 — Replace `DEV_TENANT_ID` with the real one

After G5, the client layout receives `tenantId` as a prop. Wire that down:

- Remove `DEV_TENANT_ID` import in `DashboardClientLayout.tsx` and use the prop directly.
- Delete `packages/shared/src/db/constants.ts` (one-line file becomes unnecessary).
- Drop `DEV_TENANT_ID` re-export from `packages/shared/src/db/index.ts`.
- Drop `NEXT_PUBLIC_DEV_TENANT_ID` from `.env.local.example` (still works on Vercel if anyone has it set; just no longer required).
- The seeded `00000000-...-babb` tenant row stays in DB harmlessly.

**Commit:** `refactor(auth): G6 — drop DEV_TENANT_ID hardcode`

### G7 — Email confirmation UX (defensive, in case the Dashboard setting flips back)

If a user signs in but `user.email_confirmed_at` is `null`, show an in-card banner above the dashboard:

> «Подтверди свой email — мы отправили ссылку на user@example.com.»

Plus a "Отправить ещё раз" button that calls `supabase.auth.resend({ type: 'signup', email })`.

This is just a defensive layer — confirmation is OFF in our Dashboard config (A3), so most users won't see this. If we re-enable it later in STORY-040, the UI is already there.

**Commit:** `feat(auth): G7 — unconfirmed-email banner`

### G8 — Smoke-test gate (manual via Playwright + Supabase MCP/REST)

Mandatory before G9. **If any step fails, do not bump versions, do not push. Surface the failure in chat.**

DB verification uses Supabase MCP `execute_sql` if it's authenticated, or fetch with the publishable key (read-only side) for SELECTs. Writes to `auth.users` are not user-facing — we only inspect.

#### Step 1 — Auth gate redirects unauthenticated users
- **Action:** `npm run dev` from `apps/web/`. Open `http://localhost:3000/dashboard/clients` in incognito.
- **Expect (UI):** browser ends up on `/login` (no flash of dashboard).
- **Fail:** if dashboard renders even briefly → server layout isn't blocking; check `getUser()` cookie path. If infinite redirect → SW caching auth pages, see G5 PWA gates.
- **On fail:** stop, fix, re-run from step 1.

#### Step 2 — Register a new user
- **Action:** open `/register`, fill `dima+test1@example.com` + 12-char password, submit.
- **Expect (UI):** redirect to `/dashboard/clients` showing empty list (no skeleton stuck).
- **Expect (DB):** `select id, email, raw_app_meta_data from auth.users where email = 'dima+test1@example.com'` returns **1 row**.
- **Expect (DB):** `select id, owner_user_id, name from tenants where owner_user_id = '<that user.id>'` returns **1 row** with `name = 'dima+test1@example.com'` (since no `business_name` was supplied).
- **Expect (DB):** the user's `raw_app_meta_data` jsonb contains `tenant_id` matching that tenants.id.
- **Fail:** missing tenant row → trigger didn't fire; check `\df+ public.handle_new_user` and trigger existence with `select * from pg_trigger where tgname = 'on_auth_user_created'`.
- **On fail:** stop, fix migration, drop the user, re-run.

#### Step 3 — Logout and forced redirect
- **Action:** while signed in as user 1, click Выход in the sidebar.
- **Expect (UI):** redirect to `/login`. Session cookie cleared (DevTools → Application → Cookies → `sb-<projectref>-auth-token` is gone).
- **Action then:** in the same tab, paste `http://localhost:3000/dashboard` in the URL bar.
- **Expect (UI):** redirect back to `/login` (no dashboard flash).
- **Fail:** dashboard renders → either signOut didn't clear the cookie, or `router.refresh()` was missed. Check the Выход handler in `DashboardClientLayout.tsx`.

#### Step 4 — Sign in works
- **Action:** at `/login`, enter user 1's email + password, submit.
- **Expect (UI):** redirect to `/dashboard/clients` (still empty).
- **Expect (DB):** `select count(*) from auth.sessions where user_id = '<user 1>'` ≥ 1 (Supabase tracks active sessions).
- **Fail:** "Invalid login credentials" with correct password → check email confirmation flag is OFF (architectural decision A3, set in Dashboard during G1). If on, user can't sign in until confirmed.

#### Step 5 — Create a client; ownership matches the user's tenant
- **Action:** click "+ Новый клиент", fill name + phone, save.
- **Expect (UI):** redirect to `/dashboard/clients/<uuid>`, list shows 1 entry.
- **Expect (DB):** `select id, full_name, tenant_id from clients where full_name = '<typed name>'` — exactly **1 row**, and `tenant_id` matches user 1's tenant.id from step 2.
- **Fail:** tenant_id mismatches → the client layout didn't pick up the prop, still using DEV_TENANT_ID. Re-check G5/G6.

#### Step 6 — Forgot-password email flow
- **Action:** sign out (Выход). Open `/forgot-password`, enter user 1's email, submit.
- **Expect (UI):** generic «Если такой email есть, мы отправили ссылку.» message — no enumeration leak.
- **Expect (Supabase):** Dashboard → Authentication → Logs → an entry like `password_recovery_requested` for user 1 within the last 60s.
- **Note:** for actual email delivery, Supabase free-tier sends from a dev sender unless the user customized SMTP. If running smoke test locally and SMTP isn't set, skip the email click and use Supabase Dashboard → Authentication → Users → find user → "Send password recovery" → copy the magic link from logs.

#### Step 7 — Reset password completes
- **Action:** click the reset link from the email (or the copied link from step 6). Should land on `/reset-password` with a Supabase session attached.
- **Expect (UI):** form lets user enter a new password (12+ chars). After submit, redirect to `/dashboard/clients`.
- **Expect (DB):** `select last_sign_in_at from auth.users where id = '<user 1>'` updated to "now".
- **Fail:** form errors with "Invalid token" → the `/auth/callback` PKCE handler didn't exchange the code; check the route handler in G3.

#### Step 8 — Register a SECOND user; tenants are distinct
- **Action:** sign out. Open `/register`, sign up `dima+test2@example.com`.
- **Expect (UI):** redirect to `/dashboard/clients` (empty).
- **Expect (DB):** `select id from tenants where owner_user_id = '<user 2>'` returns 1 row, and the id is **different** from user 1's tenant.id.
- **Sub-action:** create a client as user 2 with a different name (e.g. "User2Client").
- **Expect (DB):** `select tenant_id from clients where full_name = 'User2Client'` matches user 2's tenant.id.

#### Step 9 — DOCUMENT the RLS-off cross-tenant leak
- **Action:** still signed in as user 2. Open `/dashboard/clients`.
- **Expect (UI):** **the list shows BOTH user 1's client AND user 2's client.** ⚠️ **THIS IS THE EXPECTED BEHAVIOR FOR STORY-037** — RLS is off, repository filters by `tenant_id` but every authenticated client has SELECT on the whole table.
- **DB sanity:** `select tenant_id, full_name from clients order by created_at` shows two rows with two different tenant_ids — confirms the data is correctly tenant-stamped. The "leak" is purely a missing-RLS issue, not a tenant_id corruption.
- **What this proves:** the code paths are right; the only thing missing is RLS policies. **STORY-038 closes this exact hole** by adding `policy ... using (tenant_id = auth.tenant_id())` on all tenant-scoped tables. Until then: **trusted-tester deploy only** — see "Public exposure warning" at the bottom of this doc.
- **No fail criterion here** — this step is a documentation step, not a verification step. If user 2 only sees their own client, then either the layout is filtering wrong (hardcoded user 1 tenant somewhere?) OR RLS sneaked on — investigate.

After all 9 pass → proceed to G9.

### G9 — Bump + push

- `apps/web/src/app/dashboard/page.tsx` → `BUILD_VERSION = "v345-auth"`
- `apps/web/public/sw.js` → `CACHE_VERSION = "babun-v345"`
- Update `README.md` and `docs/SETUP.md` security warnings: now that auth is in place, soften the wording. Replace «БД ПУБЛИЧНАЯ по publishable key» with «BD пока без RLS — STORY-038 закроет изоляцию». Keep `<meta robots noindex>` (still no RLS).
- **No new Vercel env vars needed.** Supabase URL + publishable + secret are already there from STORY-036. Remind the user.
- `git push origin master` → Vercel auto-deploys.

**Commit:** `chore(release): G9 — v345-auth`

## Files touched

### Create

| Path | Purpose |
|---|---|
| `apps/web/supabase/migrations/20260428000001_auth_tenants.sql` | tenants.owner_user_id + handle_new_user trigger |
| `apps/web/src/lib/supabase/auth-client.ts` | signIn / signUp / signOut / reset helpers |
| `apps/web/src/app/register/page.tsx` | new |
| `apps/web/src/app/forgot-password/page.tsx` | new |
| `apps/web/src/app/reset-password/page.tsx` | new |
| `apps/web/src/app/auth/callback/route.ts` | PKCE exchange |
| `apps/web/src/components/layout/DashboardClientLayout.tsx` | the renamed-and-prop'd existing dashboard layout |

### Modify

| Path | Change |
|---|---|
| `apps/web/src/app/dashboard/layout.tsx` | replaced with thin async server component (auth gate + tenant fetch) |
| `apps/web/src/app/login/page.tsx` | rewrite — wire to `signIn`, link to /register and /forgot-password |
| `apps/web/src/app/register/page.tsx` | (in Create) — but worth listing as the route file changes meaning |
| `apps/web/src/components/layout/DashboardClientLayout.tsx` | drop `DEV_TENANT_ID` env-fallback; accept `tenantId` and `userEmail` as props; wire `signOut` to Выход |
| `packages/shared/src/db/index.ts` | drop `DEV_TENANT_ID` re-export |
| `apps/web/.env.local.example` | drop `NEXT_PUBLIC_DEV_TENANT_ID` |
| `apps/web/src/app/dashboard/page.tsx` | `BUILD_VERSION = "v345-auth"` |
| `apps/web/public/sw.js` | `CACHE_VERSION = "babun-v345"` |
| `README.md` | softer security warning post-auth |
| `docs/SETUP.md` | document the "Confirm email OFF" Dashboard step |

### Delete

| Path | Reason |
|---|---|
| `packages/shared/src/db/constants.ts` | `DEV_TENANT_ID` no longer used |

## Out of scope (next stories)

- **STORY-038** — RLS policies on every tenant-scoped table; `auth.tenant_id()` helper.
- **STORY-039** — teams + roles (multi-user per tenant, owner/admin/dispatcher/technician).
- **STORY-040** — onboarding wizard (set business name, vertical, default tags, equipment categories).
- Email confirmation customization, branded reset emails — production-readiness layer, not blocking us now.
- OAuth / magic link / social — explicit non-goal here.

## Risks

**R1 — Supabase email confirmation default ON.** Mitigation A3: turn it OFF in Dashboard before G2. We add a defensive banner in G7 in case it flips back. **Open question for the user:** confirm we want it OFF for now (auto-sign-in after register). Default: yes.

**R2 — Trigger with SECURITY DEFINER.** Misuse can leak privileges if the function does anything other than a tightly-scoped insert. Mitigation: keep the function 4 lines, no dynamic SQL, `set search_path = public` to block schema-based injection.

**R3 — PWA service worker may cache the unauthed `/dashboard/clients` page.** When the user logs in for the first time, the SW could keep serving the cached redirect-to-login response. Mitigation: bump `CACHE_VERSION` in G9 (`babun-v345`) so the SW invalidates on first load. Plus the SW `fetch` handler should pass through `/login`, `/register`, etc. without caching auth-sensitive pages — we'll verify in G8 step 9.

**R4 — Server component layout adds ~30ms per dashboard render** (extra Supabase auth check + tenant lookup). Acceptable for STORY-037; can be optimized via cookie-only fast path in 038/039 if profiling shows it.

**R5 — `tenants` row exists for the dev `00000000-...-babb` UUID with `NULL owner_user_id`.** Newly registered users get *new* tenant ids. The dev row is harmless but its associated clients data becomes orphaned. The brief's "data is throwaway" makes this acceptable; STORY-038 will clean up via CASCADE when RLS lands.

**R6 — Server-side `getUser()` requires the cookie to come through.** If any page rendered before login sets `Cache-Control: public`, a CDN could cache the redirect. Mitigation: the redirect comes from a *server component*, which Next 16 marks as dynamic by default — no caching layer should intercept. We'll verify in G8 step 9 (incognito).

**R7 — Dropping `DEV_TENANT_ID` constant is a small breaking change for any local dev who still has data tagged with the dev tenant.** Mitigation: the row stays in DB, browsers without an active session redirect to /login (so they never query for the dev tenant), and after register they get a fresh tenant. Existing data tagged `00000000-...-babb` becomes invisible — that's the brief's accepted outcome.

## Working order

1. **architect** (this file) → user reads, says "ок" / "делай".
2. **developer**:
   - **G0** — verify clean slate. Likely empty commit → fold into G1.
   - **G1** — write migration, prompt user to apply via Dashboard SQL Editor + flip "Confirm email" off. Wait for `applied`.
   - **G2** — auth-client helpers. Commit.
   - **G3** — five auth pages + callback route. Commit.
   - **G4** — wire Выход to `signOut`. Commit.
   - **G5** — split client layout into `DashboardClientLayout`; new server-side `dashboard/layout.tsx` does auth + tenant fetch. Commit.
   - **G6** — drop `DEV_TENANT_ID` everywhere. Commit.
   - **G7** — unconfirmed-email banner. Commit.
   - **G8** — manual smoke-test (9 steps via Playwright). **Gate.**
   - **G9** — bump versions, soften docs warnings; remind user no new Vercel env vars; push.
3. **reviewer** — `git diff master` checks:
   - server layout doesn't leak service role key into browser bundle
   - `redirect('/login')` only fires from server-side (not from a client effect that'd flicker the dashboard)
   - no `any`, no `@ts-ignore`
   - `tsc` + `eslint` green
   - PWA SW respects auth pages (no cached `/login`)
   - the trigger is idempotent (safe to re-run the migration)

## Constraints (reminders from CLAUDE.md)

- 400 lines per component; the 935-line dashboard layout is grandfathered but split per G5.
- TypeScript strict; no `any`.
- Don't touch ServiceWorkerRegister, swipe / pinch / `touch-action`, calendar, appointments / finance / chats data layers.
- RLS stays OFF — that's STORY-038.
- One logical commit per group (G1..G9).
- RU in UI strings, EN in code.

---

## ⚠️ PUBLIC EXPOSURE WARNING — DO NOT SHARE babun2.vercel.app PUBLICLY AFTER STORY-037

**STORY-037 lands login.** It does **NOT** land tenant isolation. **RLS is still off.**

What this means in practice:
- Any signed-in user can `select * from clients` and see EVERY tenant's data.
- The Supabase publishable key in the browser bundle still has SELECT on every tenant-scoped table.
- The smoke-test step 9 explicitly *verifies* this leak — and accepts it.

**Until STORY-038 ships:**
- 🚫 Do **not** post the URL on Twitter, LinkedIn, Telegram channels, blog posts, or anywhere indexable.
- 🚫 Do **not** invite second-tier users (potential customers, demo audiences) — only your inner circle of trusted testers (брат, друзья, ты сам).
- 🚫 Do **not** seed real customer data — anything you create is visible to every other tester who signs up.
- ✅ The `<meta name="robots" content="noindex, nofollow">` from STORY-036 G6 stays in place.
- ✅ The README + `docs/SETUP.md` security warnings stay in place (G9 softens the wording but keeps the gate).

**STORY-038 is the gate.** The moment it ships:
- RLS gets enabled on `tenants`, `clients`, `client_tags`, `client_tag_assignments` (and any future tenant-scoped table).
- An `auth.tenant_id()` helper reads `app_metadata.tenant_id` from the JWT (stamped by the trigger we land in *this* story's G1).
- Every policy keys off `tenant_id = auth.tenant_id()`.
- Smoke test re-runs step 9 and **expects** user 2 to see only their own client.

Cross out this section in the README/SETUP only after STORY-038 has shipped AND its smoke test has passed.
