-- Private appointment photos contain client property and work-site imagery.
-- The 14-digit prefix is a unique Supabase CLI migration version.
-- Keep the bucket private and issue short-lived signed URLs from the shared
-- repository.
-- Object access follows the RLS-visible appointment encoded in the path:
--   <tenant_id>/<appointment_id>/<photo_id>.<ext>

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'appointment-photos',
  'appointment-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage policies are permissive and combine with OR. Remove every historical
-- or manually-created policy that references this bucket, including possible
-- UPDATE/ALL policies, before installing the exact private policy set below.
drop policy if exists storage_appointment_photos_select on storage.objects;
drop policy if exists storage_appointment_photos_insert on storage.objects;
drop policy if exists storage_appointment_photos_update on storage.objects;
drop policy if exists storage_appointment_photos_delete on storage.objects;
drop policy if exists storage_appointment_photos_all on storage.objects;

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

-- The original STORY-049 table policy was tenant-wide. PostgreSQL combines
-- permissive policies with OR, so leaving it installed would bypass the newer
-- appointment-visibility policy for masters/brigadiers.
drop policy if exists appointment_photos_all_own on public.appointment_photos;

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
    and public.current_user_can_access_appointment(
      public.try_uuid((storage.foldername(name))[2])
    )
  );

create policy storage_appointment_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'appointment-photos'
    and public.current_user_role() in ('owner', 'dispatcher')
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_user_can_access_appointment(
      public.try_uuid((storage.foldername(name))[2])
    )
  );

do $$
begin
  if not exists (
    select 1
      from storage.buckets
     where id = 'appointment-photos'
       and public = false
       and file_size_limit = 5242880
  ) then
    raise exception 'private appointment photos: bucket configuration failed';
  end if;
end;
$$;
