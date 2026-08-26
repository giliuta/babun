# Babun CRM — Local Dev Setup

## Security posture

Multi-tenant with RLS at the DB layer. The publishable key in the app
bundle is safe to expose — even crafted REST queries from DevTools can
only see the caller's own tenant. The secret key never ships to a client;
it lives in the Supabase environment where edge functions read it.

What RLS does **not** cover: session theft on web (React Native Web keeps
the supabase-js session in `localStorage` and there is no CSP header yet —
open TODO in `vercel.json`), brute-force on login (Supabase Auth
rate-limit). On native the session is encrypted at rest via
`LargeSecureStore` (`apps/mobile/src/lib/secure-store.ts`). There are no
cookie-authenticated endpoints, so CSRF does not apply.

## Supabase Dashboard config (one-time, per project)

After running the auth migration (`20260428_001_auth_tenants.sql`), set the
following in the Supabase Dashboard:

- **Authentication → Sign In / Providers → Email → "Confirm email" OFF.**
  STORY-037 ships with auto-sign-in after register so dev / smoke-test
  works end-to-end. A future story will reinstate confirmation with a
  proper "verify your email" UI flow.

### Supabase Auth URL Configuration (CRITICAL for production)

**Authentication → URL Configuration**
([direct link](https://supabase.com/dashboard/project/rdtokosbqvgemicqeqwz/auth/url-configuration))

This is the page that decides what domain ends up in password-reset
emails, magic-link emails and email-confirmation links. A wrong value
here means users click the email link and land on a host that doesn't
exist for them — broken UX, no recovery.

| Field | Value | Why |
|---|---|---|
| **Site URL** | `https://babun2.vercel.app` | Default redirect domain. Must be the production URL, NOT localhost — even during dev. |
| **Redirect URLs** | `https://babun2.vercel.app/**` | Production allowlist (web build). |
| **Redirect URLs** | `http://localhost:8081/**` | Local Expo Web allowlist — `bun run web` serves on 8081. |
| **Redirect URLs** | `babun://**` and `babundev://**` | Native deep links. `app.json` sets scheme `babun`; the dev variant uses `babundev` (`app.config.js`). |

**Code-side note:** password reset lives in
`apps/mobile/app/(auth)/forgot-password.tsx` and calls
`supabase.auth.resetPasswordForEmail(email, { redirectTo: Linking.createURL("/reset-password") })`.
`Linking.createURL` resolves to the app scheme on native and to the dev-server
origin on Expo Web, which is why both kinds of entry must be in the allowlist.
There is no `/auth/callback` route — the link lands directly on
`apps/mobile/app/(auth)/reset-password.tsx`. The Supabase Site URL is only used
as the *default* when no `redirectTo` is supplied — but Supabase email templates
also render the button URL from it, so both halves must agree.

**If you change the production domain (custom domain, etc.):**
1. Update Site URL to the new domain.
2. Add the new domain to Redirect URLs (you can keep both during a
   transition period).
3. Existing reset-link emails issued before the change continue to
   point at the old domain — they expire on their own (Supabase
   default: 1 hour). Tell users to request a fresh reset.

## Prerequisites

- **Bun** — the canonical package manager and script runner (`bun.lock` at the root)
- **Xcode + an iOS Simulator runtime** — needed for `bun run ios`
- Access to the Supabase project `rdtokosbqvgemicqeqwz` (eu-west-1, free tier)

## Local setup

### 1. Clone and install

```bash
git clone https://github.com/giliuta/babun.git
cd babun
bun install              # from repo root — workspaces: apps/*, packages/*
```

### 2. Get Supabase keys

Open https://supabase.com/dashboard/project/rdtokosbqvgemicqeqwz/settings/api and copy:

- **Project URL** — `https://rdtokosbqvgemicqeqwz.supabase.co`
- **Publishable key** — starts with `sb_publishable_…`. Safe to expose; ships in the bundle.
- **Secret key** — starts with `sb_secret_…`. Server-side only; never commit, never put in a client env file.

### 3. Create `apps/mobile/.env.local`

The env file lives **inside the app**, not at the repo root — Expo reads dotenv
from the project directory.

```bash
cp apps/mobile/.env.example apps/mobile/.env.local
```

Fill in:

| Name | Value |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://rdtokosbqvgemicqeqwz.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` |
| `EXPO_PUBLIC_SENTRY_DSN` | optional — leave empty to disable Sentry in dev |

`EXPO_PUBLIC_*` vars are inlined into the client bundle, so only publishable
values belong here. `.env.local` is in `.gitignore`. **Never commit it.** If you
accidentally push it, immediately revoke + reissue the keys in the Supabase
Dashboard.

### 4. Generate Supabase types (optional)

The repo ships a hand-validated `database.types.ts` matching the applied
migrations. It is imported as `@babun/shared/db/database.types`, so regenerate
straight into that file:

```bash
# One-time: get a Supabase Personal Access Token at
# https://supabase.com/dashboard/account/tokens, then:
export SUPABASE_ACCESS_TOKEN=sbp_…

npx supabase gen types typescript --project-id rdtokosbqvgemicqeqwz \
  > packages/shared/src/db/database.types.ts
```

### 5. Run dev

```bash
bun run ios          # iOS simulator (expo prebuild + run)
bun run android      # Android emulator
bun run web          # Expo Web (React Native Web) on http://localhost:8081
bun run start        # Metro only — pick the platform yourself / scan the QR
```

The app opens on the login screen (`apps/mobile/app/(auth)/login.tsx`). After
signing in you land on the dashboard tabs — calendar, clients, finances, cabinet.
`(dashboard)` is an expo-router group, so it does **not** appear in the URL: the
clients list is `/clients`.

## Migrations

Run the Supabase CLI from the repo root — `supabase/migrations/` lives there since the Next.js app was removed (2026-08-25).

```bash

# Link the CLI to the project once
npx supabase link --project-ref rdtokosbqvgemicqeqwz

# Push pending migrations
npx supabase db push
```

**Manual fallback** (if the CLI fails — e.g. no PAT available):

1. Open the Supabase SQL Editor: https://supabase.com/dashboard/project/rdtokosbqvgemicqeqwz/sql/new
2. Paste the SQL of any new file under `supabase/migrations/`
3. Click Run
4. Verify with `select count(*) from public.tenants;`

## Vercel Production Setup

The deployed app at https://babun2.vercel.app is the Expo Web export: Vercel runs
`bun run build:web` and serves `apps/mobile/dist` (see `vercel.json`). The env
vars are baked into the bundle at build time, so **set them BEFORE triggering a
build that depends on them**, otherwise the build ships a broken bundle.

1. Go to **Vercel Dashboard → Project `babun2` → Settings → Environment Variables**.
2. Add each variable. For each, enable **Production**, **Preview**, **Development**.

   | Name | Value | Sensitive? |
   |---|---|---|
   | `EXPO_PUBLIC_SUPABASE_URL` | `https://rdtokosbqvgemicqeqwz.supabase.co` | no |
   | `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | no |
   | `EXPO_PUBLIC_SENTRY_DSN` | optional | no |

   The secret key does **not** belong here — edge functions read their service
   credentials from the Supabase environment, not from Vercel.
3. Save → either trigger a redeploy from the Deployments tab or push a new commit.
4. Verify by opening https://babun2.vercel.app — the login screen should render
   and sign-in should reach Supabase.

## Common errors

- **`[supabase] Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`**
  at startup — `apps/mobile/.env.local` is missing or one of the two vars is
  empty. Metro caches env: restart it after editing.
- **`new row violates row-level security policy`** — RLS is working, but
  `public.current_tenant_id()` returned NULL: the JWT carries no
  `app_metadata.tenant_id` (fresh session before `handle_new_user` fired), or the
  request runs as `anon`. Check with `select public.current_tenant_id();` under
  your own session. **Do NOT disable RLS** — the old
  `supabase/migrations/20260427_002_disable_rls.sql` is a historical file
  superseded by `20260429_001_rls_policies.sql`; running it strips tenant
  isolation from `clients` while granting `all` to `anon`.
- **`invalid input syntax for type uuid`** — id field passed to Supabase isn't UUID-formatted. New clients should use `crypto.randomUUID()` (handled by `createBlankClient`); legacy `cli-…` ids will fail.

## Common dev tasks

```bash
# Type check (must be 0)
bun run typecheck

# Tests (bun:test)
bun test

# Lint
bun run lint

# Web build exactly the way Vercel does it
bun run build:web
```
