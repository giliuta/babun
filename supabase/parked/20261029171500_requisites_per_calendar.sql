-- РЕКВИЗИТЫ — ПО КАЛЕНДАРЮ. Наборы реквизитов (юрлица с сериями номеров)
-- по-прежнему одни на аккаунт: по умолчанию все календари выставляют
-- документы от «Основных», календарь со своим юрлицом смотрит на свой набор
-- (`teams.legal_entity_id`). Меняется доступ:
--   • право «Реквизиты» (`finance.settings_requisites`) выдаётся на
--     календарь, а не на аккаунт — как «Документы» и «Счета»; строка «Реквизиты»
--     живёт в шестерёнке «Финансов» у выбранного календаря;
--   • партнёр с «Видит» видит только набор своего календаря (своих
--     календарей) — наборы чужих календарей, их IBAN и VAT, сервер ему не
--     отдаёт (`requisites_visible_ids`);
--   • правит наборы и выбирает набор календаря по-прежнему только владелец:
--     набор общий на несколько календарей, и правка задела бы документы и
--     нумерацию всех;
--   • выставлять документы по-прежнему решает «Документы» календаря — набор
--     календаря сервер подставляет сам, видеть реквизиты для этого не нужно.
-- Права партнёров переезжают как есть: «Видит» на аккаунт становится
-- «Видит» в каждом его календаре.

set local lock_timeout = '5s';

-- ─── Право — на календарь ────────────────────────────────────────────────

update public.access_blocks
   set scope = 'calendar',
       enforced_by = array['policy:public.legal_entities.legal_entities_select']
 where key = 'finance.settings_requisites';

-- Строка «на аккаунт» → строка в каждом календаре человека (сторож
-- `member_access_validate` пускает календарную строку только к его
-- календарю — берём их из `member_calendars`).
insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
select ma.tenant_id, ma.user_id, ma.block, mc.team_id, ma.level, ma.set_by, ma.set_at
  from public.member_access ma
  join public.member_calendars mc
    on mc.tenant_id = ma.tenant_id
   and mc.user_id = ma.user_id
 where ma.block = 'finance.settings_requisites'
   and ma.team_id is null
   and not exists (
     select 1
       from public.member_access d
      where d.tenant_id = ma.tenant_id
        and d.user_id = ma.user_id
        and d.block = ma.block
        and d.team_id = mc.team_id
   );

delete from public.member_access
 where block = 'finance.settings_requisites'
   and team_id is null;

-- ─── Какие наборы человек видит ──────────────────────────────────────────

-- Владелец — все наборы аккаунта; партнёр — наборы календарей, где у него
-- «Реквизиты: Видит» (свой набор календаря или «Основные», если своего нет).
create or replace function public.requisites_visible_ids()
returns uuid[]
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(le.id), array[]::uuid[])
    from public.legal_entities le
   where le.tenant_id = public.current_tenant_id()
     and (
       public.current_user_role() = 'owner'
       or exists (
         select 1
           from public.teams t
          where t.tenant_id = le.tenant_id
            and t.id = any(public.access_calendars('finance.settings_requisites', 'read'))
            and coalesce(t.legal_entity_id, public.resolve_company_id(t.tenant_id, null)) = le.id
       )
     )
$function$;

revoke all on function public.requisites_visible_ids() from public, anon;
grant execute on function public.requisites_visible_ids() to authenticated;

drop policy if exists legal_entities_select on public.legal_entities;

create policy legal_entities_select
  on public.legal_entities
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    -- Скалярный подзапрос с приведением: функция считается раз на запрос,
    -- а `any` получает массив, а не множество строк.
    and id = any ((select public.requisites_visible_ids())::uuid[])
  );

-- ─── Сторож ──────────────────────────────────────────────────────────────

do $$
begin
  if (select scope from public.access_blocks where key = 'finance.settings_requisites') <> 'calendar' then
    raise exception 'requisites_per_calendar: право осталось на аккаунт';
  end if;
  if exists (
    select 1 from public.member_access
     where block = 'finance.settings_requisites' and team_id is null
  ) then
    raise exception 'requisites_per_calendar: осталась строка права на аккаунт';
  end if;
  if has_function_privilege('anon', 'public.requisites_visible_ids()', 'execute') then
    raise exception 'requisites_per_calendar: видимость наборов исполнима без входа';
  end if;
end;
$$;
