-- ЧЕРНОВИК, НЕ НАКАЧЕН. ЦИФРА НА ЗНАЧКЕ ПРИЛОЖЕНИЯ: НОВОЕ ЗА ДЕНЬ.
--
-- Каждый пуш о делах команды (`push_activity`) прибавляет человеку единицу и
-- несёт итог в `badge` — iPhone рисует его на значке. Счёт — за местный день:
-- первый пуш нового дня начинает с единицы. Открыл календарь — приложение
-- зовёт `reset_push_badge()` и гасит значок. Сводки цифру не трогают: это не
-- новость, а план.

create table if not exists public.push_badges (
  user_id uuid primary key references auth.users (id) on delete cascade,
  day date not null,
  count integer not null default 0 check (count >= 0)
);

alter table public.push_badges enable row level security;
revoke all on public.push_badges from public, anon, authenticated;

-- Прибавить и вернуть итог. Зовёт только функция `push_activity` ключом сервиса.
create or replace function public.push_badge_bump(p_user uuid, p_by integer, p_day date)
returns integer
language sql
security definer
set search_path = public
as $function$
  insert into public.push_badges as b (user_id, day, count)
  values (p_user, p_day, greatest(p_by, 0))
  on conflict (user_id) do update
     set count = case when b.day = excluded.day then b.count + excluded.count else excluded.count end,
         day = excluded.day
  returning count;
$function$;

-- Открыл календарь — новое прочитано.
create or replace function public.reset_push_badge()
returns void
language sql
security definer
set search_path = public
as $function$
  update public.push_badges set count = 0 where user_id = auth.uid();
$function$;

revoke all on function public.push_badge_bump(uuid, integer, date) from public, anon, authenticated;
grant execute on function public.push_badge_bump(uuid, integer, date) to service_role;
revoke all on function public.reset_push_badge() from public, anon;
grant execute on function public.reset_push_badge() to authenticated;

do $guard$
begin
  if has_function_privilege('authenticated', 'public.push_badge_bump(uuid,integer,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.push_badge_bump(uuid,integer,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.reset_push_badge()', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.push_badges', 'SELECT') then
    raise exception 'push_badge: client-callable helper or table';
  end if;
end;
$guard$;
