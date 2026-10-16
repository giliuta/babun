-- СЕРВЕР ФИНАНСОВ, ВТОРОЙ КРУГ (16.10): три дыры, найденные на локальной базе.
--
-- 1. `delete_calendar` стирал проводки только счетов календаря: перевод с
--    соседним календарём оставлял на живом счёте одну ногу навсегда (отмена —
--    «перевод повреждён», удаление ноги — «нельзя удалить одну часть»).
-- 2. `guard_debt_payment_total` не сверял компанию и сторону денег: доход
--    гасил долг чужой компании (и раскрывал его остаток), расход — долг «мне
--    должны».
-- 3. Категорию с историей можно было увести в другую команду — старые
--    операции переставали сохраняться и возвращаться из корзины.
--
-- Тела взяты из живых (локальные = боевые по md5), правки — только эти.
-- Проверка перед накатом на боевой — уже лежащие пары долг/операция:
--   select t.id from finance_transactions t join debts d on d.id = t.debt_id
--    where d.tenant_id <> t.tenant_id or (d.direction = 'incoming') <> (t.type = 'income');
-- и перевод без пары:
--   select transfer_group_id from finance_transactions where type = 'transfer'
--    group by 1 having count(*) <> 2;

create or replace function public.delete_calendar(p_team_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_team public.teams%rowtype;
  v_live integer;
  v_accounts uuid[];
  n_appointments integer := 0;
  n_accounts integer := 0;
  n_operations integer := 0;
  n_services integer := 0;
  n_documents integer := 0;
  n_debts integer := 0;
begin
  if v_tenant is null then
    raise exception 'Компания не определена';
  end if;
  if public.current_user_role() is distinct from 'owner' then
    raise exception 'Удалить календарь может только владелец';
  end if;

  select * into v_team
    from public.teams
   where id = p_team_id and tenant_id = v_tenant
   for update;
  if not found then
    raise exception 'Календарь не найден';
  end if;

  select count(*) into v_live
    from public.teams
   where tenant_id = v_tenant and is_active and id <> p_team_id;
  if v_live = 0 and v_team.is_active then
    raise exception 'Последний календарь удалить нельзя';
  end if;

  insert into public._calendar_delete_context (transaction_id, tenant_id, team_id)
  values (txid_current(), v_tenant, p_team_id)
  on conflict (transaction_id) do update
    set tenant_id = excluded.tenant_id,
        team_id = excluded.team_id,
        started_at = now();

  select coalesce(array_agg(id), '{}') into v_accounts
    from public.accounts
   where tenant_id = v_tenant and brigade_id = p_team_id;

  update public.invoices
     set status = 'void'
   where tenant_id = v_tenant
     and brigade_id = p_team_id
     and status <> 'void';
  get diagnostics n_documents = row_count;

  update public.receipts
     set status = 'void'
   where tenant_id = v_tenant
     and status <> 'void'
     and (
       account_id = any (v_accounts)
       or transaction_id in (
         select id from public.finance_transactions
          where tenant_id = v_tenant and account_id = any (v_accounts)
       )
       or appointment_id in (
         select id from public.appointments
          where tenant_id = v_tenant and team_id = p_team_id
       )
     );

  -- ПЕРЕВОД УХОДИТ ЦЕЛИКОМ. Стирались только проводки счетов календаря, и
  -- перевод с соседним календарём терял одну ногу: на живом счёте оставалась
  -- половина (+40 из ниоткуда), а отменить её было нельзя — «перевод
  -- повреждён». Обе ноги группы, задевшей счёт календаря, — вместе.
  delete from public.finance_transactions
   where tenant_id = v_tenant
     and (
       account_id = any (v_accounts)
       or transfer_group_id in (
         select tx.transfer_group_id
           from public.finance_transactions tx
          where tx.tenant_id = v_tenant
            and tx.account_id = any (v_accounts)
            and tx.transfer_group_id is not null
       )
     );
  get diagnostics n_operations = row_count;

  update public.finance_transactions
     set team_id = null
   where tenant_id = v_tenant and team_id = p_team_id;

  -- Корзина: стёртые выше операции триггер положил в «Удалённые операции»,
  -- а вернуть их некуда — счета календаря уходят следом.
  delete from public.deleted_operations
   where tenant_id = v_tenant and team_id = p_team_id;

  -- Ждущие отправки SMS календаря: после удаления записи они ушли бы
  -- клиенту с пустой датой и временем.
  delete from public.sms_messages
   where tenant_id = v_tenant
     and status = 'queued'
     and (
       team_id = p_team_id
       or appointment_id in (
         select id from public.appointments
          where tenant_id = v_tenant and team_id = p_team_id
       )
     );

  -- ЗАПИСИ — ДО СЧЕТОВ: иначе удаление счёта обновляет оплаченные записи
  -- (`payment_account_id` SET NULL), и сверка денег пытается провести
  -- стёртые доходы заново.
  delete from public.appointments
   where tenant_id = v_tenant and team_id = p_team_id;
  get diagnostics n_appointments = row_count;

  -- Шаблоны и долги команды — удаляются: команда у них обязательна.
  delete from public.finance_templates
   where tenant_id = v_tenant and brigade_id = p_team_id;
  delete from public.debts
   where tenant_id = v_tenant and team_id = p_team_id;
  get diagnostics n_debts = row_count;

  delete from public.accounts
   where tenant_id = v_tenant and brigade_id = p_team_id;
  get diagnostics n_accounts = row_count;

  update public.masters set team_id = null
   where tenant_id = v_tenant and team_id = p_team_id;

  -- Запрос перевода — по любому его счёту, а не по команде источника:
  -- запрос «в календарь» оставался «живым» со ссылкой на стёртый счёт.
  delete from public.finance_transfer_requests
   where tenant_id = v_tenant
     and (
       team_id = p_team_id
       or from_account_id = any (v_accounts)
       or to_account_id = any (v_accounts)
     );
  delete from public.account_teams where team_id = p_team_id;
  delete from public.member_access
   where tenant_id = v_tenant and team_id = p_team_id;
  delete from public.team_finance_settings
   where tenant_id = v_tenant and team_id = p_team_id;
  delete from public.team_schedules
   where tenant_id = v_tenant and team_id = p_team_id;
  delete from public.day_cities
   where tenant_id = v_tenant and team_id = p_team_id;
  delete from public.day_extras
   where tenant_id = v_tenant and team_id = p_team_id;
  delete from public.recurring_reminders
   where tenant_id = v_tenant and team_id = p_team_id;

  delete from public.services
   where tenant_id = v_tenant and team_id = p_team_id;
  get diagnostics n_services = row_count;

  delete from public.teams
   where id = p_team_id and tenant_id = v_tenant;

  delete from public._calendar_delete_context
   where transaction_id = txid_current();

  return jsonb_build_object(
    'team_id', p_team_id,
    'name', v_team.name,
    'appointments', n_appointments,
    'accounts', n_accounts,
    'operations', n_operations,
    'services', n_services,
    'documents_voided', n_documents,
    'debts', n_debts
  );
end;
$function$;

create or replace function public.guard_debt_payment_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_debt public.debts%rowtype;
  v_paid numeric;
begin
  if new.debt_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.debt_id is not distinct from old.debt_id
     and abs(new.amount) <= abs(old.amount) then
    return new;
  end if;

  select * into v_debt from public.debts where id = new.debt_id for update;
  if not found then
    return new;
  end if;
  -- ЧУЖОЙ ДОЛГ — НЕ ДОЛГ ЭТОЙ ОПЕРАЦИИ. Ссылка на долг без компании в ключе:
  -- доход одной компании гасил долг другой, а отказ «осталось N» выдавал
  -- остаток чужого долга по одному UUID.
  if v_debt.tenant_id is distinct from new.tenant_id then
    raise exception 'Долг не найден'
      using errcode = '23503', hint = 'debt:not_found';
  end if;
  -- СТОРОНА ДЕНЕГ — ПО НАПРАВЛЕНИЮ ДОЛГА: «мне должны» гасит доход, «я
  -- должен» — расход. Сумма считалась по модулю, и расход закрывал долг,
  -- который должны вернуть нам.
  if (v_debt.direction = 'incoming') is distinct from (new.type = 'income')
     or new.type not in ('income', 'expense') then
    if v_debt.direction = 'incoming' then
      raise exception 'Этот долг гасится доходом'
        using errcode = '23514', hint = 'debt:wrong_side';
    end if;
    raise exception 'Этот долг гасится расходом'
      using errcode = '23514', hint = 'debt:wrong_side';
  end if;

  select coalesce(sum(abs(tx.amount)), 0) into v_paid
    from public.finance_transactions tx
   where tx.debt_id = new.debt_id
     and tx.id <> new.id;

  if v_paid + abs(new.amount) > v_debt.amount then
    raise exception 'По долгу осталось % — платёж не может быть больше', greatest(v_debt.amount - v_paid, 0)
      using errcode = 'P0001', hint = 'debt:overpay';
  end if;
  return new;
end;
$function$;

create or replace function public.guard_finance_category_history_delete()
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
    -- Команда тоже: категория, уехавшая в другую команду, делала каждую свою
    -- старую операцию непроправимой («категория не соответствует…»), а
    -- «Вернуть» из корзины — невозможным.
    or new.team_id is distinct from old.team_id
  ) and (
    exists (select 1 from public.finance_transactions where category_id = old.id)
    or exists (select 1 from public.finance_templates where category_id = old.id)
    or exists (
      select 1 from public.deleted_operations d
       where d.operation ->> 'category_id' = old.id::text
    )
  ) then
    raise exception 'Тип, команда и компания используемой категории неизменяемы';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;
