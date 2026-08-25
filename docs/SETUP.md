# Babun CRM — Local Dev Setup

## Security posture

Multi-tenant with RLS at the DB layer. The publishable key in the
browser bundle is safe to expose — even crafted REST queries from
DevTools can only see the caller's own tenant. SUPABASE_SECRET_KEY is
server-side only.

What RLS does **not** cover: CSRF (handled by httpOnly cookies +
future CSRF tokens on custom POSTs), brute-force on login (Supabase
Auth rate-limit), session hijacking (httpOnly + Secure + SameSite
cookies — Supabase defaults).

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
here means users click the email link and land on `http://localhost:3000`
which doesn't exist for them — broken UX, no recovery.

| Field | Value | Why |
|---|---|---|
| **Site URL** | `https://babun2.vercel.app` | Default redirect domain. Must be the production URL, NOT localhost — even during dev. |
| **Redirect URLs** | `https://babun2.vercel.app/**` | Production allowlist. Wildcard `**` covers /auth/callback, /reset-password, etc. |
| **Redirect URLs** | `http://localhost:3000/**` | Local-dev allowlist. Lets `npm run dev` test reset flows against the real Supabase project. |

**Code-side note:** the app's `requestPasswordReset()` helper passes
`redirectTo: ${window.location.origin}/auth/callback?next=/reset-password`,
so on `npm run dev` the redirect points at localhost (matched by the
local-dev allowlist), and on production it points at babun2.vercel.app.
The Supabase Site URL is only used as the *default* when no `redirectTo`
is supplied — but Supabase email templates also use it to render the
button URL. Both halves must agree, hence both entries above.

**If you change the production domain (custom domain, etc.):**
1. Update Site URL to the new domain.
2. Add the new domain to Redirect URLs (you can keep both during a
   transition period).
3. Existing reset-link emails issued before the change continue to
   point at the old domain — they expire on their own (Supabase
   default: 1 hour). Tell users to request a fresh reset.

## Prerequisites

- Node 20+
- npm 11+
- Access to the Supabase project `rdtokosbqvgemicqeqwz` (eu-west-1, free tier)

## Local setup

### 1. Clone and install

```bash
git clone https://github.com/giliuta/babun2.git
cd babun2
npm install              # from repo root — Turborepo workspaces install everything
```

### 2. Get Supabase keys

Open https://supabase.com/dashboard/project/rdtokosbqvgemicqeqwz/settings/api and copy:

- **Project URL** — `https://rdtokosbqvgemicqeqwz.supabase.co`
- **Publishable key** — starts with `sb_publishable_…`. Safe to expose; sent to the browser.
- **Secret key** — starts with `sb_secret_…`. Server-side only; never commit.

### 3. Create `.env.local`

From the repo root:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` — fill in the publishable + secret keys. Leave `NEXT_PUBLIC_DEV_TENANT_ID` as the seeded UUID.

`.env.local` is in `.gitignore`. **Never commit it.** If you accidentally push it, immediately revoke + reissue the keys in the Supabase Dashboard.

### 4. Generate Supabase types (optional)

The repo ships a hand-validated `database.types.ts` matching the applied migration. To regenerate from the live project:

```bash
# One-time: get a Supabase Personal Access Token at
# https://supabase.com/dashboard/account/tokens, then:
export SUPABASE_ACCESS_TOKEN=sbp_…

npm run db:types
```

### 5. Run dev

```bash
npm run dev          # localhost:3001 by default; falls back to 3000
```

Open http://localhost:3001/dashboard/clients — you should see the empty list (or seeded clients if any).

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

The deployed app at https://babun2.vercel.app needs the same env vars set in Vercel. **Do this BEFORE pushing changes that depend on the variables**, otherwise the build will deploy a broken bundle.

1. Go to **Vercel Dashboard → Project `babun2` → Settings → Environment Variables**.
2. Add each of the four variables. For each, enable **Production**, **Preview**, **Development**.

   | Name | Value | Sensitive? |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://rdtokosbqvgemicqeqwz.supabase.co` | no |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | no |
   | `SUPABASE_SECRET_KEY` | `sb_secret_…` | **yes** — toggle the *Sensitive* checkbox |
   | `NEXT_PUBLIC_DEV_TENANT_ID` | `00000000-0000-0000-0000-00000000babb` | no |

3. Save → either trigger a redeploy from the Deployments tab or push a new commit.
4. Verify by opening https://babun2.vercel.app/dashboard/clients — list should load from Supabase.

## Common errors

- **`Supabase env missing`** at runtime — `.env.local` not present or one of the publishable/URL vars is empty.
- **`new row violates row-level security policy`** — RLS is on but no permissive policy. Run `supabase/migrations/20260427_002_disable_rls.sql` (Dashboard SQL Editor fallback works) until STORY-038 ships proper policies.
- **`invalid input syntax for type uuid`** — id field passed to Supabase isn't UUID-formatted. New clients should use `crypto.randomUUID()` (handled by `createBlankClient`); legacy `cli-…` ids will fail.

## Common dev tasks

```bash
# Type check
bun run typecheck

# Lint
bun run lint

# LAN dev (test from phone on same Wi-Fi)
bun run web
```
