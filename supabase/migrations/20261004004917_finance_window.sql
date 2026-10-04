-- «ОГРАНИЧЕНИЯ» ФИНАНСОВ (владелец 03.10: «ограничения… чтоб он видел доход
-- расход определённое время»).
--
-- Новое право команды `finance.window` — «Ограничения» в блоке «Главное»
-- страницы «Финансы»: Неделя · 2 недели · Месяц · 3 месяца · Полгода · Без
-- ограничения — та же шкала и те же окна, что у клиентов и записей
-- календаря. Партнёр видит доходы, возвраты и расходы команды только с
-- `сегодня − окно` (день бизнеса); старше — их для него нет.
--
-- Не режется (решения сессии 016):
--   • платежи по долгам (`debt_id`): по ним считается остаток долга — без
--     старых платежей долг выглядел бы неоплаченным;
--   • переводы между счетами — это «Счета», не доход и расход;
--   • владелец — всегда всё.
-- Умолчание нового партнёра — «Неделя», как у клиентов и календаря;
-- нынешним партнёрам засеяно «Без ограничения» — сегодня у них ничего не
-- пропадает.
--
-- Где держится: ограничительная политика чтения `finance_transactions`
-- (RESTRICTIVE поверх всех разрешающих) — её же проходят правка и удаление
-- строки, которой не видно.

set local lock_timeout = '5s';

-- ─── 1. Право в реестре ───

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values (
  'finance.window', 'finance', 'calendar',
  array['week', 'near', 'month', 'quarter', 'half', 'own'],
  'Ограничения', false, true,
  array[
    'policy:finance_transactions_window',
    'function:public.member_finance_window_starts()'
  ],
  107
);

-- Нынешним партнёрам — «Без ограничения» в каждом их календаре.
insert into public.member_access (tenant_id, user_id, block, team_id, level)
select mc.tenant_id, mc.user_id, 'finance.window', mc.team_id, 'own'
  from public.member_calendars mc
  join public.tenant_members tm
    on tm.tenant_id = mc.tenant_id and tm.user_id = mc.user_id
 where tm.role <> 'owner'
on conflict do nothing;

-- ─── 2. Окно ───

-- С какого дня партнёру видны доходы и расходы каждой его команды:
-- { team_id: 'YYYY-MM-DD' }; команды без ограничения в ответ не входят.
-- Неизвестная ступень — «Неделя». Владельцу — пусто.
create function public.member_finance_window_starts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(jsonb_object_agg(t.team_id, t.start), '{}'::jsonb)
    from (
      select x.team_id,
             case l.level
               when 'own' then null
               when 'all' then null
               else (public.tenant_business_date(public.current_tenant_id()) - case l.level
                       when 'near' then interval '14 days'
                       when 'month' then interval '1 month'
                       when 'quarter' then interval '3 months'
                       when 'half' then interval '6 months'
                       else interval '7 days'
                     end)::date::text
             end as start
        from (
          select distinct unnest(
            public.access_calendars('finance.income', 'read')
            || public.access_calendars('finance.expense', 'read')
          ) as team_id
        ) x
        cross join lateral (
          select public.access_team_level(public.current_tenant_id(), auth.uid(), 'finance.window', x.team_id) as level
        ) l
       where auth.uid() is not null
         and public.current_user_role() = 'master'
    ) t
   where t.start is not null
$function$;

-- Её зовёт политика от лица читающего — `authenticated` нужен, `anon` — нет.
revoke all on function public.member_finance_window_starts() from public, anon;
grant execute on function public.member_finance_window_starts() to authenticated;

-- ─── 3. Политика ───

-- Окно считается один раз на запрос (скалярный подзапрос — память
-- «SECURITY DEFINER в политиках»), дальше — поиск по ключу команды.
create policy finance_transactions_window
  on public.finance_transactions
  as restrictive
  for select
  to authenticated
  using (
    (select public.current_user_role()) is distinct from 'master'
    or type not in ('income', 'refund', 'expense')
    or debt_id is not null
    or occurred_on >= coalesce(((select public.member_finance_window_starts()) ->> team_id)::date, '-infinity'::date)
  );

-- ─── 4. Сторож ───

do $guard$
begin
  if not exists (select 1 from public.access_blocks where key = 'finance.window' and live) then
    raise exception 'сторож: права «Ограничения» финансов нет в реестре';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'finance_transactions'
       and policyname = 'finance_transactions_window' and permissive = 'RESTRICTIVE' and cmd = 'SELECT'
  ) then
    raise exception 'сторож: ограничительной политики окна финансов нет';
  end if;
  if has_function_privilege('anon', 'public.member_finance_window_starts()', 'execute')
     or not has_function_privilege('authenticated', 'public.member_finance_window_starts()', 'execute') then
    raise exception 'сторож: права исполнения окна финансов не те';
  end if;
end
$guard$;
