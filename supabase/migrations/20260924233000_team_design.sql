-- «ДИЗАЙН» И ТИПЫ СОБЫТИЙ — У КАЖДОЙ КОМАНДЫ (владелец 2026-09-24: «у нас всё
-- отдельно под каждую команду, нет ничего общего»; «дизайн и типы событий у
-- каждой команды — подтверждаю»).
--
-- 1. `team_design` — одна строка на команду: как красятся записи (правило,
--    палитра «чего не хватает», запасной цвет) и какие блоки есть у формы
--    записи и события. Раньше это лежало одной строкой на компанию в
--    `calendar_settings` (цвета) и в `disabled_features` (блоки записи).
--    Читают все члены компании (форма мастера показывает те же блоки),
--    правит владелец — как настройки календаря.
-- 2. `personal_event_types.team_id` — тип события принадлежит команде.
--    Политики «по автору» (created_by = auth.uid()) заменены правилом меток
--    дня: читают члены компании, правят владелец и диспетчер.
--
-- Данные: у каждой из команд строка `team_design` получает текущие цвета
-- компании; выключенные блоки записи переносятся из `disabled_features`.
-- Типов событий в базе 0 (заготовки сняты 24.09) — переносить нечего.

create table if not exists public.team_design (
  tenant_id uuid not null,
  team_id text not null,
  record_color_rule text not null default 'team',
  record_color_palette jsonb,
  record_color_fallback text,
  disabled_blocks text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (tenant_id, team_id),
  constraint team_design_team_fk foreign key (tenant_id, team_id)
    references public.teams (tenant_id, id) on delete cascade,
  constraint team_design_rule_check
    check (record_color_rule in ('team', 'label', 'service')),
  constraint team_design_blocks_known check (
    disabled_blocks <@ array[
      'record_label', 'record_object', 'record_payment', 'record_note', 'record_files',
      'event_label', 'event_type', 'event_client', 'event_object', 'event_note', 'event_files'
    ]::text[]
  )
);

alter table public.team_design enable row level security;
revoke all on public.team_design from anon;

drop policy if exists team_design_select on public.team_design;
create policy team_design_select on public.team_design
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) is not null
  );

drop policy if exists team_design_write_owner on public.team_design;
create policy team_design_write_owner on public.team_design
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'owner'
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'owner'
  );

insert into public.team_design (
  tenant_id, team_id, record_color_rule, record_color_palette,
  record_color_fallback, disabled_blocks
)
select
  t.tenant_id,
  t.id,
  coalesce(cs.record_color_rule, 'team'),
  cs.record_color_palette,
  cs.record_color_fallback,
  coalesce(
    array(
      select b from unnest(array[
        case when 'record_label' = any(cs.disabled_features) then 'record_label' end,
        case when 'objects' = any(cs.disabled_features) then 'record_object' end,
        case when 'record_payment' = any(cs.disabled_features) then 'record_payment' end,
        case when 'record_note' = any(cs.disabled_features) then 'record_note' end,
        case when 'record_files' = any(cs.disabled_features) then 'record_files' end
      ]) as b
      where b is not null
    ),
    '{}'
  )
from public.teams t
left join public.calendar_settings cs on cs.tenant_id = t.tenant_id
on conflict (tenant_id, team_id) do nothing;

-- ── Типы событий — у команды ──
alter table public.personal_event_types add column if not exists team_id text;
delete from public.personal_event_types where team_id is null;
alter table public.personal_event_types alter column team_id set not null;
alter table public.personal_event_types
  drop constraint if exists personal_event_types_team_fk;
alter table public.personal_event_types
  add constraint personal_event_types_team_fk foreign key (tenant_id, team_id)
    references public.teams (tenant_id, id) on delete cascade;
create index if not exists personal_event_types_team_idx
  on public.personal_event_types (tenant_id, team_id);

drop policy if exists personal_event_types_select on public.personal_event_types;
drop policy if exists personal_event_types_insert on public.personal_event_types;
drop policy if exists personal_event_types_update on public.personal_event_types;
drop policy if exists personal_event_types_delete on public.personal_event_types;

create policy personal_event_types_select on public.personal_event_types
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) is not null
  );

create policy personal_event_types_write on public.personal_event_types
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = any (array['owner', 'dispatcher'])
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = any (array['owner', 'dispatcher'])
  );
