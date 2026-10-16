---
name: SUPABASE-MIGRATIONS-RUNBOOK-2026-05-17
status: applied
brief: "Sprint #3 CRM Core — all migrations applied to prod"
---

# Supabase migrations runbook — 2026-05-17

**Status:** all migrations applied to production `rdtokosbqvgemicqeqwz`
via Supabase MCP. The original four-migration plan grew to nine after
the post-deploy advisor + security review surfaced additional gaps.

## Order (applied in this sequence)

```
20260517000001_payment_status_and_finance_sync.sql
20260517000002_recurring_reminder_manual_fields.sql
20260517000003_webhooks_master_docs_ratings.sql
20260517000004_master_ratings_security.sql
20260517000005_post_apply_hardening.sql               (advisor follow-up)
20260517000007_feedback_rpc_security_definer.sql      (Beta #52 unblock)
20260517_009_feedback_rpc_hardening.sql             (security-review fix)
```

`_006` and `_008` are reserved for follow-up changes to
`calendar_settings` (adds `work_start_hour` / `work_end_hour` /
`scroll_open_hour`); not yet applied because the operator-facing
behaviour is identical without them (the cast-based code path from
v622 swallows the missing-column writes via the existing
graceful-fallback).

## What each one does

### `_001` — payment_status + finance auto-sync (P0 #13 + #14)
- Adds `payment_status` / `payment_method` / `paid_amount` columns to
  `appointments` (CHECK-constrained, backfill from `prepaid_amount`).
- Creates `finance_categories` reference + global seed (Услуги/
  Товары/Чаевые/…).
- Creates `finance_transactions` ledger with RLS + `UNIQUE
  (appointment_id, type)` for idempotency.
- Adds AFTER UPDATE / AFTER INSERT triggers
  `sync_appointment_finance{,_insert}` — books an income row when
  `(status, payment_status)` cross into `(completed, paid)`, refund
  row on the inverse transition.

### `_002` — manual reminder fields (P0 #19)
- Adds `type` / `manual` / `notify_channel` columns to
  `recurring_reminders` (additive, defaults preserve existing rows).
- New composite index `(tenant_id, type, status, next_due_date)`
  for the typed inbox view.

### `_003` — Beta tables (Beta #50 + #51 + #52)
- `public.webhooks` (HMAC secret + event mask + last-fire stats + RLS).
- `public.master_documents` (kind/storage_path/expires_at + idx for
  the 30-day expiry cron).
- `public.master_ratings` (1–5 stars + comment, **initial RLS too
  permissive — see `_004`**).

### `_004` — master_ratings security tightening (CRITICAL)
- New `master_rating_tokens` (one-shot, 60-day-expiring tokens,
  service role only; anon insert blocked).
- Drops permissive `master_ratings_insert_any` policy.
- New `master_ratings_insert_with_token` policy: requires a matching
  unused non-expired token row.
- Adds `master_ratings.token` FK column.
- SECURITY DEFINER trigger `consume_rating_token` marks the token
  used after a successful insert.

**Must apply `_003` and `_004` together (or `_003` first then `_004`
within the same change window) — `_003` alone leaves the public
endpoint open to spam.**

## How to apply

### Option 1 — Supabase CLI (recommended)

From `babun-crm/apps/web`:

```bash
# 1. Make sure you're linked to the right project
supabase link --project-ref rdtokosbqvgemicqeqwz

# 2. Push all pending migrations
supabase db push

# 3. Regenerate database types so the client picks up the new tables
npm run db:types
```

### Option 2 — Manual via Dashboard

If the CLI isn't available, paste each `.sql` file into Dashboard →
SQL Editor → New query → Run. Apply in the order above. After the
last one, regenerate types via the «Generate Types» action or run
`npm run db:types` locally.

## Post-apply checklist

After `supabase db push`:

1. **Smoke test** — open `/dashboard/finances`, complete an
   appointment via PaymentBlock → Card → verify income row appears
   in the Доходы tab on next render (= trigger fired).
2. **Refund test** — cancel a previously-paid appointment → verify
   a negative finance_transactions row with `type='refund'`.
3. **Partial test** — open PaymentBlock → «Частично» → enter
   `total - 20` → verify `appointments.payment_status='partial'` and
   `paid_amount` reflects the input. No income row yet (trigger
   only fires on full payment).
4. **Webhooks UI** — open `/dashboard/settings/integrations` →
   Webhooks card should list any existing rows, allow add/delete.
5. **Feedback form** — manually generate a token row via SQL:
   ```sql
   insert into master_rating_tokens (token, tenant_id, master_id)
   values ('test-token-1234567890', '<your-tenant-id>', '<a-master-id>');
   ```
   Open `/feedback/test-token-1234567890` → form should render.
   Submit a rating → row should land in `master_ratings`, token
   should be marked `used_at`.

## Rollback

If anything goes wrong after applying `_001` (the riskiest one
because of the trigger), the safest path is to drop the trigger
before reverting the column:

```sql
drop trigger if exists appointments_finance_sync on public.appointments;
drop trigger if exists appointments_finance_sync_insert on public.appointments;
drop function if exists public.sync_appointment_finance();
drop function if exists public.sync_appointment_finance_insert();
-- now the new columns are dormant; the UI keeps working because
-- payment_status is optional in the TypeScript Appointment type.
```

The `finance_transactions` table can stay populated — it doesn't
break anything if no new rows arrive while the trigger is off.

## Code paths that depend on these tables

| Migration | UI / API path |
|-----------|---------------|
| `_001` payment_status | `PaymentBlock` → `handlePay` in `AppointmentSheet` writes payment_status; `FinanceBlock` / `VisitsBlock` read the badge; `DebtsTab.onMarkPaid` flips to paid |
| `_002` recurring | `NewReminderSheet` writes type/manual/notify_channel via `createRecurringReminder` |
| `_003` webhooks | `<WebhooksCard />` on `/dashboard/settings/integrations` |
| `_003` ratings + `_004` tokens | `/feedback/[token]` + `/api/feedback/submit` |
| `_003` master_documents | (no UI yet — uploader is the next iteration) |

## What's NOT yet wired

- **Webhook dispatcher** (edge function that fires POST → tenant
  URL on subscribed events). Schema is ready; function to be
  written in a follow-up.
- **Master document uploader UI** + Storage bucket creation.
- **Post-visit SMS dispatcher** that generates `master_rating_tokens`
  and sends the SMS with `/feedback/<token>` link. Today the token
  is created manually; once the cron job ships, every completed +
  paid appointment with consent_given will get a token automatically.
