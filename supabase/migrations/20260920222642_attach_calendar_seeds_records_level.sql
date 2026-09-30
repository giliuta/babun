-- STORY-084, волна 0: прикрепление к календарю проставляет «Календарь и записи».
--
-- МИНА, КОТОРАЯ ЖДАЛА ПЕРВОГО НОВОГО СОТРУДНИКА. `access_calendars_of` пускает
-- КАЖДЫЙ календарный блок только если у человека есть строка `calendar.records`
-- со значением read/write в этом календаре (иначе `access_records_level`
-- отвечает умолчанием `off`). А поставить её владелец не может: блок не живой,
-- строки на странице прав нет.
--
-- Значит приглашённый после 14.09 человек с «Доходы и расходы: Меняет» получил
-- бы РОВНО НИЧЕГО — и никто бы не понял почему. Проверено на боевой базе
-- пробой в откате: снимаем строку — доступных календарей 0; возвращаем — 1.
--
-- Лечение: прикрепление к календарю само кладёт `calendar.records = read`,
-- если строки ещё нет. Это ПЕРЕНОС СЕГОДНЯШНЕЙ КАРТИНЫ в новую форму:
-- прикреплён — значит календарь видит, ровно как сейчас. Явный уровень из
-- приглашения ляжет поверх: досев идёт ДО `access_apply_changes`.

create or replace function public.seed_records_level(p_tenant uuid, p_user uuid, p_by uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
  select mc.tenant_id, mc.user_id, 'calendar.records', mc.team_id, 'read', p_by, now()
    from public.member_calendars mc
   where mc.tenant_id = p_tenant
     and mc.user_id = p_user
     and not exists (
       select 1 from public.member_access ma
        where ma.tenant_id = mc.tenant_id and ma.user_id = mc.user_id
          and ma.block = 'calendar.records' and ma.team_id = mc.team_id
     )
  on conflict do nothing
$function$;

comment on function public.seed_records_level(uuid, uuid, uuid) is
  'STORY-084 волна 0: прикреплённый к календарю обязан иметь строку calendar.records, иначе все остальные календарные блоки у него мертвы.';

-- ─── Дорога первая: владелец правит календари на карточке ──────────────

create or replace function public.set_member_calendars(p_user_id uuid, p_team_ids text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  active_tenant uuid := public.access_writer_target(p_user_id);
  wanted text[] := coalesce(p_team_ids, array[]::text[]);
  foreign_team text;
begin
  select w into foreign_team
    from unnest(wanted) as w
   where not exists (select 1 from public.teams t where t.tenant_id = active_tenant and t.id = w)
   limit 1;
  if foreign_team is not null then
    raise exception 'календарь % не из этой компании', foreign_team using errcode = '22023', hint = 'access:bad_team';
  end if;

  delete from public.member_calendars mc
   where mc.tenant_id = active_tenant
     and mc.user_id = p_user_id
     and not (mc.team_id = any(wanted));

  insert into public.member_calendars (tenant_id, user_id, team_id, attached_by, attached_at)
  select distinct active_tenant, p_user_id, w, auth.uid(), now()
    from unnest(wanted) as w
  on conflict (tenant_id, user_id, team_id) do nothing;

  perform public.seed_records_level(active_tenant, p_user_id, auth.uid());

  return public.access_map_for(active_tenant, p_user_id, true);
end;
$function$;

-- ─── Дорога вторая: человек принял приглашение ─────────────────────────
--
-- Патч якорем по живому телу: функция длинная, и копия в миграции завтра
-- разошлась бы с базой.

do $patch$
declare
  body text;
  anchor constant text := E'    on conflict (tenant_id, team_id, user_id) do nothing;\n  end if;\n';
  addition constant text := E'\n    perform public.seed_records_level(p_invitation.tenant_id, p_user_id, p_invitation.invited_by_user_id);\n  end if;\n';
begin
  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'grant_invitation_calendar';

  if body is null then
    raise exception 'STORY-084: нет функции grant_invitation_calendar';
  end if;
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'STORY-084: якорь в grant_invitation_calendar встретился не один раз';
  end if;
  if position('seed_records_level' in body) > 0 then
    raise exception 'STORY-084: grant_invitation_calendar уже досевает — волна накатана?';
  end if;

  execute replace(body, anchor, replace(anchor, E'  end if;\n', '') || addition);
end
$patch$;

-- ─── Досев тем, кто уже прикреплён ─────────────────────────────────────

insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
select mc.tenant_id, mc.user_id, 'calendar.records', mc.team_id, 'read', mc.attached_by, now()
  from public.member_calendars mc
 where not exists (
   select 1 from public.member_access ma
    where ma.tenant_id = mc.tenant_id and ma.user_id = mc.user_id
      and ma.block = 'calendar.records' and ma.team_id = mc.team_id
 )
on conflict do nothing;

-- ─── Сторож ────────────────────────────────────────────────────────────

do $guard$
declare
  emp record;
  before_cnt integer;
  after_cnt integer;
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'grant_invitation_calendar'
       and p.prosrc like '%seed_records_level%'
  ) then
    raise exception 'STORY-084 сторож: приём приглашения не досевает calendar.records';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_member_calendars'
       and p.prosrc like '%seed_records_level%'
  ) then
    raise exception 'STORY-084 сторож: правка календарей не досевает calendar.records';
  end if;

  select count(*) into after_cnt
    from public.member_calendars mc
   where not exists (
     select 1 from public.member_access ma
      where ma.tenant_id = mc.tenant_id and ma.user_id = mc.user_id
        and ma.block = 'calendar.records' and ma.team_id = mc.team_id
   );
  if after_cnt > 0 then
    raise exception 'STORY-084 сторож: % прикреплений остались без строки calendar.records', after_cnt;
  end if;

  -- Поведение: снимаем строку у живого человека — календари пропадают,
  -- досеваем — возвращаются. Сабтранзакция откатывается исключением.
  select tm.tenant_id, tm.user_id into emp
    from public.tenant_members tm
    join public.member_calendars mc on mc.tenant_id = tm.tenant_id and mc.user_id = tm.user_id
   where tm.role <> 'owner' limit 1;
  if emp.user_id is not null then
    begin
      delete from public.member_access
       where tenant_id = emp.tenant_id and user_id = emp.user_id and block = 'calendar.records';
      before_cnt := coalesce(array_length(
        public.access_calendars_of(emp.tenant_id, emp.user_id, 'finance.operations', 'read'), 1), 0);
      perform public.seed_records_level(emp.tenant_id, emp.user_id, null);
      after_cnt := coalesce(array_length(
        public.access_calendars_of(emp.tenant_id, emp.user_id, 'finance.operations', 'read'), 1), 0);
      if not (before_cnt = 0 and after_cnt > 0) then
        raise exception 'STORY-084 сторож: досев не возвращает доступ (% → %)', before_cnt, after_cnt;
      end if;
      raise exception 'STORY-084: откат пробы' using errcode = 'P0001';
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'STORY-084: откат пробы' then raise; end if;
    end;
  end if;
end
$guard$;
