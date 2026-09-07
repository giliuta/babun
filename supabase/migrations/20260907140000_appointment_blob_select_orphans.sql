-- Осиротевшие файлы записи, часть 2 (2026-09-07). Storage API удаляет объект
-- в два шага: сначала ЧИТАЕТ его по политике select, потом удаляет. Политика
-- чтения пускала только к файлам существующей записи
-- (current_user_can_access_appointment), поэтому remove() отвечал 200 и
-- ничего не удалял — файл удалённой записи оставался невидимым и вечным.
-- Владелец и диспетчер видят (и потому могут убрать) файл записи, которой
-- больше нет, — в папке своего тенанта; для мастера ничего не меняется.

create or replace function public.current_user_can_see_appointment_blob(
  p_appointment_id uuid
)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select public.current_user_can_access_appointment(p_appointment_id)
      or (
        public.current_user_role() in ('owner', 'dispatcher')
        and p_appointment_id is not null
        and not exists (
          select 1 from public.appointments a where a.id = p_appointment_id
        )
      )
$$;

drop policy if exists storage_appointment_photos_select on storage.objects;
create policy storage_appointment_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'appointment-photos'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_user_can_see_appointment_blob(
      public.try_uuid((storage.foldername(name))[2])
    )
  );
