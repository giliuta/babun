-- УВЕДОМЛЕНИЯ — НА КАЖДУЮ КОМАНДУ (владелец 03.10: «когда добавляется новая
-- команда, мы настраиваем уведомления чётко на эту команду, вот и всё»).
--
-- Строка — один человек × одна команда: что ему напоминать и о чём сообщать
-- в этой команде. Живёт в базе, а не на телефоне: на втором телефоне те же
-- настройки, и серверный пуш (когда появится ключ Apple) возьмёт их же.
-- Строки нет — умолчания столбцов: о записях не напоминать, о клиентах в
-- 09:00, сообщать о новых, изменениях и отменах, об оплатах — нет, бюджет —
-- да.
--
-- Видит и правит человек только свои строки. Команда — любая, где он
-- состоит в аккаунте (своя или открытая ему другим аккаунтом).

set local lock_timeout = '5s';

create table if not exists public.team_notification_prefs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tenant_id uuid not null,
  team_id text not null,
  record_reminder jsonb,
  client_reminder_time text default '09:00'
    check (client_reminder_time is null or client_reminder_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  notify_new boolean not null default true,
  notify_change boolean not null default true,
  notify_cancel boolean not null default true,
  notify_payment boolean not null default false,
  budget boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, tenant_id, team_id),
  constraint team_notification_prefs_team_fk foreign key (tenant_id, team_id)
    references public.teams (tenant_id, id) on delete cascade
);

alter table public.team_notification_prefs enable row level security;

drop policy if exists team_notification_prefs_own on public.team_notification_prefs;
create policy team_notification_prefs_own on public.team_notification_prefs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.tenant_members tm
       where tm.tenant_id = team_notification_prefs.tenant_id
         and tm.user_id = (select auth.uid())
    )
  );

revoke all on public.team_notification_prefs from anon;
grant select, insert, update, delete on public.team_notification_prefs to authenticated;
