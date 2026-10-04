-- СВЯЗИ «ЛЮДИ» ПЕРЕЖИВАЮТ КОРЗИНУ (03.10, сессия 017, аудит клиентов).
--
-- Было: `clients_detach_memberships_archived` (AFTER UPDATE OF deleted_at,
-- STORY-086 «дыра 4») снимал id карточки-группы из `memberships` всех её
-- людей в тот же миг, как карточку убирали в «Удалённые клиенты». Триггер
-- заводили, когда «архив» был отдельной полкой без возврата. Сейчас «Удалить»
-- обещает словами «до этого его можно вернуть», а «Отменить» в тосте и
-- «Вернуть» из корзины приносили карточку БЕЗ людей: у управляющей пять
-- жильцов — после «Удалить → Отменить» блок «Люди» пуст, у жильцов строки
-- «жилец · …» исчезли, и вернуть их нечем.
--
-- Стало:
--   • мягкое удаление связи НЕ трогает — карточка в корзине со всеми людьми,
--     «Отменить» и «Вернуть» возвращают её целиком;
--   • экран связь на карточку, которой нет в списке, и так не рисует
--     (`linkLine` в `use-client-links.ts`: «жилец · (никого)» не строка);
--   • сторож `enforce_client_memberships` такую связь при правке человека
--     сохраняет (строка группы существует), а новых целей сотруднику в корзине
--     не видно — их отсекает проверка набора;
--   • НАСТОЯЩЕЕ стирание (ночная чистка корзины, «Удалить насовсем»)
--     по-прежнему снимает связи: `clients_detach_memberships_deleted`
--     (AFTER DELETE) остаётся на месте.
--
-- Уже снятые до этой миграции связи не восстанавливаются: их следа нет.

drop trigger if exists clients_detach_memberships_archived on public.clients;

do $guard$
declare
  v_def text;
begin
  if exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where c.relname = 'clients'
       and c.relnamespace = 'public'::regnamespace
       and t.tgname = 'clients_detach_memberships_archived'
       and not t.tgisinternal
  ) then
    raise exception 'client links: мягкое удаление всё ещё снимает связи';
  end if;

  select pg_get_triggerdef(t.oid) into v_def
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
   where c.relname = 'clients'
     and c.relnamespace = 'public'::regnamespace
     and t.tgname = 'clients_detach_memberships_deleted'
     and not t.tgisinternal;
  if v_def is null or position('AFTER DELETE' in v_def) = 0
     or position('detach_client_memberships' in v_def) = 0 then
    raise exception 'client links: настоящее стирание больше не снимает связи (%)', v_def;
  end if;
end;
$guard$;
