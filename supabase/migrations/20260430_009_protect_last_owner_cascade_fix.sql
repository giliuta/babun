-- ─────────────────────────────────────────────────────────────────────
-- STORY-039 follow-up — fix protect_last_owner trigger for cascade delete.
--
-- Problem: the BEFORE DELETE trigger on tenant_members fires once per
-- row even during cascade deletion (e.g. when a tenant row is being
-- removed and tenants → tenant_members FK ON DELETE CASCADE fans out).
-- Each cascading owner row was being checked for "last owner" and
-- raising 23514, blocking legitimate full-tenant deletions:
--
--   * /api/account/delete for users who are sole owner of any tenant
--     (the endpoint deletes the tenant first, but the cascade then
--     hits the trigger).
--   * Owner-initiated tenant deletion in general (future feature).
--
-- Fix: when the parent tenant is no longer present, we're inside a
-- cascade — there's no invariant left to protect (the whole tenant is
-- going away), so skip the last-owner check. Direct DELETE on a
-- tenant_members row still triggers protection (the parent tenant
-- still exists in that case, so the EXISTS check passes through).
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.protect_last_owner()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  remaining int;
begin
  -- Skip protection when the parent tenant is gone. During cascade
  -- delete from tenants → tenant_members the parent row is removed
  -- first; by the time this BEFORE DELETE fires on cascading
  -- members, `tenants WHERE id = old.tenant_id` is empty.
  if TG_OP = 'DELETE'
     and not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;

  if (TG_OP = 'DELETE' and old.role = 'owner')
     or (TG_OP = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    select count(*)
      into remaining
      from public.tenant_members
     where tenant_id = old.tenant_id
       and role      = 'owner'
       and user_id   <> old.user_id;
    if remaining = 0 then
      raise exception 'cannot remove or demote the last owner of tenant %', old.tenant_id
        using errcode = '23514',
              hint    = 'invite or promote another owner first';
    end if;
  end if;
  return case when TG_OP = 'DELETE' then old else new end;
end;
$$;
