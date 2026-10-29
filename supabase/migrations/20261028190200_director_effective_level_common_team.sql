-- ДИРЕКТОР: «НЕ ВЫШЕ СВОИХ» ПО ДЕЙСТВУЮЩЕМУ УРОВНЮ И ТОЛЬКО ОБЩИЕ КОМАНДЫ
-- (аудит 035, cab/R-08, часть 2; пачка 7, С2).
--
-- Часть 1 (20261027225328) поправила посев «Записей». Здесь — два края,
-- которые меняют модель прав директора:
--   • `partners_check_caps` сравнивал ступень с ХРАНИМЫМ уровнем директора.
--     Действующий ниже: «Сумма» и «Оплата» без «Услуг» не действуют, весь
--     календарь закрыт при «Записях: Скрыт», неживой блок — «Скрыт»
--     (`access_calendars_of`, `access_company`). Директор с хранимой «Суммой:
--     Меняет» при «Услугах: Скрыт» сам суммы не видит, а другим её открывал.
--     Теперь мерка — действующий уровень; у окон («Неделя … Без
--     ограничения») ступеней доступа нет, там по-прежнему хранимый.
--   • `partners_manageable` пускал директора к любому не-директору: права на
--     весь аккаунт, карточку и файлы человека чужих команд он менял, а убрать
--     его не мог (`partners_removable` требует, чтобы все команды были его).
--     Теперь директор ведёт только партнёров, у которых с ним есть общая
--     команда; остальных — владелец. Его приглашения до принятия — по-прежнему
--     его (`partners_card_manageable`).
--
-- Тела правятся по якорям в живых определениях.

do $migration$
declare
  d text := pg_get_functiondef('public.partners_check_caps(uuid, uuid, jsonb)'::regprocedure);
  a1 constant text := E'  my_level text;\n';
  r1 constant text := E'  my_level text;\n'
    || E'  v_step text;\n';
  a2 constant text := E'    select ma.level into my_level\n'
    || E'      from public.member_access ma\n'
    || E'     where ma.tenant_id = p_tenant\n'
    || E'       and ma.user_id = auth.uid()\n'
    || E'       and ma.block = b.key\n'
    || E'       and ma.team_id is not distinct from change_team;\n'
    || E'    my_level := coalesce(my_level, b.levels[1]);\n';
  r2 constant text := E'    -- Мерка — действующий уровень директора; у окон ступеней доступа нет,\n'
    || E'    -- там хранимый.\n'
    || E'    if b.levels <@ array[''off'', ''read'', ''write'', ''full''] then\n'
    || E'      my_level := b.levels[1];\n'
    || E'      foreach v_step in array b.levels[2:] loop\n'
    || E'        if (b.scope = ''calendar'' and change_team = any(public.access_calendars(b.key, v_step)))\n'
    || E'           or (b.scope = ''company'' and public.access_company(b.key, v_step)) then\n'
    || E'          my_level := v_step;\n'
    || E'        end if;\n'
    || E'      end loop;\n'
    || E'    else\n'
    || E'      select ma.level into my_level\n'
    || E'        from public.member_access ma\n'
    || E'       where ma.tenant_id = p_tenant\n'
    || E'         and ma.user_id = auth.uid()\n'
    || E'         and ma.block = b.key\n'
    || E'         and ma.team_id is not distinct from change_team;\n'
    || E'      my_level := coalesce(my_level, b.levels[1]);\n'
    || E'    end if;\n';
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1
     or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then
    raise exception 'partners_check_caps: якоря уровня директора не найдены ровно один раз';
  end if;
  execute replace(replace(d, a1, r1), a2, r2);
end;
$migration$;

do $migration$
declare
  d text := pg_get_functiondef('public.partners_manageable(uuid)'::regprocedure);
  anchor constant text := E'  -- Директора ведёт только владелец.\n';
  replacement constant text := E'  -- Партнёра без общей с директором команды ведёт владелец.\n'
    || E'  if not exists (\n'
    || E'    select 1\n'
    || E'      from public.member_calendars theirs\n'
    || E'      join public.member_calendars mine\n'
    || E'        on mine.tenant_id = theirs.tenant_id\n'
    || E'       and mine.team_id = theirs.team_id\n'
    || E'       and mine.user_id = auth.uid()\n'
    || E'     where theirs.tenant_id = active_tenant\n'
    || E'       and theirs.user_id = p_user\n'
    || E'  ) then\n'
    || E'    return false;\n'
    || E'  end if;\n'
    || anchor;
begin
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'partners_manageable: якорь не найден ровно один раз';
  end if;
  execute replace(d, anchor, replacement);
end;
$migration$;

do $guard$
begin
  if position('public.access_calendars(b.key, v_step)' in
       pg_get_functiondef('public.partners_check_caps(uuid, uuid, jsonb)'::regprocedure)) = 0 then
    raise exception 'partners_check_caps: мерка снова хранимый уровень';
  end if;
  if position('from public.member_calendars theirs' in
       pg_get_functiondef('public.partners_manageable(uuid)'::regprocedure)) = 0 then
    raise exception 'partners_manageable: общая команда не проверяется';
  end if;
end;
$guard$;
