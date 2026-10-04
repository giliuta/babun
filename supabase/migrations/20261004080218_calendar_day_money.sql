-- ДОХОД И РАСХОД ДНЯ — ДЕНЬГИ КАЛЕНДАРЯ, А НЕ ВСЕХ ФИНАНСОВ (владелец 04.10).
--
-- «Доход/расход в календаре внизу подтягивает весь доход и весь расход со
-- страницы финансов — так не должно быть. Доход — по записям: есть запись —
-- высчитывает, нет — нет. Расход — только если внести через календарь; внесённое
-- в финансах (реклама €300) — нет. С дохода/расхода календаря обязательно
-- переносится в финансы, но с финансов обратно — нет. И это право — в доступах
-- календаря: финансы этого календаря за день, не общая картина».
--
-- 1. У операции появляется признак «внесена из календаря» (`from_calendar`).
--    Его ставит кнопка листа «Финансы дня»; лента «Финансов» — нет. День
--    календаря считает деньги записей и такие операции. Возврат наследует
--    признак своего дохода.
-- 2. Право календаря `calendar.day_money` — «Доход и расход дня»: Скрыты ·
--    Видит · Вносит. «Видит» читает деньги записей своего календаря и операции
--    из календаря; «Вносит» — ещё и заводит, правит и удаляет СВОИ доходы и
--    расходы из календаря. Счета команды, категории и VAT-настройки команды —
--    ровно для формы операции. «Ограничения» — календаря (`calendar.window`).
-- 3. Нынешним партнёрам право засевается по их деньгам в «Финансах»: видели
--    доходы или расходы команды — «Видит», писали — «Вносит».
--
-- Прежние ручные операции (все — тестовые) признака не получают: в дне
-- календаря их больше нет, в «Финансах» они на месте.

alter table public.finance_transactions
  add column if not exists from_calendar boolean not null default false;

comment on column public.finance_transactions.from_calendar is
  'Операция внесена кнопкой «Финансы дня» календаря: день календаря считает деньги записей и такие операции (владелец 04.10).';

-- ── Возврат наследует признак своего дохода ─────────────────────────────
create or replace function public.inherit_refund_from_calendar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.refund_of_id is not null then
    select coalesce(t.from_calendar, false) into new.from_calendar
      from public.finance_transactions t
     where t.id = new.refund_of_id;
    new.from_calendar := coalesce(new.from_calendar, false);
  end if;
  return new;
end;
$$;
revoke all on function public.inherit_refund_from_calendar() from public, anon, authenticated;

drop trigger if exists trg_inherit_refund_from_calendar on public.finance_transactions;
create trigger trg_inherit_refund_from_calendar
  before insert on public.finance_transactions
  for each row execute function public.inherit_refund_from_calendar();

-- ── Право ────────────────────────────────────────────────────────────────
insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values (
  'calendar.day_money', 'calendar', 'calendar', array['off', 'read', 'write'],
  'Доход и расход дня', false, true,
  array[
    'policy:public.finance_transactions.finance_transactions_select_day_money',
    'policy:public.finance_transactions.finance_transactions_insert_day_money',
    'policy:public.finance_transactions.finance_transactions_update_day_money',
    'policy:public.finance_transactions.finance_transactions_delete_day_money',
    'policy:finance_transactions_window',
    'function:public.member_day_money_window_starts()',
    'policy:public.accounts.accounts_select',
    'policy:public.account_teams.account_teams_select_calendar',
    'policy:public.finance_categories.finance_categories_select_access',
    'policy:public.finance_category_hidden.finance_category_hidden_select_access',
    'policy:public.finance_category_order.finance_category_order_select_access',
    'policy:public.team_finance_settings.team_finance_settings_select_access'
  ],
  29
)
on conflict (key) do update
  set area = excluded.area, scope = excluded.scope, levels = excluded.levels,
      title_ru = excluded.title_ru, owner_only = excluded.owner_only,
      live = excluded.live, enforced_by = excluded.enforced_by,
      position = excluded.position;

-- Засев нынешним партнёрам: по их доходам и расходам команды.
insert into public.member_access (tenant_id, user_id, block, team_id, level)
select s.tenant_id, s.user_id, 'calendar.day_money', s.team_id,
       case when s.top >= 3 then 'write' else 'read' end
  from (
    select ma.tenant_id, ma.user_id, ma.team_id,
           max(array_position(array['off', 'read', 'write', 'full'], ma.level)) as top
      from public.member_access ma
     where ma.block in ('finance.income', 'finance.expense')
       and ma.team_id is not null
     group by ma.tenant_id, ma.user_id, ma.team_id
  ) s
 where s.top >= 2
on conflict do nothing;

-- ── «Ограничения» денег дня — окно календаря ─────────────────────────────
create or replace function public.member_day_money_window_starts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(t.team_id, t.start), '{}'::jsonb)
    from (
      select x.team_id, public.member_record_window_start(x.team_id) as start
        from (
          select distinct unnest(public.access_calendars('calendar.day_money', 'read')) as team_id
        ) x
       where auth.uid() is not null
         and public.current_user_role() = 'master'
    ) t
   where t.start is not null
$$;
revoke all on function public.member_day_money_window_starts() from public, anon;
grant execute on function public.member_day_money_window_starts() to authenticated;

-- ── Операции ─────────────────────────────────────────────────────────────
drop policy if exists finance_transactions_select_day_money on public.finance_transactions;
create policy finance_transactions_select_day_money on public.finance_transactions
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and type = any (array['income', 'refund', 'expense'])
    and (appointment_id is not null or from_calendar)
    and team_id in (select unnest(public.access_calendars('calendar.day_money', 'read')))
  );

drop policy if exists finance_transactions_insert_day_money on public.finance_transactions;
create policy finance_transactions_insert_day_money on public.finance_transactions
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and from_calendar
    and type = any (array['income', 'expense'])
    and team_id in (select unnest(public.access_calendars('calendar.day_money', 'write')))
    and appointment_id is null
    and invoice_id is null
    and refund_of_id is null
    and debt_id is null
    and created_by = (select auth.uid())
    and occurred_on >= coalesce(((select public.member_day_money_window_starts()) ->> team_id)::date, '-infinity'::date)
    and (account_id is null or account_id in (select unnest(public.access_accounts_for('calendar.day_money', 'write'))))
  );

drop policy if exists finance_transactions_update_day_money on public.finance_transactions;
create policy finance_transactions_update_day_money on public.finance_transactions
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and from_calendar
    and type = any (array['income', 'expense'])
    and team_id in (select unnest(public.access_calendars('calendar.day_money', 'write')))
    and appointment_id is null
    and invoice_id is null
    and refund_of_id is null
    and debt_id is null
    and created_by = (select auth.uid())
    and (account_id is null or account_id in (select unnest(public.access_accounts_for('calendar.day_money', 'write'))))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and from_calendar
    and type = any (array['income', 'expense'])
    and team_id in (select unnest(public.access_calendars('calendar.day_money', 'write')))
    and appointment_id is null
    and invoice_id is null
    and refund_of_id is null
    and debt_id is null
    and created_by = (select auth.uid())
    and occurred_on >= coalesce(((select public.member_day_money_window_starts()) ->> team_id)::date, '-infinity'::date)
    and (account_id is null or account_id in (select unnest(public.access_accounts_for('calendar.day_money', 'write'))))
  );

drop policy if exists finance_transactions_delete_day_money on public.finance_transactions;
create policy finance_transactions_delete_day_money on public.finance_transactions
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and from_calendar
    and type = any (array['income', 'expense'])
    and team_id in (select unnest(public.access_calendars('calendar.day_money', 'write')))
    and appointment_id is null
    and invoice_id is null
    and refund_of_id is null
    and debt_id is null
    and created_by = (select auth.uid())
    and (account_id is null or account_id in (select unnest(public.access_accounts_for('calendar.day_money', 'write'))))
  );

-- Окно партнёра: строка, видная по «Финансам», режется окном финансов;
-- деньги дня календаря — окном календаря. Команда без денег дня — как было.
alter policy finance_transactions_window on public.finance_transactions
  using (
    ((select public.current_user_role()) is distinct from 'master')
    or (type <> all (array['income', 'refund', 'expense']))
    or (debt_id is not null)
    or (
      not (team_id in (select unnest(public.access_calendars('calendar.day_money', 'read'))))
      and occurred_on >= coalesce(((select public.member_finance_window_starts()) ->> team_id)::date, '-infinity'::date)
    )
    or (
      team_id in (
        select unnest(public.access_calendars('finance.income', 'read') || public.access_calendars('finance.expense', 'read'))
      )
      and occurred_on >= coalesce(((select public.member_finance_window_starts()) ->> team_id)::date, '-infinity'::date)
    )
    or (
      (appointment_id is not null or from_calendar)
      and team_id in (select unnest(public.access_calendars('calendar.day_money', 'read')))
      and occurred_on >= coalesce(((select public.member_day_money_window_starts()) ->> team_id)::date, '-infinity'::date)
    )
  );

-- ── Что нужно форме операции ─────────────────────────────────────────────
alter policy accounts_select on public.accounts
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      ((select public.current_user_role()) = 'owner')
      or (brigade_id in (select unnest(public.access_calendars('finance.accounts', 'read'))))
      or (id in (select unnest(public.access_accounts_for('finance.income', 'read'))))
      or (id in (select unnest(public.access_accounts_for('finance.expense', 'read'))))
      or (id in (select unnest(public.access_accounts_for('finance.accounts', 'read'))))
      or (id in (select unnest(public.access_accounts_for('calendar.day_money', 'read'))))
    )
  );

alter policy account_teams_select_calendar on public.account_teams
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (team_id in (select unnest(public.access_calendars('finance.income', 'read'))))
      or (team_id in (select unnest(public.access_calendars('finance.expense', 'read'))))
      or (team_id in (select unnest(public.access_calendars('finance.accounts', 'read'))))
      or (team_id in (select unnest(public.access_calendars('calendar.day_money', 'read'))))
    )
  );

alter policy finance_categories_select_access on public.finance_categories
  using (
    (
      tenant_id is null
      and (
        ((select cardinality(public.access_calendars('finance.income', 'read'))) > 0)
        or ((select cardinality(public.access_calendars('finance.expense', 'read'))) > 0)
        or ((select cardinality(public.access_calendars('finance.debts', 'read'))) > 0)
        or ((select cardinality(public.access_calendars('calendar.day_money', 'read'))) > 0)
      )
    )
    or (
      tenant_id = (select public.current_tenant_id())
      and (
        (team_id in (select unnest(public.access_calendars('finance.income', 'read'))))
        or (team_id in (select unnest(public.access_calendars('finance.expense', 'read'))))
        or (team_id in (select unnest(public.access_calendars('finance.debts', 'read'))))
        or (team_id in (select unnest(public.access_calendars('calendar.day_money', 'read'))))
      )
    )
  );

alter policy finance_category_hidden_select_access on public.finance_category_hidden
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      ((select cardinality(public.access_calendars('finance.income', 'read'))) > 0)
      or ((select cardinality(public.access_calendars('finance.expense', 'read'))) > 0)
      or ((select cardinality(public.access_calendars('finance.debts', 'read'))) > 0)
      or ((select cardinality(public.access_calendars('calendar.day_money', 'read'))) > 0)
    )
  );

alter policy finance_category_order_select_access on public.finance_category_order
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      ((select cardinality(public.access_calendars('finance.income', 'read'))) > 0)
      or ((select cardinality(public.access_calendars('finance.expense', 'read'))) > 0)
      or ((select cardinality(public.access_calendars('finance.debts', 'read'))) > 0)
      or ((select cardinality(public.access_calendars('calendar.day_money', 'read'))) > 0)
    )
  );

alter policy team_finance_settings_select_access on public.team_finance_settings
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (team_id in (select unnest(public.access_calendars('finance.income', 'read'))))
      or (team_id in (select unnest(public.access_calendars('finance.expense', 'read'))))
      or (team_id in (select unnest(public.access_calendars('calendar.day_money', 'read'))))
    )
  );
