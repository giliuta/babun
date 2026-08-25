-- Mobile CRM privacy boundary. Operational roles receive deliberately narrow
-- The 14-digit prefix is a unique Supabase CLI migration version.
-- projections instead of raw tenant/client/service rows. Row-level client
-- data is assignment-scoped, attachments follow the same scope, and manual
-- day finance is owner-only. The legacy web client is intentionally outside
-- this migration's compatibility contract.

-- These columns already exist in the generated production schema, but the
-- checked-in migration chain never created them. Declare them before any
-- function below references deleted_at (and before later invoice/client RPCs
-- reference the remaining fields) so a clean database can apply 001..012.
alter table public.clients
  add column if not exists phone_e164 text,
  add column if not exists avatar_url text,
  add column if not exists deleted_at timestamptz,
  add column if not exists favorite_master_id text;

-- ── Safe company profile ────────────────────────────────────────────
-- tenants contains invoice requisites, subscription identifiers and bank
-- details in the same row as the display name. RLS cannot mask columns, so
-- direct table reads are owner-only and operational roles use this projection.
create or replace function public.current_tenant_profile_safe()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_user_role() = 'owner' then to_jsonb(t)
    when public.current_user_role() in ('dispatcher', 'master') then
      jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'vertical', t.vertical,
        'city', t.city,
        'country', t.country,
        'address', t.address,
        'logo_url', t.logo_url,
        'contact_phone', t.contact_phone,
        'contact_email', t.contact_email,
        'contact_whatsapp', t.contact_whatsapp,
        'contact_telegram', t.contact_telegram,
        'contact_instagram', t.contact_instagram,
        'onboarded_at', t.onboarded_at,
        'personal_calendar_enabled', t.personal_calendar_enabled,
        'created_at', t.created_at
      )
    else null
  end
    from public.tenants t
   where t.id = public.current_tenant_id()
   limit 1
$$;

revoke all on function public.current_tenant_profile_safe()
  from public, anon, authenticated;
grant execute on function public.current_tenant_profile_safe()
  to authenticated;

-- Atomic shallow merge for blur/switch profile edits. A client-side
-- read-modify-write loses concurrent fields when two controls save together.
create or replace function public.patch_master_profile(
  p_master_id text,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile jsonb;
begin
  if auth.uid() is null
     or public.current_tenant_id() is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'only an owner can update a master profile'
      using errcode = '42501';
  end if;

  if p_master_id is null
     or nullif(btrim(p_master_id), '') is null
     or p_patch is null
     or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid master profile patch'
      using errcode = '22023';
  end if;

  update public.masters m
     set profile = coalesce(m.profile, '{}'::jsonb) || p_patch
   where m.tenant_id = public.current_tenant_id()
     and m.id = p_master_id
  returning m.profile into v_profile;

  if not found then
    raise exception 'master not found'
      using errcode = 'P0002';
  end if;

  return v_profile;
end;
$$;

revoke all on function public.patch_master_profile(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.patch_master_profile(text, jsonb)
  to authenticated;

drop policy if exists tenants_select_member on public.tenants;
drop policy if exists tenants_select_owner on public.tenants;
create policy tenants_select_owner on public.tenants for select
  to authenticated
  using (
    id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

-- ── Assignment helpers ───────────────────────────────────────────────
-- SECURITY DEFINER is required to avoid clients -> appointments -> clients
-- policy recursion. The function never trusts caller-supplied tenant ids: it
-- pins every lookup to the active JWT tenant and auth.uid membership helpers.
create or replace function public.current_user_can_access_client(
  p_client_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.clients c
     where c.id = p_client_id
       and c.tenant_id = public.current_tenant_id()
       and (
         public.current_user_role() in ('owner', 'dispatcher')
         or (
           public.current_user_role() = 'master'
           and exists (
             select 1
               from public.appointments a
              where a.tenant_id = c.tenant_id
                and a.client_id = c.id
                and a.kind = 'work'
                and (
                  a.master_id = public.current_user_master_id()
                  or a.team_id = any(public.current_user_team_ids())
                )
           )
         )
       )
  )
$$;

revoke all on function public.current_user_can_access_client(uuid)
  from public, anon, authenticated;
grant execute on function public.current_user_can_access_client(uuid)
  to authenticated;

create or replace function public.current_user_can_access_client_tag(
  p_tag_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('owner', 'dispatcher')
    or (
      public.current_user_role() = 'master'
      and exists (
        select 1
          from public.client_tag_assignments cta
         where cta.tenant_id = public.current_tenant_id()
           and cta.tag_id = p_tag_id
           and public.current_user_can_access_client(cta.client_id)
      )
    )
$$;

revoke all on function public.current_user_can_access_client_tag(uuid)
  from public, anon, authenticated;
grant execute on function public.current_user_can_access_client_tag(uuid)
  to authenticated;

-- Shared visibility predicate for photo metadata/storage. It does not depend
-- on the caller having raw SELECT on appointments, so masters can use photos
-- attached to assigned work while the finance-bearing base row stays closed.
create or replace function public.current_user_can_access_appointment(
  p_appointment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.appointments a
     where a.id = p_appointment_id
       and a.tenant_id = public.current_tenant_id()
       and (
         public.current_user_role() in ('owner', 'dispatcher')
         or (
           public.current_user_role() = 'master'
           and (
             (
               a.kind = 'work'
               and (
                 a.master_id = public.current_user_master_id()
                 or a.team_id = any(public.current_user_team_ids())
               )
             )
             or (
               a.kind in ('event', 'personal')
               and a.created_by = auth.uid()
             )
           )
         )
       )
  )
$$;

revoke all on function public.current_user_can_access_appointment(uuid)
  from public, anon, authenticated;
grant execute on function public.current_user_can_access_appointment(uuid)
  to authenticated;

-- Minimal operational identities for the native crew UI. These functions
-- are the only master read path; raw clients/services rows contain internal
-- notes, blacklist flags, finance and service economics.
create or replace function public.list_master_clients_safe(
  p_client_id uuid default null
)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id,
    'tenant_id', c.tenant_id,
    'full_name', c.full_name,
    'phone', c.phone,
    'created_at', c.created_at
  )
    from public.clients c
   where public.current_user_role() = 'master'
     and c.tenant_id = public.current_tenant_id()
     and c.deleted_at is null
     and (p_client_id is null or c.id = p_client_id)
     and public.current_user_can_access_client(c.id)
   order by c.full_name, c.id
$$;

revoke all on function public.list_master_clients_safe(uuid)
  from public, anon, authenticated;
grant execute on function public.list_master_clients_safe(uuid)
  to authenticated;

create or replace function public.list_master_services_safe()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', s.id,
    'tenant_id', s.tenant_id,
    'name', s.name,
    'color', s.color
  )
    from public.services s
   where public.current_user_role() = 'master'
     and s.tenant_id = public.current_tenant_id()
     and s.is_active
     and exists (
       select 1
         from public.appointments a
        where a.tenant_id = s.tenant_id
          and a.kind = 'work'
          and (
            a.master_id = public.current_user_master_id()
            or a.team_id = any(public.current_user_team_ids())
          )
          and (
            coalesce(a.service_ids, '[]'::jsonb) ? s.id
            or exists (
              select 1
                from jsonb_array_elements(
                  case
                    when jsonb_typeof(a.services) = 'array' then a.services
                    else '[]'::jsonb
                  end
                ) line
               where line ->> 'serviceId' = s.id
            )
          )
     )
   order by s.position, s.name, s.id
$$;

revoke all on function public.list_master_services_safe()
  from public, anon, authenticated;
grant execute on function public.list_master_services_safe()
  to authenticated;

-- Dispatchers need sale-side catalogue data to price and schedule a booking,
-- but never material/cost/margin economics. Raw services stays owner-only;
-- this projection is the complete dispatcher read contract.
create or replace function public.list_dispatcher_services_safe()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', s.id,
    'tenant_id', s.tenant_id,
    'category_id', s.category_id,
    'name', s.name,
    'price', s.price,
    'duration_minutes', s.duration_minutes,
    'color', s.color,
    'is_countable', s.is_countable,
    'price_tiers', s.price_tiers,
    'duration_tiers', s.duration_tiers,
    'bulk_threshold', s.bulk_threshold,
    'bulk_price', s.bulk_price,
    'brigade_ids', s.brigade_ids,
    'is_active', s.is_active,
    'position', s.position,
    'created_at', s.created_at,
    'updated_at', s.updated_at
  )
    from public.services s
   where public.current_user_role() = 'dispatcher'
     and s.tenant_id = public.current_tenant_id()
     and s.is_active
   order by s.position, s.name, s.id
$$;

revoke all on function public.list_dispatcher_services_safe()
  from public, anon, authenticated;
grant execute on function public.list_dispatcher_services_safe()
  to authenticated;

-- ── Clients and tags ─────────────────────────────────────────────────
drop policy if exists clients_select_member on public.clients;
drop policy if exists clients_select_role_scoped on public.clients;
create policy clients_select_role_scoped on public.clients for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  );

drop policy if exists client_tag_assignments_select_member
  on public.client_tag_assignments;
drop policy if exists client_tag_assignments_select_role_scoped
  on public.client_tag_assignments;
create policy client_tag_assignments_select_role_scoped
  on public.client_tag_assignments for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  );

drop policy if exists client_tags_select_member on public.client_tags;
drop policy if exists client_tags_select_role_scoped on public.client_tags;
create policy client_tags_select_role_scoped on public.client_tags for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  );

drop policy if exists services_select_member on public.services;
drop policy if exists services_select_operator on public.services;
drop policy if exists services_select_owner on public.services;
create policy services_select_owner on public.services for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

drop policy if exists service_categories_select_member
  on public.service_categories;
drop policy if exists service_categories_select_operator
  on public.service_categories;
create policy service_categories_select_operator
  on public.service_categories for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  );

-- 20260430's permissive policy survived the 20260720210001 rename and would OR
-- with appointment_photos_by_appointment, exposing every tenant photo row.
drop policy if exists appointment_photos_all_own
  on public.appointment_photos;
drop policy if exists appointment_photos_all_member
  on public.appointment_photos;
drop policy if exists appointment_photos_by_appointment
  on public.appointment_photos;
drop policy if exists appointment_photos_select_visible
  on public.appointment_photos;
drop policy if exists appointment_photos_insert_visible
  on public.appointment_photos;
drop policy if exists appointment_photos_update_operator
  on public.appointment_photos;
drop policy if exists appointment_photos_delete_operator
  on public.appointment_photos;

create policy appointment_photos_select_visible
  on public.appointment_photos for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_can_access_appointment(appointment_id)
  );

create policy appointment_photos_insert_visible
  on public.appointment_photos for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_can_access_appointment(appointment_id)
  );

create policy appointment_photos_update_operator
  on public.appointment_photos for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  );

create policy appointment_photos_delete_operator
  on public.appointment_photos for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  );

-- ── Client attachments ───────────────────────────────────────────────
-- The claim that used to stand here ("missing from the checked-in migration
-- chain") was wrong: the table is created by 20260517_008_client_attachments.sql,
-- which sorts earlier and therefore always wins. The CREATE TABLE IF NOT EXISTS
-- that followed was dead on every database — and worse, it silently described a
-- schema nobody has (unique storage_path, mime_type default
-- 'application/octet-stream', size_bytes check, created_by FK + default
-- auth.uid()), so reading this file taught the wrong shape. The block is gone;
-- the constraints it promised are actually created by
-- 20260826090000_client_attachments_schema_drift.sql. Only the parts below,
-- which really do something, stay.
create index if not exists idx_client_attachments_tenant_client
  on public.client_attachments(tenant_id, client_id, created_at desc);

alter table public.client_attachments enable row level security;

-- Unknown/manual production policies must not remain permissive: policies are
-- OR-ed in Postgres, so merely adding a strict policy would not close a broad
-- existing one.
do $$
declare
  p record;
begin
  for p in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = 'client_attachments'
  loop
    execute format(
      'drop policy if exists %I on public.client_attachments',
      p.policyname
    );
  end loop;
end;
$$;

create policy client_attachments_select_role_scoped
  on public.client_attachments for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  );

create policy client_attachments_insert_operator
  on public.client_attachments for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
    and public.current_user_can_access_client(client_id)
    and (created_by is null or created_by = auth.uid())
  );

create policy client_attachments_update_operator
  on public.client_attachments for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
    and public.current_user_can_access_client(client_id)
  );

create policy client_attachments_delete_operator
  on public.client_attachments for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  );

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'client-attachments',
  'client-attachments',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'text/plain'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Invalid path fragments must become NULL rather than throwing from an RLS
-- predicate and turning a harmless list request into HTTP 500.
create or replace function public.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
begin
  return p_value::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

revoke all on function public.try_uuid(text) from public, anon, authenticated;
grant execute on function public.try_uuid(text) to authenticated;

-- Remove every historical/manual policy that mentions this bucket. A broad
-- policy would otherwise OR with the strict policies below.
do $$
declare
  p record;
begin
  for p in
    select policyname
      from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and (
         coalesce(qual, '') ilike '%client-attachments%'
         or coalesce(with_check, '') ilike '%client-attachments%'
       )
  loop
    execute format('drop policy if exists %I on storage.objects', p.policyname);
  end loop;
end;
$$;

create policy storage_client_attachments_select
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'client-attachments'
    and public.current_user_role() in ('owner', 'dispatcher')
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_user_can_access_client(
      public.try_uuid((storage.foldername(name))[2])
    )
  );

create policy storage_client_attachments_insert
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'client-attachments'
    and public.current_user_role() in ('owner', 'dispatcher')
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_user_can_access_client(
      public.try_uuid((storage.foldername(name))[2])
    )
  );

create policy storage_client_attachments_update
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'client-attachments'
    and public.current_user_role() in ('owner', 'dispatcher')
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_user_can_access_client(
      public.try_uuid((storage.foldername(name))[2])
    )
  )
  with check (
    bucket_id = 'client-attachments'
    and public.current_user_role() in ('owner', 'dispatcher')
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_user_can_access_client(
      public.try_uuid((storage.foldername(name))[2])
    )
  );

create policy storage_client_attachments_delete
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'client-attachments'
    and public.current_user_role() in ('owner', 'dispatcher')
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_user_can_access_client(
      public.try_uuid((storage.foldername(name))[2])
    )
  );

-- ── SMS templates without the legacy kitchen-sink blob ──────────────
-- Production keeps old web state in tenant_state.prototype_state. Reading
-- that row to get one smsTemplates key exposes every co-located prototype
-- entity, so mobile uses atomic key-level RPCs and raw access is owner-only.
create table if not exists public.tenant_state (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  prototype_state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tenant_state enable row level security;

do $$
declare
  p record;
begin
  for p in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = 'tenant_state'
  loop
    execute format('drop policy if exists %I on public.tenant_state', p.policyname);
  end loop;
end;
$$;

create policy tenant_state_owner_all on public.tenant_state for all
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

create or replace function public.read_sms_templates_safe()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_state jsonb;
begin
  if auth.uid() is null
     or not coalesce(
       public.current_user_role() in ('owner', 'dispatcher'),
       false
     ) then
    raise exception 'sms templates require owner or dispatcher access'
      using errcode = '42501';
  end if;

  select ts.prototype_state
    into v_state
    from public.tenant_state ts
   where ts.tenant_id = public.current_tenant_id();

  return jsonb_build_object(
    'present', coalesce(v_state ? 'smsTemplates', false),
    'templates', case
      when coalesce(v_state ? 'smsTemplates', false)
        then v_state -> 'smsTemplates'
      else '[]'::jsonb
    end
  );
end;
$$;

revoke all on function public.read_sms_templates_safe()
  from public, anon, authenticated;
grant execute on function public.read_sms_templates_safe()
  to authenticated;

create or replace function public.write_sms_templates_safe(p_templates jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not coalesce(
       public.current_user_role() in ('owner', 'dispatcher'),
       false
     ) then
    raise exception 'sms templates require owner or dispatcher access'
      using errcode = '42501';
  end if;

  if p_templates is null or jsonb_typeof(p_templates) <> 'array' then
    raise exception 'sms templates must be an array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_templates) > 200
     or exists (
       select 1
        from jsonb_array_elements(p_templates) item
        where jsonb_typeof(item) <> 'object'
           or jsonb_typeof(item -> 'id') is distinct from 'string'
           or jsonb_typeof(item -> 'body') is distinct from 'string'
           or length(item ->> 'id') > 200
           or length(item ->> 'body') > 5000
     ) then
    raise exception 'sms templates payload is invalid'
      using errcode = '22023';
  end if;

  insert into public.tenant_state (tenant_id, prototype_state, updated_at)
  values (
    public.current_tenant_id(),
    jsonb_build_object('smsTemplates', p_templates),
    now()
  )
  on conflict (tenant_id) do update
     set prototype_state = jsonb_set(
           coalesce(public.tenant_state.prototype_state, '{}'::jsonb),
           '{smsTemplates}',
           p_templates,
           true
         ),
         updated_at = now();

  return p_templates;
end;
$$;

revoke all on function public.write_sms_templates_safe(jsonb)
  from public, anon, authenticated;
grant execute on function public.write_sms_templates_safe(jsonb)
  to authenticated;

-- ── Assigned brigade reference data ─────────────────────────────────
-- Team rows contain payout percentages and private membership/role blobs;
-- master rows contain an unrestricted HR/profile jsonb. Operational users
-- receive only fields needed by booking and assigned-work UI.
create or replace function public.list_operational_teams_safe()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', t.id,
    'tenant_id', t.tenant_id,
    'name', t.name,
    'region', t.region,
    'color', t.color,
    'is_active', t.is_active,
    'position', t.position,
    'timezone', t.timezone,
    'default_city', t.default_city,
    'cities', t.cities,
    'tint_days_by_label', t.tint_days_by_label,
    'hide_cancelled', t.hide_cancelled,
    'allow_overtime', t.allow_overtime,
    'appointment_blocks', t.appointment_blocks,
    'buffer_minutes', t.buffer_minutes,
    'calendar_window_start', t.calendar_window_start,
    'calendar_window_end', t.calendar_window_end,
    'default_scroll_time', t.default_scroll_time,
    'default_slot_minutes', t.default_slot_minutes,
    'created_at', t.created_at,
    'updated_at', t.updated_at
  )
    from public.teams t
   where public.current_user_role() in ('dispatcher', 'master')
     and t.tenant_id = public.current_tenant_id()
     and (
       public.current_user_role() = 'dispatcher'
       or t.id = any(public.current_user_team_ids())
     )
   order by t.position, t.name, t.id
$$;

revoke all on function public.list_operational_teams_safe()
  from public, anon, authenticated;
grant execute on function public.list_operational_teams_safe()
  to authenticated;

create or replace function public.list_operational_masters_safe()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', m.id,
    'tenant_id', m.tenant_id,
    'full_name', m.full_name,
    'phone', m.phone,
    'avatar_url', m.avatar_url,
    'team_id', m.team_id,
    'role', m.role,
    'title', m.title,
    'color', m.color,
    'account_status', m.account_status,
    'is_active', m.is_active,
    'position', m.position,
    'created_at', m.created_at,
    'updated_at', m.updated_at
  )
    from public.masters m
   where public.current_user_role() in ('dispatcher', 'master')
     and m.tenant_id = public.current_tenant_id()
     and (
       public.current_user_role() = 'dispatcher'
       or m.id = public.current_user_master_id()
     )
   order by m.position, m.full_name, m.id
$$;

revoke all on function public.list_operational_masters_safe()
  from public, anon, authenticated;
grant execute on function public.list_operational_masters_safe()
  to authenticated;

-- A master must not discover empty/unassigned brigade calendars. Raw SELECT
-- is owner-only because RLS cannot mask payout_percentage/members/profile.
drop policy if exists teams_select_member on public.teams;
drop policy if exists teams_select_role_scoped on public.teams;
drop policy if exists teams_select_owner on public.teams;
create policy teams_select_owner on public.teams for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

drop policy if exists masters_select_by_role on public.masters;
drop policy if exists masters_select_owner on public.masters;
create policy masters_select_owner on public.masters for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

drop policy if exists team_schedules_select_member on public.team_schedules;
drop policy if exists team_schedules_select_role_scoped
  on public.team_schedules;
create policy team_schedules_select_role_scoped
  on public.team_schedules for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.current_user_role() in ('owner', 'dispatcher')
      or (
        public.current_user_role() = 'master'
        and team_id = any(public.current_user_team_ids())
      )
    )
  );

-- Company-wide calendar preferences are configuration, not an assigned-team
-- row. Masters use the per-team schedule above and app defaults; they cannot
-- enumerate the tenant-wide personal labels or days-off blob.
drop policy if exists calendar_settings_select_member
  on public.calendar_settings;
drop policy if exists calendar_settings_select_operator
  on public.calendar_settings;
create policy calendar_settings_select_operator
  on public.calendar_settings for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  );

-- Loyalty discounts are needed while a dispatcher prepares a booking, but
-- they are neither part of an assigned crew job nor master-facing settings.
drop policy if exists tenant_loyalty_settings_select_member
  on public.tenant_loyalty_settings;
drop policy if exists tenant_loyalty_settings_select_operator
  on public.tenant_loyalty_settings;
create policy tenant_loyalty_settings_select_operator
  on public.tenant_loyalty_settings for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  );

-- Return reminders include client names, phones and internal notes. They are
-- an operator inbox, never tenant-wide reference data for a master account.
drop policy if exists recurring_reminders_all_own
  on public.recurring_reminders;
drop policy if exists recurring_reminders_select_member
  on public.recurring_reminders;
drop policy if exists recurring_reminders_modify_owner_or_dispatcher
  on public.recurring_reminders;
drop policy if exists recurring_reminders_operator_all
  on public.recurring_reminders;
create policy recurring_reminders_operator_all
  on public.recurring_reminders for all
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  );

-- Restate equipment scoping so a historical permissive policy cannot OR with
-- the assigned-team rule from 20260720210001.
drop policy if exists equipment_tenant_all on public.equipment;
drop policy if exists equipment_select_by_role on public.equipment;
create policy equipment_select_by_role on public.equipment for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.current_user_role() in ('owner', 'dispatcher')
      or (
        public.current_user_role() = 'master'
        and assigned_team_id = any(public.current_user_team_ids())
      )
    )
  );

-- ── Calendar labels versus manual finance ───────────────────────────
drop policy if exists day_cities_all_own on public.day_cities;
drop policy if exists day_cities_select_member on public.day_cities;
drop policy if exists day_cities_modify_owner_or_dispatcher on public.day_cities;
drop policy if exists day_cities_select_role_scoped on public.day_cities;
drop policy if exists day_cities_write_operator on public.day_cities;

create policy day_cities_select_role_scoped on public.day_cities for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.current_user_role() in ('owner', 'dispatcher')
      or (
        public.current_user_role() = 'master'
        and team_id = any(public.current_user_team_ids())
      )
    )
  );

create policy day_cities_write_operator on public.day_cities for all
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  );

drop policy if exists day_extras_all_own on public.day_extras;
drop policy if exists day_extras_select_member on public.day_extras;
drop policy if exists day_extras_modify_owner_or_dispatcher on public.day_extras;
drop policy if exists day_extras_owner_all on public.day_extras;

create policy day_extras_owner_all on public.day_extras for all
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

-- ── Finance-safe mobile appointments for masters ────────────────────
-- RLS cannot mask columns. Raw appointment SELECT/UPDATE/INSERT/DELETE is
-- therefore owner/dispatcher-only; masters use the narrow list/update RPCs.
-- This intentionally drops compatibility with the abandoned web master flow.
drop policy if exists appointments_select on public.appointments;
drop policy if exists appointments_insert on public.appointments;
drop policy if exists appointments_update on public.appointments;
drop policy if exists appointments_delete on public.appointments;

create policy appointments_select on public.appointments for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
    and (
      kind = 'work'
      or (kind in ('event', 'personal') and created_by = auth.uid())
    )
  );

create policy appointments_insert on public.appointments for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
    and (
      kind = 'work'
      or (
        kind in ('event', 'personal')
        and (created_by is null or created_by = auth.uid())
      )
    )
  );

create policy appointments_update on public.appointments for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
    and (
      kind = 'work'
      or (kind in ('event', 'personal') and created_by = auth.uid())
    )
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
    and (
      kind = 'work'
      or (kind in ('event', 'personal') and created_by = auth.uid())
    )
  );

create policy appointments_delete on public.appointments for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
    and (
      kind = 'work'
      or (kind in ('event', 'personal') and created_by = auth.uid())
    )
  );

create or replace function public.list_master_appointments_safe(
  p_offset integer default 0,
  p_limit integer default 1000
)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id,
    'tenant_id', a.tenant_id,
    'client_id', a.client_id,
    'team_id', a.team_id,
    'master_id', a.master_id,
    'location_id', a.location_id,
    'date', a.date,
    'time_start', a.time_start,
    'time_end', a.time_end,
    'kind', a.kind,
    'status', a.status,
    'comment', a.comment,
    'address', a.address,
    'address_note', a.address_note,
    'address_lat', a.address_lat,
    'address_lng', a.address_lng,
    'cancel_reason', a.cancel_reason,
    'source', a.source,
    'is_online_booking', a.is_online_booking,
    'consent_given', a.consent_given,
    'color_override', a.color_override,
    'reminder_enabled', a.reminder_enabled,
    'reminder_offsets', a.reminder_offsets,
    'reminder_template', a.reminder_template,
    'service_ids', a.service_ids,
    'total_duration', a.total_duration,
    'created_by', a.created_by,
    'created_at', a.created_at,
    'updated_at', a.updated_at,
    'event_all_day', a.event_all_day,
    'event_notes', a.event_notes,
    'event_url', a.event_url,
    'event_push_enabled', a.event_push_enabled,
    'event_push_offsets', a.event_push_offsets,
    'event_push_at', a.event_push_at,
    'event_repeat', a.event_repeat,
    -- Deliberately constant/missing finance projection.
    'total_amount', 0,
    'custom_total', false,
    'discount_amount', 0,
    'prepaid_amount', 0,
    'paid_amount', 0,
    'payment_status', 'unpaid',
    'payment_method', null,
    'payments', '[]'::jsonb,
    'payment', null,
    'expenses', '[]'::jsonb,
    'services', '[]'::jsonb,
    'service_price_overrides', '{}'::jsonb,
    'global_discount', null
  )
    from public.appointments a
   where public.current_user_role() = 'master'
     and a.tenant_id = public.current_tenant_id()
     and (
       (
         a.kind = 'work'
         and (
           a.master_id = public.current_user_master_id()
           or a.team_id = any(public.current_user_team_ids())
         )
       )
       or (
         a.kind in ('event', 'personal')
         and a.created_by = auth.uid()
       )
     )
   order by a.date, a.time_start, a.id
   offset greatest(coalesce(p_offset, 0), 0)
   limit greatest(1, least(coalesce(p_limit, 1000), 1000))
$$;

revoke all on function public.list_master_appointments_safe(integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_master_appointments_safe(integer, integer)
  to authenticated;

create or replace function public.update_master_appointment_safe(
  p_appointment_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_current_status text;
begin
  if auth.uid() is null
     or public.current_user_role() is distinct from 'master' then
    raise exception 'only a master can use this appointment update'
      using errcode = '42501';
  end if;

  if p_patch is null
     or jsonb_typeof(p_patch) <> 'object'
     or p_patch = '{}'::jsonb then
    raise exception 'appointment patch must be a non-empty object'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_object_keys(p_patch) key
     where key not in ('status', 'comment')
  ) then
    raise exception 'master can update only status and comment'
      using errcode = '42501';
  end if;

  if p_patch ? 'status'
     and (
       jsonb_typeof(p_patch -> 'status') <> 'string'
       or (p_patch ->> 'status') not in (
         'scheduled',
         'in_progress',
         'completed'
       )
     ) then
    raise exception 'unsupported master appointment status'
      using errcode = '22023';
  end if;

  if p_patch ? 'comment'
     and jsonb_typeof(p_patch -> 'comment') <> 'string' then
    raise exception 'appointment comment must be text'
      using errcode = '22023';
  end if;

  if length(coalesce(p_patch ->> 'comment', '')) > 10000 then
    raise exception 'appointment comment is too long'
      using errcode = '22023';
  end if;

  select a.status
    into v_current_status
    from public.appointments a
   where a.id = p_appointment_id
     and a.tenant_id = public.current_tenant_id()
     and (
       (
         a.kind = 'work'
         and (
           a.master_id = public.current_user_master_id()
           or a.team_id = any(public.current_user_team_ids())
         )
       )
       or (
         a.kind in ('event', 'personal')
         and a.created_by = auth.uid()
       )
     )
   for update;

  if not found then
    raise exception 'appointment not found or no longer assigned'
      using errcode = 'P0002';
  end if;

  -- Crew statuses move forward only. Same-state writes are retry-safe;
  -- cancellation and every rollback stay with owner/dispatcher.
  if p_patch ? 'status'
     and not (
       (p_patch ->> 'status') = v_current_status
       or (
         v_current_status = 'scheduled'
         and (p_patch ->> 'status') = 'in_progress'
       )
       or (
         v_current_status = 'in_progress'
         and (p_patch ->> 'status') = 'completed'
       )
     ) then
    raise exception 'master appointment status transition is not allowed'
      using errcode = '23514';
  end if;

  update public.appointments a
     set status = case
           when p_patch ? 'status' then p_patch ->> 'status'
           else a.status
         end,
         comment = case
           when p_patch ? 'comment' then p_patch ->> 'comment'
           else a.comment
         end
   where a.id = p_appointment_id
     and a.tenant_id = public.current_tenant_id()
  returning jsonb_build_object(
    'id', a.id,
    'status', a.status,
    'comment', a.comment,
    'updated_at', a.updated_at
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.update_master_appointment_safe(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_master_appointment_safe(uuid, jsonb)
  to authenticated;

-- Deployment assertions.
do $$
begin
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and policyname in (
           'clients_select_role_scoped',
           'client_tag_assignments_select_role_scoped',
           'client_tags_select_role_scoped',
           'client_attachments_select_role_scoped',
           'tenant_state_owner_all',
           'services_select_owner',
           'service_categories_select_operator',
           'teams_select_owner',
           'masters_select_owner',
           'team_schedules_select_role_scoped',
           'calendar_settings_select_operator',
           'tenant_loyalty_settings_select_operator',
           'recurring_reminders_operator_all',
           'equipment_select_by_role',
           'day_cities_select_role_scoped',
           'day_extras_owner_all',
           'appointments_select'
         )) <> 17 then
    raise exception 'master privacy: expected role-scoped policies are missing';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'day_extras'
       and policyname <> 'day_extras_owner_all'
  ) then
    raise exception 'master privacy: permissive day_extras policy remains';
  end if;

  if has_function_privilege(
       'anon',
       'public.list_master_appointments_safe(integer,integer)',
       'EXECUTE'
     ) then
    raise exception 'master privacy: safe appointments RPC is callable by anon';
  end if;

  if has_function_privilege(
       'anon',
       'public.list_master_clients_safe(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.list_master_services_safe()',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.list_dispatcher_services_safe()',
       'EXECUTE'
     ) then
    raise exception 'master privacy: safe reference RPC is callable by anon';
  end if;

  if has_function_privilege(
       'anon',
       'public.current_tenant_profile_safe()',
       'EXECUTE'
     ) then
    raise exception 'master privacy: safe tenant profile RPC is callable by anon';
  end if;

  if has_function_privilege(
       'anon',
       'public.list_operational_teams_safe()',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.list_operational_masters_safe()',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.update_master_appointment_safe(uuid,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.current_user_can_access_appointment(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.read_sms_templates_safe()',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.write_sms_templates_safe(jsonb)',
       'EXECUTE'
     ) then
    raise exception 'master privacy: operational RPC is callable by anon';
  end if;

  if has_function_privilege(
       'anon',
       'public.patch_master_profile(text,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'master privacy: profile patch RPC is callable by anon';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'tenants'
       and policyname <> 'tenants_select_owner'
       and cmd in ('SELECT', 'ALL')
       and (
         'authenticated' = any(roles)
         or 'public' = any(roles)
       )
  ) then
    raise exception 'master privacy: non-owner tenants SELECT policy remains';
  end if;

  -- Unknown/manual permissive policies combine with OR. Fail deployment if
  -- any client-callable raw SELECT/ALL policy survives beyond this exact set.
  if exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename in (
         'tenants',
         'clients',
         'services',
         'teams',
         'masters',
         'appointments',
         'recurring_reminders',
         'tenant_state'
       )
       and cmd in ('SELECT', 'ALL')
       and (
         'authenticated' = any(roles)
         or 'anon' = any(roles)
         or 'public' = any(roles)
       )
       and policyname not in (
         'tenants_select_owner',
         'clients_select_role_scoped',
         'services_select_owner',
         'services_write_owner',
         'teams_select_owner',
         'teams_write_owner',
         'masters_select_owner',
         'masters_write_owner',
         'appointments_select',
         'recurring_reminders_operator_all',
         'tenant_state_owner_all'
       )
  ) then
    raise exception 'master privacy: unexpected raw SELECT policy remains';
  end if;

  if (select public from storage.buckets
       where id = 'client-attachments') is distinct from false then
    raise exception 'master privacy: client-attachments bucket is public';
  end if;
end;
$$;
