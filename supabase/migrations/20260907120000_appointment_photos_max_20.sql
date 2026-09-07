-- Лимит файлов записи — 20 (владелец 2026-09-06: «лимит файлов отлично, 20
-- подойдёт с головой»). Клиент (MAX_APPOINTMENT_PHOTOS) и бакет уже жили по
-- 20, а сторож базы check_max_photos по-прежнему считал до пяти: шестой файл
-- падал с «max 5 photos per appointment». Тело функции — прежнее, меняется
-- порог и текст; триггер переименован, чтобы имя не врало.

create or replace function public.check_max_photos()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.appointments
    where id = new.appointment_id
    for update;
  if (
    select count(*) from public.appointment_photos
    where appointment_id = new.appointment_id
  ) >= 20 then
    raise exception 'В записи не больше 20 файлов'
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists appointment_photos_max_5 on public.appointment_photos;
drop trigger if exists appointment_photos_max_20 on public.appointment_photos;
create trigger appointment_photos_max_20
  before insert on public.appointment_photos
  for each row execute function public.check_max_photos();
