-- Calendar event visibility is defined by assignment, not by the legacy
-- The 14-digit prefix is a unique Supabase CLI migration version.
-- kind spelling:
--   * event/personal + team_id IS NULL     -> private creator event;
--   * event/personal + team_id IS NOT NULL -> shared team event.
--
-- Operators read every team event in their tenant but may mutate only events
-- they created. Masters never receive raw appointment rows: the safe RPC and
-- the shared photo predicate expose only work assigned to them and events for
-- one of their currently assigned teams.

-- Empty text was historically possible while teams were local-only. Treat it
-- as the only safe interpretation (personal) before the new write guard starts
-- rejecting it as a fake team assignment.
update public.appointments
   set team_id = null
 where kind in ('event', 'personal')
   and team_id is not null
   and nullif(btrim(team_id), '') is null;

-- Preserve the creator boundary even if a client attempts to turn an event
-- into work (or vice versa) inside one UPDATE. A SECURITY DEFINER trigger is
-- also able to validate a dispatcher's team against the owner-only teams table.
create or replace function public.enforce_appointment_event_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and auth.uid() is not null
     and (
       (old.kind in ('event', 'personal'))
       is distinct from
       (new.kind in ('event', 'personal'))
     ) then
    raise exception 'appointment kind cannot cross the work/event boundary'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and auth.uid() is not null
     and old.kind in ('event', 'personal')
     and new.created_by is distinct from old.created_by then
    raise exception 'event creator is immutable'
      using errcode = '42501';
  end if;

  -- The legacy schema used globally-unconstrained client UUIDs and tenant-local
  -- text ids for teams/masters. RLS protects the appointment row itself, but a
  -- caller could otherwise attach an active-tenant row to a foreign-tenant
  -- client UUID or to an orphan team/master id. Validate every non-null
  -- reference in this SECURITY DEFINER trigger so direct PostgREST writes and
  -- RPC writes have the same tenant boundary.
  if new.client_id is not null and not exists (
    select 1
      from public.clients c
     where c.tenant_id = new.tenant_id
       and c.id = new.client_id
  ) then
    raise exception 'appointment client belongs to another tenant or is missing'
      using errcode = '23503';
  end if;

  if new.team_id is not null then
    if nullif(btrim(new.team_id), '') is null then
      raise exception 'appointment team id cannot be empty'
        using errcode = '22023';
    end if;
    if not exists (
      select 1
        from public.teams t
       where t.tenant_id = new.tenant_id
         and t.id = new.team_id
    ) then
      raise exception 'appointment team belongs to another tenant or is missing'
        using errcode = '23503';
    end if;
  end if;

  if new.master_id is not null then
    if nullif(btrim(new.master_id), '') is null then
      raise exception 'appointment master id cannot be empty'
        using errcode = '22023';
    end if;
    if not exists (
      select 1
        from public.masters m
       where m.tenant_id = new.tenant_id
         and m.id = new.master_id
    ) then
      raise exception 'appointment master belongs to another tenant or is missing'
        using errcode = '23503';
    end if;
  end if;

  if new.kind in ('event', 'personal') then
    -- trg_appointments_set_created_by runs first (trigger names are ordered),
    -- so an authenticated event always reaches this guard with its real author.
    if auth.uid() is not null
       and new.created_by is distinct from auth.uid() then
      raise exception 'event creator must match the authenticated user'
        using errcode = '42501';
    end if;

  end if;

  return new;
end;
$$;

revoke all on function public.enforce_appointment_event_scope()
  from public, anon, authenticated;

drop trigger if exists trg_appointments_zz_enforce_event_scope
  on public.appointments;
create trigger trg_appointments_zz_enforce_event_scope
  before insert or update on public.appointments
  for each row execute function public.enforce_appointment_event_scope();

-- This predicate is shared by appointment_photos RLS and Storage policies.
-- It must mirror the list RPC exactly; otherwise a signed photo URL can become
-- an accidental side channel for an event hidden from the calendar.
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
         (
           public.current_user_role() in ('owner', 'dispatcher')
           and (
             a.kind = 'work'
             or (
               a.kind in ('event', 'personal')
               and (
                 a.team_id is not null
                 or a.created_by = auth.uid()
               )
             )
           )
         )
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
               and a.team_id is not null
               and a.team_id = any(public.current_user_team_ids())
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

-- Read visibility and mutation authority intentionally differ for shared team
-- events. Masters can add evidence only to assigned work; operators can mutate
-- work photos and photos on events they personally created.
create or replace function public.current_user_can_mutate_appointment_photo(
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
         (
           public.current_user_role() in ('owner', 'dispatcher')
           and (
             a.kind = 'work'
             or (
               a.kind in ('event', 'personal')
               and a.created_by = auth.uid()
             )
           )
         )
         or (
           public.current_user_role() = 'master'
           and a.kind = 'work'
           and (
             a.master_id = public.current_user_master_id()
             or a.team_id = any(public.current_user_team_ids())
           )
         )
       )
  )
$$;

revoke all on function public.current_user_can_mutate_appointment_photo(uuid)
  from public, anon, authenticated;
grant execute on function public.current_user_can_mutate_appointment_photo(uuid)
  to authenticated;

-- Remove every historical named policy before installing the exact four-policy
-- set. PostgreSQL permissive policies combine with OR, so one survivor would
-- silently undo the private-event boundary.
drop policy if exists appointments_all_own on public.appointments;
drop policy if exists appointments_select_member on public.appointments;
drop policy if exists appointments_insert_owner_or_dispatcher on public.appointments;
drop policy if exists appointments_update_member on public.appointments;
drop policy if exists appointments_delete_owner_or_dispatcher on public.appointments;
drop policy if exists appointments_select on public.appointments;
drop policy if exists appointments_insert on public.appointments;
drop policy if exists appointments_update on public.appointments;
drop policy if exists appointments_delete on public.appointments;

do $$
declare
  p record;
begin
  for p in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = 'appointments'
  loop
    execute format('drop policy if exists %I on public.appointments', p.policyname);
  end loop;
end;
$$;

create policy appointments_select on public.appointments for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
    and (
      kind = 'work'
      or (
        kind in ('event', 'personal')
        and (team_id is not null or created_by = auth.uid())
      )
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
        and created_by = auth.uid()
      )
    )
  );

-- Team-event visibility is intentionally broader than mutation authority.
-- The author can move an event between personal/team scope, but cannot hand
-- its creator identity to another operator.
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

-- Photo metadata follows the same appointment predicate for every operation.
-- In particular, another dispatcher can view a team event's photos but cannot
-- alter a private creator event's metadata merely by knowing its UUID.
drop policy if exists appointment_photos_select_visible
  on public.appointment_photos;
drop policy if exists appointment_photos_insert_visible
  on public.appointment_photos;
drop policy if exists appointment_photos_update_operator
  on public.appointment_photos;
drop policy if exists appointment_photos_delete_operator
  on public.appointment_photos;

do $$
declare
  p record;
begin
  for p in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = 'appointment_photos'
  loop
    execute format(
      'drop policy if exists %I on public.appointment_photos',
      p.policyname
    );
  end loop;
end;
$$;

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
    and public.current_user_can_mutate_appointment_photo(appointment_id)
  );

create policy appointment_photos_update_operator
  on public.appointment_photos for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
    and public.current_user_can_mutate_appointment_photo(appointment_id)
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
    and public.current_user_can_mutate_appointment_photo(appointment_id)
  );

create policy appointment_photos_delete_operator
  on public.appointment_photos for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
    and public.current_user_can_mutate_appointment_photo(appointment_id)
  );

-- Storage object writes mirror metadata writes. SELECT remains shared for a
-- visible team event, while INSERT/DELETE use the narrower mutation predicate.
drop policy if exists storage_appointment_photos_select on storage.objects;
drop policy if exists storage_appointment_photos_insert on storage.objects;
drop policy if exists storage_appointment_photos_delete on storage.objects;

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
         coalesce(qual, '') ilike '%appointment-photos%'
         or coalesce(with_check, '') ilike '%appointment-photos%'
       )
  loop
    execute format('drop policy if exists %I on storage.objects', p.policyname);
  end loop;
end;
$$;

create policy storage_appointment_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'appointment-photos'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_user_can_access_appointment(
      public.try_uuid((storage.foldername(name))[2])
    )
  );

create policy storage_appointment_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'appointment-photos'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_user_can_mutate_appointment_photo(
      public.try_uuid((storage.foldername(name))[2])
    )
  );

create policy storage_appointment_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'appointment-photos'
    and public.current_user_role() in ('owner', 'dispatcher')
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_user_can_mutate_appointment_photo(
      public.try_uuid((storage.foldername(name))[2])
    )
  );

-- Finance-safe calendar projection for a master/brigadier. Shared team events
-- carry their event details, while all finance fields remain constant/masked.
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
         and a.team_id is not null
         and a.team_id = any(public.current_user_team_ids())
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

-- Masters may see a team event but never mutate it through the operational
-- update RPC. Only assigned work supports the forward status/comment flow.
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
     and a.kind = 'work'
     and (
       a.master_id = public.current_user_master_id()
       or a.team_id = any(public.current_user_team_ids())
     )
   for update;

  if not found then
    raise exception 'work appointment not found or no longer assigned'
      using errcode = 'P0002';
  end if;

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

-- Fail deployment if an old permissive appointment policy survived or if an
-- anonymous caller regained access to one of the SECURITY DEFINER functions.
do $$
begin
  if (select count(*)
        from pg_policies
       where schemaname = 'public'
         and tablename = 'appointments'
         and policyname in (
           'appointments_select',
           'appointments_insert',
           'appointments_update',
           'appointments_delete'
         )) <> 4 then
    raise exception 'team events: exact appointment policy set is missing';
  end if;

  if exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'appointments'
       and policyname not in (
         'appointments_select',
         'appointments_insert',
         'appointments_update',
         'appointments_delete'
       )
  ) then
    raise exception 'team events: permissive appointment policy remains';
  end if;

  if (select count(*)
        from pg_policies
       where schemaname = 'public'
         and tablename = 'appointment_photos'
         and policyname in (
           'appointment_photos_select_visible',
           'appointment_photos_insert_visible',
           'appointment_photos_update_operator',
           'appointment_photos_delete_operator'
         )) <> 4 then
    raise exception 'team events: exact photo policy set is missing';
  end if;

  if exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'appointment_photos'
       and policyname not in (
         'appointment_photos_select_visible',
         'appointment_photos_insert_visible',
         'appointment_photos_update_operator',
         'appointment_photos_delete_operator'
       )
  ) then
    raise exception 'team events: permissive photo policy remains';
  end if;

  if has_function_privilege(
       'anon',
       'public.current_user_can_access_appointment(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.list_master_appointments_safe(integer,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.current_user_can_mutate_appointment_photo(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.update_master_appointment_safe(uuid,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'team events: operational function is callable by anon';
  end if;

  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.appointments'::regclass
       and tgname = 'trg_appointments_zz_enforce_event_scope'
       and not tgisinternal
  ) then
    raise exception 'team events: event-scope guard is missing';
  end if;
end;
$$;
