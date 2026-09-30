-- ДОХОДЫ И РАСХОДЫ — ДВА ПРАВА (права по блокам, этап 2 денег, срез 2а; сессия 015).
--
-- Владелец 29.09: «разрешить… только доходы, но видел все расходы», «чтобы
-- новый пользователь предоставил права сотруднику и не переживал о том, что он
-- может что-то украсть». Строка прав «Доходы и расходы» (`finance.operations`)
-- делится на две: «Доходы» (`finance.income`) и «Расходы» (`finance.expense`),
-- у каждой четыре ступени:
--   Не видит · Видит · Добавляет · Правит всё
--     • «Добавляет» (`write`) — заводит своё и правит/удаляет ТОЛЬКО своё;
--     • «Правит всё» (`full`) — правит и удаляет и чужие операции команды.
--
-- НОВАЯ СТУПЕНЬ `full` — В КОНЦЕ ШКАЛЫ. Порядок ступеней на сервере — место в
-- массиве (`array_position`); массив становится ['off', 'read', 'write',
-- 'full'], и прежние ранги не сдвигаются: off=1, read=2, write=3. `full`
-- проходит везде, где нужен `write` (ранг 4 ≥ 3). Правится ровно этот литерал
-- в трёх правилах: `access_calendars_of`, `access_company`,
-- `access_accounts_for`. Зависимость от «Календаря и записей»
-- (`array['read', 'write']`) не трогается: у того блока `full` не бывает.
--
-- РАЗВИЛКИ (согласованы с сессией 013 «финансы», 29.09):
--   (а) «Доходы» — строки `income` и `refund` (возврат — действие стороны
--       дохода); «Расходы» — `expense`. Перевод между счетами — не доход и не
--       расход: его строки видит «Счета: Видит», пишет — «Счета: Управляет»
--       (как и было, через `record_account_transfer`).
--   (б) Оплата записи остаётся правом блока «Оплата» (`record.payment`):
--       её строки кладут definer-функции оплаты, а напрямую сотрудник
--       оплату записи не правит ни на какой ступени «Доходов».
--   (в) Оплата долга — операция с `debt_id`: её пускает «Долги: Принимает
--       оплату» (`finance.debts` = write) сама, без «Доходов»/«Расходов»;
--       иначе ступень была бы мёртвой. Править и удалять — только свою.
--   (г) «Счета: Только при оплате» — не новая ступень: это «Счета: Не видит»
--       рядом с «Оплата: Принимает». Название счёта в оплате отдаёт
--       `list_payment_accounts_safe` по праву оплаты, без остатков. Экран прав
--       так её и называет.
--   (д) Категории, шаблоны операций и настройки денег команды читаются по
--       любой из сторон (и категории — ещё по долгам): иначе у «только
--       расходы» пропали бы категории.
--   Ревью 013 (29.09): чек на оплату долга выписывает «Долги: Принимает
--   оплату»; чек на ручной доход — «Доходы» (своё на «Добавляет», любое на
--   «Правит всё»). Ручной день пишет только стороны, которые человек пишет:
--   чужая сторона дня остаётся нетронутой, даже если он её не видит, а в ответ
--   уходят только видимые ему стороны.
--
-- АВТОР ОПЕРАЦИИ СТАВИТ СЕРВЕР. «Своё» в политиках — `created_by =
-- auth.uid()`, а клиент автора не шлёт: его ставит BEFORE-триггер
-- `assert_finance_transaction_integrity` (`if tg_op = 'INSERT' and
-- new.created_by is null then new.created_by := auth.uid()`), и RLS WITH CHECK
-- считается уже после него. Прогон 29.09 на живых политиках: вставка
-- сотрудника без `created_by` проходит, автор — он; вставка с чужим автором —
-- 42501 (подменённого автора сервер не исправляет молча, а отказывает). Строки
-- без автора в базе — только старше 15.08, до этой строки триггера. Убрать её
-- из триггера — значит закрыть «Добавляет» у всех сотрудников.
--
-- ПЕРЕНОС БЕЗ ПОТЕРЬ. Каждое выставленное «Доходы и расходы» копируется в обе
-- стороны: «Видит» → «Видит»; «Меняет» → «Доходы: Добавляет» и «Расходы:
-- Правит всё» — ровно то, что давало «Меняет»: заводить доход и расход и
-- править ЛЮБОЙ расход команды (доходы сотрудник не правил вовсе). Так же
-- переносятся шаблоны доступа и неотправленные изменения приглашений. На
-- 29.09 таких строк в базе ноль, перенос — для порядка. Сам блок
-- `finance.operations` перестаёт быть живым: его строки остаются, но сервер
-- их больше не спрашивает.
--
-- ТЕЛА ФУНКЦИЙ — ИЗ ЖИВОЙ БАЗЫ (`pg_get_functiondef`, 29.09), не из файлов
-- миграций: часть тел правилась в базе позже файлов. Прогон вхолостую сверяет
-- каждое новое тело с живым: живое плюс ровно правки этого файла.
--
-- Клиент уже знает `full` и новые ключи (коммит сессии 015 до наката): разбор
-- карты прав строгий и на незнакомой ступени падает.

-- ─── 1. Ступень «Правит всё» в шкале ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.access_calendars_of(p_tenant uuid, p_user uuid, p_block text, p_min text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  min_rank integer := array_position(array['off', 'read', 'write', 'full'], p_min);
  member_role text;
  block_row public.access_blocks%rowtype;
  granted text[];
begin
  if p_tenant is null or p_user is null or min_rank is null or min_rank < 2 then
    return array[]::text[];
  end if;

  select * into block_row
    from public.access_blocks b
   where b.key = p_block
     and b.scope = 'calendar';
  if not found then
    return array[]::text[];
  end if;

  select tm.role into member_role
    from public.tenant_members tm
   where tm.tenant_id = p_tenant
     and tm.user_id = p_user;
  if member_role is null then
    return array[]::text[];
  end if;

  if member_role = 'owner' then
    select coalesce(array_agg(t.id order by t.id), array[]::text[])
      into granted
      from public.teams t
     where t.tenant_id = p_tenant;
    return granted;
  end if;

  if not block_row.live or block_row.owner_only then
    return array[]::text[];
  end if;

  select coalesce(array_agg(mc.team_id order by mc.team_id), array[]::text[])
    into granted
    from public.member_calendars mc
    -- Архивный календарь сотруднику закрыт целиком (аудит 24.09).
    join public.teams t
      on t.tenant_id = mc.tenant_id
     and t.id = mc.team_id
     and t.is_active
    left join public.member_access ma
      on ma.tenant_id = mc.tenant_id
     and ma.user_id = mc.user_id
     and ma.block = block_row.key
     and ma.team_id = mc.team_id
   where mc.tenant_id = p_tenant
     and mc.user_id = p_user
     and array_position(array['off', 'read', 'write', 'full'], coalesce(ma.level, block_row.levels[1])) >= min_rank
     and (
       block_row.key = 'calendar.records'
       or array_position(array['read', 'write'], public.access_records_level(p_tenant, p_user, mc.team_id)) is not null
     );

  return granted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.access_company(p_block text, p_min text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller uuid := auth.uid();
  min_rank integer := array_position(array['off', 'read', 'write', 'full'], p_min);
  active_tenant uuid;
  caller_role text;
  block_row public.access_blocks%rowtype;
  stored_level text;
begin
  if caller is null or min_rank is null or min_rank < 2 then
    return false;
  end if;

  active_tenant := public.current_tenant_id();
  if active_tenant is null then
    return false;
  end if;

  select tm.role into caller_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant
     and tm.user_id = caller;
  if caller_role is null then
    return false;
  end if;

  select * into block_row
    from public.access_blocks b
   where b.key = p_block
     and b.scope = 'company';
  if not found then
    if p_block in ('clients', 'clients.contacts') and exists (
      select 1 from public.access_blocks b where b.key = p_block
    ) then
      return caller_role = 'owner'
        or cardinality(public.access_calendars(p_block, p_min)) > 0;
    end if;
    return false;
  end if;

  if caller_role = 'owner' then
    return true;
  end if;

  if not block_row.live or block_row.owner_only then
    return false;
  end if;

  select ma.level into stored_level
    from public.member_access ma
   where ma.tenant_id = active_tenant
     and ma.user_id = caller
     and ma.block = block_row.key
     and ma.team_id is null;

  return coalesce(
    array_position(array['off', 'read', 'write', 'full'], coalesce(stored_level, block_row.levels[1])) >= min_rank,
    false
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.access_accounts_for(p_block text, p_min text)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller uuid := auth.uid();
  min_rank integer := array_position(array['off', 'read', 'write', 'full'], p_min);
  active_tenant uuid;
  caller_role text;
  granted_calendars text[];
  visible uuid[];
begin
  if caller is null or min_rank is null or min_rank < 2 then
    return array[]::uuid[];
  end if;

  if not exists (
    select 1
      from public.access_blocks b
     where b.key = p_block
       and b.scope = 'calendar'
  ) then
    return array[]::uuid[];
  end if;

  active_tenant := public.current_tenant_id();
  if active_tenant is null then
    return array[]::uuid[];
  end if;

  select tm.role into caller_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant
     and tm.user_id = caller;
  if caller_role is null then
    return array[]::uuid[];
  end if;

  if caller_role = 'owner' then
    select coalesce(array_agg(a.id order by a.id), array[]::uuid[])
      into visible
      from public.accounts a
     where a.tenant_id = active_tenant;
    return visible;
  end if;

  granted_calendars := public.access_calendars_of(active_tenant, caller, p_block, p_min);
  if cardinality(granted_calendars) = 0 then
    return array[]::uuid[];
  end if;

  select coalesce(array_agg(a.id order by a.id), array[]::uuid[])
    into visible
    from public.accounts a
   where a.tenant_id = active_tenant
     and (
       (a.scope = 'team' and a.brigade_id = any(granted_calendars))
       or (
         min_rank = 2
         and a.scope = 'company'
         and exists (
           select 1
             from public.account_teams att
            where att.account_id = a.id
              and att.tenant_id = active_tenant
              and att.team_id = any(granted_calendars)
         )
       )
     );

  return visible;
end;
$function$;

-- ─── 2. Реестр: две стороны денег ───────────────────────────────────────

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values
  (
    'finance.income', 'finance', 'calendar', array['off', 'read', 'write', 'full'], 'Доходы', false, true,
    array[
      'policy:public.finance_transactions.finance_transactions_select_calendar',
      'policy:public.finance_transactions.finance_transactions_insert_income',
      'policy:public.finance_transactions.finance_transactions_update_income',
      'policy:public.finance_transactions.finance_transactions_delete_income',
      'policy:public.day_extras.day_extras_select_calendar',
      'function:public.replace_day_extras(text, text, jsonb)',
      'function:public.issue_receipt(uuid, jsonb, uuid)',
      'policy:public.accounts.accounts_select',
      'policy:public.account_teams.account_teams_select_calendar',
      'policy:public.finance_categories.finance_categories_select_access',
      'policy:public.finance_category_hidden.finance_category_hidden_select_access',
      'policy:public.finance_category_order.finance_category_order_select_access',
      'policy:public.finance_templates.finance_templates_select_access',
      'policy:public.team_finance_settings.team_finance_settings_select_access'
    ],
    108
  ),
  (
    'finance.expense', 'finance', 'calendar', array['off', 'read', 'write', 'full'], 'Расходы', false, true,
    array[
      'policy:public.finance_transactions.finance_transactions_select_calendar',
      'policy:public.finance_transactions.finance_transactions_insert_expense',
      'policy:public.finance_transactions.finance_transactions_update_expense',
      'policy:public.finance_transactions.finance_transactions_delete_expense',
      'policy:public.day_extras.day_extras_select_calendar',
      'function:public.replace_day_extras(text, text, jsonb)',
      'policy:public.accounts.accounts_select',
      'policy:public.account_teams.account_teams_select_calendar',
      'policy:public.finance_categories.finance_categories_select_access',
      'policy:public.finance_category_hidden.finance_category_hidden_select_access',
      'policy:public.finance_category_order.finance_category_order_select_access',
      'policy:public.finance_templates.finance_templates_select_access',
      'policy:public.team_finance_settings.team_finance_settings_select_access'
    ],
    109
  )
on conflict (key) do update
  set area = excluded.area,
      scope = excluded.scope,
      levels = excluded.levels,
      title_ru = excluded.title_ru,
      owner_only = excluded.owner_only,
      live = excluded.live,
      enforced_by = excluded.enforced_by,
      position = excluded.position;

update public.access_blocks
   set live = false,
       enforced_by = array[]::text[]
 where key = 'finance.operations';

update public.access_blocks
   set enforced_by = array[
         'policy:public.accounts.accounts_select',
         'policy:public.accounts.accounts_insert_calendar',
         'policy:public.accounts.accounts_update_calendar',
         'policy:public.account_teams.account_teams_select_calendar',
         'policy:public.finance_transfer_requests.finance_transfer_requests_select_calendar',
         'policy:public.finance_transactions.finance_transactions_select_calendar',
         'function:public.account_balances(uuid)',
         'function:public.account_period_totals(uuid, date, date)',
         'function:public.record_account_transfer(uuid, uuid, uuid, numeric, date, text)',
         'function:public.delete_account_transfer(uuid)'
       ]
 where key = 'finance.accounts';

update public.access_blocks
   set enforced_by = array[
         'policy:public.debts.debts_read',
         'policy:public.debts.debts_insert',
         'policy:public.debts.debts_update',
         'policy:public.debts.debts_delete',
         'policy:public.finance_transactions.finance_transactions_select_debt',
         'policy:public.finance_transactions.finance_transactions_insert_debt',
         'policy:public.finance_transactions.finance_transactions_update_debt',
         'policy:public.finance_transactions.finance_transactions_delete_debt',
         'function:public.issue_receipt(uuid, jsonb, uuid)',
         'policy:public.finance_categories.finance_categories_select_access',
         'policy:public.finance_category_hidden.finance_category_hidden_select_access',
         'policy:public.finance_category_order.finance_category_order_select_access'
       ]
 where key = 'finance.debts';

-- ─── 3. Перенос выставленного: «Доходы и расходы» → обе стороны ─────────

insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
select ma.tenant_id,
       ma.user_id,
       side.block,
       ma.team_id,
       case when side.block = 'finance.expense' and ma.level = 'write' then 'full' else ma.level end,
       ma.set_by,
       ma.set_at
  from public.member_access ma
 cross join (values ('finance.income'), ('finance.expense')) as side(block)
 where ma.block = 'finance.operations'
on conflict (tenant_id, user_id, block, team_id) do nothing;

update public.access_templates t
   set levels = t.levels
       || jsonb_build_object('finance.income', t.levels -> 'finance.operations')
       || jsonb_build_object(
            'finance.expense',
            case when t.levels ->> 'finance.operations' = 'write'
                 then to_jsonb('full'::text)
                 else t.levels -> 'finance.operations'
            end
          )
 where t.levels ? 'finance.operations'
   and not (t.levels ? 'finance.income' or t.levels ? 'finance.expense');

update public.invitations i
   set access_changes = i.access_changes || (
         select jsonb_agg(
                  jsonb_build_object(
                    'block', side.block,
                    'team_id', change -> 'team_id',
                    'level',
                    case when side.block = 'finance.expense' and change ->> 'level' = 'write'
                         then 'full'
                         else change ->> 'level'
                    end
                  )
                )
           from jsonb_array_elements(i.access_changes) as change
          cross join (values ('finance.income'), ('finance.expense')) as side(block)
          where change ->> 'block' = 'finance.operations'
       )
 where jsonb_typeof(i.access_changes) = 'array'
   and exists (
     select 1 from jsonb_array_elements(i.access_changes) as change
      where change ->> 'block' = 'finance.operations'
   )
   and not exists (
     select 1 from jsonb_array_elements(i.access_changes) as change
      where change ->> 'block' in ('finance.income', 'finance.expense')
   );

-- ─── 4. Операции: каждая сторона — своим правом ─────────────────────────

drop policy if exists finance_transactions_select_calendar on public.finance_transactions;
drop policy if exists finance_transactions_insert_calendar on public.finance_transactions;
drop policy if exists finance_transactions_update_calendar on public.finance_transactions;
drop policy if exists finance_transactions_delete_calendar on public.finance_transactions;

-- Читает: доход и возврат — «Доходы», расход — «Расходы», перевод — «Счета».
-- Строки долга по-прежнему читает и «Долги» (`finance_transactions_select_debt`).
create policy finance_transactions_select_calendar on public.finance_transactions
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (type in ('income', 'refund') and team_id in (select unnest(public.access_calendars('finance.income', 'read'))))
      or (type = 'expense' and team_id in (select unnest(public.access_calendars('finance.expense', 'read'))))
      or (type = 'transfer' and team_id in (select unnest(public.access_calendars('finance.accounts', 'read'))))
    )
  );

-- Заводит доход: только свой, без записи, инвойса, возврата и долга.
create policy finance_transactions_insert_income on public.finance_transactions
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('finance.income', 'write')))
    and type = 'income'
    and invoice_id is null
    and refund_of_id is null
    and appointment_id is null
    and debt_id is null
    and created_by = (select auth.uid())
    and (account_id is null or account_id in (select unnest(public.access_accounts_for('finance.income', 'write'))))
  );

-- Заводит расход: свой, без инвойса, возврата и долга; с записью можно
-- (материалы к работе).
create policy finance_transactions_insert_expense on public.finance_transactions
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('finance.expense', 'write')))
    and type = 'expense'
    and invoice_id is null
    and refund_of_id is null
    and debt_id is null
    and created_by = (select auth.uid())
    and (account_id is null or account_id in (select unnest(public.access_accounts_for('finance.expense', 'write'))))
  );

-- Принимает оплату долга: операция с долгом своей команды — по праву
-- «Долги: Принимает оплату», без «Доходов» и «Расходов» (развилка в).
create policy finance_transactions_insert_debt on public.finance_transactions
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('finance.debts', 'write')))
    and type in ('income', 'expense')
    and debt_id in (
      select d.id
        from public.debts d
       where d.tenant_id = (select public.current_tenant_id())
         and d.team_id in (select unnest(public.access_calendars('finance.debts', 'write')))
    )
    and invoice_id is null
    and refund_of_id is null
    and (type = 'expense' or appointment_id is null)
    and created_by = (select auth.uid())
    and (account_id is null or account_id in (select unnest(public.access_accounts_for('finance.debts', 'write'))))
  );

-- Правит и удаляет доход: «Правит всё» — любой ручной доход команды,
-- «Добавляет» — только свой. Оплата записи, инвойс, возврат и долг сюда не
-- входят: их ведут свои двери.
create policy finance_transactions_update_income on public.finance_transactions
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and type = 'income'
    and invoice_id is null
    and refund_of_id is null
    and appointment_id is null
    and debt_id is null
    and (
      team_id in (select unnest(public.access_calendars('finance.income', 'full')))
      or (
        team_id in (select unnest(public.access_calendars('finance.income', 'write')))
        and created_by = (select auth.uid())
      )
    )
    and (account_id is null or account_id in (select unnest(public.access_accounts_for('finance.income', 'write'))))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and type = 'income'
    and invoice_id is null
    and refund_of_id is null
    and appointment_id is null
    and debt_id is null
    and (
      team_id in (select unnest(public.access_calendars('finance.income', 'full')))
      or (
        team_id in (select unnest(public.access_calendars('finance.income', 'write')))
        and created_by = (select auth.uid())
      )
    )
    and (account_id is null or account_id in (select unnest(public.access_accounts_for('finance.income', 'write'))))
  );

create policy finance_transactions_delete_income on public.finance_transactions
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and type = 'income'
    and invoice_id is null
    and refund_of_id is null
    and appointment_id is null
    and debt_id is null
    and (
      team_id in (select unnest(public.access_calendars('finance.income', 'full')))
      or (
        team_id in (select unnest(public.access_calendars('finance.income', 'write')))
        and created_by = (select auth.uid())
      )
    )
    and (account_id is null or account_id in (select unnest(public.access_accounts_for('finance.income', 'write'))))
  );

-- Правит и удаляет расход: «Правит всё» — любой, «Добавляет» — только свой.
create policy finance_transactions_update_expense on public.finance_transactions
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and type = 'expense'
    and invoice_id is null
    and refund_of_id is null
    and debt_id is null
    and (
      team_id in (select unnest(public.access_calendars('finance.expense', 'full')))
      or (
        team_id in (select unnest(public.access_calendars('finance.expense', 'write')))
        and created_by = (select auth.uid())
      )
    )
    and (account_id is null or account_id in (select unnest(public.access_accounts_for('finance.expense', 'write'))))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and type = 'expense'
    and invoice_id is null
    and refund_of_id is null
    and debt_id is null
    and (
      team_id in (select unnest(public.access_calendars('finance.expense', 'full')))
      or (
        team_id in (select unnest(public.access_calendars('finance.expense', 'write')))
        and created_by = (select auth.uid())
      )
    )
    and (account_id is null or account_id in (select unnest(public.access_accounts_for('finance.expense', 'write'))))
  );

create policy finance_transactions_delete_expense on public.finance_transactions
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and type = 'expense'
    and invoice_id is null
    and refund_of_id is null
    and debt_id is null
    and (
      team_id in (select unnest(public.access_calendars('finance.expense', 'full')))
      or (
        team_id in (select unnest(public.access_calendars('finance.expense', 'write')))
        and created_by = (select auth.uid())
      )
    )
    and (account_id is null or account_id in (select unnest(public.access_accounts_for('finance.expense', 'write'))))
  );

-- Правит и удаляет свою оплату долга — по праву «Долги: Принимает оплату».
create policy finance_transactions_update_debt on public.finance_transactions
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('finance.debts', 'write')))
    and type in ('income', 'expense')
    and debt_id in (
      select d.id
        from public.debts d
       where d.tenant_id = (select public.current_tenant_id())
         and d.team_id in (select unnest(public.access_calendars('finance.debts', 'write')))
    )
    and invoice_id is null
    and refund_of_id is null
    and (type = 'expense' or appointment_id is null)
    and created_by = (select auth.uid())
    and (account_id is null or account_id in (select unnest(public.access_accounts_for('finance.debts', 'write'))))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('finance.debts', 'write')))
    and type in ('income', 'expense')
    and debt_id in (
      select d.id
        from public.debts d
       where d.tenant_id = (select public.current_tenant_id())
         and d.team_id in (select unnest(public.access_calendars('finance.debts', 'write')))
    )
    and invoice_id is null
    and refund_of_id is null
    and (type = 'expense' or appointment_id is null)
    and created_by = (select auth.uid())
    and (account_id is null or account_id in (select unnest(public.access_accounts_for('finance.debts', 'write'))))
  );

create policy finance_transactions_delete_debt on public.finance_transactions
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('finance.debts', 'write')))
    and type in ('income', 'expense')
    and debt_id in (
      select d.id
        from public.debts d
       where d.tenant_id = (select public.current_tenant_id())
         and d.team_id in (select unnest(public.access_calendars('finance.debts', 'write')))
    )
    and invoice_id is null
    and refund_of_id is null
    and (type = 'expense' or appointment_id is null)
    and created_by = (select auth.uid())
    and (account_id is null or account_id in (select unnest(public.access_accounts_for('finance.debts', 'write'))))
  );

-- ─── 5. Что читается вместе с операциями — по любой из сторон ───────────

drop policy if exists day_extras_select_calendar on public.day_extras;
create policy day_extras_select_calendar on public.day_extras
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (kind = 'income' and team_id in (select unnest(public.access_calendars('finance.income', 'read'))))
      or (kind = 'expense' and team_id in (select unnest(public.access_calendars('finance.expense', 'read'))))
    )
  );

drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or brigade_id in (select unnest(public.access_calendars('finance.accounts', 'read')))
      or id in (select unnest(public.access_accounts_for('finance.income', 'read')))
      or id in (select unnest(public.access_accounts_for('finance.expense', 'read')))
      or id in (select unnest(public.access_accounts_for('finance.accounts', 'read')))
    )
  );

drop policy if exists account_teams_select_calendar on public.account_teams;
create policy account_teams_select_calendar on public.account_teams
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      team_id in (select unnest(public.access_calendars('finance.income', 'read')))
      or team_id in (select unnest(public.access_calendars('finance.expense', 'read')))
      or team_id in (select unnest(public.access_calendars('finance.accounts', 'read')))
    )
  );

drop policy if exists finance_categories_select_access on public.finance_categories;
create policy finance_categories_select_access on public.finance_categories
  for select to authenticated
  using (
    (
      tenant_id is null
      and (
        (select cardinality(public.access_calendars('finance.income', 'read'))) > 0
        or (select cardinality(public.access_calendars('finance.expense', 'read'))) > 0
        or (select cardinality(public.access_calendars('finance.debts', 'read'))) > 0
      )
    )
    or (
      tenant_id = (select public.current_tenant_id())
      and (
        team_id in (select unnest(public.access_calendars('finance.income', 'read')))
        or team_id in (select unnest(public.access_calendars('finance.expense', 'read')))
        or team_id in (select unnest(public.access_calendars('finance.debts', 'read')))
      )
    )
  );

drop policy if exists finance_category_hidden_select_access on public.finance_category_hidden;
create policy finance_category_hidden_select_access on public.finance_category_hidden
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select cardinality(public.access_calendars('finance.income', 'read'))) > 0
      or (select cardinality(public.access_calendars('finance.expense', 'read'))) > 0
      or (select cardinality(public.access_calendars('finance.debts', 'read'))) > 0
    )
  );

drop policy if exists finance_category_order_select_access on public.finance_category_order;
create policy finance_category_order_select_access on public.finance_category_order
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select cardinality(public.access_calendars('finance.income', 'read'))) > 0
      or (select cardinality(public.access_calendars('finance.expense', 'read'))) > 0
      or (select cardinality(public.access_calendars('finance.debts', 'read'))) > 0
    )
  );

drop policy if exists finance_templates_select_access on public.finance_templates;
create policy finance_templates_select_access on public.finance_templates
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      brigade_id in (select unnest(public.access_calendars('finance.income', 'read')))
      or brigade_id in (select unnest(public.access_calendars('finance.expense', 'read')))
    )
  );

drop policy if exists team_finance_settings_select_access on public.team_finance_settings;
create policy team_finance_settings_select_access on public.team_finance_settings
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      team_id in (select unnest(public.access_calendars('finance.income', 'read')))
      or team_id in (select unnest(public.access_calendars('finance.expense', 'read')))
    )
  );

-- ─── 6. Функции, спрашивавшие «Доходы и расходы» ────────────────────────

-- Чек выписывается только на доход (`tx.type = 'income'` ниже). Ручной доход
-- открывает «Доходы»: «Правит всё» — любой в команде, «Добавляет» — свой (в тон
-- политикам операций). Оплату долга — «Долги: Принимает оплату», как и саму
-- операцию: иначе деньги приняты, а чек не выписать (сессия 013, 29.09).
-- У старых ручных доходов автор пуст: `created_by = auth.uid()` дало бы NULL,
-- а `if not allowed` на NULL не срабатывает — прогон 29.09 так выписал чек на
-- чужой доход. Поэтому автор сравнивается через `is not distinct from`, а
-- отказ — на всё, что не «да» (`allowed is not true`). Остальное тело — живое.
CREATE OR REPLACE FUNCTION public.issue_receipt(p_transaction_id uuid, p_lines jsonb DEFAULT NULL::jsonb, p_company_id uuid DEFAULT NULL::uuid)
 RETURNS receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  tx public.finance_transactions%rowtype;
  existing public.receipts%rowtype;
  result_row public.receipts%rowtype;
  refunded_amount numeric;
  allowed boolean := false;
begin
  if auth.uid() is null or tenant_uuid is null then
    raise exception 'Войдите в приложение, чтобы выписать чек';
  end if;
  if p_transaction_id is null then
    raise exception 'Не указана операция';
  end if;

  select * into tx
    from public.finance_transactions
   where id = p_transaction_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Операция не найдена';
  end if;

  if public.current_user_role() = 'owner' then
    allowed := true;
  elsif tx.source = 'auto' and tx.appointment_id is not null then
    allowed := public.current_user_can_pay_appointment(tx.team_id, tx.master_id);
  elsif tx.debt_id is not null then
    allowed :=
      tx.team_id is not null
      and tx.team_id = any(public.access_calendars('finance.debts', 'write'))
      and tx.debt_id in (
        select d.id from public.debts d
         where d.tenant_id = tenant_uuid
           and d.team_id = any(public.access_calendars('finance.debts', 'write'))
      )
      and (
        tx.account_id is null
        or tx.account_id = any(public.access_accounts_for('finance.debts', 'write'))
      );
  else
    allowed :=
      tx.team_id is not null
      and (
        tx.team_id = any(public.access_calendars('finance.income', 'full'))
        or (
          tx.team_id = any(public.access_calendars('finance.income', 'write'))
          and tx.created_by is not distinct from auth.uid()
        )
      )
      and (
        tx.account_id is null
        or tx.account_id = any(public.access_accounts_for('finance.income', 'write'))
      );
  end if;
  if allowed is not true then
    raise exception 'Недостаточно прав, чтобы выписать чек по этой операции';
  end if;

  select * into existing from public.receipts where transaction_id = tx.id;
  if found then
    return existing;
  end if;

  if tx.type <> 'income' then
    raise exception 'Чек выписывается только на доход';
  end if;
  if tx.amount <= 0 then
    raise exception 'Сумма операции должна быть больше нуля';
  end if;
  if tx.client_id is null then
    raise exception 'У операции нет клиента — чек не нужен';
  end if;

  select coalesce(sum(abs(amount)), 0) into refunded_amount
    from public.finance_transactions
   where refund_of_id = tx.id and type = 'refund';
  if refunded_amount >= round(tx.amount, 2) then
    raise exception 'По операции оформлен полный возврат — чек не выписывается';
  end if;

  result_row := public._issue_receipt_core(tx, p_lines, p_company_id);
  if result_row.id is null then
    select * into result_row from public.receipts where transaction_id = tx.id;
  end if;
  if result_row.id is null then
    raise exception 'Не удалось выписать чек';
  end if;
  return result_row;
end;
$function$;

-- Ручной день: сразу отказывает тому, кто не пишет ни одну сторону. Под
-- замком дня (сессия 013, 29.09): стираются и пишутся только стороны, которые
-- он пишет, — чужие строки дня, даже невидимые ему, остаются как были.
-- Строка чужой стороны в списке допустима, только если она уже лежит в дне
-- ровно такой же (клиент вернул день целиком) — её пропускаем; иначе это
-- правка закрытого, отказ. Отдаёт только стороны, которые он видит: тело
-- работает от владельца функции, мимо RLS.
CREATE OR REPLACE FUNCTION public.replace_day_extras(p_team_id text, p_date text, p_extras jsonb)
 RETURNS SETOF day_extras
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  item jsonb;
  amount_value numeric;
  caller_is_owner boolean;
  writable text[];
  readable text[];
  foreign_item jsonb;
begin
  if auth.uid() is null
     or tenant_uuid is null then
    raise exception 'Ручные финансы доступны только участникам компании'
      using errcode = '42501';
  end if;
  caller_is_owner := coalesce(public.current_user_role() = 'owner', false);
  if not caller_is_owner
     and not coalesce(
       p_team_id = any(public.access_calendars('finance.income', 'write'))
       or p_team_id = any(public.access_calendars('finance.expense', 'write')),
       false
     ) then
    raise exception 'Менять доходы и расходы в этом календаре вам не открыто'
      using errcode = '42501', hint = 'block:finance.income';
  end if;
  if nullif(btrim(coalesce(p_team_id, '')), '') is null
     or not exists (
       select 1 from public.teams team
        where team.tenant_id = tenant_uuid and team.id = p_team_id
     ) then
    raise exception 'Команда не найдена в этой компании'
      using errcode = '23503';
  end if;
  if p_date is null
     or p_date !~ '^\d{4}-\d{2}-\d{2}$'
     or (p_date::date)::text <> p_date then
    raise exception 'Дата ручной операции некорректна'
      using errcode = '22023';
  end if;
  if p_extras is null or jsonb_typeof(p_extras) <> 'array' then
    raise exception 'Список ручных операций повреждён'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_extras) > 200 then
    raise exception 'Слишком много ручных операций за один день'
      using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_extras)
  loop
    if jsonb_typeof(item) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(item) key
          where key not in (
            'id', 'name', 'amount', 'kind', 'category',
            'payment_method', 'receipt_url'
          )
       )
       or jsonb_typeof(item -> 'id') <> 'string'
       or jsonb_typeof(item -> 'name') <> 'string'
       or jsonb_typeof(item -> 'amount') <> 'number'
       or jsonb_typeof(item -> 'kind') <> 'string'
       or nullif(btrim(item ->> 'name'), '') is null
       or char_length(btrim(item ->> 'name')) > 500
       or (item ->> 'kind') not in ('income', 'expense')
       or (
         item ? 'category'
         and item -> 'category' <> 'null'::jsonb
         and (
           jsonb_typeof(item -> 'category') <> 'string'
           or (item ->> 'category') not in ('fuel', 'food', 'supplies', 'other')
         )
       )
       or (
         item ? 'payment_method'
         and item -> 'payment_method' <> 'null'::jsonb
         and (
           jsonb_typeof(item -> 'payment_method') <> 'string'
           or (item ->> 'payment_method') not in ('cash', 'card', 'transfer', 'other')
         )
       )
       or (
         item ? 'receipt_url'
         and item -> 'receipt_url' <> 'null'::jsonb
         and (
           jsonb_typeof(item -> 'receipt_url') <> 'string'
           or char_length(item ->> 'receipt_url') > 2048
         )
       ) then
      raise exception 'Ручная операция содержит некорректные поля'
        using errcode = '22023';
    end if;

    begin
      perform (item ->> 'id')::uuid;
      amount_value := (item ->> 'amount')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Идентификатор или сумма ручной операции некорректны'
        using errcode = '22023';
    end;
    if amount_value = 'NaN'::numeric
       or amount_value < 0
       or amount_value > 999999999.99
       or round(amount_value, 2) is distinct from amount_value then
      raise exception 'Сумма ручной операции некорректна'
        using errcode = '22023';
    end if;
  end loop;

  if (
    select count(distinct (value ->> 'id')::uuid)
      from jsonb_array_elements(p_extras)
  ) <> jsonb_array_length(p_extras) then
    raise exception 'Ручные операции не должны повторяться'
      using errcode = '23505';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(tenant_uuid::text || ':' || p_team_id || ':' || p_date, 0)
  );

  select coalesce(array_agg(side.kind), array[]::text[]) into writable
    from (values ('income'), ('expense')) as side(kind)
   where caller_is_owner
      or coalesce(p_team_id = any(public.access_calendars('finance.' || side.kind, 'write')), false);
  select coalesce(array_agg(side.kind), array[]::text[]) into readable
    from (values ('income'), ('expense')) as side(kind)
   where caller_is_owner
      or coalesce(p_team_id = any(public.access_calendars('finance.' || side.kind, 'read')), false);

  for foreign_item in
    select value
      from jsonb_array_elements(p_extras)
     where not ((value ->> 'kind') = any(writable))
  loop
    if not exists (
      select 1
        from public.day_extras extra
       where extra.tenant_id = tenant_uuid
         and extra.team_id = p_team_id
         and extra.date = p_date
         and extra.id = (foreign_item ->> 'id')::uuid
         and extra.kind = foreign_item ->> 'kind'
         and extra.name = btrim(foreign_item ->> 'name')
         and extra.amount = (foreign_item ->> 'amount')::numeric
         and extra.category is not distinct from (foreign_item ->> 'category')
         and extra.payment_method is not distinct from (foreign_item ->> 'payment_method')
         and extra.receipt_url is not distinct from (foreign_item ->> 'receipt_url')
    ) then
      raise exception 'Менять эту сторону денег в этом календаре вам не открыто'
        using errcode = '42501', hint = 'block:finance.' || (foreign_item ->> 'kind');
    end if;
  end loop;

  delete from public.day_extras extra
   where extra.tenant_id = tenant_uuid
     and extra.team_id = p_team_id
     and extra.date = p_date
     and extra.kind = any(writable);

  insert into public.day_extras (
    id, tenant_id, team_id, date, name, amount, kind, category,
    payment_method, receipt_url
  )
  select
    (value ->> 'id')::uuid,
    tenant_uuid,
    p_team_id,
    p_date,
    btrim(value ->> 'name'),
    (value ->> 'amount')::numeric,
    value ->> 'kind',
    value ->> 'category',
    value ->> 'payment_method',
    value ->> 'receipt_url'
  from jsonb_array_elements(p_extras)
  where (value ->> 'kind') = any(writable);

  return query
    select extra.*
      from public.day_extras extra
     where extra.tenant_id = tenant_uuid
       and extra.team_id = p_team_id
       and extra.date = p_date
       and extra.kind = any(readable)
     order by extra.created_at, extra.id;
end;
$function$;

-- ─── 7. Живое время ─────────────────────────────────────────────────────
-- Карта каждого сотрудника меняется (новые ключи, общий уходит), хотя его
-- уровни не трогали: тот же сигнал, что даёт правка прав.

do $signal$
declare
  person record;
begin
  for person in
    update public.tenant_members tm
       set access_version = tm.access_version + 1
     where tm.role <> 'owner'
    returning tm.tenant_id, tm.user_id, tm.access_version
  loop
    perform realtime.send(
      jsonb_build_object('tenant_id', person.tenant_id, 'version', person.access_version),
      'access_changed',
      'access:' || person.user_id::text,
      true
    );
  end loop;
end
$signal$;

-- ─── 8. Сторож ──────────────────────────────────────────────────────────

do $guard$
declare
  v_policies constant text[] := array[
    'finance_transactions.finance_transactions_select_calendar',
    'finance_transactions.finance_transactions_select_debt',
    'finance_transactions.finance_transactions_insert_income',
    'finance_transactions.finance_transactions_insert_expense',
    'finance_transactions.finance_transactions_insert_debt',
    'finance_transactions.finance_transactions_update_income',
    'finance_transactions.finance_transactions_update_expense',
    'finance_transactions.finance_transactions_update_debt',
    'finance_transactions.finance_transactions_delete_income',
    'finance_transactions.finance_transactions_delete_expense',
    'finance_transactions.finance_transactions_delete_debt',
    'finance_transactions.finance_transactions_owner_all',
    'day_extras.day_extras_select_calendar',
    'accounts.accounts_select',
    'account_teams.account_teams_select_calendar',
    'finance_categories.finance_categories_select_access',
    'finance_category_hidden.finance_category_hidden_select_access',
    'finance_category_order.finance_category_order_select_access',
    'finance_templates.finance_templates_select_access',
    'team_finance_settings.team_finance_settings_select_access'
  ];
  v_missing text;
  v_left text;
  v_entry text;
begin
  -- Реестр: две живые стороны с четырьмя ступенями, общий блок не живой.
  if (
    select count(*) from public.access_blocks b
     where b.key in ('finance.income', 'finance.expense')
       and b.live
       and b.levels = array['off', 'read', 'write', 'full']
       and b.scope = 'calendar'
       and not b.owner_only
  ) <> 2 then
    raise exception 'сторож: «Доходы» и «Расходы» не живые или не с четырьмя ступенями';
  end if;
  if exists (select 1 from public.access_blocks where key = 'finance.operations' and live) then
    raise exception 'сторож: «Доходы и расходы» остался живым';
  end if;

  -- Шкала: новая ступень в трёх правилах, старого литерала нет нигде.
  if exists (
    select 1 from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('access_calendars_of', 'access_company', 'access_accounts_for')
       and (
         position('array[''off'', ''read'', ''write'', ''full'']' in p.prosrc) = 0
         or position('array[''off'', ''read'', ''write'']' in replace(p.prosrc, 'array[''off'', ''read'', ''write'', ''full'']', '')) > 0
       )
  ) then
    raise exception 'сторож: шкала ступеней не обновлена во всех трёх правилах';
  end if;

  -- Общий ключ больше не спрашивает ни одна функция и ни одна политика.
  select string_agg(p.proname, ', ') into v_left
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosrc like '%finance.operations%';
  if v_left is not null then
    raise exception 'сторож: функции ещё спрашивают finance.operations: %', v_left;
  end if;
  select string_agg(pp.tablename || '.' || pp.policyname, ', ') into v_left
    from pg_policies pp
   where pp.schemaname = 'public'
     and (coalesce(pp.qual, '') || ' ' || coalesce(pp.with_check, '')) like '%finance.operations%';
  if v_left is not null then
    raise exception 'сторож: политики ещё спрашивают finance.operations: %', v_left;
  end if;

  -- Политики сотрудника на местах; старых общих нет.
  select string_agg(want, ', ') into v_missing
    from unnest(v_policies) want
   where not exists (
     select 1 from pg_policies pp
      where pp.schemaname = 'public'
        and pp.tablename || '.' || pp.policyname = want
   );
  if v_missing is not null then
    raise exception 'сторож: нет политик: %', v_missing;
  end if;
  if exists (
    select 1 from pg_policies pp
     where pp.schemaname = 'public'
       and pp.tablename = 'finance_transactions'
       and pp.policyname in (
         'finance_transactions_insert_calendar',
         'finance_transactions_update_calendar',
         'finance_transactions_delete_calendar'
       )
  ) then
    raise exception 'сторож: остались общие политики записи операций';
  end if;

  -- Каждый сторож блока из реестра существует.
  for v_entry in
    select unnest(b.enforced_by)
      from public.access_blocks b
     where b.key in ('finance.income', 'finance.expense', 'finance.accounts', 'finance.debts')
  loop
    if v_entry like 'policy:public.%' then
      if not exists (
        select 1 from pg_policies pp
         where pp.schemaname = 'public'
           and 'policy:public.' || pp.tablename || '.' || pp.policyname = v_entry
      ) then
        raise exception 'сторож: в реестре несуществующая политика %', v_entry;
      end if;
    elsif v_entry like 'function:public.%' then
      if to_regprocedure(substr(v_entry, length('function:') + 1)) is null then
        raise exception 'сторож: в реестре несуществующая функция %', v_entry;
      end if;
    else
      raise exception 'сторож: непонятная запись реестра %', v_entry;
    end if;
  end loop;
end
$guard$;
