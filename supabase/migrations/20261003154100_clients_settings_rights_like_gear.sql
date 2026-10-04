-- ПРАВА «НАСТРОЕК КЛИЕНТОВ» — КАК ШЕСТЕРЁНКА (владелец 03.10: «теперь
-- настройки клиентов, то есть шестерёнка» — вслед за «Карточкой клиента»,
-- где права идут ровно блоками страницы).
--
-- Шестерёнка «Клиентов» с 03.10: «Клиент» — «Блоки клиентов», «Связь»;
-- «Объекты» — «Типы объектов», «Карты для маршрута»; «Справочники» — «Теги»,
-- «Источники». У каждой строки шестерёнки — своё право (владелец 01.10: «по
-- строке на каждую строку шестерёнки»):
--
--   1. Названия прав — словами шестерёнки: «Блоки клиентов» (было «Карточка
--      клиента»), «Связь» («Способы связи»), «Теги» («Теги клиентов»).
--   2. Порядок реестра — порядок шестерёнки: «Типы объектов» перед «Картами».
--   3. «Источники» — своё право `clients.settings_sources`. До сих пор свои
--      источники команды правились правом тегов (`client_sources`, 03.10);
--      теперь — своим. Каждому, у кого стоит право тегов, «Источники»
--      ставятся тем же положением — никто молча не теряет правки (сегодня
--      таких строк нет).

set local lock_timeout = '5s';

-- ─── 1. Названия ─────────────────────────────────────────────────────────

update public.access_blocks set title_ru = 'Блоки клиентов' where key = 'clients.settings_card';
update public.access_blocks set title_ru = 'Связь' where key = 'clients.settings_ways';
update public.access_blocks set title_ru = 'Теги' where key = 'clients.settings_tags';

-- ─── 2. Порядок ──────────────────────────────────────────────────────────

update public.access_blocks set position = 247 where key = 'clients.settings_objects';
update public.access_blocks set position = 248 where key = 'clients.settings_maps';

-- ─── 3. «Источники» — своё право ─────────────────────────────────────────

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values (
  'clients.settings_sources', 'clients', 'calendar', array['off', 'read', 'write'], 'Источники', false, true,
  array['policy:public.client_sources.client_sources_write_settings'], 250
)
on conflict (key) do nothing;

insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
select ma.tenant_id, ma.user_id, 'clients.settings_sources', ma.team_id, ma.level, ma.set_by, ma.set_at
  from public.member_access ma
 where ma.block = 'clients.settings_tags'
on conflict (tenant_id, user_id, block, team_id) do nothing;

alter policy client_sources_write_settings
  on public.client_sources
  using (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('clients.settings_sources', 'write')))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('clients.settings_sources', 'write')))
  );
