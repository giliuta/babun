-- STORY-036 G5.5 hotfix.
-- Supabase auto-enables RLS on tables created in the public schema for
-- projects using the new publishable-key format. Our 001 migration
-- explicitly intended RLS OFF (per STORY-036 plan, real policies land
-- in STORY-038), so flip it off now and grant CRUD to the standard
-- Supabase roles. STORY-038 re-enables RLS with proper tenant policies
-- that key off auth.tenant_id().

alter table public.tenants                disable row level security;
alter table public.clients                disable row level security;
alter table public.client_tags            disable row level security;
alter table public.client_tag_assignments disable row level security;

-- Make grants explicit so PostgREST accepts INSERT/UPDATE/DELETE from
-- the anon (publishable) and authenticated roles. STORY-038 will keep
-- the grants and rely on RLS for isolation.
grant all on public.tenants                to anon, authenticated;
grant all on public.clients                to anon, authenticated;
grant all on public.client_tags            to anon, authenticated;
grant all on public.client_tag_assignments to anon, authenticated;
