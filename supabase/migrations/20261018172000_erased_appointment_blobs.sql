-- ФАЙЛЫ ЗАПИСИ, СТЁРТОЙ НАСОВСЕМ ПАРТНЁРОМ.
--
-- «Удалить насовсем» в «Удалённых записях» стирает снимок
-- (`deleted_appointments`), а следом приложение стирает файлы фото через
-- Storage API (`useEraseDeletedAppointment` → `removePhotoBlobs`). Storage
-- API удаляет в два шага: читает объект под политикой SELECT, потом удаляет
-- под политикой DELETE. Ветки «записи уже нет» в обеих
-- (`current_user_can_see_appointment_blob`,
-- `current_user_can_delete_appointment_blob`) открыты только владельцу и
-- диспетчеру; партнёру, который сам стёр свою запись, не открыто ничего —
-- `remove()` отвечает 200, а файлы остаются в бакете навсегда.
--
-- Проверить «это его запись» по снимку нельзя: к моменту удаления файлов
-- снимка уже нет (порядок «сначала снимок, потом файлы» обязателен — иначе
-- отказ стирания снимка оставил бы в ящике запись без фото). Перевернуть
-- порядок тоже нельзя: тогда открылась бы ветка «запись в ящике», и сборки
-- приложения, которые стирают файлы сразу после удаления записи, сносили бы
-- фото записей, ещё лежащих в ящике.
--
-- Поэтому снимок, уходя НЕ возвратом, оставляет надгробие
-- `erased_appointment_blobs`: чья запись, какой календарь и вид, кто стёр.
-- Файлы стёртой записи читает и удаляет тот, кто её стёр, — если у него
-- есть право удалять файлы такой записи живой (те же ветки, что у
-- `current_user_can_mutate_appointment_photo`). Ночная очистка ящика
-- (`purge_deleted_appointments`) тоже оставляет надгробие — с пустым
-- `erased_by`: это список папок, которые должен вымести уборщик с ключом
-- сервиса (SQL не удаляет файлы хранилища, `storage.protect_delete`).
--
-- Ветки владельца и диспетчера не меняются.

set local lock_timeout = '5s';

-- ─── 1. Надгробие ───

create table public.erased_appointment_blobs (
  appointment_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  team_id text not null,
  kind text not null,
  created_by uuid,
  erased_by uuid,
  erased_at timestamptz not null default now()
);

comment on table public.erased_appointment_blobs is
  'Запись, стёртая из «Удалённых записей» насовсем (кнопкой или ночной очисткой): по ней стирают её файлы в бакете appointment-photos.';
comment on column public.erased_appointment_blobs.erased_by is
  'Кто стёр; пусто — ночная очистка. Файлы читает и удаляет только он.';

create index erased_appointment_blobs_tenant_idx
  on public.erased_appointment_blobs (tenant_id, erased_at);

-- Пишет только триггер ящика, читает только помощник политики (оба —
-- определители). Снаружи таблицы нет.
alter table public.erased_appointment_blobs enable row level security;
revoke all on table public.erased_appointment_blobs from public, anon, authenticated;

create function public.deleted_appointment_leave_tombstone()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- Возврат кладёт запись обратно до удаления снимка: живая строка есть —
  -- файлы снова её, надгробие не нужно.
  if exists (
    select 1 from public.appointments a where a.id = old.id and a.tenant_id = old.tenant_id
  ) then
    return old;
  end if;
  insert into public.erased_appointment_blobs
    (appointment_id, tenant_id, team_id, kind, created_by, erased_by)
  values (old.id, old.tenant_id, old.team_id, old.kind, old.created_by, auth.uid())
  on conflict (appointment_id) do update
    set erased_by = excluded.erased_by, erased_at = now();
  return old;
end;
$function$;

revoke all on function public.deleted_appointment_leave_tombstone() from public, anon, authenticated;

create trigger trg_deleted_appointment_tombstone
  after delete on public.deleted_appointments
  for each row execute function public.deleted_appointment_leave_tombstone();

-- ─── 2. Файлы стёртой записи — тому, кто её стёр ───

create function public.current_user_erased_appointment_blob(p_appointment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select p_appointment_id is not null
     and not exists (select 1 from public.appointments a where a.id = p_appointment_id)
     and not exists (select 1 from public.deleted_appointments d where d.id = p_appointment_id)
     and exists (
       select 1
         from public.erased_appointment_blobs e
        where e.appointment_id = p_appointment_id
          and e.tenant_id = public.current_tenant_id()
          and e.erased_by = auth.uid()
          and (
            -- Запись — «Файлы записи: Меняет» в её календаре.
            (e.kind = 'work'
              and e.team_id in (select unnest(public.access_calendars('record.files', 'write'))))
            -- Событие — его автор; сотруднику — ещё и «Файлы события: Меняет».
            or (e.kind <> 'work' and e.created_by = auth.uid()
                and (public.current_user_role() is distinct from 'master'
                     or e.team_id in (select unnest(public.access_calendars('event.files', 'write')))))
          )
     )
$function$;

revoke all on function public.current_user_erased_appointment_blob(uuid) from public, anon;
grant execute on function public.current_user_erased_appointment_blob(uuid) to authenticated;

-- Обе политики нужны вместе: без SELECT Storage API объекта «не находит» и
-- молча ничего не удаляет.
create policy storage_appointment_photos_select_erased on storage.objects
  for select to authenticated
  using (
    bucket_id = 'appointment-photos'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and public.current_user_erased_appointment_blob(public.try_uuid((storage.foldername(name))[2]))
  );

create policy storage_appointment_photos_delete_erased on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'appointment-photos'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and public.current_user_erased_appointment_blob(public.try_uuid((storage.foldername(name))[2]))
  );

do $guard$
begin
  if has_function_privilege('anon', 'public.current_user_erased_appointment_blob(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.deleted_appointment_leave_tombstone()', 'execute')
     or has_table_privilege('authenticated', 'public.erased_appointment_blobs', 'select') then
    raise exception 'сторож: надгробие или его помощник открыты наружу';
  end if;
end
$guard$;
