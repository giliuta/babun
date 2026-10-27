-- ПРИГЛАШЕНИЕ ДИРЕКТОРА — НЕ ШИРЕ ЕГО ПРАВ В МОМЕНТ ПРИЁМА (аудит 035, cab/R-02).
--
-- Директор («Партнёры: Управляет») ставит приглашённому права «не выше своих»
-- — но проверка (`partners_check_caps`, `partners_check_teams`) стоит при
-- создании и правке приглашения. Приглашение живёт до 7 дней: владелец
-- понизил директора или открепил его от календаря — приглашение принималось
-- с прежними календарями и уровнями. Снимались приглашения только когда
-- директор терял «Партнёров» целиком.
--
-- Теперь `grant_invitation_calendar` при приёме приглашения не от владельца:
--   • прикрепляет только к тем календарям приглашения, к которым пригласивший
--     прикреплён сейчас;
--   • каждый уровень блока режет до сегодняшнего уровня пригласившего в том
--     же календаре (или на всю компанию).
-- Приглашения владельца — как были. Приглашение без пригласившего (старые
-- строки) считается владельческим: его создавал только владелец.
--
-- Тело правится по якорям в живом определении.

do $migration$
declare
  d text := pg_get_functiondef('public.grant_invitation_calendar(public.invitations, uuid)'::regprocedure);
  a_decl constant text := E'  v_changes jsonb;\n';
  b_decl constant text := E'  v_changes jsonb;\n  v_by_owner boolean;\n';
  a_start constant text := E'  if p_user_id is null then\n    return;\n  end if;\n';
  b_start constant text := E'  if p_user_id is null then\n    return;\n  end if;\n'
    || E'  v_by_owner := p_invitation.invited_by_user_id is null or exists (\n'
    || E'    select 1 from public.tenant_members tm\n'
    || E'     where tm.tenant_id = p_invitation.tenant_id\n'
    || E'       and tm.user_id = p_invitation.invited_by_user_id\n'
    || E'       and tm.role = ''owner''\n'
    || E'  );\n';
  a_teams constant text := E'  if cardinality(v_team_ids) > 0 then\n';
  b_teams constant text := E'  -- Пригласил не владелец: только календари, к которым он прикреплён сейчас.\n'
    || E'  if not v_by_owner then\n'
    || E'    select coalesce(array_agg(x.team_id order by x.ord), array[]::text[])\n'
    || E'      into v_team_ids\n'
    || E'      from unnest(v_team_ids) with ordinality as x(team_id, ord)\n'
    || E'     where exists (\n'
    || E'       select 1 from public.member_calendars mc\n'
    || E'        where mc.tenant_id = p_invitation.tenant_id\n'
    || E'          and mc.user_id = p_invitation.invited_by_user_id\n'
    || E'          and mc.team_id = x.team_id\n'
    || E'     );\n'
    || E'  end if;\n\n'
    || E'  if cardinality(v_team_ids) > 0 then\n';
  a_apply constant text := E'  if jsonb_array_length(v_changes) > 0 then\n    perform public.access_apply_changes(\n';
  b_apply constant text := E'  -- Пригласил не владелец: уровень — не выше его сегодняшнего.\n'
    || E'  if not v_by_owner and jsonb_array_length(v_changes) > 0 then\n'
    || E'    select coalesce(jsonb_agg(\n'
    || E'             jsonb_set(e.ch, ''{level}'', to_jsonb(\n'
    || E'               case\n'
    || E'                 when array_position(array[''off'', ''read'', ''write'', ''full''], e.ch ->> ''level'')\n'
    || E'                    > array_position(array[''off'', ''read'', ''write'', ''full''], cap.level)\n'
    || E'                 then cap.level\n'
    || E'                 else e.ch ->> ''level''\n'
    || E'               end))\n'
    || E'             order by e.ord), ''[]''::jsonb)\n'
    || E'      into v_changes\n'
    || E'      from jsonb_array_elements(v_changes) with ordinality as e(ch, ord)\n'
    || E'      join public.access_blocks b on b.key = e.ch ->> ''block''\n'
    || E'     cross join lateral (\n'
    || E'       select coalesce(\n'
    || E'         (select ma.level from public.member_access ma\n'
    || E'           where ma.tenant_id = p_invitation.tenant_id\n'
    || E'             and ma.user_id = p_invitation.invited_by_user_id\n'
    || E'             and ma.block = b.key\n'
    || E'             and ma.team_id is not distinct from nullif(e.ch ->> ''team_id'', '''')),\n'
    || E'         b.levels[1]\n'
    || E'       ) as level\n'
    || E'     ) cap;\n'
    || E'  end if;\n\n'
    || E'  if jsonb_array_length(v_changes) > 0 then\n    perform public.access_apply_changes(\n';
begin
  if (length(d) - length(replace(d, a_decl, ''))) / length(a_decl) <> 1
     or (length(d) - length(replace(d, a_start, ''))) / length(a_start) <> 1
     or (length(d) - length(replace(d, a_teams, ''))) / length(a_teams) <> 1
     or (length(d) - length(replace(d, a_apply, ''))) / length(a_apply) <> 1 then
    raise exception 'grant_invitation_calendar: якоря не найдены ровно по одному разу';
  end if;
  execute replace(replace(replace(replace(d, a_decl, b_decl), a_start, b_start), a_teams, b_teams), a_apply, b_apply);
end;
$migration$;
