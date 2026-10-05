-- СКРЫТЫЙ КАЛЕНДАРЬ — У ЧЕЛОВЕКА, А НЕ У КОМАНДЫ (владелец 04.10: «мне дали
-- доступ к календарю другой компании — свой „Личный“ я могу скрыть: в
-- календаре, финансах и клиентах его нет, а в настройках календаря тумблером
-- включаю обратно; скрыть можно, только когда есть другой календарь; забрали
-- доступ к другим — он сам выходит из архива»).
--
-- Строка = «этот человек не хочет видеть этот календарь в лентах». Самому
-- календарю и другим людям от неё ничего: записи, деньги, права — как были.
-- Правило «скрыть можно, только когда остаётся другой» и «последний сам
-- возвращается» живёт в приложении (`hidden-calendars.ts`): скрытие — это
-- выбор отображения, а лента и так считается на телефоне.
--
-- Видит и пишет строку только сам человек; писать можно только про календарь
-- аккаунта, где он состоит. Удалили календарь или человека из аккаунта —
-- строка уходит каскадом.

set local lock_timeout = '5s';

create table public.user_hidden_calendars (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tenant_id uuid not null,
  team_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id, team_id),
  foreign key (tenant_id, team_id) references public.teams (tenant_id, id) on delete cascade
);

alter table public.user_hidden_calendars enable row level security;

create policy user_hidden_calendars_select on public.user_hidden_calendars
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy user_hidden_calendars_insert on public.user_hidden_calendars
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.tenant_members tm
       where tm.tenant_id = user_hidden_calendars.tenant_id
         and tm.user_id = (select auth.uid())
    )
  );

create policy user_hidden_calendars_delete on public.user_hidden_calendars
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.user_hidden_calendars to authenticated;
revoke all on public.user_hidden_calendars from anon;

do $guard$
begin
  if has_table_privilege('anon', 'public.user_hidden_calendars', 'select') then
    raise exception 'сторож: скрытые календари открыты anon';
  end if;
end
$guard$;
