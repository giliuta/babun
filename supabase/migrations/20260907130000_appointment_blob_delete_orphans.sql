-- Осиротевшие файлы записи (2026-09-07). Удаление записи каскадом стирает
-- строки appointment_photos, а блобы в бакете остаются: политика удаления
-- пускала только к файлам СУЩЕСТВУЮЩЕЙ записи
-- (current_user_can_mutate_appointment_photo), а к моменту очистки записи
-- уже нет. Владелец и диспетчер могут убрать блоб записи, которой больше нет,
-- — только в папке своего тенанта (её проверяет сама политика). Загрузка
-- (insert) прежней функцией не трогается: в папку несуществующей записи
-- по-прежнему не залить.

create or replace function public.current_user_can_delete_appointment_blob(
  p_appointment_id uuid
)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select public.current_user_can_mutate_appointment_photo(p_appointment_id)
      or (
        public.current_user_role() in ('owner', 'dispatcher')
        and p_appointment_id is not null
        and not exists (
          select 1 from public.appointments a where a.id = p_appointment_id
        )
      )
$$;

drop policy if exists storage_appointment_photos_delete on storage.objects;
create policy storage_appointment_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'appointment-photos'
    and public.current_user_role() in ('owner', 'dispatcher')
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_user_can_delete_appointment_blob(
      public.try_uuid((storage.foldername(name))[2])
    )
  );
