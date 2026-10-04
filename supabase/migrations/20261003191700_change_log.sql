-- «ИСТОРИЯ ИЗМЕНЕНИЙ» — ЖУРНАЛ ВСЕГО, ЧТО МЕНЯЮТ В АККАУНТЕ (владелец 03.10:
-- «любое изменение записывается в историю… чётко отслеживать, что делаю я и
-- что делает каждый из моих партнёров»).
--
-- Одна таблица `change_log`, одна функция-триггер `log_change()` на
-- главных таблицах. Строка журнала — кто (`actor_id` + имя на тот момент),
-- что (`entity` — таблица, `action`), над чем (`entity_id`, `label` — имя
-- предмета на тот момент, `meta` — дата и сумма для подписи), в каком
-- календаре (`team_id`) и какие поля как поменялись (`changes`:
-- {"поле": [было, стало]}).
--
-- ПРАВИЛА:
-- • Журнал НИКОГДА не ломает правку: любая ошибка внутри триггера
--   проглатывается, строка просто не пишется.
-- • Пишется только верхний уровень (`pg_trigger_depth() = 1`): засев
--   источников новой команды, служебные пересчёты другими триггерами — не
--   пишутся; удаление календаря (`calendar_delete_in_progress()`) оставляет
--   одну строку «Календарь удалён», а не сотни.
-- • Правка без смысла (только `updated_at` и служебные поля) не пишется.
-- • Мягкое удаление (`deleted_at`) — это «удалён», снятие — «возвращён».
-- • Большие значения (списки, объекты) не копируются: поле помечается
--   «изменено» (`"*"`), текст режется до 120 знаков.
-- • Без входа (сервер, cron) — автор пустой: «Система».
--
-- ЧИТАЕТ владелец — весь журнал аккаунта; остальные — только свои строки.
-- Пишет только триггер. Хранится год (cron чистит старше 365 дней).

set local lock_timeout = '5s';

create table if not exists public.change_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  team_id text,
  actor_id uuid,
  actor_name text,
  entity text not null,
  entity_id text,
  action text not null check (action in ('insert', 'update', 'delete', 'restore')),
  label text,
  meta jsonb,
  changes jsonb,
  created_at timestamptz not null default now()
);

create index if not exists change_log_tenant_time on public.change_log (tenant_id, created_at desc);
create index if not exists change_log_actor_time on public.change_log (tenant_id, actor_id, created_at desc);
create index if not exists change_log_team_time on public.change_log (tenant_id, team_id, created_at desc);

alter table public.change_log enable row level security;

drop policy if exists change_log_select on public.change_log;
create policy change_log_select on public.change_log
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or actor_id = (select auth.uid())
    )
  );

revoke all on public.change_log from anon, authenticated;
grant select on public.change_log to authenticated;

-- Имя человека — та же формула, что у «Партнёров» (`list_members`).
create or replace function public.change_log_person_name(p_tenant uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
           nullif(btrim(m.full_name), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
           split_part(u.email, '@', 1)
         )
    from auth.users u
    left join public.tenant_members tm on tm.tenant_id = p_tenant and tm.user_id = u.id
    left join public.masters m on m.tenant_id = p_tenant and m.id = tm.master_id
   where u.id = p_user
   limit 1;
$$;

revoke all on function public.change_log_person_name(uuid, uuid) from public, anon, authenticated;

create or replace function public.log_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_before jsonb;
  v_after jsonb;
  v_action text := lower(tg_op);
  v_tenant uuid;
  v_team text;
  v_entity_id text;
  v_label text;
  v_meta jsonb;
  v_actor uuid := auth.uid();
  v_ignore constant text[] := array[
    'updated_at', 'created_at', 'purge_at', 'access_version', 'set_at', 'set_by',
    'attached_at', 'attached_by', 'pinned_at', 'phone_e164', 'position'
  ];
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  -- Удаление календаря стирает его записи и настройки по одной — в журнале
  -- остаётся только сам «Календарь удалён».
  if tg_table_name <> 'teams' and public.calendar_delete_in_progress() then
    return null;
  end if;

  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new, v_old);

  if tg_op = 'UPDATE' then
    -- Мягкое удаление и возврат — отдельные действия, а не «изменено».
    if v_new ? 'deleted_at'
       and (v_old ->> 'deleted_at') is null and (v_new ->> 'deleted_at') is not null then
      v_action := 'delete';
    elsif v_new ? 'deleted_at'
       and (v_old ->> 'deleted_at') is not null and (v_new ->> 'deleted_at') is null then
      v_action := 'restore';
    else
      for v_key in select jsonb_object_keys(v_new) loop
        continue when v_key = any(v_ignore) or v_key = 'deleted_at';
        v_before := v_old -> v_key;
        v_after := v_new -> v_key;
        continue when v_before is not distinct from v_after;
        if jsonb_typeof(v_before) in ('object', 'array') or jsonb_typeof(v_after) in ('object', 'array') then
          v_changes := v_changes || jsonb_build_object(v_key, '"*"'::jsonb);
        else
          if jsonb_typeof(v_before) = 'string' then v_before := to_jsonb(left(v_before #>> '{}', 120)); end if;
          if jsonb_typeof(v_after) = 'string' then v_after := to_jsonb(left(v_after #>> '{}', 120)); end if;
          v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_array(v_before, v_after));
        end if;
      end loop;
      if v_changes = '{}'::jsonb then
        return null;
      end if;
    end if;
  end if;

  v_tenant := (v_row ->> 'tenant_id')::uuid;
  v_team := coalesce(
    v_row ->> 'team_id',
    v_row ->> 'brigade_id',
    case when tg_table_name = 'teams' then v_row ->> 'id' end
  );
  v_entity_id := coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'team_id');

  -- Имя предмета на тот момент и короткая подпись (дата, сумма).
  case tg_table_name
    when 'appointments' then
      v_label := coalesce(
        (select c.full_name from public.clients c where c.id = (v_row ->> 'client_id')::uuid),
        nullif(btrim(v_row ->> 'comment'), '')
      );
      v_meta := jsonb_build_object(
        'kind', v_row ->> 'kind',
        'date', v_row ->> 'date',
        'time', v_row ->> 'time_start'
      );
    when 'finance_transactions' then
      v_label := coalesce(
        (select fc.name from public.finance_categories fc where fc.id = (v_row ->> 'category_id')::uuid),
        nullif(btrim(v_row ->> 'notes'), '')
      );
      v_meta := jsonb_build_object('type', v_row ->> 'type', 'amount', v_row -> 'amount', 'date', v_row ->> 'occurred_on');
    when 'debts' then
      v_label := coalesce(
        (select c.full_name from public.clients c where c.id = (v_row ->> 'client_id')::uuid),
        nullif(btrim(v_row ->> 'counterparty'), '')
      );
      v_meta := jsonb_build_object('direction', v_row ->> 'direction', 'amount', v_row -> 'amount');
    when 'invoices' then
      v_label := v_row ->> 'number';
      v_meta := jsonb_build_object('kind', v_row ->> 'kind', 'amount', v_row -> 'total');
    when 'receipts' then
      v_label := v_row ->> 'number';
      v_meta := jsonb_build_object('amount', v_row -> 'amount');
    when 'member_access', 'member_calendars', 'tenant_members' then
      v_label := public.change_log_person_name(v_tenant, (v_row ->> 'user_id')::uuid);
      v_meta := jsonb_strip_nulls(jsonb_build_object(
        'block', v_row ->> 'block',
        'level', v_row ->> 'level',
        'role', v_row ->> 'role'
      ));
    when 'invitations' then
      v_label := coalesce(nullif(btrim(v_row ->> 'full_name'), ''), v_row ->> 'email', v_row ->> 'phone');
    when 'team_design', 'team_schedules' then
      v_label := (select t.name from public.teams t where t.tenant_id = v_tenant and t.id = v_team);
    when 'personal_event_types' then
      v_label := v_row ->> 'label';
    else
      v_label := coalesce(v_row ->> 'name', v_row ->> 'full_name', v_row ->> 'label', v_row ->> 'number');
  end case;

  insert into public.change_log (
    tenant_id, team_id, actor_id, actor_name, entity, entity_id, action, label, meta, changes
  ) values (
    v_tenant,
    v_team,
    v_actor,
    case when v_actor is null then null else public.change_log_person_name(v_tenant, v_actor) end,
    tg_table_name,
    v_entity_id,
    v_action,
    left(v_label, 120),
    v_meta,
    case when v_changes = '{}'::jsonb then null else v_changes end
  );
  return null;
exception when others then
  -- Журнал не имеет права уронить правку.
  return null;
end;
$$;

revoke all on function public.log_change() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'appointments', 'clients', 'finance_transactions', 'debts', 'invoices', 'receipts',
    'teams', 'accounts', 'services', 'cities', 'client_tags', 'client_sources',
    'location_labels', 'finance_categories', 'personal_event_types',
    'member_access', 'member_calendars', 'tenant_members', 'invitations',
    'team_design', 'team_schedules'
  ] loop
    execute format('drop trigger if exists zz_log_change on public.%I', t);
    execute format(
      'create trigger zz_log_change after insert or update or delete on public.%I
         for each row execute function public.log_change()',
      t
    );
  end loop;
end;
$$;

-- Год истории; старше — чистит ночной cron.
select cron.unschedule(jobid) from cron.job where jobname = 'change_log_purge';
select cron.schedule(
  'change_log_purge',
  '17 3 * * *',
  $$delete from public.change_log where created_at < now() - interval '365 days'$$
);
