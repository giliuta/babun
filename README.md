# Babun CRM

## Security

Babun is multi-tenant. **Row-Level Security** is on for every
tenant-scoped table — each user only sees their own data, enforced at
the database layer (not just in app code). Even with the publishable
key in the app bundle, an attacker who opens DevTools and crafts
direct REST queries cannot read other tenants' rows.

What RLS does **not** cover (handled elsewhere):

- **Session storage** — there are no auth cookies and no server routes.
  On web (React Native Web, static export) supabase-js keeps the session
  in `localStorage`; on native it goes into the Keychain/Keystore through
  `LargeSecureStore` (`apps/mobile/src/lib/secure-store.ts`).
- **CSRF** — not applicable while auth is bearer-token-only with no
  cookie-authenticated endpoints. Any future cookie-based endpoint would
  need explicit CSRF tokens.
- **XSS on web** — because the web session lives in `localStorage`, any
  injected script can steal it. There is **no** `Content-Security-Policy`
  header today (`vercel.json` sets only `Cache-Control`) — open TODO.
- **Brute-force on login** — Supabase Auth rate-limits sign-in
  attempts out of the box.
- **Privileged operations** — account deletion and other service-key work
  run in Supabase edge functions (`supabase/functions/`), authorised by
  the caller's `Authorization: Bearer …` access token.

CRM platform for service businesses. First customer: AirFix (HVAC, Cyprus).

## Setup

See [docs/SETUP.md](docs/SETUP.md).

## Project structure

One codebase behind iOS, Android and Web — the Next.js app was removed on
2026-08-25 and the web target is now React Native Web.

- `apps/mobile/` — Expo SDK 54 / React Native app (expo-router). The only app.
- `packages/shared/` — shared types, db repositories, offline cache/sync layer
- `supabase/migrations/` — SQL migrations, the single source of truth for the schema
- `supabase/functions/` — edge functions
- `docs/stories/` — feature plans (STORY-NNN.md)
- `docs/adr/` — architecture decision records

Project rules live in [AGENTS.md](AGENTS.md) (`CLAUDE.md` only points there).

## Workflow

1. `/plan {feature}` → docs/stories/STORY-NNN.md
2. Wait for approval
3. `/implement {story-id}` → code by groups (G0..G6), commit per group
4. `bun run typecheck && bun run test`, then verify the screen in the iOS simulator
5. Push, PR and deploy only when the owner explicitly asks: branch →
   `gh pr create` (direct pushes to `master` are closed, see AGENTS.md).
   Vercel builds `bun run build:web` (Expo Web) from `master`.
