-- СНЯТОГО СОТРУДНИКА ТОКЕН ЗАБЫВАЕТ КОМПАНИЮ (стык снятия членства и claim'ов).
--
-- Нашла сессия 008 на живых данных 14.09: после снятия airfix.cy из Giliuta у
-- него в `raw_app_meta_data` остались `tenant_id = Giliuta`, `tenant_role =
-- master` и Giliuta в `available_tenants`. Список компаний в токене пересчитывают
-- только `activate_tenant`, `accept_invitation` и `handle_new_user` — то есть при
-- ПРИХОДЕ в компанию; уход его не трогал никогда.
--
-- Чем это было опасно и чем нет. Данных призрак не открывает: `current_tenant_id()`
-- сверяет членство для обеих веток (заголовок и claim). Но нарушен инвариант
-- «`available_tenants` = членства», на который опирается чистка при переходе
-- (`switch-tenant.ts`: запросы компании из списка остаются тёплыми), и без
-- заголовка снятый получал NULL вместо своей живой компании.
--
-- Решение — один помощник `sync_tenant_claims(user)`: список компаний из членств
-- в том же порядке, что у `activate_tenant`; claim компании остаётся, если человек
-- в ней состоит, иначе переезжает на старейшее членство (с его ролью и карточкой
-- мастера) или снимается, если членств не осталось. Зовёт его триггер после
-- удаления строки `tenant_members` — любой дорогой: экран, каскад удаления
-- компании, ручной delete. Аккаунт, удаляемый целиком, помощник пропускает.
--
-- Пересчёт при подтверждении почты не нужен: GoTrue перезаписывает метаданные
-- только при регистрации, а снятие членства идёт не через неё.

create or replace function public.sync_tenant_claims(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_meta jsonb;
  v_available jsonb;
  v_claim text;
  v_next_tenant public.tenant_members.tenant_id%type;
  v_next_role public.tenant_members.role%type;
  v_next_master public.tenant_members.master_id%type;
begin
  select coalesce(u.raw_app_meta_data, '{}'::jsonb)
    into v_meta
    from auth.users u
   where u.id = p_user_id;

  -- Аккаунт удаляется целиком (каскад из auth.users) — писать некуда.
  if not found then
    return;
  end if;

  select coalesce(jsonb_agg(x.tenant_id order by x.joined_at, x.tenant_id), '[]'::jsonb)
    into v_available
    from (
      select tm.tenant_id::text as tenant_id, min(tm.joined_at) as joined_at
        from public.tenant_members tm
       where tm.user_id = p_user_id
       group by tm.tenant_id
    ) x;

  v_claim := nullif(v_meta ->> 'tenant_id', '');

  if v_claim is null or v_available ? v_claim then
    if coalesce(v_meta -> 'available_tenants', '[]'::jsonb) is distinct from v_available then
      update auth.users u
         set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object('available_tenants', v_available)
       where u.id = p_user_id;
    end if;
    return;
  end if;

  select tm.tenant_id, tm.role, tm.master_id
    into v_next_tenant, v_next_role, v_next_master
    from public.tenant_members tm
   where tm.user_id = p_user_id
   order by tm.joined_at asc, tm.tenant_id asc
   limit 1;

  update auth.users u
     set raw_app_meta_data =
       (coalesce(u.raw_app_meta_data, '{}'::jsonb) - 'tenant_id' - 'tenant_role' - 'tenant_master_id')
       || jsonb_build_object('available_tenants', v_available)
       || case
            when v_next_tenant is null then '{}'::jsonb
            else jsonb_build_object('tenant_id', v_next_tenant::text, 'tenant_role', v_next_role)
          end
       || case
            when v_next_tenant is null or v_next_master is null then '{}'::jsonb
            else jsonb_build_object('tenant_master_id', v_next_master)
          end
   where u.id = p_user_id;
end;
$function$;

revoke all on function public.sync_tenant_claims(uuid) from public, anon, authenticated;

create or replace function public.tenant_members_removed_sync_claims()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.sync_tenant_claims(old.user_id);
  return null;
end;
$function$;

revoke all on function public.tenant_members_removed_sync_claims() from public, anon, authenticated;

drop trigger if exists tenant_members_removed_sync_claims on public.tenant_members;
create trigger tenant_members_removed_sync_claims
  after delete on public.tenant_members
  for each row execute function public.tenant_members_removed_sync_claims();

-- Разовая починка уже разошедшихся (на 14.09 — один человек, airfix.cy).
do $backfill$
declare
  r record;
begin
  for r in
    select u.id
      from auth.users u
     where coalesce(u.raw_app_meta_data -> 'available_tenants', '[]'::jsonb)
           is distinct from coalesce((
             select jsonb_agg(x.tenant_id order by x.joined_at, x.tenant_id)
               from (select tm.tenant_id::text as tenant_id, min(tm.joined_at) as joined_at
                       from public.tenant_members tm
                      where tm.user_id = u.id
                      group by tm.tenant_id) x
           ), '[]'::jsonb)
        or (nullif(u.raw_app_meta_data ->> 'tenant_id', '') is not null
            and not exists (
              select 1 from public.tenant_members tm
               where tm.user_id = u.id
                 and tm.tenant_id::text = u.raw_app_meta_data ->> 'tenant_id'))
  loop
    perform public.sync_tenant_claims(r.id);
  end loop;
end
$backfill$;

do $guard$
begin
  if exists (
    select 1
      from auth.users u
     where nullif(u.raw_app_meta_data ->> 'tenant_id', '') is not null
       and not exists (
         select 1 from public.tenant_members tm
          where tm.user_id = u.id
            and tm.tenant_id::text = u.raw_app_meta_data ->> 'tenant_id')
  ) then
    raise exception 'миграция: в токене осталась компания без членства';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.tenant_members'::regclass
       and tgname = 'tenant_members_removed_sync_claims'
  ) then
    raise exception 'миграция: нет триггера пересчёта токена';
  end if;
end
$guard$;
