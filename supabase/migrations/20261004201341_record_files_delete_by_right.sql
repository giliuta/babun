-- «ФОТО И ФАЙЛЫ ЗАПИСИ: МЕНЯЕТ» — ВЕСЬ БЛОК (аудит прав 04.10, правило
-- владельца 30.09 «„Меняет“ — весь блок»). Право обещало «прикладывает и
-- удаляет файлы записи», а удалять партнёру не давал никто: строку фото и
-- её объект в хранилище стирали только владелец и диспетчер, и приложение
-- прятало корзину. Теперь удаляет тот, кто может прикладывать
-- (`current_user_can_mutate_appointment_photo` — «Меняет» в календаре записи).
--
-- Порядок удаления у приложения — «сначала строка, потом объект» (ссылка на
-- объект берётся из удалённой строки). Поэтому объект документа записи
-- партнёр стирает, только когда его строки уже нет: живой файл чужой записи
-- того же клиента так не достать. Фото записи лежат в папке самой записи —
-- там хватает права на запись.

set local lock_timeout = '5s';

create policy appointment_photos_delete_files_right on public.appointment_photos
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and public.current_user_can_mutate_appointment_photo(appointment_id)
  );

create policy storage_appointment_photos_delete_files_right on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'appointment-photos'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and public.current_user_can_mutate_appointment_photo(public.try_uuid((storage.foldername(name))[2]))
  );

create policy client_attachments_delete_record on public.client_attachments
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and appointment_id is not null
    and public.current_user_can_mutate_appointment_photo(appointment_id)
  );

-- Объект документа записи — только «осиротевший»: строки уже нет, а клиент
-- папки — клиент записи, где у партнёра «Меняет». Определитель — чтобы
-- проверка строки не зависела от того, что ему видно.
create or replace function public.current_user_can_drop_record_attachment_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
           select 1 from public.client_attachments ca
            where ca.storage_path = p_name
         )
     and exists (
           select 1 from public.appointments a
            where a.tenant_id = public.current_tenant_id()
              and a.kind = 'work'
              and a.client_id = public.try_uuid((storage.foldername(p_name))[2])
              and public.current_user_can_mutate_appointment_photo(a.id)
         );
$$;

revoke all on function public.current_user_can_drop_record_attachment_object(text) from public, anon;
grant execute on function public.current_user_can_drop_record_attachment_object(text) to authenticated;

create policy storage_client_attachments_delete_record on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'client-attachments'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and public.current_user_can_drop_record_attachment_object(name)
  );

do $guard$
begin
  if has_function_privilege('anon', 'public.current_user_can_drop_record_attachment_object(text)', 'execute') then
    raise exception 'сторож: помощник удаления открыт anon';
  end if;
end
$guard$;
