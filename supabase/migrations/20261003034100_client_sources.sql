-- «ИСТОЧНИКИ» — СВОИ У КОМАНДЫ (владелец 03.10: «используй источник, с учётом
-- что они могут самостоятельно добавить источник»).
--
-- Восемь готовых вариантов («Рекомендация», «Instagram», «WhatsApp»…) остаются
-- в приложении. Сверху команда заводит свои («Bazaraki», «Facebook», имя
-- партнёра) — строками этой таблицы. Клиент хранит выбор в прежнем текстовом
-- поле `clients.acquisition_source`: готовый — ключом («instagram»), свой —
-- `src:<id>`. Колонки клиента не меняются, поэтому маски полей, списки
-- разрешённых полей правки и выгрузка работают как были. Удалённый свой
-- источник у клиента читается как «Другое».
--
-- Права — как у тегов: читают те, кому открыты клиенты компании; правят
-- владелец и сотрудник с правом «Справочники» в этой команде
-- (`clients.settings_tags`).

set local lock_timeout = '5s';

create table if not exists public.client_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  team_id text not null,
  name text not null check (length(btrim(name)) between 1 and 60),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint client_sources_team_fk foreign key (tenant_id, team_id)
    references public.teams (tenant_id, id) on delete cascade
);

create unique index if not exists client_sources_team_name
  on public.client_sources (tenant_id, team_id, lower(btrim(name)));
create index if not exists client_sources_tenant on public.client_sources (tenant_id);

alter table public.client_sources enable row level security;

drop policy if exists client_sources_select_access on public.client_sources;
create policy client_sources_select_access on public.client_sources
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or (select public.access_company('clients', 'read'))
    )
  );

drop policy if exists client_sources_modify_owner on public.client_sources;
create policy client_sources_modify_owner on public.client_sources
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'owner'
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'owner'
  );

drop policy if exists client_sources_write_settings on public.client_sources;
create policy client_sources_write_settings on public.client_sources
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('clients.settings_tags', 'write')))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('clients.settings_tags', 'write')))
  );

revoke all on public.client_sources from anon;
grant select, insert, update, delete on public.client_sources to authenticated;
