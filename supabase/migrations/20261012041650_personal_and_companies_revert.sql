-- ОТКАТ «ЛИЧНОЕ И КОМПАНИИ» (владелец 12.10: «убираем то, что мы делали
-- недавно — компании и так далее; мы просто изменили тариф оплаты»).
--
-- Модель снова «человек — его аккаунт и календари» (01.10); цена за
-- календарь (20261011211518) остаётся. Что снимается:
--   • сторожа Личного: в аккаунте снова сколько угодно календарей и люди;
--   • пробный — всегда «полный доступ» (в Личном был Соло на 1 календарь);
--   • регистрация по приглашению не заводит своего аккаунта (как до 11.10);
--   • три ПУСТЫХ аккаунта, которые 11.10 завела миграция людям, уже
--     владевшим аккаунтом (giluta.art, airfix.cy, демо Babun): в каждом
--     только автоматический «Личный», без записей, клиентов и денег.
-- Колонки `kind/personal_of/created_by` и функции компаний остаются, пока
-- телефоны не получат обновление без компаний (их зовут прежние сборки).

drop trigger if exists teams_personal_one_calendar on public.teams;
drop trigger if exists invitations_personal_no_members on public.invitations;
drop trigger if exists tenant_members_personal_no_members on public.tenant_members;
drop function if exists public.personal_space_one_calendar();
drop function if exists public.personal_space_no_members();

do $$
declare
  v_def text;
  v_old text;
begin
  -- Пробный — на всё, в любом аккаунте.
  select pg_get_functiondef('public.start_trial(text)'::regprocedure) into v_def;
  v_old := $q$  if v_kind = 'personal' then
    p_tier := 'solo';
  else
    p_tier := 'max';
  end if;$q$;
  if position(v_old in v_def) = 0 then
    raise exception 'start_trial: якорь не найден';
  end if;
  execute replace(v_def, v_old, $q$  p_tier := 'max';$q$);

  -- Пришедший по приглашению — без своего аккаунта, как до 11.10.
  select pg_get_functiondef('public.handle_new_user()'::regprocedure) into v_def;
  v_old := $q$    perform public.ensure_personal_space(new.id);
    perform public.sync_tenant_claims(new.id);

    return new;$q$;
  if position(v_old in v_def) = 0 then
    raise exception 'handle_new_user: якорь не найден';
  end if;
  execute replace(v_def, v_old, $q$    return new;$q$);
end;
$$;

-- Три пустых аккаунта, заведённых миграцией 11.10 рядом с уже существующим.
-- Сторож: только если в аккаунте один участник, ни записи, ни клиента, ни
-- операции, а у человека есть другой аккаунт, где он владелец.
do $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select t.id
      from public.tenants t
     where t.id in (
       'e4301c6c-34e4-4794-ab4a-da5a0c3bab7f',
       'd06e35ba-8691-4f5a-bb6a-0110cbca34b8',
       '40dc9668-f0fe-46b2-93df-bade2797ee23'
     )
       and t.created_at between '2026-10-11 19:21:00+00' and '2026-10-11 19:23:00+00'
       and (select count(*) from public.tenant_members m where m.tenant_id = t.id) = 1
       and not exists (select 1 from public.appointments a where a.tenant_id = t.id)
       and not exists (select 1 from public.clients c where c.tenant_id = t.id)
       and not exists (select 1 from public.finance_transactions f where f.tenant_id = t.id)
       and exists (
         select 1 from public.tenant_members own
           join public.tenant_members other on other.user_id = own.user_id
          where own.tenant_id = t.id
            and other.tenant_id <> t.id
            and other.role = 'owner'
       )
  loop
    -- Телефон, открывший пустой аккаунт, уедет в свой прежний по claim'ам.
    delete from public.tenants where id = r.id;
    n := n + 1;
  end loop;
  raise notice 'removed % empty accounts', n;
end;
$$;

do $$
declare
  r record;
begin
  for r in select id from auth.users where email in ('giluta.art@gmail.com', 'airfix.cy@gmail.com', 'babun.app+review@gmail.com')
  loop
    perform public.sync_tenant_claims(r.id);
  end loop;
end;
$$;
