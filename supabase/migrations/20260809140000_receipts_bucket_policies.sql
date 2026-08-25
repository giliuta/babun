-- ДОКУМЕНТ, ПОДТВЕРЖДАЮЩИЙ ОПЕРАЦИЮ.
--
-- Бакет `receipts` существовал с самого начала (finance_transactions.receipt_url
-- ссылается именно на него), но БЕЗ ЕДИНОЙ ПОЛИТИКИ: RLS на storage.objects
-- запрещает по умолчанию, поэтому положить туда файл было физически нельзя.
-- Колонка была, места хранения — нет.
--
-- Права ровно те же, что у самих денег (finance_transactions_owner_all):
-- писать и читать чеки может владелец своего тенанта. Папка первого уровня —
-- tenant_id, она же граница видимости.

update storage.buckets
   set file_size_limit = 10485760,               -- 10 МБ: фото чека и PDF инвойса
       allowed_mime_types = array['image/jpeg','image/png','image/heic','image/webp','application/pdf']
 where id = 'receipts';

drop policy if exists storage_receipts_select on storage.objects;
create policy storage_receipts_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (current_tenant_id())::text
    and current_user_role() = 'owner'
  );

drop policy if exists storage_receipts_insert on storage.objects;
create policy storage_receipts_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (current_tenant_id())::text
    and current_user_role() = 'owner'
  );

drop policy if exists storage_receipts_update on storage.objects;
create policy storage_receipts_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (current_tenant_id())::text
    and current_user_role() = 'owner'
  )
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (current_tenant_id())::text
    and current_user_role() = 'owner'
  );

drop policy if exists storage_receipts_delete on storage.objects;
create policy storage_receipts_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (current_tenant_id())::text
    and current_user_role() = 'owner'
  );
