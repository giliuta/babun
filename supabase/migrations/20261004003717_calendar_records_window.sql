-- «ОГРАНИЧЕНИЯ» ЗАПИСЕЙ КАЛЕНДАРЯ (владелец 03.10: «как в клиентах, такие
-- же ограничения нужно добавить в календаре, чтобы записи после какого-то
-- времени у мастера он больше не мог их видеть»).
--
-- Новое право команды `calendar.window` — «Ограничения» в блоке «Записи»
-- страницы «Календарь»: Неделя · 2 недели · Месяц · 3 месяца · Полгода · Без
-- ограничения — та же шкала и те же окна, что у «Ограничений» клиентов
-- (`access_client_ids_in`). Окно назад от сегодня (день бизнеса): прошедшая
-- РАБОТА старше окна партнёру не видна; будущие записи и события — всегда.
--
-- Решения (сессия 016, владелец разрешил решать самому):
--   • умолчание нового партнёра — «Неделя», как у клиентов (самое узкое);
--   • нынешним партнёрам в их календарях — «Без ограничения»: сегодня у них
--     ничего не пропадает, сузит владелец;
--   • «История» в карточке клиента окну не подчиняется — у неё своё право
--     («Своя команда» / «Все команды»).
--
-- Где держится: окно записей партнёра (`list_master_appointments_safe`),
-- доступ к самой записи и её фото (`current_user_can_access_appointment`),
-- правка, удаление и копия старой записи (`member_appointment_update` /
-- `_delete` / `_copy` — «не найдена», как чужая).
--
-- ПРАВКА ЖИВЫХ ТЕЛ ПО ЯКОРЮ со сверкой md5 (03.10): тело поменяли — миграция
-- падает, а не затирает чужое.

set local lock_timeout = '5s';

-- ─── 1. Право в реестре ───

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values (
  'calendar.window', 'calendar', 'calendar',
  array['week', 'near', 'month', 'quarter', 'half', 'own'],
  'Ограничения', false, true,
  array[
    'function:public.member_record_window_start(text)',
    'function:public.list_master_appointments_safe(integer, integer)',
    'function:public.current_user_can_access_appointment(uuid)',
    'function:public.member_appointment_update(uuid, jsonb)',
    'function:public.member_appointment_delete(uuid)',
    'function:public.member_appointment_copy(uuid, text, text, text, uuid)'
  ],
  15
);

-- Нынешним партнёрам — «Без ограничения» в каждом их календаре.
insert into public.member_access (tenant_id, user_id, block, team_id, level)
select mc.tenant_id, mc.user_id, 'calendar.window', mc.team_id, 'own'
  from public.member_calendars mc
  join public.tenant_members tm
    on tm.tenant_id = mc.tenant_id and tm.user_id = mc.user_id
 where tm.role <> 'owner'
on conflict do nothing;

-- ─── 2. Окно ───

-- С какого дня партнёру видна прошедшая работа этой команды; NULL — без
-- ограничения (и всегда для владельца). Неизвестная ступень — «Неделя».
create function public.member_record_window_start(p_team text)
returns text
language sql
stable
security definer
set search_path = public
as $function$
  select case l.level
           when 'own' then null
           when 'all' then null
           else (public.tenant_business_date(public.current_tenant_id()) - case l.level
                   when 'near' then interval '14 days'
                   when 'month' then interval '1 month'
                   when 'quarter' then interval '3 months'
                   when 'half' then interval '6 months'
                   else interval '7 days'
                 end)::date::text
         end
    from (
      select public.access_team_level(public.current_tenant_id(), auth.uid(), 'calendar.window', p_team) as level
    ) l
   where auth.uid() is not null
     and public.current_user_role() = 'master'
$function$;

-- Работа старше окна — «её нет».
create function public.member_record_hidden(p_kind text, p_team text, p_date text)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(p_kind = 'work' and p_date < public.member_record_window_start(p_team), false)
$function$;

-- Начала окон по всем командам, где он видит записи: { team_id: 'YYYY-MM-DD' }.
create function public.member_record_window_starts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(jsonb_object_agg(t.team_id, t.start), '{}'::jsonb)
    from (
      select x.team_id, public.member_record_window_start(x.team_id) as start
        from unnest(public.access_calendars('calendar.records', 'read')) as x(team_id)
    ) t
   where t.start is not null
$function$;

-- Только для своих дверей: снаружи их не зовут.
revoke all on function public.member_record_window_start(text) from public, anon, authenticated;
revoke all on function public.member_record_hidden(text, text, text) from public, anon, authenticated;
revoke all on function public.member_record_window_starts() from public, anon, authenticated;

-- ─── 3. Двери ───

do $migration$
declare
  patch record;
  def text;
  actual text;
begin
  for patch in
    select *
      from (values
        ('public.list_master_appointments_safe(integer, integer)', 'b4c6c0d5fb79edb819ce75bf16dd5f6e',
         $old$           public.access_calendars('calendar.events', 'read') as event_teams,$old$,
         $new$           public.access_calendars('calendar.events', 'read') as event_teams,
           -- «Ограничения» записей (03.10): с какого дня видна прошедшая работа.
           public.member_record_window_starts()               as window_starts,$new$),
        ('public.list_master_appointments_safe(integer, integer)', null,
         $old$     and a.team_id = any(me.record_teams)$old$,
         $new$     and a.team_id = any(me.record_teams)
     -- «Ограничения» записей (03.10): прошедшая работа старше окна не видна.
     and (a.kind <> 'work' or a.date >= coalesce(me.window_starts ->> a.team_id, ''))$new$),
        ('public.current_user_can_access_appointment(uuid)', 'c5e2fb96a984d6b93a3cf7b9d4d5dd39',
         $old$           public.current_user_role() = 'master'
           and ($old$,
         $new$           public.current_user_role() = 'master'
           -- «Ограничения» записей (03.10): старая работа — как чужая.
           and not public.member_record_hidden(a.kind, a.team_id, a.date)
           and ($new$),
        ('public.member_appointment_update(uuid, jsonb)', '54f9382b3229d14063ebff5187426222',
         $old$     or not public.member_sees_calendar(a.team_id) then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;$old$,
         $new$     or not public.member_sees_calendar(a.team_id) then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;
  -- «Ограничения» записей (03.10): работу старше окна он не видит и не правит.
  if public.member_record_hidden(a.kind, a.team_id, a.date) then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;$new$),
        ('public.member_appointment_delete(uuid)', 'f42b9d12e7b2334cd4b90d05d9163891',
         $old$  if not found or a.team_id is null then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;$old$,
         $new$  if not found or a.team_id is null then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;
  -- «Ограничения» записей (03.10): работу старше окна он не видит и не удаляет.
  if public.member_record_hidden(a.kind, a.team_id, a.date) then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;$new$),
        ('public.member_appointment_copy(uuid, text, text, text, uuid)', '04d494236db8a72cb88e67d7fa44b3da',
         $old$     or not public.member_sees_calendar(s.team_id) then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;$old$,
         $new$     or not public.member_sees_calendar(s.team_id) then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;
  -- «Ограничения» записей (03.10): старую работу он не видит и не копирует.
  if public.member_record_hidden(s.kind, s.team_id, s.date) then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;$new$)
      ) as v(fn, expected, old_part, new_part)
  loop
    -- Сумма сверяется до первой правки функции (вторая правка той же функции
    -- идёт по уже изменённому телу и сверки не требует).
    if patch.expected is not null then
      select md5(prosrc) into actual from pg_proc where oid = patch.fn::regprocedure;
      if actual is distinct from patch.expected then
        raise exception '% изменилась после 03.10 — перечитать тело перед правкой', patch.fn;
      end if;
    end if;
    def := pg_get_functiondef(patch.fn::regprocedure);
    if (length(def) - length(replace(def, patch.old_part, ''))) / length(patch.old_part) <> 1 then
      raise exception '% — якорь не найден ровно один раз', patch.fn;
    end if;
    execute replace(def, patch.old_part, patch.new_part);
  end loop;
end
$migration$;

-- ─── 4. Сторож ───

do $guard$
declare
  fn text;
begin
  if not exists (select 1 from public.access_blocks where key = 'calendar.window' and live) then
    raise exception 'сторож: права «Ограничения» записей нет в реестре';
  end if;
  foreach fn in array array[
    'public.member_record_window_start(text)',
    'public.member_record_hidden(text, text, text)',
    'public.member_record_window_starts()'
  ] loop
    if has_function_privilege('anon', fn, 'execute')
       or has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'сторож: % открыта снаружи', fn;
    end if;
  end loop;
  foreach fn in array array[
    'public.list_master_appointments_safe(integer, integer)',
    'public.current_user_can_access_appointment(uuid)',
    'public.member_appointment_update(uuid, jsonb)',
    'public.member_appointment_delete(uuid)',
    'public.member_appointment_copy(uuid, text, text, text, uuid)'
  ] loop
    if position('member_record_' in (select prosrc from pg_proc where oid = fn::regprocedure)) = 0 then
      raise exception 'сторож: % не держит окно записей', fn;
    end if;
    if has_function_privilege('anon', fn, 'execute') then
      raise exception 'сторож: % открылась anon', fn;
    end if;
  end loop;
end
$guard$;
