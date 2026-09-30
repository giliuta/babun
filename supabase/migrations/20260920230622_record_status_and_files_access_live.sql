-- STORY-084, ВОЛНА 2: «Статус записи» и «Фото и файлы записи» — настоящие права.
--
-- ЧТО БЫЛО. Обе двери проверяли СТАРОЕ назначение карточкой, которого новая
-- модель прав не знает вовсе: `update_master_appointment_safe` пускала по
-- `master_id = current_user_master_id()` ИЛИ `team_id = any(current_user_team_ids())`,
-- фото — по той же паре. Уровень блока не решал ничего, а переключатель
-- «Статус записи» на странице прав даже не показывался.
--
-- ПЕРЕНОС СЕГОДНЯШНЕЙ КАРТИНЫ. Умолчание у обоих блоков — «Скрыт», поэтому
-- первым шагом каждому прикреплённому проставляется `write` в его календарях:
-- прикреплён — значит статус ставит и фото грузит, ровно как сейчас. Без
-- этого волна отняла бы у живых людей то, что у них было.
--
-- ЧТЕНИЕ ФОТО ТОЖЕ СТАЛО ПРАВОМ. Иначе положение «Смотрит» ничего бы не
-- значило — ровно тот лгущий переключатель, против которого написана
-- STORY-083. События (`team_id is null`) остаются за автором, как были.
--
-- ЗАМЕТКА ЗАПИСИ. Та же RPC патчит и комментарий, но блок `record.note` ещё
-- спит: пока он не живой, комментарий ходит вместе со статусом. Его волна
-- добавит свою проверку на поле.
--
-- Прогнано в `begin … rollback` на этой же базе: при «Меняет» фото правятся,
-- при «Скрыт» — нет.

insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
select mc.tenant_id, mc.user_id, b.key, mc.team_id, 'write', mc.attached_by, now()
  from public.member_calendars mc
  cross join (values ('record.status'), ('record.files')) as b(key)
 where not exists (
   select 1 from public.member_access ma
    where ma.tenant_id = mc.tenant_id and ma.user_id = mc.user_id
      and ma.block = b.key and ma.team_id = mc.team_id)
on conflict do nothing;

do $patch$
declare
  body text;
  anchor constant text := E'     and (\n       a.master_id = public.current_user_master_id()\n       or a.team_id = any(public.current_user_team_ids())\n     )\n';
  addition constant text := E'     and a.team_id in (select unnest(public.access_calendars(''record.status'', ''write'')))\n';
begin
  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'update_master_appointment_safe';
  if body is null then
    raise exception 'STORY-084: нет функции update_master_appointment_safe';
  end if;
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'STORY-084: якорь в update_master_appointment_safe встретился не один раз';
  end if;
  if position('access_calendars(''record.status''' in body) > 0 then
    raise exception 'STORY-084: волна уже накатана?';
  end if;
  execute replace(body, anchor, addition);
end
$patch$;

create or replace function public.current_user_can_mutate_appointment_photo(p_appointment_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.appointments a
     where a.id = p_appointment_id
       and a.tenant_id = public.current_tenant_id()
       and (
         -- Владелец — всегда; событие — его автор, как и было.
         (public.current_user_role() = 'owner'
           and (a.kind = 'work' or (a.kind in ('event','personal') and a.created_by = auth.uid())))
         or (a.kind in ('event','personal') and a.created_by = auth.uid())
         -- Запись — по уровню блока в её календаре. Прежняя пара
         -- «моя карточка ИЛИ моя команда» и была тем, что уровень не решал.
         or (a.kind = 'work'
             and a.team_id in (select unnest(public.access_calendars('record.files', 'write'))))
       )
  )
$function$;

drop policy if exists appointment_photos_select_visible on public.appointment_photos;
create policy appointment_photos_select_visible on public.appointment_photos
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and public.current_user_can_access_appointment(appointment_id)
    and exists (
      select 1 from public.appointments a
       where a.id = appointment_photos.appointment_id
         and (a.team_id is null
              or a.team_id in (select unnest(public.access_calendars('record.files', 'read'))))
    )
  );

update public.access_blocks
   set live = true,
       enforced_by = array['function:public.update_master_appointment_safe(uuid, jsonb)']
 where key = 'record.status';

update public.access_blocks
   set live = true,
       enforced_by = array[
         'function:public.current_user_can_mutate_appointment_photo(uuid)',
         'policy:appointment_photos_select_visible',
         'policy:appointment_photos_insert_visible',
         'policy:appointment_photos_update_operator',
         'policy:appointment_photos_delete_operator'
       ]
 where key = 'record.files';

do $signal$
declare
  person record;
begin
  for person in
    update public.tenant_members tm
       set access_version = tm.access_version + 1
     where tm.role <> 'owner'
    returning tm.tenant_id, tm.user_id, tm.access_version
  loop
    perform realtime.send(
      jsonb_build_object('tenant_id', person.tenant_id, 'version', person.access_version),
      'access_changed',
      'access:' || person.user_id::text,
      true
    );
  end loop;
end
$signal$;

do $guard$
declare
  emp record;
  can_on boolean;
  can_off boolean;
begin
  select tm.tenant_id, tm.user_id, mc.team_id into emp
    from public.tenant_members tm
    join public.member_calendars mc on mc.tenant_id = tm.tenant_id and mc.user_id = tm.user_id
   where tm.role <> 'owner' limit 1;

  if emp.user_id is null then
    raise notice 'STORY-084: сотрудников нет — поведенческий сторож пропущен';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', emp.user_id, 'role','authenticated',
        'app_metadata', json_build_object('tenant_id', emp.tenant_id))::text, true);
    perform set_config('request.headers',
      json_build_object('x-babun-tenant', emp.tenant_id)::text, true);

    select coalesce(bool_or(public.current_user_can_mutate_appointment_photo(a.id)), true)
      into can_on from public.appointments a where a.kind = 'work' and a.team_id = emp.team_id;
    if not can_on then
      raise exception 'STORY-084 сторож: при «Меняет» фото править нельзя';
    end if;

    update public.member_access set level = 'off'
     where tenant_id = emp.tenant_id and user_id = emp.user_id
       and block = 'record.files' and team_id = emp.team_id;
    select coalesce(bool_or(public.current_user_can_mutate_appointment_photo(a.id)), false)
      into can_off from public.appointments a where a.kind = 'work' and a.team_id = emp.team_id;
    if can_off then
      raise exception 'STORY-084 сторож: при «Скрыт» фото всё ещё правятся';
    end if;

    update public.member_access set level = 'write'
     where tenant_id = emp.tenant_id and user_id = emp.user_id
       and block = 'record.files' and team_id = emp.team_id;

    perform set_config('request.jwt.claims', null, true);
    perform set_config('request.headers', null, true);
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'update_master_appointment_safe'
       and (p.prosrc like '%current_user_master_id%' or p.prosrc like '%current_user_team_ids%')
  ) then
    raise exception 'STORY-084 сторож: в статусе осталась старая ветка назначения';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'update_master_appointment_safe'
       and p.prosrc like '%access_calendars(''record.status''%'
  ) then
    raise exception 'STORY-084 сторож: статус не спрашивает уровень';
  end if;
  if not exists (
    select 1 from public.access_blocks
     where key in ('record.status','record.files') and live and array_length(enforced_by,1) >= 1
     having count(*) = 2
  ) then
    raise exception 'STORY-084 сторож: блоки не стали живыми';
  end if;
end
$guard$;
