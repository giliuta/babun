# STORY-053b — PWA mobile polish

**Status:** `done — pending G5 device test` — autonomous portion (G1–G4 + G7–G8) shipped as `v365-pwa-polish` on 2026-05-02. Final acceptance gate is the iPhone push-receive test (user-side; cannot be automated).
**Estimate:** 3–4 days.
**Dependencies:** none. Builds on existing PWA + auth + RLS.
**Blocks:** STORY-054 (offline-first) — must close this story fully first per user order.
**Numbering note:** `053b` not `053` — `053` is reserved for the dashboard contrast cleanup parked in `docs/backlog.md`. Both surfaced from STORY-045 G6; this one is the bigger scope.

## Why

Babun is sold as a phone-first PWA but today it lacks the polish that makes a web app feel "installed":
- No push notifications → masters don't know a new appointment landed unless they open the app.
- No swipe gestures on lists → desktop ergonomics on a phone.
- Install prompt is a default `beforeinstallprompt` capture without iOS guidance — most users on iPhone never install.
- Hardware back button on Android dismisses the whole page instead of just closing modals.

This story closes that gap so opening Babun on a phone feels like opening Telegram, not a website.

## G0 — Inventory (done 2026-04-30)

| Concern | State | Verdict |
|---|---|---|
| Service worker scope | `apps/web/public/sw.js`, scope `/`, cache `babun-v363`, push + notificationclick handlers already scaffolded (lines 102–138) | Reuse — push handler shows notifications correctly, just unused today |
| Haptic feedback | `apps/web/src/lib/haptics.ts` with `haptic("tap"\|"warning"\|"success")` — Android `navigator.vibrate`, iOS no-op fallback documented | **Already done. Reuse.** |
| Swipe gestures | `apps/web/src/components/ui/SwipeableRow.tsx` exists | **Already done. Reuse — wire into list rows.** |
| Animation library | None. CSS transitions + Tailwind classes everywhere | **Don't add framer-motion** — existing patterns are enough for this story |
| Install prompt | `apps/web/src/components/pwa/InstallPrompt.tsx` — uses `beforeinstallprompt`, generic copy, no iOS path | Replace with the wider modal in G5 |
| iOS Safari version detection | None | Add small `lib/platform.ts` util (UA parse + safe-area inset detection) |
| `web-push` server lib | Not installed | Install in G1 |
| `framer-motion` | Not installed | Skip — out of scope |
| VAPID keys | None | Generate in G1 |

**Implication:** scope is meaningfully smaller than the original brief because haptics + swipe + SW push handler are already there. Real work concentrates on the push subscription pipeline (G1–G3), the install modal rewrite (G5), and the back-button history layer (G6). Gestures (G4) is mostly wiring.

## G1 — Push notifications: foundation

### Decisions
- **D1.** **VAPID keys generated locally**, public key in Vercel env (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`), private key in **Supabase Vault** (`VAPID_PRIVATE_KEY`) — not Vercel env, because the sender will be a Supabase Edge Function so the secret should live next to the runner. (User asked for "Supabase secret" — that's Supabase Vault.)
- **D2.** **Sender = Supabase Edge Function `send_push`**, not Next API route. Pg trigger → `pg_net.http_post` to the function → function loads private key from Vault → calls `web-push` against subscription endpoint. This keeps fan-out logic at the DB and lets a row insert reach 5 subscriptions in one trigger run without round-tripping through a Vercel cold start.
- **D3.** **iOS support: 16.4+ home-screen PWA only.** Plain Safari iOS doesn't support web push. Subscribe button gates on `'serviceWorker' in navigator && 'PushManager' in window && (window.matchMedia('(display-mode: standalone)').matches || iOS<16.4 fallback message)`. iOS users not in PWA get a "Сначала установи приложение на главный экран" message instead of a broken subscribe.

### Schema migration
```sql
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  keys jsonb not null,        -- { p256dh, auth }
  device_label text,           -- 'iPhone 15 (Safari)' parsed from UA
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)   -- one row per device
);

create index push_subscriptions_user_idx on push_subscriptions (user_id);
create index push_subscriptions_tenant_idx on push_subscriptions (tenant_id);

alter table push_subscriptions enable row level security;

-- User sees only their own subscriptions
create policy push_subscriptions_select_own on push_subscriptions
  for select using (user_id = auth.uid());
create policy push_subscriptions_insert_own on push_subscriptions
  for insert with check (user_id = auth.uid());
create policy push_subscriptions_delete_own on push_subscriptions
  for delete using (user_id = auth.uid());
-- No update policy — subscriptions are insert-or-delete only
```

Migration filename: `supabase/migrations/20260501000001_push_subscriptions.sql`.

### Server-side helper
- `apps/web/src/app/api/push/subscribe/route.ts` (POST) — auth check, parse `{ endpoint, keys, deviceLabel }`, INSERT (ON CONFLICT DO NOTHING).
- `apps/web/src/app/api/push/unsubscribe/route.ts` (POST) — DELETE WHERE endpoint matches.

### Edge function
- `supabase/functions/send_push/index.ts` — Deno runtime, uses `web-push` Deno port. Receives `{ user_ids: uuid[], title, body, url }`, queries subscriptions, fans out, logs failures (410 Gone → delete subscription).

## G2 — Subscription flow (UI)

- New file `apps/web/src/components/pwa/EnableNotificationsPrompt.tsx`.
- Trigger: shown once when `sessionCount >= 2` (track in localStorage `babun-session-count`, increment on each `DashboardClientLayout` mount). Persistent dismissal sets `babun-push-prompt-dismissed-at` for 7 days.
- Sheet (centered modal per `feedback_center_modals.md` memory):
  - Title: `Включить уведомления?`
  - Body: `Приходи в курсе новых записей и заявок без открытия приложения.`
  - Two buttons: `Включить` (primary `#1F66D7`) / `Не сейчас` (outline).
- On `Включить` → request permission → on grant, `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` → POST `/api/push/subscribe` → toast `Уведомления включены`.
- On `Не сейчас` → set localStorage flag, dismiss for 7 days.
- Settings page (`/dashboard/settings`) gets a row "Уведомления" with on/off toggle for users to revisit the choice.

## G3 — Notifications for core events

Triggers fire `pg_net.http_post` to the Edge Function. Edge Function does the actual push. v1 ships with **two** triggers; the third (`master_new_appointment`) is deferred to STORY-039b — see "Future work" below.

| Trigger | DB event | Recipient |
|---|---|---|
| `notify_owner_new_member` | INSERT on `tenant_members` where `role != 'owner'` | the tenant's owners (excluding the actor) |
| `notify_inviter_invite_accepted` | UPDATE on `invitations` where `accepted_at` flips `NULL → NOT NULL` | `invited_by_user_id` |

### Security boundary note

`_dispatch_push` and the per-trigger functions are declared `security definer set search_path = public, extensions`. They run with the function-owner's privileges (`postgres` role) so they can `pg_net.http_post` without granting that capability to `authenticated`. The trade-off is that any code path that can fire these triggers can fan-out a push — which is exactly what we want for INSERT/UPDATE-driven events, but worth being aware of when adding more triggers in the future. Don't expand the function bodies to do anything besides the dispatch + skip rules.

### Push delivery semantics

**Best-effort, no replay guarantee.** The Web Push spec doesn't provide reliable delivery on top of the OS notification systems (APNs / FCM). Specifically:

- **TTL = 24h** in the Edge Function. Push services drop messages that haven't reached the device within that window. If a user's iPhone is offline for >24h, notifications fired during that window are **lost**, not queued. Acceptable trade-off for ephemeral UX events ("приглашение принято") — the data is still in the DB; the missed push is just a missed nudge.
- **Lifecycle inconsistencies on iOS.** PWA push on iOS only works when the app is installed to home screen on iOS 16.4+. Users on stock Safari iOS see the EnableNotificationsPrompt's gate ("Сначала установи на главный экран") before the subscribe button. iPad behaviour is iPad-OS-version-dependent.
- **No delivery receipts.** A 2xx response from the push service means "queued for delivery" not "shown on device". We log `sent` count to the function logs but it's an upper bound.

If reliable in-app notification history matters later, store an event log in Postgres and let clients pull on focus. Out of scope for v1.

### `owner.new_member` email lookup — privacy boundary

The `owner.new_member` template performs `supabase.auth.admin.getUserById(user_id)` inside the Edge Function to resolve an email for the notification body. This crosses a normally-isolated boundary (auth.users is service-role-only) but the recipient is the tenant's owner, who *invited* this exact user — they already know the email. The lookup just surfaces it on the notification card so the owner sees `ivan@example.com принял приглашение как Диспетчер` instead of generic `Принято приглашение в роли «Диспетчер»`.

If the lookup fails (network blip, deleted user, anything) the template degrades to the generic copy. No throw, no notification skip.

The result is memoised per request (`emailCache`) so a fan-out to N owners only does the lookup once.

### Notification copy parity

Both `owner.new_member` and `inviter.invite_accepted` use the same body shape: `{email} принял приглашение как {role}`. Identical pattern keeps the notification card readable across both events for users who are both Owner and Inviter (common case in small teams).

### Supabase extension-schema gotcha (G3 hotfix learning)

`pg_net` installs its functions into the **`net`** schema regardless of the `CREATE EXTENSION pg_net WITH SCHEMA extensions` clause. The original `_dispatch_push` body called `extensions.http_post(...)` which silently failed inside the function's exception handler — pipeline appeared healthy from the trigger side but no HTTP request ever fired. Fixed in `20260501000004_dispatch_push_fix_pgnet_schema.sql` by calling `net.http_post(...)` and adding `net` to the function's `search_path`.

**Pattern for future stories using pg_net / pg_cron / postgis / similar:**

1. Don't trust `CREATE EXTENSION ... WITH SCHEMA <x>` to relocate every object — most extensions hardcode their schema.
2. After install, run `select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like '<expected_function>%';` to confirm the actual schema.
3. Always call extension functions with their fully qualified schema name.
4. If using `EXCEPTION WHEN OTHERS` for resilience, add a structured `RAISE WARNING` with `sqlerrm` so silent extension-call failures still surface in Supabase Logs (we did this — that's how the smoke caught it after the http_response check).

Same logic applies to extensions we'll likely add later: `pg_cron`, `vector`, `postgis`, etc. Check the actual schema before writing the wrapper functions.

### Feature flag

Master switch is the database-level GUC `app.push_enabled` (default `'off'` set by the migration). Triggers are wired but inert until:
```sql
alter database postgres set app.push_enabled = 'on';
-- existing connections need to reconnect to see the new value
```

### CSV-import mute

Bulk insert paths set the transaction-scoped GUC `app.skip_push = '1'` so a 5000-row CSV doesn't fan out 5000 push notifications:
```sql
begin;
  select set_config('app.skip_push', '1', true);
  -- bulk inserts here
commit;
```

### Future work — `master_new_appointment` deferred

`appointments.master_id` is `text` today (legacy local-storage slug), not `uuid`. The push pipeline only knows how to address `auth.users.id` UUIDs. Until STORY-039b migrates the masters domain to be auth-keyed, master notifications can't be delivered.

When STORY-039b lands, add this trigger function in the same migration:
```sql
create or replace function public._tg_notify_master_new_appointment() returns trigger ... as $$
begin
  if NEW.master_id is null or NEW.master_id = auth.uid() then return NEW; end if;
  perform public._dispatch_push(
    'master.new_appointment',
    jsonb_build_object(
      'appointment_id', NEW.id,
      'tenant_id',      NEW.tenant_id,
      'date',           NEW.date,
      'time_start',     NEW.time_start,
      'time_end',       NEW.time_end,
      'service_ids',    NEW.service_ids,
      'client_id',      NEW.client_id,
      'comment',        NEW.comment
    ),
    array[NEW.master_id]
  );
  return NEW;
end;
$$;

create trigger notify_master_new_appointment
  after insert on public.appointments
  for each row execute function public._tg_notify_master_new_appointment();
```

The Edge Function (`send_push`) already keeps a `master.new_appointment` entry in its `TEMPLATES` const so a copy refresh + this trigger are the only delta when STORY-039b ships.

Notification copy is built server-side in the Edge Function:
- Master appointment: `Новая запись · ${date.toLocaleDateString('ru')}, ${time}` body: `${client_name || 'Без имени'} · ${service_name || 'Услуга не указана'}`
- New member: `${user_email} принял приглашение в ${tenant_name}` body: `Роль: ${role}`
- Invite accepted: same as new member but framed for the inviter

Click handler in `sw.js` (already present) opens `https://babun.app/<deep-link>` — for appointments `/dashboard/appointments/${id}`, for members `/dashboard/settings/team`, for invites `/dashboard/settings/team`.

**Privacy guard:** never include client phone, comment, or financial data in the notification text. Names + service names only.

## G4 — Gestures (mostly wiring)

- **Wire `SwipeableRow` into `ClientsList` and `AppointmentList`.** Action buttons on swipe-left:
  - Client row: `Архивировать` (haptic `tap`) + `Удалить` (haptic `warning`).
  - Appointment row: `Завершить` (success) + `Отменить` (warning).
- **Pull-to-refresh** wrapper component `apps/web/src/components/ui/PullToRefresh.tsx` (~80 lines, raw touch events — no library). Used on `/dashboard/clients`, `/dashboard/appointments` lists. Pull threshold 60px → spinner appears → release triggers refetch → spinner exits via CSS transition.
- Haptic feedback already wired via `lib/haptics.ts` — just call `haptic("tap")` on swipe-action commit, `haptic("success")` on pull-to-refresh complete.

No new dependencies. ~150 lines of new code total.

## G5 — Install prompt (rewrite)

Replace `apps/web/src/components/pwa/InstallPrompt.tsx` with `InstallPromptModal.tsx`:

- Trigger: `sessionCount >= 2` AND `localStorage['babun-install-prompt-dismissed-at']` either unset or > 7 days old. Hidden if already in standalone mode (`window.matchMedia('(display-mode: standalone)').matches`).
- Two paths inside the modal based on platform detection (`lib/platform.ts`):
  - **Android with `beforeinstallprompt` captured**: single button `Установить` → `event.prompt()`. On accept, dismiss permanently.
  - **iOS Safari**: 3 numbered steps with inline SVG icons (no real screenshots — keeps bundle small):
    1. Тапни ⤴ внизу экрана
    2. Найди «На главный экран»
    3. Нажми «Добавить»
  - **Other**: generic "Открой Babun в Safari (iOS) или Chrome (Android), чтобы установить" message.

Decline path: dismiss button sets the 7-day flag.

## G6 — Back button handling

New util `apps/web/src/lib/history-stack.ts`:
- `pushModalEntry(id, onClose)` — calls `history.pushState({ babunModal: id }, '')`, registers `onClose` for the matching popstate.
- Single global `popstate` listener resolves the most-recent registered handler.
- Each opened sheet/modal calls `pushModalEntry` on open and `history.back()` on programmatic close (so the stack stays balanced).

Wire into `SheetShell` and `ConfirmDialog` so every existing modal participates. Hardware back / iOS swipe-from-edge → popstate → modal closes without page navigation.

Edge case: if a user explicitly hits browser-back through cleared history, normal navigation behavior applies. Don't trap navigation, just stack modal closes ahead of it.

## G7 — Smoke (7/7)

Local prod build first, then prod after G8.

1. **Subscribe push** — log in twice, see prompt, accept → granted permission → row in `push_subscriptions` with correct `keys.p256dh` length 87 chars. Manually invoke send_push via Edge Function dashboard with the user's UUID → notification appears on the device.
2. **Swipe gesture** — open `/dashboard/clients`, swipe-left on a row → `Архивировать` + `Удалить` reveal, tap `Архивировать` → row removes, haptic fires (Android) or no-op (iOS). No layout shift.
3. **Pull-to-refresh** — pull down on clients list at top → spinner appears → release → list refetches and re-renders without flash.
4. **Install prompt mobile** — fresh localStorage, log in 3 times, prompt appears on the 3rd. iOS UA shows iOS instructions; Android shows the install button.
5. **Decline → 7-day skip** — dismiss the prompt, log in again immediately → no prompt. Mock-set `babun-install-prompt-dismissed-at` to 8 days ago → prompt reappears.
6. **Back button closes modal** — open AppointmentSheet, hit hardware back → sheet closes, page stays on `/dashboard/appointments`. Hit back again → page navigates back normally.
7. **iOS Safari < 16.4 graceful** — set UA to `iOS 16.0`, log in twice → prompt shows fallback "Сначала установи приложение на главный экран" instead of broken subscribe button. No console errors.

## G8 — Bump v364-pwa-polish + push

- `BUILD_VERSION = "v364-pwa-polish"`
- `CACHE_VERSION = "babun-v364"`

## G9 — Production verify

Repeat smoke 1, 4, 6 against prod (these are the user-visible features). 2, 3, 5 are local-friendly. 7 needs a real iPhone with old Safari (skip on prod, document as covered in local).

## Acceptance criteria

| # | Criterion | Verified by |
|---|---|---|
| 1 | Push subscribe + receive works end-to-end on Android Chrome PWA | G7 step 1 |
| 2 | Swipe gestures + pull-to-refresh wired on clients/appointments | G7 steps 2, 3 |
| 3 | Install prompt with iOS-specific instructions | G7 step 4 |
| 4 | 7-day re-prompt cooldown after decline | G7 step 5 |
| 5 | Hardware back closes modals, not pages | G7 step 6 |
| 6 | iOS < 16.4 graceful degradation | G7 step 7 |
| 7 | RLS works — user can't read other users' subscriptions | extra DB check during smoke |

## Out of scope

- Native-only features (vibration patterns beyond simple, ARKit, etc.)
- Cross-device push token sync (each device has its own subscription)
- Notification preferences UI (per-event mute) — defer, single global on/off in v1
- Rich notifications (action buttons in the notification card) — Chrome supports, iOS doesn't, deferred
- Notification history page in-app — deferred

## Risks

- **iOS push complexity**: requires PWA-installed-then-subscribe sequence. The flow has 3 prompt dialogs back-to-back (install → permission → success). Mitigated by sequencing: subscribe prompt won't show until `display-mode: standalone`, which forces install first.
- **Edge Function cold starts**: first push after idle period adds ~1s. Acceptable for non-realtime notifications.
- **VAPID rotation**: if private key leaks, all subscriptions become invalid (need re-subscribe). Document in runbook; not solving in v1.
- **Pg trigger latency** during bulk inserts (CSV import → many appointment notifications): mitigate with a `WHERE` clause that skips notifications during CSV import (set `pg_temp.skip_notifications = true` in the import path, trigger checks).
- **`history.pushState` interference with Next router**: Next 16 uses History API for client navigation. Risk that our modal entries collide. Mitigate by namespacing state with `{ babunModal: id }` and only handling popstate for events that match this shape.

## Owner one-shots (~10 min)

Owner generates the keypair locally so the private key never enters the chat transcript:

1. PowerShell: `npx --yes web-push generate-vapid-keys --json` → captures both halves locally.
2. **Edge Function Secrets** (NOT Postgres Vault — they are different stores; Edge Functions read only from Edge Function Secrets):
   - Open https://supabase.com/dashboard/project/<project>/functions/secrets
   - Add `VAPID_PRIVATE_KEY` = `privateKey` from step 1. Paste straight into the Dashboard form, never to chat.
   - Add `VAPID_PUBLIC_KEY` = `publicKey` from step 1.
   - Add `VAPID_SUBJECT` = `mailto:support@babun.app`.
3. Vercel env `NEXT_PUBLIC_VAPID_PUBLIC_KEY` = same `publicKey` (Production + Preview + Development).
4. Apply migration `20260501000001_push_subscriptions.sql` via Supabase Dashboard → SQL Editor.
5. Apply migration `20260501000002_push_subscriptions_service_role.sql` (service_role bypass — see post-JWT-migration gotcha below).
6. Deploy Edge Function: `supabase functions deploy send_push --no-verify-jwt --project-ref <project>` (or Dashboard UI deploy if CLI not installed).
7. After deploy, set Verify JWT = OFF in the function's settings (pg_net trigger in G3 calls without an auth token).

### Post-JWT-migration service_role gotcha (G1 hotfix learning)

Supabase migrated from a single legacy `SUPABASE_SERVICE_ROLE_KEY` to `SUPABASE_SECRET_KEYS` — keys minted via JWT Signing Keys. The legacy var is still injected for backward compat but on newer projects it lacks the privileges to bypass RLS. The new keys also do not auto-bypass RLS.

**Pattern for any future table that needs to be readable from an Edge Function via service-role** (cross-user fan-out, batch jobs, scheduled cleanup, etc.):

```sql
grant all on public.<table_name> to service_role;

create policy <table_name>_service_role_all
  on public.<table_name>
  for all to service_role
  using (true) with check (true);
```

**Don't make this the default for every new table** — only the ones that genuinely need server-side cross-user reads. Tables that should remain user-scoped (the vast majority) keep their original `for select to authenticated using (user_id = auth.uid())` shape with no service_role addition.

Applied to `push_subscriptions` in `20260501000002_push_subscriptions_service_role.sql`.

### VAPID public key (rotated 2026-05-01) — for traceability

```
BP-uRrKUuklZGmzVRlLAJgzB93MmNovjoVB6tbIBLwi-A4GyMt7KWN9wipVZ-c1GZCN3Ltk9zqWTn8m_FTvOqnE
```

This is the `NEXT_PUBLIC_VAPID_PUBLIC_KEY` baked into the client SDK at build time. Public is safe to commit — that's how every Web Push library on the web works. The matching private key lives only in Supabase Vault as `VAPID_PRIVATE_KEY` and was generated locally in PowerShell, never via the agent's tool output.

A previous keypair (`BECYeBiHN...JJGM`) appeared in the chat transcript during initial G1 drafting and was invalidated before any deploy. Do not use it for any future test; the migration + skeleton both use Vault secrets, so as long as Vault holds only the new private key, the rotation is complete.
