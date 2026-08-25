-- ─────────────────────────────────────────────────────────────────────
-- Beta #52 security gap fix — `master_ratings` was created in
-- 20260517_003 with a permissive `with check (true)` policy for the
-- public feedback form. As-is, any bot that knows a master_id and
-- tenant_id can spam 5-star ratings indefinitely. This migration
-- closes the gap with three layers:
--
--   1. One-shot token table (`master_rating_tokens`) — the
--      post-visit SMS link carries a 192-bit token that resolves to
--      (appointment_id, master_id, tenant_id). Insert is gated on
--      «this token exists and hasn't been consumed yet».
--   2. Trigger consumes the token on insert (sets `used_at`).
--   3. RLS tightened: anon inserts now require a matching unused
--      token row.
-- ─────────────────────────────────────────────────────────────────────

-- ─── One-shot tokens ─────────────────────────────────────────────────
create table if not exists public.master_rating_tokens (
  token            text primary key,
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  appointment_id   uuid references public.appointments(id) on delete cascade,
  master_id        text not null,
  created_at       timestamptz not null default now(),
  used_at          timestamptz,
  -- Tokens expire 60 days after issue so a forgotten link can't be
  -- mined years later.
  expires_at       timestamptz not null default (now() + interval '60 days')
);

create index if not exists idx_master_rating_tokens_master
  on public.master_rating_tokens(tenant_id, master_id);
create index if not exists idx_master_rating_tokens_unused
  on public.master_rating_tokens(token)
  where used_at is null;

alter table public.master_rating_tokens enable row level security;

-- Owner reads to display «Отзыв ожидает оценки от Иванова» etc.
create policy rating_tokens_read_own on public.master_rating_tokens for select
  to anon, authenticated
  using (tenant_id = public.current_tenant_id());

-- Only the service role (edge functions) creates tokens. The public
-- feedback page never inserts new tokens — it consumes existing ones.
create policy rating_tokens_no_anon_write on public.master_rating_tokens
  for insert to anon
  with check (false);

create policy rating_tokens_owner_insert on public.master_rating_tokens
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

-- ─── Tighten the existing master_ratings insert policy ───────────────
drop policy if exists master_ratings_insert_any on public.master_ratings;

-- New policy: insert requires a real, unused, non-expired token
-- pointing at the same (tenant_id, master_id) the row claims.
-- We embed the token in the row itself via a new optional column.
alter table public.master_ratings
  add column if not exists token text references public.master_rating_tokens(token) on delete set null;

create index if not exists idx_master_ratings_token
  on public.master_ratings(token) where token is not null;

create policy master_ratings_insert_with_token on public.master_ratings
  for insert to anon, authenticated
  with check (
    token is not null
    and exists (
      select 1 from public.master_rating_tokens t
      where t.token = master_ratings.token
        and t.used_at is null
        and t.expires_at > now()
        and t.tenant_id = master_ratings.tenant_id
        and t.master_id = master_ratings.master_id
    )
  );

-- Mark the token used after a successful insert. SECURITY DEFINER
-- so the trigger runs with elevated privileges and bypasses the
-- read-policy on master_rating_tokens (which is tenant-scoped).
create or replace function public.consume_rating_token()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.token is not null then
    update public.master_rating_tokens
       set used_at = now()
     where token = NEW.token
       and used_at is null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists master_ratings_consume_token on public.master_ratings;
create trigger master_ratings_consume_token
  after insert on public.master_ratings
  for each row execute function public.consume_rating_token();
