# Babun CRM

## Security

Babun is multi-tenant. **Row-Level Security** is on for every
tenant-scoped table — each user only sees their own data, enforced at
the database layer (not just in app code). Even with the publishable
key in the app bundle, an attacker who opens DevTools and crafts
direct REST queries cannot read other tenants' rows.

What RLS does **not** cover (handled elsewhere):

- **CSRF** — Supabase auth tokens travel via httpOnly cookies; any
  future custom POST endpoint will need explicit CSRF tokens.
- **Brute-force on login** — Supabase Auth rate-limits sign-in
  attempts out of the box.
- **Session hijacking** — auth cookies are httpOnly + Secure +
  SameSite=lax (Supabase Auth defaults).

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

## Workflow

1. `/plan {feature}` → docs/stories/STORY-NNN.md
2. Wait for approval
3. `/implement {story-id}` → code by groups (G0..G6), commit per group
4. `bun run typecheck && bun run test`, then verify the screen in the iOS simulator
5. `git push origin master` → Vercel builds `bun run build:web` (Expo Web)
