-- ТИП У ОБЪЕКТА СОБЫТИЯ.
--
-- Владелец: тип объекта можно выбирать и в событиях. Объект события без
-- клиента живёт в самой записи (`address`, `address_lat/lng`,
-- `address_note`, `location_id = null`), и типу места там не было. Новая
-- колонка — ссылка на справочник «Типы объектов» (`location_labels`):
-- переименование типа объект не трогает, удалённый тип снимается сам
-- (`on delete set null`).
--
-- Тип — только из справочника КОМАНДЫ ЭТОЙ ЗАПИСИ, и команда живая
-- (изоляция клиентов: справочное — только обслуживающих активных
-- календарей). Судим новое значение и перенос записи в другую команду:
-- стоящее у записи прочую правку не запирает. Внутренние ходы без
-- пользователя (cron, сервис) мимо, как у соседей. Тариф тип не запирает:
-- объект события бесплатен.

-- Ключ справочника — пара (tenant_id, id): ссылка составная, и удаление типа
-- обнуляет только тип, а не компанию записи (`set null (колонка)`, PG 15+).
alter table public.appointments
  add column if not exists address_object_type_id text;
alter table public.appointments
  add constraint appointments_address_object_type_fk
    foreign key (tenant_id, address_object_type_id)
    references public.location_labels (tenant_id, id)
    on delete set null (address_object_type_id);

comment on column public.appointments.address_object_type_id is
  'Тип объекта события без клиента (справочник «Типы объектов» команды записи).';

create or replace function public.appointment_object_type_of_team()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null
     or new.address_object_type_id is null
     or (tg_op = 'UPDATE'
         and new.address_object_type_id is not distinct from old.address_object_type_id
         and new.team_id is not distinct from old.team_id) then
    return new;
  end if;

  if new.team_id is null
     or not exists (
       select 1
         from public.location_labels ll
         join public.teams t
           on t.id = ll.team_id
          and t.tenant_id = ll.tenant_id
        where ll.id = new.address_object_type_id
          and ll.tenant_id = new.tenant_id
          and ll.team_id = new.team_id
          and ll.is_active
          and t.is_active
     ) then
    raise exception 'object type must belong to the active team of the appointment'
      using errcode = '23503', hint = 'event:object_type_other_team';
  end if;
  return new;
end;
$function$;

-- Функция сторожа: звать её напрямую некому.
revoke all on function public.appointment_object_type_of_team() from public, anon, authenticated;

drop trigger if exists appointments_object_type_of_team on public.appointments;
create trigger appointments_object_type_of_team
  before insert or update of address_object_type_id, team_id on public.appointments
  for each row execute function public.appointment_object_type_of_team();
