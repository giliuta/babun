-- «УДАЛИТЬ НАВСЕГДА» СТИРАЕТ И КАЛЕНДАРЬ С ДЕНЬГАМИ (04.10, сессия 017,
-- аудит календаря).
--
-- Было: «Кабинет → Архив → Удалить навсегда» падало у любого календаря, где
-- была оплаченная запись или долг, — «Не удалось удалить», календарь
-- оставался в архиве:
--   • счета удалялись РАНЬШЕ записей. Ссылка `appointments.payment_account_id`
--     (ON DELETE SET NULL) обновляла оплаченные записи, триггер
--     `appointments_finance_sync` звал сверку денег, а та пыталась заново
--     провести уже стёртые авто-доходы и не находила ни одного счёта команды:
--     «Для этого способа оплаты нет счёта, принимающего деньги заявок».
--     У аккаунта без тарифа то же обновление отбивал `appointments_free_readonly`;
--   • долги и шаблоны команды «обнулялись» (`team_id/brigade_id = null`), а с
--     25.09 команда у них обязательна (NOT NULL и `fill_money_team`).
--
-- Стало (тело — живое, `pg_get_functiondef` перед правкой; меняется только
-- порядок и судьба долгов, шаблонов, корзины и очереди SMS):
--   • записи календаря удаляются ДО счетов — к удалению счёта ссылаться на
--     него уже некому, сверка денег не просыпается;
--   • шаблоны операций команды удаляются (до счетов, чтобы их ссылка на счёт
--     не обновлялась впустую), долги команды — тоже: это деньги стёртого
--     календаря, «в живых финансах их не существует»;
--   • операции, которые стирание отправило в «Удалённые операции» (триггер
--     корзины), оттуда тоже уходят: вернуть их некуда — их счетов больше нет;
--   • ждущие отправки SMS календаря снимаются: иначе они уходили бы клиентам
--     с пустой датой и временем (ссылка на запись обнуляется).

create or replace function public.delete_calendar(p_team_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  delete from public.finance_transactions
   where tenant_id = v_tenant and account_id = any (v_accounts);
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

  delete from public.finance_transfer_requests
   where tenant_id = v_tenant and team_id = p_team_id;
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

do $guard$
declare
  v_src text;
begin
  select prosrc into v_src from pg_proc
   where oid = 'public.delete_calendar(text)'::regprocedure;
  if position('update public.debts' in v_src) > 0
     or position('update public.finance_templates' in v_src) > 0 then
    raise exception 'delete_calendar: долги или шаблоны снова обнуляются вместо удаления';
  end if;
  if position('delete from public.appointments' in v_src)
     > position('delete from public.accounts' in v_src) then
    raise exception 'delete_calendar: счета удаляются раньше записей';
  end if;
  if position('delete from public.finance_templates' in v_src) = 0
     or position('delete from public.debts' in v_src) = 0 then
    raise exception 'delete_calendar: шаблоны и долги команды не удаляются';
  end if;
end;
$guard$;
