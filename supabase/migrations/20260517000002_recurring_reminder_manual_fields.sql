-- ─────────────────────────────────────────────────────────────────────
-- P0 #19 (CRM Core brief) — manual reminder support on recurring_reminders.
--
-- Background.
--   `recurring_reminders` was modelled around the «schedule next
--   service after a completed appointment» flow — every row was
--   seeded by a closed visit. The brief asks for ad-hoc reminders:
--   «позвонить через неделю», «прислать каталог», «спросить как
--   стиралка». Those reminders share the same inbox UI but are NOT
--   tied to a completed appointment, and they carry a kind (call /
--   visit / sms / service / custom) + a notification channel
--   (push / sms / email).
--
-- Additive: existing rows read as `type='service'`, `manual=false`,
-- `notify_channel='push'` — matches the pre-migration behaviour.
-- ─────────────────────────────────────────────────────────────────────

alter table public.recurring_reminders
  add column if not exists type text not null default 'service'
    check (type in ('call', 'visit', 'sms', 'service', 'custom')),
  add column if not exists manual boolean not null default false,
  add column if not exists notify_channel text not null default 'push'
    check (notify_channel in ('push', 'sms', 'email'));

-- Inbox query gains a type filter on the «звонки» tab. Composite
-- index keeps the existing tenant+status+date lookup hot while
-- letting the typed view scan only the right rows.
create index if not exists idx_recurring_reminders_type
  on public.recurring_reminders(tenant_id, type, status, next_due_date);
