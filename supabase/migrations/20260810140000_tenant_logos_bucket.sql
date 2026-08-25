-- ЛОГОТИП КОМПАНИИ ЛЕЖИТ В ПУБЛИЧНОМ БАКЕТЕ — И ЭТО ОСОЗНАННО.
--
-- Логотип печатается в инвойсе, который уходит клиенту письмом и PDF-ом.
-- Приватный бакет отдаёт только КОРОТКОЖИВУЩИЕ ссылки, а документ живёт годами:
-- через пять минут картинка в уже отправленном счёте превратилась бы в дыру.
-- Секрета в логотипе нет — он и так на каждом документе и на вывеске.
--
-- Писать может только владелец своего тенанта; читать — кто угодно по прямой
-- ссылке, как и задумано.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tenant-logos', 'tenant-logos', true, 5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
   set public = true,
       file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists tenant_logos_select on storage.objects;
create policy tenant_logos_select on storage.objects
  for select to public
  using (bucket_id = 'tenant-logos');

drop policy if exists tenant_logos_insert on storage.objects;
create policy tenant_logos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tenant-logos'
    and (storage.foldername(name))[1] = (current_tenant_id())::text
    and current_user_role() = 'owner'
  );

drop policy if exists tenant_logos_update on storage.objects;
create policy tenant_logos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'tenant-logos'
    and (storage.foldername(name))[1] = (current_tenant_id())::text
    and current_user_role() = 'owner'
  )
  with check (
    bucket_id = 'tenant-logos'
    and (storage.foldername(name))[1] = (current_tenant_id())::text
    and current_user_role() = 'owner'
  );

drop policy if exists tenant_logos_delete on storage.objects;
create policy tenant_logos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tenant-logos'
    and (storage.foldername(name))[1] = (current_tenant_id())::text
    and current_user_role() = 'owner'
  );
