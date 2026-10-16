-- ФИНАНСЫ: ВИДИМОСТЬ ПАРТНЁРА И КОРЗИНА ОПЕРАЦИЙ (серверный аудит).
--
-- 1. «Удалённые операции» отдавали партнёру снимок операции (сумма, счёт,
--    клиент) без правил живой таблицы: скрытые счета и окно «Ограничения»
--    финансов (`member_finance_window_starts`) на корзину не действовали.
-- 2. Журнал «История изменений» для партнёра пускал операции по «Доход ∪
--    Расход: Видит» без учёта ТИПА (кто видел только расходы — видел доходы,
--    переводы и платежи долгов), скрытых счетов и окна; события скрытого счёта
--    были видны по «Счета: Видит». Для правил журналу не хватало счёта и долга
--    — `log_change` теперь кладёт их в `meta`.
-- 3. Вид, команду, охват и начальный остаток счёта замораживала только живая
--    таблица операций; операция в корзине — тоже история (`account_has_history`).
-- 4. Категорию можно было удалить, пока её операция лежит в корзине, и
--    «Вернуть» молча обнуляло категорию.
-- 5. Возврат в корзине + удалённый после него исходный доход = «Вернуть»
--    возврат падало «Исходный доход для возврата не найден». Теперь доход, у
--    которого возврат лежит в корзине, не удаляется.
-- 6. `tenant_business_date` / `tenant_currency` отвечали любому вошедшему про
--    ЛЮБУЮ компанию.
-- 7. Категории не имели уникальности имени в команде: «Во всех командах» при
--    обрыве оставляла дубли.
--
-- Старые строки журнала (до этой миграции) несут `meta` без `account_id`:
-- партнёру они скрыты целиком (безопаснее, чем показать операцию скрытого
-- счёта); владелец видит журнал как раньше. Бэкфилла нет — новые записи
-- несут поля сразу.


-- 1. Корзина операций: правила живой таблицы для не-владельца ----------------

drop policy if exists deleted_operations_select on public.deleted_operations;
create policy deleted_operations_select on public.deleted_operations
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or (
        team_id in (select unnest(public.access_calendars('finance.settings_trash', 'read')))
        and (
          (
            (operation ->> 'debt_id') is null
            and type = 'income'
            and team_id in (select unnest(public.access_calendars('finance.income', 'read')))
          )
          or (
            (operation ->> 'debt_id') is null
            and type = 'expense'
            and team_id in (select unnest(public.access_calendars('finance.expense', 'read')))
          )
          or (
            (operation ->> 'debt_id') is not null
            and team_id in (select unnest(public.access_calendars('finance.debts', 'read')))
          )
        )
        -- Скрытый счёт виден только владельцу, и его операции в корзине тоже.
        and (
          (operation ->> 'account_id') is null
          or (operation ->> 'account_id') <> all (((select public.hidden_account_ids()))::text[])
        )
        -- Окно «Ограничения» финансов: платежи долга и не-деньги окном не режутся —
        -- как в `finance_transactions_window`.
        and (
          (operation ->> 'debt_id') is not null
          or type not in ('income', 'refund', 'expense')
          or ((select public.member_finance_window_starts()) ->> team_id) is null
          or (operation ->> 'occurred_on')::date
               >= (((select public.member_finance_window_starts()) ->> team_id))::date
        )
      )
    )
  );

-- «Удалить насовсем» — те же рамки, что и чтение: чего партнёр не видит, того он
-- не стирает.
drop policy if exists deleted_operations_delete on public.deleted_operations;
create policy deleted_operations_delete on public.deleted_operations
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or (
        team_id in (select unnest(public.access_calendars('finance.settings_trash', 'write')))
        and (operation ->> 'created_by') = ((select auth.uid()))::text
        and (
          (
            (operation ->> 'debt_id') is null
            and type = 'income'
            and team_id in (select unnest(public.access_calendars('finance.income', 'read')))
          )
          or (
            (operation ->> 'debt_id') is null
            and type = 'expense'
            and team_id in (select unnest(public.access_calendars('finance.expense', 'read')))
          )
          or (
            (operation ->> 'debt_id') is not null
            and team_id in (select unnest(public.access_calendars('finance.debts', 'read')))
          )
        )
        and (
          (operation ->> 'account_id') is null
          or (operation ->> 'account_id') <> all (((select public.hidden_account_ids()))::text[])
        )
        and (
          (operation ->> 'debt_id') is not null
          or type not in ('income', 'refund', 'expense')
          or ((select public.member_finance_window_starts()) ->> team_id) is null
          or (operation ->> 'occurred_on')::date
               >= (((select public.member_finance_window_starts()) ->> team_id))::date
        )
      )
    )
  );

-- 2. Журнал: операции по типу, счёту и окну; события счетов — без скрытых -----

drop policy if exists change_log_select_partner on public.change_log;
create policy change_log_select_partner on public.change_log
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.access_company('cabinet.history', 'read'))
    and team_id is not null
    and case entity
      when 'appointments' then team_id in (select unnest(public.access_calendars('calendar.records', 'read')))
      when 'appointment_photos' then team_id in (select unnest(public.access_calendars('record.files', 'read')))
      when 'day_cities' then team_id in (select unnest(public.access_calendars('calendar.day_labels', 'read')))
      when 'clients' then team_id in (select unnest(public.access_calendars('clients', 'read')))
      when 'client_attachments' then team_id in (select unnest(public.access_calendars('clients.files', 'read')))
      when 'client_tag_assignments' then team_id in (select unnest(public.access_calendars('clients.tags', 'read')))
      when 'client_tags' then team_id in (select unnest(public.access_calendars('clients.settings_tags', 'read')))
      when 'client_sources' then team_id in (select unnest(public.access_calendars('clients.settings_sources', 'read')))
      -- Те же правила, что у `finance_transactions`: тип операции открывает своё
      -- право (платёж долга — «Долги»), скрытый счёт и окно финансов режут.
      -- Запись без ключа `account_id` в meta — старая форма журнала: не-владельцу
      -- она скрыта (счёт неизвестен).
      when 'finance_transactions' then (
        (meta ? 'account_id')
        and (
          (meta ->> 'account_id') is null
          or (meta ->> 'account_id') <> all (((select public.hidden_account_ids()))::text[])
        )
        and (
          (
            (meta ->> 'debt_id') is not null
            and team_id in (select unnest(public.access_calendars('finance.debts', 'read')))
          )
          or (
            (meta ->> 'type') in ('income', 'refund')
            and team_id in (select unnest(public.access_calendars('finance.income', 'read')))
          )
          or (
            (meta ->> 'type') = 'expense'
            and team_id in (select unnest(public.access_calendars('finance.expense', 'read')))
          )
          or (
            (meta ->> 'type') = 'transfer'
            and team_id in (select unnest(public.access_calendars('finance.accounts', 'read')))
          )
        )
        and (
          (meta ->> 'debt_id') is not null
          or (meta ->> 'type') not in ('income', 'refund', 'expense')
          or ((select public.member_finance_window_starts()) ->> team_id) is null
          or (meta ->> 'date')::date
               >= (((select public.member_finance_window_starts()) ->> team_id))::date
        )
      )
      when 'finance_categories' then team_id in (select unnest(public.access_calendars('finance.settings_categories_income', 'read') || public.access_calendars('finance.settings_categories_expense', 'read') || public.access_calendars('finance.settings_categories_debts', 'read')))
      when 'debts' then team_id in (select unnest(public.access_calendars('finance.debts', 'read')))
      when 'accounts' then (
        team_id in (select unnest(public.access_calendars('finance.accounts', 'read')))
        and (entity_id is null or entity_id <> all (((select public.hidden_account_ids()))::text[]))
      )
      when 'invoices' then team_id in (select unnest(public.access_calendars('finance.documents', 'read')))
      when 'receipts' then team_id in (select unnest(public.access_calendars('finance.documents', 'read')))
      when 'services' then team_id in (select unnest(public.access_calendars('calendar.services', 'read')))
      when 'cities' then team_id in (select unnest(public.access_calendars('calendar.labels', 'read')))
      when 'location_labels' then team_id in (select unnest(public.access_calendars('calendar.labels', 'read')))
      when 'team_schedules' then team_id in (select unnest(public.access_calendars('calendar.schedule', 'read')))
      when 'teams' then team_id in (select unnest(public.access_calendars('calendar.identity', 'read')))
      when 'calendar_settings' then team_id in (select unnest(public.access_calendars('calendar.hours', 'read')))
      when 'team_design' then team_id in (select unnest(public.access_calendars('calendar.booking_form', 'read')))
      when 'personal_event_types' then team_id in (select unnest(public.access_calendars('calendar.booking_form', 'read')))
      else false
    end
  );

-- log_change: в meta операции — счёт и долг (только добавление ключей).
CREATE OR REPLACE FUNCTION public.log_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Верхний уровень — кроме денег: доход и возврат от оплаты в записи
  -- создаёт триггер записи, и без них фильтр «Деньги» не видел бы главного
  -- пути дохода.
  if pg_trigger_depth() > 1 and tg_table_name <> 'finance_transactions' then
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
    -- «Удалить» календаря, услуги, метки, типа объекта — это is_active=false
    -- (уходит в архив): в истории это «удалён», а не «Активность да → нет».
    elsif v_new ? 'is_active'
       and (v_old ->> 'is_active')::boolean is true and (v_new ->> 'is_active')::boolean is false then
      v_action := 'delete';
    elsif v_new ? 'is_active'
       and (v_old ->> 'is_active')::boolean is false and (v_new ->> 'is_active')::boolean is true then
      v_action := 'restore';
    else
      for v_key in select jsonb_object_keys(v_new) loop
        continue when v_key = any(v_ignore) or v_key = 'deleted_at';
        v_before := v_old -> v_key;
        v_after := v_new -> v_key;
        continue when v_before is not distinct from v_after;
        if coalesce(jsonb_typeof(v_before), 'null') in ('array', 'null')
           and coalesce(jsonb_typeof(v_after), 'null') in ('array', 'null')
           and (jsonb_typeof(v_before) = 'array' or jsonb_typeof(v_after) = 'array') then
          -- Список (заметки, услуги, оплаты, телефоны, объекты): что
          -- добавили и что убрали — именами; без имён — просто «изменено».
          v_changes := v_changes || jsonb_build_object(
            v_key,
            coalesce(public.change_log_array_diff(v_before, v_after), '"*"'::jsonb)
          );
        elsif jsonb_typeof(v_before) in ('object', 'array') or jsonb_typeof(v_after) in ('object', 'array') then
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
  -- Личное событие без команды видит только автор — в журнал, который читает
  -- владелец, оно не идёт.
  if tg_table_name = 'appointments'
     and coalesce(v_row ->> 'kind', 'work') <> 'work'
     and v_row ->> 'team_id' is null then
    return null;
  end if;
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
        (select c.full_name from public.clients c
          where c.id = (v_row ->> 'client_id')::uuid and c.tenant_id = v_tenant),
        nullif(btrim(v_row ->> 'comment'), '')
      );
      v_meta := jsonb_build_object(
        'kind', v_row ->> 'kind',
        'date', v_row ->> 'date',
        'time', v_row ->> 'time_start'
      );
    when 'finance_transactions' then
      v_label := coalesce(
        (select fc.name from public.finance_categories fc
          where fc.id = (v_row ->> 'category_id')::uuid
            and (fc.tenant_id = v_tenant or fc.tenant_id is null)),
        nullif(btrim(v_row ->> 'notes'), '')
      );
      -- Счёт и долг лежат в строке журнала, чтобы политика чтения партнёра
      -- могла скрыть операции скрытых счетов, а платежи долга отделить от
      -- обычных доходов и расходов. Ключ `account_id` есть ВСЕГДА (при
      -- операции без счёта — JSON null): по нему политика отличает запись
      -- новой формы от старой.
      v_meta := jsonb_build_object(
        'type', v_row ->> 'type',
        'amount', v_row -> 'amount',
        'date', v_row ->> 'occurred_on',
        'account_id', v_row ->> 'account_id',
        'debt_id', v_row ->> 'debt_id'
      );
    when 'debts' then
      v_label := coalesce(
        (select c.full_name from public.clients c
          where c.id = (v_row ->> 'client_id')::uuid and c.tenant_id = v_tenant),
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
        'block_title', (select b.title_ru from public.access_blocks b where b.key = v_row ->> 'block'),
        'level', v_row ->> 'level',
        'role', v_row ->> 'role'
      ));
    when 'invitations' then
      v_label := coalesce(nullif(btrim(v_row ->> 'full_name'), ''), v_row ->> 'email', v_row ->> 'phone');
    when 'team_design', 'team_schedules' then
      v_label := (select t.name from public.teams t where t.tenant_id = v_tenant and t.id = v_team);
    when 'personal_event_types' then
      v_label := v_row ->> 'label';
    when 'client_tag_assignments' then
      -- Тег у клиента: кому поставили и какой; команда — у тега.
      v_entity_id := v_row ->> 'client_id';
      v_label := (select c.full_name from public.clients c
                   where c.id = (v_row ->> 'client_id')::uuid and c.tenant_id = v_tenant);
      select tg.team_id, jsonb_build_object('tag', tg.name)
        into v_team, v_meta
        from public.client_tags tg
       where tg.id = (v_row ->> 'tag_id')::uuid and tg.tenant_id = v_tenant;
    when 'client_attachments' then
      v_label := v_row ->> 'filename';
      select c.team_id, jsonb_build_object('client', c.full_name, 'client_id', c.id)
        into v_team, v_meta
        from public.clients c
       where c.id = (v_row ->> 'client_id')::uuid and c.tenant_id = v_tenant;
    when 'appointment_photos' then
      v_entity_id := v_row ->> 'appointment_id';
      select coalesce(c.full_name, nullif(btrim(a.comment), '')), a.team_id,
             jsonb_build_object('date', a.date, 'time', a.time_start, 'kind', a.kind)
        into v_label, v_team, v_meta
        from public.appointments a
        left join public.clients c on c.id = a.client_id and c.tenant_id = v_tenant
       where a.id = (v_row ->> 'appointment_id')::uuid and a.tenant_id = v_tenant;
    when 'day_cities' then
      v_label := v_row ->> 'city';
      v_meta := jsonb_build_object('date', v_row ->> 'date');
    when 'calendar_settings' then
      v_label := null;
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
$function$;

-- 3. Заморозка счёта — по всей истории, корзина включена -----------------------
-- (`account_has_history`: операции, корзина, чеки, оплаты по заявкам, инвойсы).

CREATE OR REPLACE FUNCTION public.guard_account_financial_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ledger_balance numeric(14,2);
  legacy_conversion boolean := false;
begin
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return new;
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'Компания финансового счёта неизменяема';
  end if;

  -- Единственный легальный переход охвата: общий счёт становится счётом
  -- бригады, к которой он и был подключён.
  legacy_conversion := old.scope = 'company'
    and new.scope = 'team'
    and new.brigade_id is not null
    and exists (
      select 1 from public.account_teams at
       where at.account_id = old.id and at.team_id = new.brigade_id
    );

  if new.scope is distinct from old.scope
     and not legacy_conversion
     and public.account_has_history(old.id) then
    raise exception 'Тип охвата счёта с операциями нельзя изменить';
  end if;
  if new.brigade_id is distinct from old.brigade_id
     and not legacy_conversion
     and public.account_has_history(old.id) then
    raise exception 'Команду счёта с операциями нельзя изменить';
  end if;
  if new.kind is distinct from old.kind and public.account_has_history(old.id) then
    raise exception 'Тип счёта с операциями нельзя изменить';
  end if;
  if new.opening_balance is distinct from old.opening_balance and public.account_has_history(old.id) then
    raise exception 'Начальный баланс счёта с операциями нельзя изменить';
  end if;
  if old.is_active and not new.is_active then
    select round(
      old.opening_balance + coalesce(sum(
        case
          when type = 'expense' then -amount
          when type = 'refund' then -abs(amount)
          else amount
        end
      ), 0),
      2
    ) into ledger_balance
    from public.finance_transactions
    where account_id = old.id;
    if ledger_balance <> 0 then
      raise exception 'Счёт с остатком % нельзя закрыть; сначала обнулите его', ledger_balance;
    end if;
  end if;
  return new;
end;
$function$;

-- 4. Категория, чья операция лежит в корзине, не удаляется ---------------------

create index if not exists deleted_operations_category_idx
  on public.deleted_operations ((operation ->> 'category_id'));

CREATE OR REPLACE FUNCTION public.guard_finance_category_history_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.tenant_id is not null
     and not exists (select 1 from public.tenants where id = old.tenant_id) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' and (
    exists (select 1 from public.finance_transactions where category_id = old.id)
    or exists (select 1 from public.finance_templates where category_id = old.id)
    or exists (select 1 from public.debts where category_id = old.id)
  ) then
    raise exception 'Категория используется в финансовой истории и не может быть удалена';
  end if;
  -- Операция в «Удалённых» вернётся с этой категорией: удалить категорию
  -- сейчас — значит молча обнулить её при «Вернуть».
  if tg_op = 'DELETE' and exists (
    select 1 from public.deleted_operations d
     where d.operation ->> 'category_id' = old.id::text
  ) then
    raise exception 'Категория есть у операции в «Удалённых» — сначала очистите или верните её'
      using errcode = '23503', hint = 'category:in_trash';
  end if;
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.type is distinct from old.type
  ) and (
    exists (select 1 from public.finance_transactions where category_id = old.id)
    or exists (select 1 from public.finance_templates where category_id = old.id)
    or exists (
      select 1 from public.deleted_operations d
       where d.operation ->> 'category_id' = old.id::text
    )
  ) then
    raise exception 'Тип и компания используемой категории неизменяемы';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

-- 5. Доход, у которого возврат лежит в корзине, не удаляется -------------------
-- Возврат в корзине «Вернуть» только при живом исходном доходе
-- (`assert_finance_transaction_integrity`). Доход без возвратов в живой таблице
-- удалялся — и возврат терял основание. Отдельный триггер, чтобы не трогать
-- `delete_operation` / `trash_deleted_operation`.

create or replace function public.guard_income_with_trashed_refund()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Каскад от удаления самой компании уносит всё вместе.
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;
  if exists (
    select 1 from public.deleted_operations d
     where d.tenant_id = old.tenant_id
       and d.type = 'refund'
       and d.operation ->> 'refund_of_id' = old.id::text
  ) then
    raise exception 'У этого дохода есть возврат в «Удалённых» — сначала верните его или очистите «Удалённые»'
      using errcode = '23514', hint = 'operation:refund_in_trash';
  end if;
  return old;
end;
$function$;

revoke all on function public.guard_income_with_trashed_refund() from public, anon, authenticated;

create index if not exists deleted_operations_refund_of_idx
  on public.deleted_operations ((operation ->> 'refund_of_id'))
  where type = 'refund';

drop trigger if exists trg_guard_income_with_trashed_refund on public.finance_transactions;
-- Имя раньше `trg_trash_deleted_operation` по алфавиту: отказ до переноса в корзину.
create trigger trg_guard_income_with_trashed_refund
  before delete on public.finance_transactions
  for each row
  when (old.type = 'income' and not public.calendar_delete_in_progress())
  execute function public.guard_income_with_trashed_refund();

-- 6. Справки о компании — только своей -----------------------------------------
-- Клиент зовёт `tenant_business_date` лишь со своей компанией (зеркало). Все
-- вызыватели внутри базы — security definer под postgres, у них auth.uid() тот
-- же вошедший: членство проверяется честно; сервисный вызов (uid пуст) пускаем.
-- `tenant_currency` клиент не зовёт вовсе — закрыта для всех, кроме сервера.

create or replace function public.tenant_business_date(p_tenant_id uuid)
returns date
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  tenant_timezone text;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.tenant_members tm
     where tm.user_id = auth.uid() and tm.tenant_id = p_tenant_id
  ) then
    return null;
  end if;
  select cs.timezone into tenant_timezone
    from public.calendar_settings cs
   where cs.tenant_id = p_tenant_id;
  tenant_timezone := coalesce(nullif(btrim(tenant_timezone), ''), 'Europe/Nicosia');
  begin
    return (current_timestamp at time zone tenant_timezone)::date;
  exception when invalid_parameter_value then
    return (current_timestamp at time zone 'Europe/Nicosia')::date;
  end;
end;
$function$;

revoke all on function public.tenant_business_date(uuid) from public, anon;
grant execute on function public.tenant_business_date(uuid) to authenticated, service_role;

revoke all on function public.tenant_currency(uuid) from public, anon, authenticated;
grant execute on function public.tenant_currency(uuid) to service_role;

-- 7. Имя категории уникально в команде и виде -----------------------------------
-- Скрытые остаются в счёте имён (они видны в справочнике); выведенные из
-- продукта (`retired`) — нет. При дублях индекс НЕ создаётся (предупреждение):
-- сначала их разбирают руками.

do $$
begin
  if exists (
    select 1 from public.finance_categories
     where tenant_id is not null and not retired
     group by tenant_id, team_id, type, lower(btrim(name))
    having count(*) > 1
  ) then
    raise warning 'finance_categories: есть дубли имён в команде — уникальный индекс не создан';
  else
    create unique index if not exists ux_finance_categories_team_type_name
      on public.finance_categories (tenant_id, team_id, type, lower(btrim(name)))
      where tenant_id is not null and not retired;
  end if;
end
$$;

-- Сторож: миграция сделала то, что обещала ----------------------------------------

do $$
declare
  def text;
begin
  select pg_get_functiondef('public.log_change'::regproc) into def;
  if def not like '%''account_id'', v_row ->> ''account_id''%' or def not like '%''debt_id'', v_row ->> ''debt_id''%' then
    raise exception 'log_change не кладёт счёт и долг в meta';
  end if;

  select pg_get_functiondef('public.guard_account_financial_history'::regproc) into def;
  if def like '%from public.finance_transactions where account_id = old.id%'
     or (length(def) - length(replace(def, 'account_has_history(old.id)', ''))) / length('account_has_history(old.id)') <> 4 then
    raise exception 'guard_account_financial_history должен замораживать счёт по account_has_history';
  end if;

  select pg_get_functiondef('public.guard_finance_category_history_delete'::regproc) into def;
  if def not like '%deleted_operations%' then
    raise exception 'guard_finance_category_history_delete не смотрит корзину';
  end if;

  if not exists (
    select 1 from pg_policies
     where tablename = 'deleted_operations' and policyname = 'deleted_operations_select'
       and qual like '%hidden_account_ids%' and qual like '%member_finance_window_starts%'
  ) then
    raise exception 'deleted_operations_select не режет скрытые счета и окно';
  end if;
  if not exists (
    select 1 from pg_policies
     where tablename = 'change_log' and policyname = 'change_log_select_partner'
       and qual like '%hidden_account_ids%' and qual like '%member_finance_window_starts%'
       and qual like '%account_id%'
  ) then
    raise exception 'change_log_select_partner не режет скрытые счета и окно';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.finance_transactions'::regclass
       and tgname = 'trg_guard_income_with_trashed_refund' and not tgisinternal
  ) then
    raise exception 'нет триггера trg_guard_income_with_trashed_refund';
  end if;

  if has_function_privilege('anon', 'public.tenant_business_date(uuid)', 'execute')
     or has_function_privilege('anon', 'public.tenant_currency(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.tenant_currency(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.guard_income_with_trashed_refund()', 'execute')
     or not has_function_privilege('authenticated', 'public.tenant_business_date(uuid)', 'execute') then
    raise exception 'права на справки о компании и сторожа расходятся с замыслом';
  end if;
end
$$;
