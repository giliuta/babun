-- ЮР. ИМЯ КЛИЕНТА — ЧАСТЬ РЕКВИЗИТОВ, И СОТРУДНИКУ ОНО ЗАКРЫТО (STORY-088, волна 4).
--
-- Опись 24.09: реквизиты клиента (VAT, рег. номер, адрес для счёта, набор
-- `requisites`) сотруднику не отдаются и не пишутся, а `legal_name` проскочил
-- обе стороны. Он читался в окне сотрудника (`client_without_money`) и
-- принимался `update_client_with_tags`, а триггер `sync_client_requisites`
-- переносил его в набор реквизитов по умолчанию — то есть сотрудник, которому
-- реквизиты не показывают, переписывал получателя на инвойсе владельца.
--
-- Что делает миграция:
--  1. `client_without_money` прячет и `legal_name` — как VAT и адрес для счёта.
--  2. Сторож `clients_member_legal_name_guard`: у сотрудника новое юр. имя не
--     рождается (вставка обнуляет), а правка отказывает `access:field`.
--     Стоит по имени РАНЬШЕ `clients_sync_requisites`, поэтому до набора
--     реквизитов правка сотрудника не доходит. Тела больших функций клиента
--     не переписываются — одна узкая точка на все дороги записи.

create or replace function public.client_without_money(p_client jsonb)
 returns jsonb
 language sql
 immutable
 set search_path to 'public'
as $function$
  select p_client || jsonb_build_object(
    'balance', 0,
    'discount', 0,
    'legal_name', null,
    'vat_number', null,
    'reg_number', null,
    'billing_address', null,
    'requisites', '[]'::jsonb
  )
$function$;

create or replace function public.clients_member_legal_name_guard()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if public.current_user_role() is distinct from 'master' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.legal_name := null;
  elsif new.legal_name is distinct from old.legal_name then
    raise exception 'access:field:legal_name' using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function public.clients_member_legal_name_guard() from public, anon, authenticated;

drop trigger if exists clients_member_legal_name_guard on public.clients;
create trigger clients_member_legal_name_guard
  before insert or update of legal_name on public.clients
  for each row execute function public.clients_member_legal_name_guard();

do $audit$
begin
  -- Сторож обязан стоять раньше синхронизации реквизитов: триггеры одного
  -- момента идут по алфавиту имён.
  if 'clients_member_legal_name_guard' >= 'clients_sync_requisites' then
    raise exception 'legal name guard would run after requisites sync';
  end if;
  if public.client_without_money('{"legal_name":"X"}'::jsonb) ->> 'legal_name' is not null then
    raise exception 'client_without_money still leaks legal_name';
  end if;
end
$audit$;
