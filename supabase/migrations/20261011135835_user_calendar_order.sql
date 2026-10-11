-- ПОРЯДОК КАЛЕНДАРЕЙ В ЛЕНТЕ — У ЧЕЛОВЕКА (владелец 11.10: «нужно, чтоб можно
-- менять местами календари»). Лента над календарём и финансами показывает
-- календари всех аккаунтов человека («Личный», «Y&D», чужие команды), поэтому
-- порядок — его, а не компании: одна строка на человека, как скрытые
-- календари (`user_hidden_calendars`), и одна по обе стороны перехода между
-- аккаунтами. Ключ календаря — «<tenant_id>:<team_id>»; неизвестные ключи
-- приложение пропускает, новые календари встают в конец.

create table if not exists public.user_calendar_order (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  calendars text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.user_calendar_order enable row level security;

create policy user_calendar_order_select on public.user_calendar_order
  for select to authenticated using (user_id = (select auth.uid()));
create policy user_calendar_order_insert on public.user_calendar_order
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy user_calendar_order_update on public.user_calendar_order
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy user_calendar_order_delete on public.user_calendar_order
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.user_calendar_order from anon;
grant select, insert, update, delete on public.user_calendar_order to authenticated;
