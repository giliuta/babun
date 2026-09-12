-- ЛЕНТА КАЛЕНДАРЕЙ УЧИТСЯ ВИДЕТЬ ДОСТУП ПО РОЛИ, А НЕ ТОЛЬКО ВЫДАННЫЕ ПРАВА.
--
-- СИМПТОМ. Человека приглашают в компанию — он входит, а ЛЕНТА КАЛЕНДАРЕЙ У
-- НЕГО ПУСТАЯ. При этом сам экран календаря показывает команды: два списка об
-- одном и том же расходятся. Проверено на боевой базе (Giliuta, приём
-- приглашения диспетчером внутри `rollback`):
--   `list_operational_teams_safe()` → 4 календаря   (ветка роли есть)
--   `list_my_calendars()`           → 0 календарей  (ветки роли нет)
--
-- ПРИЧИНА. Права по календарям (`calendar_members`) заведены 12.09, и перенос
-- раздал строки ТЕМ, КТО УЖЕ БЫЛ В КОМПАНИИ. Кто приходит после — не получает
-- ни одной строки: `accept_invitation` пишет только `tenant_members`. Старые
-- читатели это переживают, потому что у них осталась ветка роли
-- (`current_user_role()`, `current_user_team_ids()`), а `list_my_calendars`
-- родилась уже новой и знает ТОЛЬКО `calendar_members`.
--
-- Это цена шага «расширяем»: пока обе механики живы, ОБЕ ветки обязан нести
-- КАЖДЫЙ читатель. Один читатель с одной веткой — и появляется расхождение,
-- которое человек читает как «меня не пустили».
--
-- ЧТО ДЕЛАЕМ. Лента получает те же три ветки, что и остальные читатели:
--   • владелец            — все календари компании, все права;
--   • явное право         — ровно выданные календари и ровно выданные галочки;
--   • иначе ветка роли    — диспетчеру вся компания, мастеру его назначения
--                           (карточка мастера и списки внутри команды).
--
-- ГЛАВНОЕ ПРАВИЛО, РАДИ КОТОРОГО ВСЁ: ЯВНОЕ ПРАВО НЕ ДОБАВЛЯЕТСЯ К РОЛИ, А
-- ЗАМЕНЯЕТ ЕЁ. Как только у человека в компании появилась хоть одна строка
-- прав, ветка роли для него выключается целиком. Иначе выдача права на ОДИН
-- календарь ничего бы не сузила — диспетчер как видел всю компанию, так и
-- видел бы, и обещание владельца «приглашаю в календарь — видит исключительно
-- его» не выполнялось бы никогда.
--
-- Функции `current_user_team_ids()`/`current_user_calendar_ids()` здесь звать
-- НЕЛЬЗЯ: они считают от АКТИВНОЙ компании, а лента показывает все компании
-- человека сразу. Поэтому назначения мастера разложены явно, по `tenant_id`
-- каждой строки членства.
--
-- ПРОГНАНО НА БОЕВОЙ В `begin/rollback` (2026-09-12), Giliuta:
--   владелец                      3 → 3  (не изменилось)
--   мастер с выданным правом      2 → 2  (не изменилось)
--   диспетчер, только что принят  0 → 3  (починено)
--   ему же выдали ОДИН календарь  3 → 1, права ровно `view·book` (сужение)

create or replace function public.list_my_calendars()
returns table(
  tenant_id uuid,
  tenant_name text,
  team_id text,
  team_name text,
  team_color text,
  role text,
  grants text[],
  is_active boolean,
  onboarded boolean
)
language sql
stable
security definer
set search_path = public
as $function$
  select t.tenant_id,
         tn.name,
         t.id,
         t.name,
         t.color,
         tm.role,
         case
           when tm.role = 'owner' then array[
             'view','book','edit_all','clients','phones','finance','close_day','settings'
           ]::text[]
           -- Явное право всегда точнее роли — и когда шире, и когда уже.
           when cm.user_id is not null then coalesce(cm.grants, array[]::text[])
           -- Ветка роли повторяет перенос 12.09 галочка в галочку, иначе
           -- приглашённый и переведённый получали бы разный доступ при
           -- одинаковой роли.
           when tm.role = 'dispatcher' then array[
             'view','book','edit_all','clients','phones'
           ]::text[]
           else array['view']::text[]
         end,
         t.tenant_id = public.current_tenant_id(),
         tn.onboarded_at is not null
    from public.tenant_members tm
    join public.tenants tn on tn.id = tm.tenant_id
    join public.teams t on t.tenant_id = tm.tenant_id
    left join public.calendar_members cm
      on cm.tenant_id = t.tenant_id
     and cm.team_id = t.id
     and cm.user_id = tm.user_id
   where tm.user_id = auth.uid()
     and t.is_active
     and (
       tm.role = 'owner'
       or cm.user_id is not null
       or (
         -- ВЫКЛЮЧАТЕЛЬ ВЕТКИ РОЛИ. Считается по компании целиком, а не по
         -- строке календаря: иначе человек с правом на один календарь
         -- продолжал бы видеть остальные «по роли».
         not exists (
           select 1 from public.calendar_members c2
            where c2.tenant_id = tm.tenant_id
              and c2.user_id = tm.user_id
         )
         and (
           tm.role = 'dispatcher'
           or (
             tm.master_id is not null
             and (
               exists (
                 select 1 from public.masters m
                  where m.tenant_id = tm.tenant_id
                    and m.id = tm.master_id
                    and m.team_id = t.id
               )
               or coalesce(t.lead_ids, '[]'::jsonb) ? tm.master_id
               or coalesce(t.helper_ids, '[]'::jsonb) ? tm.master_id
               or exists (
                 select 1
                   from jsonb_array_elements(
                     case when jsonb_typeof(t.members) = 'array'
                          then t.members else '[]'::jsonb end
                   ) member
                  where case jsonb_typeof(member)
                          when 'string' then member #>> '{}'
                          when 'object' then coalesce(member ->> 'master_id', member ->> 'id')
                          else null
                        end = tm.master_id
               )
             )
           )
         )
       )
     )
   order by (t.tenant_id = public.current_tenant_id()) desc, tn.name, t.position, t.name
$function$;

comment on function public.list_my_calendars() is
  'Календари человека во всех его компаниях. Владелец — вся компания; есть '
  'явные права — ровно они (ветка роли при этом выключается целиком); нет '
  'ни одной строки прав — доступ по роли, как до перехода на calendar_members.';

do $$
declare v_src text;
begin
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='list_my_calendars';

  if position('calendar_members' in v_src) = 0 then
    raise exception 'list_my_calendars: выданные права не читаются';
  end if;

  -- Сторож против самой вероятной будущей правки: снять ветку роли раньше,
  -- чем всем живым людям розданы строки прав. Тогда лента опустеет молча.
  if position('dispatcher' in v_src) = 0 then
    raise exception 'list_my_calendars: ветка роли потеряна — приглашённые ослепнут';
  end if;

  -- И против обратной: потерять выключатель. Тогда явное право перестанет
  -- сужать, и «приглашаю в один календарь» снова начнёт открывать все.
  if position('not exists' in v_src) = 0 then
    raise exception 'list_my_calendars: выключатель ветки роли потерян — право перестало сужать';
  end if;
end $$;
