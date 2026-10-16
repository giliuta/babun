-- ДЕНЬГИ ЗАДНИМ ЧИСЛОМ ЛОЖАТСЯ В ДЕНЬ ВИЗИТА.
--
-- Человек вносит прошлое: создаёт сегодня визит на прошлую дату и тут же
-- отмечает его оплаченным. Проводка ложилась на «сегодня» (дата платежа по
-- умолчанию — момент нажатия), и в финансах текущего месяца оказывались
-- деньги давно прошедших работ.
--
-- Правило: заявка создана в этот же рабочий день компании, а её дата —
-- раньше сегодняшней, значит это ввод истории, и деньги ложатся в день
-- визита. Во всех остальных случаях — как было: долг за старый визит,
-- оплаченный сегодня, остаётся сегодняшним; явно выбранная прошлая дата
-- платежа (не сегодняшняя) по-прежнему главнее. `created_at` заявки
-- ставит сервер и менять его нельзя никому, поэтому правило не обойти.
--
-- ИЗВЕСТНОЕ ОГРАНИЧЕНИЕ: явно выбранное «сегодня» неотличимо от даты по
-- умолчанию (`nullif(meta_occurred_on, business_today)`). Визит, внесённый
-- сегодня задним числом и действительно оплаченный сегодня, ляжет в день
-- визита; положить его на сегодня можно, только выбрав дату платежа
-- отличной от сегодняшней.
--
-- Возвраты в режиме ввода истории (снятие платежа «деньги не поступили»,
-- возврат при отмене визита, возврат переплаты) датируются днём своего
-- дохода: это правка того же ввода, а не событие сегодняшнего дня. Иначе
-- прошлый месяц показывал бы доход, а текущий — его минус. Возврат в любой
-- другой день — настоящее событие и остаётся сегодняшним.
--
-- ЗАВИСИМОСТЬ. От `public.appointment_history_entry_date(uuid)` теперь
-- зависят три функции, и каждая будущая миграция, переписывающая их целиком,
-- обязана сохранить вызов (сторож —
-- `apps/mobile/src/features/appointments/history-payment-date-contract.test.ts`):
--   * `public.reconcile_appointment_finance` — дата дохода и дата возврата;
--   * `public.cancel_appointment_payment` — дата сторно «деньги не поступили»;
--   * `public.refund_appointment_overpayment` — дата возврата переплаты.
-- Тела меняются точечной заменой в боевом определении: перед заменой
-- сверяется `md5(prosrc)` живого тела (чужая правка не будет молча
-- перезаписана), а каждый якорь обязан встретиться ровно один раз. Права и
-- владельцы не трогаются.
--
-- ПЕРЕНОС УЖЕ ЗАПИСАННОГО — одним блоком, атомарно: таблица финансов
-- запирается до выборки (параллельный возврат не проскочит между выборкой и
-- переносом), сторож целостности и журнал изменений снимаются только внутри
-- блока и возвращаются в нём же. Переносятся лишь строки, созданные начиная
-- с месяца, когда ошибка проявилась: старая история (и сданные по ней
-- кварталы VAT) не трогается. Строки с чеком или инвойсом не переносятся: у
-- документа своя дата выдачи. Каждая перенесённая строка с прежней датой
-- остаётся в `public.finance_occurred_on_fixes` — перенос можно откатить.

create or replace function public.appointment_history_entry_date(p_appointment_id uuid)
 returns date
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  appt_tenant uuid;
  appt_date text;
  appt_created timestamptz;
  tenant_timezone text;
  business_today date;
  created_day date;
  visit_day date;
begin
  select a.tenant_id, a.date, a.created_at
    into appt_tenant, appt_date, appt_created
    from public.appointments a
   where a.id = p_appointment_id;
  if appt_tenant is null or appt_created is null
     or appt_date is null or appt_date !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  -- Дата заявки — текст: несуществующий день не роняет проводку, а просто
  -- оставляет её сегодняшней.
  begin
    visit_day := appt_date::date;
  exception when others then
    return null;
  end;
  business_today := public.tenant_business_date(appt_tenant);
  select cs.timezone into tenant_timezone
    from public.calendar_settings cs
   where cs.tenant_id = appt_tenant;
  tenant_timezone := coalesce(nullif(btrim(tenant_timezone), ''), 'Europe/Nicosia');
  begin
    created_day := (appt_created at time zone tenant_timezone)::date;
  exception when invalid_parameter_value then
    created_day := (appt_created at time zone 'Europe/Nicosia')::date;
  end;
  if created_day = business_today and visit_day < business_today then
    return visit_day;
  end if;
  return null;
end;
$function$;

revoke all on function public.appointment_history_entry_date(uuid) from public, anon, authenticated;

do $$
declare
  body text;
  -- Функция, md5 живого тела, на котором построена правка.
  expected text[][] := array[
    array['public.reconcile_appointment_finance(uuid,numeric,numeric,numeric,text,text,boolean)', '383aecf02d6253b1a3d4df91565dd835'],
    array['public.cancel_appointment_payment(uuid,text,uuid)', '0271aa4c4b145b124c0339aa0e5995c4'],
    array['public.refund_appointment_overpayment(uuid,numeric,uuid)', 'dc461888630a304b0bc0886f3323885f']
  ];
  -- Функция, якорь, замена.
  patches text[][] := array[
    -- Доход сверки: явная прошлая дата платежа, иначе день визита при вводе
    -- истории, иначе сегодня.
    array['public.reconcile_appointment_finance(uuid,numeric,numeric,numeric,text,text,boolean)',
          'coalesce(meta_occurred_on, business_today),',
          'coalesce(nullif(meta_occurred_on, business_today), public.appointment_history_entry_date(appointment_row.id), business_today),'],
    -- Возврат сверки знает дату своего дохода.
    array['public.reconcile_appointment_finance(uuid,numeric,numeric,numeric,text,text,boolean)',
          E'          income.invoice_id,\n          coalesce(income.appointment_payment_kind, ''settlement'') as payment_kind,',
          E'          income.invoice_id,\n          income.occurred_on,\n          coalesce(income.appointment_payment_kind, ''settlement'') as payment_kind,'],
    array['public.reconcile_appointment_finance(uuid,numeric,numeric,numeric,text,text,boolean)',
          E'          business_today,\n          ''auto'',\n          income_candidate.id,',
          E'          case\n            when public.appointment_history_entry_date(appointment_row.id) is not null\n              then income_candidate.occurred_on\n            else business_today\n          end,\n          ''auto'',\n          income_candidate.id,'],
    array['public.cancel_appointment_payment(uuid,text,uuid)',
          E'    business_today, ''auto'', income.id, null,',
          E'    case\n      when public.appointment_history_entry_date(appt.id) is not null then income.occurred_on\n      else business_today\n    end, ''auto'', income.id, null,'],
    array['public.refund_appointment_overpayment(uuid,numeric,uuid)',
          E'      business_today, ''auto'', income.id, null,',
          E'      case\n        when public.appointment_history_entry_date(appt.id) is not null then income.occurred_on\n        else business_today\n      end, ''auto'', income.id, null,']
  ];
  i integer;
begin
  for i in 1 .. array_length(expected, 1) loop
    if (select md5(prosrc) from pg_proc where oid = expected[i][1]::regprocedure)
       is distinct from expected[i][2] then
      raise exception '% изменилась после сверки — пересоберите миграцию от живого тела', expected[i][1];
    end if;
  end loop;
  for i in 1 .. array_length(patches, 1) loop
    body := pg_get_functiondef(patches[i][1]::regprocedure);
    if (length(body) - length(replace(body, patches[i][2], ''))) / length(patches[i][2]) <> 1 then
      raise exception '%: якорь даты не найден ровно один раз', patches[i][1];
    end if;
    execute replace(body, patches[i][2], patches[i][3]);
  end loop;
end;
$$;

-- Прежние даты перенесённых строк — для отката. Только для сервера.
create table if not exists public.finance_occurred_on_fixes (
  transaction_id uuid primary key,
  old_occurred_on date not null,
  new_occurred_on date not null,
  fixed_at timestamptz not null default now()
);
alter table public.finance_occurred_on_fixes enable row level security;
revoke all on table public.finance_occurred_on_fixes from public, anon, authenticated;

do $$
declare
  -- Начало месяца, в котором ошибка проявилась: раньше строки не трогаем.
  fix_from constant timestamptz := '2026-10-01 00:00:00+00';
  rec record;
  visit_day date;
  zone_name text;
  selected integer;
  moved integer;
  min_old date;
  max_old date;
  min_new date;
  max_new date;
begin
  perform set_config('lock_timeout', '5s', true);
  lock table public.finance_transactions in share row exclusive mode;

  create temp table _history_payment_dates (
    id uuid primary key,
    old_date date not null,
    new_date date not null
  ) on commit drop;

  for rec in
    select tx.id, tx.occurred_on, tx.created_at as tx_created,
           a.date as visit_text, a.created_at as appt_created,
           coalesce(nullif(btrim(cs.timezone), ''), 'Europe/Nicosia') as tz
      from public.finance_transactions tx
      join public.appointments a on a.id = tx.appointment_id
      left join public.calendar_settings cs on cs.tenant_id = tx.tenant_id
     where tx.source = 'auto'
       and tx.type = 'income'
       and tx.invoice_id is null
       and tx.created_at >= fix_from
       and a.date ~ '^\d{4}-\d{2}-\d{2}$'
       and not exists (select 1 from public.receipts rc where rc.transaction_id = tx.id)
  loop
    -- Несуществующая дата или зона компании — строку не трогаем.
    begin
      visit_day := rec.visit_text::date;
      zone_name := rec.tz;
      perform now() at time zone zone_name;
    exception when others then
      continue;
    end;
    if (rec.appt_created at time zone zone_name)::date = (rec.tx_created at time zone zone_name)::date
       and rec.occurred_on = (rec.tx_created at time zone zone_name)::date
       and visit_day < rec.occurred_on then
      insert into _history_payment_dates (id, old_date, new_date)
      values (rec.id, rec.occurred_on, visit_day)
      on conflict (id) do nothing;
      -- Возврат этого дохода, записанный в тот же день, едет вместе с ним.
      insert into _history_payment_dates (id, old_date, new_date)
      select refund.id, refund.occurred_on, visit_day
        from public.finance_transactions refund
       where refund.refund_of_id = rec.id
         and refund.type = 'refund'
         and refund.source = 'auto'
         and refund.invoice_id is null
         and (refund.created_at at time zone zone_name)::date = (rec.appt_created at time zone zone_name)::date
         and refund.occurred_on = (refund.created_at at time zone zone_name)::date
      on conflict (id) do nothing;
    end if;
  end loop;

  select count(*), min(old_date), max(old_date), min(new_date), max(new_date)
    into selected, min_old, max_old, min_new, max_new
    from _history_payment_dates;

  insert into public.finance_occurred_on_fixes (transaction_id, old_occurred_on, new_occurred_on)
  select id, old_date, new_date from _history_payment_dates
  on conflict (transaction_id) do nothing;

  alter table public.finance_transactions disable trigger trg_assert_finance_transaction_integrity;
  alter table public.finance_transactions disable trigger zz_log_change;
  update public.finance_transactions tx
     set occurred_on = moved_row.new_date
    from _history_payment_dates moved_row
   where tx.id = moved_row.id
     and tx.occurred_on = moved_row.old_date;
  get diagnostics moved = row_count;
  alter table public.finance_transactions enable trigger zz_log_change;
  alter table public.finance_transactions enable trigger trg_assert_finance_transaction_integrity;

  if moved <> selected then
    raise exception 'Дата ввода истории: выбрано %, перенесено % — перенос отменён', selected, moved;
  end if;
  raise notice 'Дата ввода истории: перенесено % строк; было % … %, стало % … %',
    moved, min_old, max_old, min_new, max_new;
end;
$$;

-- Сторож: заплатки на месте, сторож целостности и журнал снова включены,
-- таблица отката закрыта для клиентов.
do $$
begin
  if (select prosrc from pg_proc
       where oid = 'public.reconcile_appointment_finance(uuid,numeric,numeric,numeric,text,text,boolean)'::regprocedure)
     not like '%appointment_history_entry_date(appointment_row.id), business_today)%'
     or (select prosrc from pg_proc
          where oid = 'public.reconcile_appointment_finance(uuid,numeric,numeric,numeric,text,text,boolean)'::regprocedure)
     not like '%then income_candidate.occurred_on%'
     or (select prosrc from pg_proc
          where oid = 'public.cancel_appointment_payment(uuid,text,uuid)'::regprocedure)
     not like '%appointment_history_entry_date(appt.id)%'
     or (select prosrc from pg_proc
          where oid = 'public.refund_appointment_overpayment(uuid,numeric,uuid)'::regprocedure)
     not like '%appointment_history_entry_date(appt.id)%' then
    raise exception 'Дата ввода истории: заплатка не применилась';
  end if;
  if (
    select count(*) from pg_trigger
     where tgrelid = 'public.finance_transactions'::regclass
       and tgname in ('trg_assert_finance_transaction_integrity', 'zz_log_change')
       and tgenabled = 'O'
  ) <> 2 then
    raise exception 'Сторож целостности или журнал финансов не включён обратно';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.finance_occurred_on_fixes'::regclass)
     or exists (
       select 1 from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name = 'finance_occurred_on_fixes'
          and grantee in ('anon', 'authenticated', 'PUBLIC')
     ) then
    raise exception 'Таблица отката дат открыта клиентам';
  end if;
end;
$$;
