-- ВЛАДЕЛЕЦ ВИДИТ СОХРАНЁННЫЕ УРОВНИ СОТРУДНИКА, ДАЖЕ У НЕЖИВЫХ БЛОКОВ.
--
-- Нашла сессия 008 на живых данных 14.09: экран «Права» показывал у мастера
-- airfix.cy в Giliuta всё «Скрыт», хотя в `member_access` у него 6 уровней
-- («Смотрит» записи, «Меняет» статус, клиенты, услуги, мастера). Причина —
-- `access_map_for` фильтровала блоки по `live` и в режиме владельца: на этапе 1
-- живых блоков нет, и `list_member_access` отдавала пустые словари и не
-- отдавала прикреплённый календарь ключом.
--
-- Фильтр по `live` — про ПРИМЕНЕНИЕ прав: он остаётся в карте самого
-- сотрудника (`my_access_map`, `p_include_off = false`). Владельцу нужна правда о
-- сохранённом: все блоки, кроме «только владелец», и каждый прикреплённый
-- календарь ключом со всеми календарными блоками. Менять неживой блок по-прежнему
-- нельзя — это держит `set_member_access` отказом `access:not_live`.

create or replace function public.access_map_for(p_tenant_id uuid, p_user_id uuid, p_include_off boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  member_role text;
  member_version bigint;
  company_levels jsonb;
  calendar_levels jsonb;
  attached jsonb;
begin
  select tm.role, tm.access_version
    into member_role, member_version
    from public.tenant_members tm
   where tm.tenant_id = p_tenant_id and tm.user_id = p_user_id;

  if member_role is null then
    return null;
  end if;

  if member_role = 'owner' then
    return jsonb_build_object(
      'tenant_id', p_tenant_id, 'is_owner', true, 'version', member_version,
      'company', '{}'::jsonb, 'calendars', '{}'::jsonb
    );
  end if;

  select coalesce(jsonb_object_agg(b.key, coalesce(ma.level, b.levels[1])), '{}'::jsonb)
    into company_levels
    from public.access_blocks b
    left join public.member_access ma
      on ma.tenant_id = p_tenant_id
     and ma.user_id = p_user_id
     and ma.block = b.key
     and ma.team_id is null
   where (b.live or p_include_off) and b.scope = 'company' and not b.owner_only;

  select coalesce(jsonb_object_agg(per_team.team_id, per_team.blocks), '{}'::jsonb)
    into calendar_levels
    from (
      select mc.team_id,
             jsonb_object_agg(b.key, coalesce(ma.level, b.levels[1])) as blocks,
             coalesce(max(coalesce(ma.level, b.levels[1])) filter (where b.key = 'calendar.records'), 'off') as records_level
        from public.member_calendars mc
        cross join public.access_blocks b
        left join public.member_access ma
          on ma.tenant_id = mc.tenant_id
         and ma.user_id = mc.user_id
         and ma.block = b.key
         and ma.team_id = mc.team_id
       where mc.tenant_id = p_tenant_id
         and mc.user_id = p_user_id
         and (b.live or p_include_off)
         and b.scope = 'calendar'
       group by mc.team_id
    ) per_team
   where p_include_off or per_team.records_level <> 'off';

  if p_include_off then
    select coalesce(jsonb_agg(mc.team_id order by mc.team_id), '[]'::jsonb)
      into attached
      from public.member_calendars mc
     where mc.tenant_id = p_tenant_id and mc.user_id = p_user_id;
    return jsonb_build_object(
      'tenant_id', p_tenant_id, 'is_owner', false, 'version', member_version,
      'attached_calendars', attached,
      'company', company_levels, 'calendars', calendar_levels
    );
  end if;

  return jsonb_build_object(
    'tenant_id', p_tenant_id, 'is_owner', false, 'version', member_version,
    'company', company_levels, 'calendars', calendar_levels
  );
end;
$function$;

revoke all on function public.access_map_for(uuid, uuid, boolean) from public, anon, authenticated;
