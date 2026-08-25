-- 20260625_001 — fix sync_appointment_finance_insert() trigger.
-- The trigger does `insert into finance_transactions ... on conflict
-- (appointment_id, type) do nothing`, but no matching unique index existed
-- → every appointment INSERT failed with 42P10. A PARTIAL index can't be
-- inferred by ON CONFLICT (the trigger statement has no WHERE), so use a
-- plain unique index. NULL appointment_id rows stay non-conflicting
-- (Postgres NULLS DISTINCT), so manual/non-appointment finance rows are fine.
create unique index if not exists ux_finance_tx_appointment_type
  on public.finance_transactions (appointment_id, type);
