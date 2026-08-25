-- ─────────────────────────────────────────────────────────────────────
-- STORY-079 — Atomic SMS balance increment.
--
-- Code review iter 2 (#5) flagged the read-then-write pattern in the
-- Stripe webhook's `maybeCreditSmsTopup`:
--
--   read balance → in-memory add → write
--
-- Two concurrent topups for the same tenant lose the second's credit.
-- The UNIQUE on stripe_payment_intent_id only deduplicates same-event
-- retries, not concurrent different-event races.
--
-- This RPC does the increment in a single SQL statement so Postgres'
-- row-level lock guarantees correctness, and upserts the row when
-- the tenant has no tenant_sms_config yet.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.bump_sms_balance(
  p_tenant_id uuid,
  p_amount_cents integer
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_amount_cents <= 0 then
    return json_build_object('error', 'amount_must_be_positive');
  end if;

  -- Single-statement upsert with atomic add. ON CONFLICT lets the
  -- expression `balance_cents + EXCLUDED... + amount` use the live
  -- row's current value at write time, avoiding the read-then-write
  -- race entirely.
  insert into public.tenant_sms_config (tenant_id, balance_cents, free_sms_remaining)
  values (p_tenant_id, p_amount_cents, 10)
  on conflict (tenant_id) do update
    set balance_cents = tenant_sms_config.balance_cents + p_amount_cents
  returning balance_cents into v_balance;

  return json_build_object('balance_cents', v_balance);
end;
$$;

revoke all on function public.bump_sms_balance(uuid, integer) from public;
-- Service-role only — webhook is the only legit caller.
grant execute on function public.bump_sms_balance(uuid, integer) to service_role;

comment on function public.bump_sms_balance is
  'STORY-079 — atomic balance increment for SMS topups. Replaces the '
  'racy read-then-update pattern in /api/stripe/webhook handler. '
  'Service-role only — never call from app code, only from the '
  'webhook after sms_topups row has been inserted.';
