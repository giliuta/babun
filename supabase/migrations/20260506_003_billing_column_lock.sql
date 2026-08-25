-- ─────────────────────────────────────────────────────────────────────
-- STORY-078 — Lock billing columns on public.tenants from owner-side
-- writes.
--
-- Found by code review (iteration 1, issue #8): the
-- tenants_update_own RLS policy is column-agnostic, so any
-- authenticated owner could:
--
--   await supabase.from('tenants')
--     .update({ plan: 'business', plan_override: 'lifetime' })
--     .eq('id', myTenantId)
--
-- and bypass every paywall in 4 lines of DevTools. Stripe-as-source-
-- of-truth is documented in the webhook code comment but enforced
-- only by good behaviour on the app side.
--
-- The fix is column-level: revoke UPDATE on the billing columns from
-- the `authenticated` role; service_role (used by the Stripe webhook)
-- still has full UPDATE because it bypasses RLS + grants.
--
-- Columns locked:
--   * plan                — Stripe-managed
--   * plan_override       — admin-managed (set via /admin/tenants)
--   * stripe_customer_id  — created by ensureStripeCustomer
--   * stripe_subscription_id  — set by webhook on subscription.created
--   * subscription_status     — set by webhook
--   * trial_ends_at           — set by webhook
--   * current_period_end      — set by webhook
--
-- Owner can still UPDATE other columns via tenants_update_own
-- (name, vertical, city, country, currency, contacts, etc.).
-- ─────────────────────────────────────────────────────────────────────

revoke update (
  plan,
  plan_override,
  stripe_customer_id,
  stripe_subscription_id,
  subscription_status,
  trial_ends_at,
  current_period_end
) on public.tenants from authenticated, anon;

-- service_role keeps everything via the existing tenants_service_role
-- policy that has `with check (true)`. No re-grant needed for it.

comment on column public.tenants.plan is
  'Stripe-managed. Owner cannot UPDATE this column directly — column '
  'grant revoked from authenticated in 20260506_003. Mutated only via '
  'the /api/stripe/webhook handler running with service_role.';

comment on column public.tenants.plan_override is
  'Platform admin-managed. Owner cannot UPDATE this column directly. '
  'Set via /admin/tenants/[id] form which calls a service-role action.';
