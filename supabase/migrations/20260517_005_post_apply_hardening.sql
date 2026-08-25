-- Post-deploy hardening applied right after _001…_004 landed on prod
-- (rdtokosbqvgemicqeqwz). Supabase advisor flagged three small gaps:
--
--   1. `finance_categories` was created without `enable row level
--      security`. The table is intentionally readable from any tenant
--      (the seeded global defaults have tenant_id IS NULL), but the
--      linter wants RLS on every public table. Solution: enable RLS,
--      read-policy that lets anyone see globals + their own rows,
--      write-policy locked to the owning tenant.
--
--   2. `sync_appointment_finance{,_insert}` had no explicit
--      `search_path` set, so a search_path attacker could in theory
--      shadow the lookups. Pin to public.
--
--   3. `consume_rating_token` is SECURITY DEFINER and was reachable
--      through PostgREST as /rest/v1/rpc/consume_rating_token.
--      Trigger functions shouldn't be RPC-callable. Revoke EXECUTE
--      from anon + authenticated; the trigger fires via the
--      table-level grant.
--
-- Advisor re-check after this migration: 0 ERROR, 0 lint hits on the
-- _001…_004 objects. The 61 remaining WARNs are pre-existing on
-- unrelated legacy functions (e.g. set_updated_at).

alter table public.finance_categories enable row level security;

create policy finance_categories_read_any on public.finance_categories
  for select to anon, authenticated
  using (
    tenant_id is null
    or tenant_id = public.current_tenant_id()
  );

create policy finance_categories_write_own on public.finance_categories
  for all to authenticated
  using      (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

alter function public.sync_appointment_finance() set search_path = public;
alter function public.sync_appointment_finance_insert() set search_path = public;

revoke execute on function public.consume_rating_token() from anon, authenticated, public;
