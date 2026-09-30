-- ПРИГЛАШЕНИЕ В ОДИН КАЛЕНДАРЬ ТЕПЕРЬ И ПРАВДА СУЖАЕТ ДОСТУП.
--
-- НАЙДЕНО АДВЕРСАРНОЙ ПРОВЕРКОЙ СОСЕДНЕЙ СЕССИИ, дефект мой, и он хуже всего,
-- что чинилось за день: ПРОДУКТ ОБЕЩАЛ ТО, ЧЕГО НЕ ДЕЛАЛ.
--
-- Вчера приглашение научилось звать в конкретный календарь, а экран подписал
-- альтернативу словами «Все календари · видит всю компанию, как раньше» — то
-- есть прямо пообещал владельцу, что выбор календаря доступ СУЖАЕТ. Выключатель
-- «есть выданное право — ветка роли гаснет» при этом жил ровно в двух функциях
-- списков. В ПОЛИТИКАХ его не было: они короткозамыкались на роль.
--
-- ЧЕМ ЭТО МЕРЯЕТСЯ. Прогон на боевой в rollback: человек, приглашённый
-- диспетчером в ОДНУ «Команду 1» Giliuta, видел в ленте ОДИН календарь — и при
-- этом 18 записей, из них 16 из календарей, куда его не звали, плюс всю
-- клиентскую базу с телефонами. Он же мог их править и удалять. Владелец об
-- этом не узнал бы никогда: экран говорит обратное.
--
-- Не выстрелило только потому, что в боевой базе НЕТ НИ ОДНОГО диспетчера.
-- Сработало бы на первом же приглашении.
--
-- ЧТО ДЕЛАЕМ. Тот же выключатель, что в списках, ставится в политики записей и
-- клиентов: ветка роли работает, только пока у человека НЕТ НИ ОДНОЙ строки
-- прав в этой компании. Появилась — доступ считается ровно по выданным
-- календарям.
--
-- ВЛАДЕЛЕЦ ВЫНЕСЕН В ОТДЕЛЬНУЮ ВЕТКУ, И ЭТО НЕ КОСМЕТИКА. Перенос 12.09 выдал
-- владельцу строки прав на все существовавшие тогда календари. Если бы
-- выключатель гасил и его ветку, владелец потерял бы доступ к КАЖДОМУ
-- календарю, созданному после переноса: строки прав на него нет, а роль уже
-- погашена. Владелец не ограничивается правами никогда — он их выдаёт.
--
-- КЛИЕНТЫ СУЖАЮТСЯ ПО РАБОТЕ, а не по отдельной связи: клиент виден, если у
-- него есть запись в одном из моих календарей. Это ровно то, что владелец
-- описывал словами «база одна, но мастер не должен видеть её целиком, а
-- историю клиента по своим календарям видеть должен». Отдельная таблица связи
-- «клиент↔календарь» — следующий шаг; пока её нет, работа сама и есть связь.
-- Право `clients` при этом впервые становится ЖИВЫМ: без него список пуст.
--
-- ПРОГНАНО НА БОЕВОЙ В `begin/rollback`, три роли до и после:
--   владелец                     18 записей / 5 клиентов → 18 / 5  (не тронут)
--   мастер с правом на календарь  2 записей / 0 клиентов →  2 / 0  (не тронут)
--   диспетчер в ОДИН календарь   18 записей / 5 клиентов →  2 / 2
--     из них из чужих календарей         16 →  0

create or replace function public.current_user_has_calendar_grants()
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1 from public.calendar_members cm
     where cm.tenant_id = public.current_tenant_id()
       and cm.user_id = auth.uid()
  )
$function$;

comment on function public.current_user_has_calendar_grants() is
  'Есть ли у человека хоть одна строка прав в активной компании. Пока нет — '
  'доступ считается по роли, как до перехода на календари; появилась — ветка '
  'роли гаснет, и доступ считается ровно по выданным календарям. Владельца не '
  'касается: он не ограничивается правами, он их выдаёт.';

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (
    (select public.current_user_role()) = 'owner'
    or ((select public.current_user_role()) = 'dispatcher'
        and not (select public.current_user_has_calendar_grants()))
    or team_id in (select unnest(public.current_user_calendar_ids('view')))
  )
  and (
    kind = 'work'
    or (kind = any(array['event','personal'])
        and (team_id is not null or created_by = auth.uid()))
  )
);

drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert on public.appointments for insert to authenticated
with check (
  tenant_id = (select public.current_tenant_id())
  and (
    (select public.current_user_role()) = 'owner'
    or ((select public.current_user_role()) = 'dispatcher'
        and not (select public.current_user_has_calendar_grants()))
    or team_id in (select unnest(public.current_user_calendar_ids('book')))
  )
  and (
    kind = 'work'
    or (kind = any(array['event','personal']) and created_by = auth.uid())
  )
);

drop policy if exists appointments_update on public.appointments;
create policy appointments_update on public.appointments for update to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (
    (select public.current_user_role()) = 'owner'
    or ((select public.current_user_role()) = 'dispatcher'
        and not (select public.current_user_has_calendar_grants()))
    or team_id in (select unnest(public.current_user_calendar_ids('edit_all')))
  )
  and (
    kind = 'work'
    or (kind = any(array['event','personal']) and created_by = auth.uid())
  )
)
with check (
  tenant_id = (select public.current_tenant_id())
  and (
    (select public.current_user_role()) = 'owner'
    or ((select public.current_user_role()) = 'dispatcher'
        and not (select public.current_user_has_calendar_grants()))
    or team_id in (select unnest(public.current_user_calendar_ids('edit_all')))
  )
  and (
    kind = 'work'
    or (kind = any(array['event','personal']) and created_by = auth.uid())
  )
);

drop policy if exists appointments_delete on public.appointments;
create policy appointments_delete on public.appointments for delete to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (
    (select public.current_user_role()) = 'owner'
    or ((select public.current_user_role()) = 'dispatcher'
        and not (select public.current_user_has_calendar_grants()))
    or team_id in (select unnest(public.current_user_calendar_ids('edit_all')))
  )
  and (
    kind = 'work'
    or (kind = any(array['event','personal']) and created_by = auth.uid())
  )
);

drop policy if exists clients_select_role_scoped on public.clients;
create policy clients_select_role_scoped on public.clients for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (
    (select public.current_user_role()) = 'owner'
    or ((select public.current_user_role()) = 'dispatcher'
        and not (select public.current_user_has_calendar_grants()))
    or id in (
      select a.client_id from public.appointments a
       where a.client_id is not null
         and a.team_id in (select unnest(public.current_user_calendar_ids('clients')))
    )
  )
);

drop policy if exists clients_update_owner_or_dispatcher on public.clients;
create policy clients_update_owner_or_dispatcher on public.clients for update to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (
    (select public.current_user_role()) = 'owner'
    or ((select public.current_user_role()) = 'dispatcher'
        and not (select public.current_user_has_calendar_grants()))
    or id in (
      select a.client_id from public.appointments a
       where a.client_id is not null
         and a.team_id in (select unnest(public.current_user_calendar_ids('clients')))
    )
  )
);

do $$
declare v_name text;
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='current_user_has_calendar_grants'
  ) then
    raise exception 'выключатель ветки роли не заведён';
  end if;

  -- СТОРОЖ ИМЕНАМИ, А НЕ ПОИСКОМ ОБРАЗЦА. Соблазн был написать «ни в одной
  -- политике записей и клиентов не встречается роль диспетчера» — и такой
  -- сторож упал бы на `clients_insert_owner_or_dispatcher`, которую здесь не
  -- трогают намеренно: завести клиента человеку с правами можно, утечки в
  -- этом нет. Широкий сторож либо ломает накат, либо его ослабляют до
  -- бессмысленного. Поэтому перечислены ровно те пять политик, которые
  -- обязаны спрашивать выключатель.
  foreach v_name in array array[
    'appointments_select','appointments_insert','appointments_update',
    'appointments_delete','clients_select_role_scoped',
    'clients_update_owner_or_dispatcher'
  ] loop
    if not exists (
      select 1 from pg_policies
       where schemaname='public'
         and policyname = v_name
         and coalesce(qual,'') || coalesce(with_check,'')
             like '%current_user_has_calendar_grants%'
    ) then
      raise exception
        'политика % снова открывает всё по роли, не спросив выданные права', v_name;
    end if;
  end loop;
end $$;
