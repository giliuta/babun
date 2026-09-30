-- КЛИЕНТЫ МАСТЕРА — ПО ТОМУ ЖЕ УРОВНЮ «КЛИЕНТ», ЧТО В ЗАПИСИ (STORY-087,
-- аудит 23.09).
--
-- Запись мастеру отдаёт клиента только в календарях, где блок записи
-- `record.client` у него не ниже «Видит» (`list_master_appointments_safe`,
-- `access_calendars('record.client', 'read')`). А окно клиентов мастера
-- (`list_master_clients_safe`) спрашивало лишь «есть ли у клиента работа в
-- моих календарях» (`current_user_can_access_client`): владелец выключал
-- мастеру «Клиента» в календаре — запись его прятала, а вкладка «Клиенты»
-- продолжала отдавать имена всех клиентов этого календаря.
--
-- Теперь окно отдаёт клиента, только если у него есть рабочая запись в
-- календаре, где мастеру открыт `record.client`. Подпись, аргумент и
-- умолчание не меняются: тело переписано со снятого `pg_get_functiondef`.

create or replace function public.list_master_clients_safe(p_client_id uuid default null::uuid)
 returns setof jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- Календари с открытым «Клиентом» считаются один раз на вызов: массив в
  -- скалярный подзапрос не обернуть (`text = text[]`), а голый вызов в
  -- условии считался бы на каждую строку.
  with client_teams as (
    select public.access_calendars('record.client', 'read') as ids
  )
  select jsonb_build_object(
    'id', c.id,
    'tenant_id', c.tenant_id,
    'full_name', c.full_name,
    'phone', case when public.access_company('clients.contacts', 'read') then c.phone else '' end,
    'created_at', c.created_at
  )
    from public.clients c
   cross join client_teams ct
   where public.current_user_role() = 'master'
     and c.tenant_id = public.current_tenant_id()
     and c.deleted_at is null
     and (p_client_id is null or c.id = p_client_id)
     and public.current_user_can_access_client(c.id)
     and exists (
       select 1
         from public.appointments a
        where a.tenant_id = c.tenant_id
          and a.client_id = c.id
          and a.kind = 'work'
          and a.team_id = any(ct.ids)
     )
   order by c.full_name, c.id
$function$;

-- ─── Сторож ──────────────────────────────────────────────────────────────
do $audit$
begin
  if position('record.client' in (
    select prosrc from pg_proc where oid = 'public.list_master_clients_safe(uuid)'::regprocedure
  )) = 0 then
    raise exception 'list_master_clients_safe must follow record.client';
  end if;
  if has_function_privilege('anon', 'public.list_master_clients_safe(uuid)', 'execute') then
    raise exception 'list_master_clients_safe must not be callable by anon';
  end if;
end
$audit$;
