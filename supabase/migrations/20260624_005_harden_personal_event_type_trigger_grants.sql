-- 20260624_005 — harden trigger fn grants.
-- Trigger functions never need direct EXECUTE for app roles (the trigger
-- mechanism invokes them regardless). Revoking removes the needless RPC
-- surface and silences the security advisor WARN on
-- set_personal_event_type_created_by introduced in 20260624_002.
revoke execute on function public.set_personal_event_type_created_by() from anon, authenticated, public;
