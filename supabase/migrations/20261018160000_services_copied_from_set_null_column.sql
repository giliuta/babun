-- УСЛУГУ-ИСТОЧНИК ШАБЛОНА МОЖНО УДАЛИТЬ, А ЕЁ КАЛЕНДАРЬ — СТЕРЕТЬ.
--
-- Копия услуги в другой команде помнит источник составным ключом
-- (tenant_id, copied_from_service_id) с `ON DELETE SET NULL` без списка
-- колонок. Без списка Postgres при удалении источника обнуляет ВСЕ колонки
-- ссылки — и `tenant_id`, которая NOT NULL: удаление услуги насовсем и
-- стирание календаря с её прайсом падали «null value in column tenant_id».
-- Обнуляется только ссылка на источник (Postgres 15+).
alter table public.services drop constraint services_copied_from_fk;
alter table public.services
  add constraint services_copied_from_fk
  foreign key (tenant_id, copied_from_service_id)
  references public.services (tenant_id, id)
  on delete set null (copied_from_service_id);

do $guard$
begin
  if exists (
    select 1 from pg_constraint c
     where c.contype = 'f'
       and c.connamespace = 'public'::regnamespace
       and c.confdeltype in ('n', 'd')
       and array_length(c.conkey, 1) > 1
       and c.confdelsetcols is null
  ) then
    raise exception 'миграция: составной ключ с SET NULL/DEFAULT без списка колонок';
  end if;
end
$guard$;
