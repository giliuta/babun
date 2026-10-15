# STORY-047 — SMS Hybrid (Twilio reminders, multi-tenant)

Status: **CLOSED** — skeleton mode pipeline live in production
(v367-sms-hybrid, babun-v367). Awaiting Owner Twilio one-shots
before flipping `app_settings.sms_enabled = 'on'`.

## Final shipped contents

| Gate | Commit | What |
|---|---|---|
| G1 | `0c3e843` | tenant_sms_config + sms_messages + RLS + RPC |
| G3 | `8034211` | send_sms Edge Function (skeleton) + read-only service_role grants hotfix |
| G4 | `ac492b8` | pg_cron schedule (every 5 min, heartbeat) |
| G7a | (verified) | Smoke 4/4 PASS — match, queued, idempotent skip, row shape |
| G6 | `a4569e8` | /api/twilio/status webhook + 9 Vitest cases (signature, AccountSid, status mapping) |
| G5+G8 | `a89ea96` | Settings UI (3 components + page + server action) + v367 bump |
| G9 | (verified) | sw.js serves babun-v367; /dashboard/settings/sms returns 307 unauthenticated |

## Production state

- `app_settings.sms_enabled = 'off'` — pipeline inert; cron fires every 5 min, Edge Function returns `{matched:0, mode:"skeleton", reason:"sms_enabled_off"}` immediately.
- `cron.job` row: `{ schedule: '*/5 * * * *', jobname: 'sms_reminder_check', active: true }`.
- `send_sms` Edge Function deployed at `https://rdtokosbqvgemicqeqwz.supabase.co/functions/v1/send_sms`, Verify JWT OFF.
- `/api/twilio/status` deployed at `https://babun.app/api/twilio/status` — returns `{ok:true, ignored:true}` for unknown MessageSid.
- `/dashboard/settings/sms` Owner-gated — non-owner redirects to `/dashboard/settings?error=sms_owner_only`.

## Awaiting Owner one-shots

1. Register Twilio account on `support@babun.app`, buy a Cyprus SMS-capable phone number.
2. Put creds in Edge Function Secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`.
3. **Code change required to leave skeleton mode** — replace the `status='failed' / error_code='skeleton_mode'` INSERT block in `send_sms/index.ts` with a real Twilio Messages.create() call + `status='sent' / twilio_sid=resp.sid`. ~30 LOC diff (the "G3b" anchor in the function header).
4. After G3b deploy + your OK → flip `app_settings.sms_enabled='on'`.
5. AirFix BYOK Twilio account → register through Babun's Settings UI (already shipped) → tenant_sms_config row created automatically.

## Tech debt logged

- `npm run db:types` regen + replace `supabase as any` casts (STORY-047b).
- Audit `public` schema service_role grants for consistent default (read-only opt-in writes).
- Webhook structured logging for unknown-MessageSid hits.

## Original spec (kept below)


## Locked decisions (post-G0)

1. **BYOK token storage = plaintext column, service-role-only RLS.**
   `tenant_sms_config.twilio_auth_token text` with RLS denying all
   reads to authenticated. Edge Function reads via service-role JWT.
   Rationale: equivalent attack surface to Edge Function Secrets
   (where VAPID lives), Postgres-at-rest is encrypted on Supabase.
   Migration to pgsodium/Vault deferred until ≥3 BYOK tenants +
   audit/compliance story justifies the complexity.
2. **Ignore `appointments.reminder_*` columns in v1.** Pre-existing
   localStorage flags, never wired in production. Tenant-level
   toggles in `tenant_sms_config` are sufficient bulk on/off. Per-
   appointment opt-out logged for a future story.
3. **Authorization scope.**
   - G3 Edge Function deploy: autonomous (skeleton mode w/o real Twilio creds)
   - `sms_enabled` flag flip ON: gated on user OK after verify
   - Real Twilio account registration: user-side action
   - Real test SMS send: gated on user OK after Twilio account ready
4. **Vault correction.** VAPID lives in Edge Function Secrets, not
   `vault.create_secret`. Babun's platform Twilio creds also in Edge
   Function Secrets (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
   `TWILIO_PHONE_NUMBER`). BYOK creds in plaintext column per #1.
5. **Webhook signature verification = single endpoint with two
   lookups (architect recommendation).** `/api/twilio/status` is
   one URL; the body's `MessageSid` indexes into `sms_messages` to
   find `tenant_id`, `tenant_sms_config.twilio_auth_token`, and
   `tenant_sms_config.twilio_account_sid`. Cross-check the body's
   `AccountSid` against the stored SID BEFORE the HMAC compute —
   forgery with a real MessageSid + wrong AccountSid 403's without
   burning crypto. DoS bounded by Vercel rate-limits + a single
   indexed lookup.

## Goal

Automatic SMS reminders to clients before scheduled appointments.
Multi-tenant SaaS architecture with two modes per tenant:

- **Platform mode** — Babun's own Twilio account (Free / Pro tier).
  Sender label: `Babun`. Quotas tracked per-tenant, refresh monthly.
- **BYOK mode** — Tenant's Twilio account (Business tier). Sender
  label: tenant-customised (e.g. `AirFix`). No Babun-side quota; the
  tenant pays Twilio directly.

Reminders fire at:
- 24 h before appointment (default ON)
- 2 h before appointment (default OFF — opt-in per tenant)

## Architecture

### Table: `tenant_sms_config`

| column | type | notes |
|---|---|---|
| `tenant_id` | uuid PK FK → tenants ON DELETE CASCADE | one row per tenant |
| `mode` | text CHECK (`platform`, `byok`) | default `platform` |
| `enabled` | boolean default false | master switch |
| `remind_24h_before` | boolean default true | |
| `remind_2h_before` | boolean default false | |
| `template_24h` | text default RU template | placeholders below |
| `template_2h` | text default RU template | |
| `twilio_account_sid` | text NULL | BYOK only |
| `twilio_auth_token_secret_id` | uuid NULL | Vault secret ID, BYOK only |
| `twilio_phone_number` | text NULL | BYOK only |
| `sent_this_month` | integer default 0 | platform-mode quota tracking |
| `free_quota_per_month` | integer default 50 | refreshed by janitor cron |
| `created_at`, `updated_at` | timestamptz | |

### Template placeholders

`{client_name}`, `{time}`, `{date}`, `{phone}`, `{business_name}`

### Default RU templates

- 24h: `Здравствуйте, {client_name}! Напоминаем что у Вас завтра в {time} назначен визит. Если что-то изменилось — позвоните нам.`
- 2h: `Здравствуйте, {client_name}! Через 2 часа у Вас назначен визит на {time}.`

### Table: `sms_messages` (history)

| column | type | notes |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `tenant_id` | uuid NOT NULL FK → tenants ON DELETE CASCADE | |
| `appointment_id` | uuid NULL FK → appointments ON DELETE SET NULL | history survives appointment delete |
| `client_id` | uuid NULL FK → clients ON DELETE SET NULL | |
| `to_phone` | text NOT NULL | denormalized for history |
| `message_body` | text NOT NULL | rendered template |
| `twilio_sid` | text NULL | Twilio message ID |
| `status` | text CHECK (`queued`, `sent`, `delivered`, `failed`, `undelivered`) | |
| `error_code` | text NULL | |
| `error_message` | text NULL | |
| `trigger_type` | text CHECK (`reminder_24h`, `reminder_2h`, `manual`, `test`) | |
| `mode` | text NOT NULL | `platform` / `byok` for billing |
| `created_at` | timestamptz default now() | |
| `delivered_at` | timestamptz NULL | set by webhook |

### RLS

- `tenant_sms_config` SELECT: `tenant_id = current_tenant_id() AND current_user_role() = 'owner'` (Owner-only — token + quota visibility is sensitive)
- `tenant_sms_config` UPDATE/INSERT: same as SELECT
- `sms_messages` SELECT: `tenant_id = current_tenant_id()` (any role can view history)
- `sms_messages` INSERT/UPDATE: `service_role` only (Edge Function bypasses RLS via service-role JWT — explicit policy required per STORY-053b lesson)

## Checkpoint flow

- G0 Discovery — inventory existing infra. Pause + report if surprises.
- G1 DB schema migration — review BEFORE apply
- G2 Vault wrapper for Twilio Auth Token — review BEFORE apply
- G3 Edge Function `send_sms` — review BEFORE deploy
- G4+ — TBD (user spec was truncated mid-message; awaiting remainder)

## G0 — Discovery

Read-only inventory of:
- `appointments` table — which columns are relevant for SMS rendering (date, time_start, time_end, client_id, team_id, etc.)
- pg_cron — enabled? what extension version? schema location?
- Vault secrets — does `vault.create_secret` / `vault.delete_secret` exist? Pattern from STORY-053b VAPID keys.
- Toast system — existing helper for UI feedback in Settings save flows.
- `/dashboard/settings/*` page structure — where the SMS section will mount.
- Existing `current_tenant_id()` / `current_user_role()` helpers — exact signatures.
- Edge Function deployment path + auth (service-role JWT).

## G1 — DB schema (specced, not yet shipped)

Migration `20260502000001_sms_config.sql`:
- `tenant_sms_config` table + RLS (owner-only via `current_user_role()` helper)
- `sms_messages` table + RLS (tenant-scoped, service-role bypass for inserts)
- Indexes on `tenant_id`, `status`, `created_at`
- Reuse `set_updated_at` trigger
- Explicit `service_role` policies per STORY-053b lessons

Show SQL for review BEFORE apply.

## G2 — Vault encryption for Twilio Auth Token (specced)

BYOK mode requires encrypted credentials. Pattern reuse from VAPID:
- Settings UI save → server action → `vault.create_secret(token, 'twilio_auth_<tenant_id>')` → store returned UUID in `tenant_sms_config.twilio_auth_token_secret_id`
- Update: delete old secret via `vault.delete_secret`, create new
- Tenant delete: orphan secrets cleanup deferred to a janitor cron (separate story)

Show vault wrapper for review BEFORE apply.

## G3 — Edge Function `send_sms` — SHIPPED in skeleton mode

Deployed at `https://rdtokosbqvgemicqeqwz.supabase.co/functions/v1/send_sms`,
Verify JWT OFF (pg_cron internal). Skeleton mode inserts `sms_messages`
rows with `status='failed'` + `error_code='skeleton_mode'` for cron +
query + render path verification before real Twilio fan-out (G3b).

### G3 hotfix (caught during deploy smoke-ping)

Migration: `20260502000002_service_role_grants_hotfix.sql`. Same root
cause as the STORY-053b push_subscriptions hotfix — JWT-Signing-Keys
service-role JWTs don't auto-bypass RLS like the legacy single key
did. Tightened to **read-only**: `grant select` + `for select to
service_role` policies on the four pre-existing tables `send_sms`
reads (`app_settings`, `tenants`, `appointments`, `clients`).

**Forward rule:** if a future Edge Function needs INSERT/UPDATE/DELETE
on any of these tables, add the narrow GRANT in the feature story
that introduces the need — don't widen them globally.

### Original spec (kept for reference)

Deno + TypeScript. Triggered every 5 minutes by pg_cron via `net.http_post`. Behaviour:

1. Query appointments where:
   - `date + time_start = now() + 24h` (±5 min window) for reminder_24h
   - OR `date + time_start = now() + 2h` (±5 min window) for reminder_2h
   - AND `tenant_sms_config.enabled = true` AND the relevant `remind_*_before` flag is true
   - AND no existing `sms_messages` row for `(appointment_id, trigger_type)` — idempotency
2. For each match:
   - Lookup `tenant_sms_config` + (BYOK) Vault secret
   - Render template with placeholders from appointment + client + tenant
   - Call Twilio:
     - Platform: Babun's creds from Edge Function Secrets (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`)
     - BYOK: tenant creds from Vault
   - Insert `sms_messages` row (`queued` / `sent` / `failed`)
   - Platform + Free tier: increment `sent_this_month`; if over `free_quota_per_month` → skip + insert with `status='failed'`, `error_code='quota_exceeded'`
   - Twilio webhook → `/api/twilio/status` updates `sms_messages.status` + `delivered_at`

Show code for review BEFORE deploy.

## G4 — Cron setup (specced)

Migration `20260502000002_sms_cron.sql`:
- `create extension if not exists pg_cron with schema extensions` (first time we use pg_cron — verify Supabase managed permission, fallback strategy if needed)
- `cron.schedule('sms_reminder_check', '*/5 * * * *', ...)` posting to `send_sms` Edge Function via `extensions.http_post`
- Heartbeat-only: cron fires unconditionally, Edge Function gates on `app_settings.sms_enabled = 'on'` and early-returns OFF

## G5 — Settings UI (specced)

`apps/web/src/app/dashboard/settings/sms/page.tsx`. Owner-gated via `current_user_role() = 'owner'`. Three sections:
- **Mode selection** — RadioGroup platform vs BYOK; platform shows quota progress + future Pro upgrade CTA placeholder; BYOK shows SID/token/phone inputs + Test connection.
- **Reminder settings** — master enable toggle, 24h / 2h toggles, template editors with placeholder helper buttons + live preview.
- **History** — last 50 SMS, status badges, click-row → detail modal, status filter, monthly statistics row.

New components: `TwilioConfigForm` (~200 LOC), `TemplateEditor` (~150 LOC), `SMSHistoryTable` (~180 LOC).

## G6 — Webhook endpoint (specced)

`apps/web/src/app/api/twilio/status/route.ts` POST:
1. Read raw body + `x-twilio-signature` header
2. Parse `MessageSid` + `AccountSid` from body (still untrusted)
3. Lookup `sms_messages.twilio_sid → tenant_id → tenant_sms_config.{twilio_auth_token, twilio_account_sid}` (1 indexed read)
4. Cross-check stored `twilio_account_sid` against body `AccountSid` — mismatch → 403 (cheap, no HMAC)
5. Compute Twilio HMAC-SHA1 over the request URL + sorted body params, compare with `x-twilio-signature` (timing-safe)
6. Valid → update `sms_messages` row by `twilio_sid` with new status, `delivered_at`, `error_code`, `error_message`
7. Invalid → 403

For **platform-mode** SMS rows, `tenant_sms_config.twilio_auth_token` is NULL. Fall back to `process.env.TWILIO_AUTH_TOKEN` for the HMAC. The decision is driven by the row's `mode` field.

## G7 — Smoke (deferred where real Twilio is needed)

8 scenarios:
1. Owner registers BYOK creds → `tenant_sms_config` row created
2. Test connection → Edge Function with `trigger_type='test'` → mock response in skeleton mode
3. Cron manual fire (`select cron.dispatch('sms_reminder_check')`) → finds 24h-ahead appointment → renders → posts (mock) → `sms_messages` inserted
4. Webhook receives status → `sms_messages.status` updated
5. `enabled=false` → cron fires, Edge Function skips → no rows
6. Non-owner → /dashboard/settings/sms 403
7. Quota exhausted (platform free) → status `failed` with `error_code='quota_exceeded'`, no Twilio call
8. `app_settings.sms_enabled='off'` → Edge Function returns early → no rows

Steps requiring real Twilio (1, 2, 3, 4 production-side) deferred to user action after Twilio account registration.

## G8 — Release

Bump `BUILD_VERSION → v367-sms`, `CACHE_VERSION → babun-v367`. Push to master → Vercel deploy.

## G9 — Production verify

After deploy:
- /dashboard/settings/sms accessible (Owner only)
- `select * from cron.job` shows `sms_reminder_check`
- Edge Function `send_sms` deployed
- `app_settings.sms_enabled = 'off'` (master switch starts inert)

Real test SMS sending — gated on user setup of Babun's Twilio account.

## Owner one-shots (user-side, after G3–G4)

1. Register Twilio account on `support@babun.app`, buy a Cyprus SMS-capable phone number
2. Put credentials in Edge Function Secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
3. After real creds + user OK → flip `app_settings.sms_enabled='on'`
4. AirFix BYOK Twilio account (later, after STORY-052 lifetime grant)

## Backlog + tech debt discovered during this story

- **Webhook unknown-MessageSid logging.** Today the route logs a
  `console.warn`. Future: structured logging + a security-review
  surface in case someone starts brute-forcing the MessageSid space
  to map out the system. Not a v1 blocker; the AccountSid + HMAC
  gates already prevent any actual mutation from a forged hit.
- **Type-cast hack on `getSupabaseService()` for the SMS tables.**
  `database.types.ts` was last regenerated before STORY-047 G1, so
  `tenant_sms_config` + `sms_messages` aren't in the typed schema
  yet. The webhook route uses `supabase as any` + post-query type
  assertions. Schedule a `npm run db:types` regen as STORY-047b
  cleanup along with the audit of public-schema service_role grants.



- **Audit `public` schema service_role grants.** Decide a global
  pattern (read-only default + opt-in writes per table). Today the
  matrix is: `tenant_sms_config` + `sms_messages` + `push_subscriptions`
  have full `grant all`; `app_settings` + `tenants` + `appointments` +
  `clients` have `grant select` only (STORY-047 G3 hotfix). Other
  tables in `public` haven't been audited — anything an Edge Function
  needs to touch will tripwire on the JWT-Signing-Keys gap.

## Out of scope (parked, to be confirmed)

- Inbound SMS handling (Twilio incoming webhooks, replies)
- MMS / multi-language templates (RU only in v1)
- Tenant-level template editor UI (single editable textarea per template, no rich-text)
- Per-master signature / reply-to
- Quota top-up purchase flow (Free → Pro tier upgrade — separate billing story)
- Orphan Vault secret cleanup (separate janitor story)

## Lessons applied from STORY-053b + STORY-054

- Service-role bypass on RLS tables needs explicit policy after JWT-Signing-Keys migration.
- Edge Function Secrets ≠ Postgres Vault. Babun's platform Twilio creds live in Edge Function Secrets; tenant BYOK creds live in Vault per-tenant.
- Don't trust `WITH SCHEMA` clauses on extensions — schema is hardcoded.
- Schema changes outside agreed scope require STOP + ask.
- Idempotency keys (`appointment_id, trigger_type`) prevent duplicate sends on cron retries.
