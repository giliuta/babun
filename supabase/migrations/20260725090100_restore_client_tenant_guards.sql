-- Восстановить триггер-гарды границы тенанта для клиентов.
--
-- Парная к 20260725090000_restore_normalize_client_tag_ids.sql. Обе
-- достают недостающие куски из 20260720210012_atomic_client_tags.sql,
-- которая в прод не уехала (см. разбор в шапке первой миграции).
--
-- ⚠️ ТА ЖЕ ЛОВУШКА: не применять 20260720210012 целиком — там лежат
-- СТАРЫЕ версии create_client_with_tags / update_client_with_tags, и
-- `create or replace` молча откатит правки от 22 июля (city_manual).
-- Здесь — только гарды, дословно из оригинала.
--
-- ПРЕДУСЛОВИЕ: enforce_client_reference_tenant обращается к
-- public.masters БЕЗ защитного to_regclass. Таблица создаётся в
-- 20260624_001_reference_entities.sql. Перед применением наличие
-- masters / client_tags / client_tag_assignments было проверено в проде
-- (rdtokosbqvgemicqeqwz, 2026-07-25) — все три существуют, поэтому
-- триггеры безопасны. На пустой базе накатывать эту миграцию только
-- после 20260624_001.
--
-- Применено в прод 2026-07-25 как `restore_client_tenant_guards`;
-- файл добавлен в репозиторий, чтобы состояние кода совпадало с базой.
-- Идемпотентно: create or replace + drop trigger if exists.

create or replace function public.enforce_client_reference_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.referred_by_client_id is not null then
    if new.referred_by_client_id = new.id then
      raise exception 'client cannot refer itself'
        using errcode = '23514';
    end if;
    if not exists (
      select 1
        from public.clients referrer
       where referrer.tenant_id = new.tenant_id
         and referrer.id = new.referred_by_client_id
    ) then
      raise exception 'referring client does not belong to the client tenant'
        using errcode = '23503';
    end if;
  end if;

  if new.favorite_master_id is not null and not exists (
    select 1
      from public.masters master
     where master.tenant_id = new.tenant_id
       and master.id = new.favorite_master_id
  ) then
    raise exception 'favorite master does not belong to the client tenant'
      using errcode = '23503';
  end if;

  return new;
end;
$function$;

drop trigger if exists clients_enforce_reference_tenant on public.clients;
create trigger clients_enforce_reference_tenant
  before insert or update of tenant_id, referred_by_client_id, favorite_master_id
  on public.clients
  for each row execute function public.enforce_client_reference_tenant();

revoke all on function public.enforce_client_reference_tenant()
  from public, anon, authenticated;

create or replace function public.enforce_client_tag_assignment_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not exists (
    select 1
      from public.clients client
     where client.tenant_id = new.tenant_id
       and client.id = new.client_id
  ) then
    raise exception 'assigned client does not belong to the assignment tenant'
      using errcode = '23503';
  end if;

  if not exists (
    select 1
      from public.client_tags tag
     where tag.tenant_id = new.tenant_id
       and tag.id = new.tag_id
  ) then
    raise exception 'assigned tag does not belong to the assignment tenant'
      using errcode = '23503';
  end if;

  return new;
end;
$function$;

drop trigger if exists client_tag_assignments_enforce_tenant
  on public.client_tag_assignments;
create trigger client_tag_assignments_enforce_tenant
  before insert or update of tenant_id, client_id, tag_id
  on public.client_tag_assignments
  for each row execute function public.enforce_client_tag_assignment_tenant();

revoke all on function public.enforce_client_tag_assignment_tenant()
  from public, anon, authenticated;
