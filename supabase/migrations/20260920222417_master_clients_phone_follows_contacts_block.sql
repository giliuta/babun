-- STORY-084, волна 1б: телефон клиента перестаёт уходить мимо права.
--
-- `clients.contacts` — блок ЖИВОЙ с 19.09: `list_member_clients` телефон
-- прячет честно. Но у клиента есть ВТОРАЯ дорога — «клиент записи»,
-- `list_master_clients_safe`, — и она отдавала `c.phone` всем мастерам
-- безусловно. Живой блок, который врёт, хуже мёртвого, который молчит:
-- владелец ставил «Телефоны: Скрыт», видел слово и не получал ничего.
--
-- Пустая строка, а не null: ровно та же форма, что у `client_without_contacts`
-- и у клиентской маски (`withoutContacts`), — экран не должен различать, по
-- какой дороге приехал клиент.
--
-- Накачено 21.09 через apply_migration; прогон в откате сделан на этой же базе.

create or replace function public.list_master_clients_safe(p_client_id uuid default null::uuid)
returns setof jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', c.id,
    'tenant_id', c.tenant_id,
    'full_name', c.full_name,
    'phone', case when public.access_company('clients.contacts', 'read') then c.phone else '' end,
    'created_at', c.created_at
  )
    from public.clients c
   where public.current_user_role() = 'master'
     and c.tenant_id = public.current_tenant_id()
     and c.deleted_at is null
     and (p_client_id is null or c.id = p_client_id)
     and public.current_user_can_access_client(c.id)
   order by c.full_name, c.id
$function$;

update public.access_blocks
   set enforced_by = array(select distinct e from unnest(
         enforced_by || array['function:public.list_master_clients_safe(uuid)']) as e)
 where key = 'clients.contacts';

-- Сторож: проверяем ПОВЕДЕНИЕ настоящего мастера, а не текст функции.

do $guard$
declare
  emp record;
  saved text;
  without_phone integer;
begin
  select tm.tenant_id, tm.user_id into emp
    from public.tenant_members tm where tm.role = 'master' limit 1;
  if emp.user_id is null then
    raise notice 'STORY-084: мастеров в базе нет — поведенческий сторож пропущен';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', emp.user_id, 'role','authenticated',
        'app_metadata', json_build_object('tenant_id', emp.tenant_id))::text, true);
    perform set_config('request.headers',
      json_build_object('x-babun-tenant', emp.tenant_id)::text, true);

    select ma.level into saved from public.member_access ma
     where ma.tenant_id = emp.tenant_id and ma.user_id = emp.user_id
       and ma.block = 'clients.contacts' and ma.team_id is null;

    delete from public.member_access
     where tenant_id = emp.tenant_id and user_id = emp.user_id
       and block = 'clients.contacts' and team_id is null;
    insert into public.member_access (tenant_id, user_id, block, team_id, level)
    values (emp.tenant_id, emp.user_id, 'clients.contacts', null, 'off');
    select count(*) into without_phone from public.list_master_clients_safe() r
     where coalesce(r ->> 'phone', '') <> '';
    if without_phone > 0 then
      raise exception 'STORY-084 сторож: телефон уходит мимо clients.contacts (% строк)', without_phone;
    end if;

    delete from public.member_access
     where tenant_id = emp.tenant_id and user_id = emp.user_id
       and block = 'clients.contacts' and team_id is null;
    if saved is not null then
      insert into public.member_access (tenant_id, user_id, block, team_id, level)
      values (emp.tenant_id, emp.user_id, 'clients.contacts', null, saved);
    end if;
    perform set_config('request.jwt.claims', null, true);
    perform set_config('request.headers', null, true);
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'list_master_clients_safe'
       and p.prosrc like '%access_company(''clients.contacts''%'
  ) then
    raise exception 'STORY-084 сторож: вторая дорога к телефону не закрыта';
  end if;
end
$guard$;
