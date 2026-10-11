-- ЦЕНА ЗА КАЛЕНДАРЬ (владелец 12.10: «за календарь — хорошая идея», «давай
-- поднимай цену»): €9.99 в месяц за рабочий календарь, €7.99 при оплате за
-- год; люди бесплатно и без лимита. Заменяет лестницу Соло · Про · Макс.
--
-- В базе оплата за календари — тот же «полный доступ» (`plan = 'max'`), а
-- сколько календарей оплачено — `paid_calendars` (количество в подписке
-- Stripe, пишет вебхук). Календари НЕ упираются в лимит: добавили —
-- подписка растёт со следующего платежа (`tariff-checkout`, действие sync, и
-- сверка вебхуком перед счётом). Старые подписчики Про (их нет) и пробные
-- «Про» доживают по старым числам.

alter table public.tenants
  add column if not exists paid_calendars integer
    check (paid_calendars is null or paid_calendars >= 0);

comment on column public.tenants.paid_calendars is
  'Календарей в подписке Stripe (quantity). Пишет только stripe-webhook.';

-- Только вебхук: из приложения число оплаченных календарей не меняется.
create or replace function public.tenants_guard_billing()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.role() is null
     or auth.role() = 'service_role'
     or current_setting('babun.billing_write', true) = 'on' then
    return new;
  end if;
  if new.plan is distinct from old.plan
     or new.plan_override is distinct from old.plan_override
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.subscription_status is distinct from old.subscription_status
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.current_period_end is distinct from old.current_period_end
     or new.trial_tier is distinct from old.trial_tier
     or new.trial_started_at is distinct from old.trial_started_at
     or new.working_team_ids is distinct from old.working_team_ids
     or new.paid_calendars is distinct from old.paid_calendars then
    raise exception 'Тариф меняется только оплатой или пробным периодом'
      using errcode = '42501', hint = 'plan:billing';
  end if;
  return new;
end;
$function$;

-- Оплачено (или выдано навсегда, или пробный на всё) — календарей и людей без
-- лимита; старый пробный «Про» — 5; без оплаты — свой календарь, без людей.
create or replace function public.tenant_tier_limit(t_id uuid, p_what text)
returns integer
language sql
stable security definer
set search_path to 'public'
as $function$
  select case public.tenant_effective_plan(t_id)
    when 'max' then 1000
    when 'pro' then 5
    else case p_what when 'teams' then 1 else 0 end
  end
$function$;

-- Слова отказов — под цену за календарь (лимиты «до 50» больше не встречаются).
create or replace function public.enforce_plan_limits()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_plan text;
  v_limit integer;
  v_count integer;
begin
  if new.tenant_id is null then
    raise exception 'ограничение тарифа требует tenant_id' using errcode = '22023';
  end if;

  v_plan := public.tenant_effective_plan(new.tenant_id);

  -- Календари: новый или возвращённый из архива — в пределах лимита.
  if tg_table_name = 'teams' then
    if not new.is_active then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.is_active then
      return new;
    end if;
    v_limit := public.tenant_tier_limit(new.tenant_id, 'teams');
    select count(*)::integer into v_count
      from public.teams tm
     where tm.tenant_id = new.tenant_id
       and tm.is_active
       and tm.id <> new.id;
    if v_count >= v_limit then
      raise exception '%', case v_plan
          when 'pro' then 'В пробном Про — до 5 календарей'
          else 'Новые календари — после оплаты'
        end
        using errcode = 'P0001', hint = 'plan:teams';
    end if;
    return new;
  end if;

  -- Партнёры: приглашение — в пределах лимита (люди и ждущие приглашения).
  if tg_table_name = 'invitations' then
    if new.accepted_at is not null or new.expires_at <= statement_timestamp() then
      return new;
    end if;
    -- Тот же человек ещё раз (повтор ссылки, другая команда) — не новый партнёр.
    if exists (
      select 1
        from public.invitations i
       where i.tenant_id = new.tenant_id
         and lower(i.email) = lower(new.email)
         and i.id is distinct from new.id
         and i.accepted_at is null
         and i.expires_at > statement_timestamp()
    ) then
      return new;
    end if;
    v_limit := public.tenant_tier_limit(new.tenant_id, 'partners');
    select count(*)::integer into v_count
      from (
        select m.user_id::text as who
          from public.tenant_members m
         where m.tenant_id = new.tenant_id
           and m.role <> 'owner'
        union
        select lower(i.email)
          from public.invitations i
         where i.tenant_id = new.tenant_id
           and i.accepted_at is null
           and i.expires_at > statement_timestamp()
      ) people;
    if v_count >= v_limit then
      raise exception '%', case v_plan
          when 'pro' then 'В пробном Про — до 5 партнёров'
          else 'Партнёры — после оплаты календарей'
        end
        using errcode = 'P0001', hint = 'plan:partners';
    end if;
    return new;
  end if;

  -- Команда сверх лимита — только для просмотра.
  -- `team_id` есть не у каждой таблицы этого сторожа (у инвойса команда —
  -- `brigade_id`): PL/pgSQL разбирает выражение целиком до проверки имени
  -- таблицы, и `new.team_id` ронял любую вставку инвойса (аудит 03.10).
  if tg_table_name in ('appointments', 'clients')
     and (to_jsonb(new) ->> 'team_id') is not null
     and not public.team_is_working(new.tenant_id, to_jsonb(new) ->> 'team_id') then
    raise exception 'Эта команда сверх тарифа — только для просмотра'
      using errcode = 'P0001', hint = 'plan:team-frozen';
  end if;

  if v_plan is distinct from 'free' then
    return new;
  end if;

  if tg_table_name = 'appointments' then
    if new.kind = 'work' then
      raise exception 'Записывать клиентов можно после оплаты календаря'
        using errcode = 'P0001', hint = 'plan:book-clients';
    end if;
    return new;
  end if;

  if tg_table_name = 'clients' then
    raise exception 'Клиенты — после оплаты календаря'
      using errcode = 'P0001', hint = 'plan:clients';
  end if;

  if tg_table_name = 'services' then
    raise exception 'Услуги доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:services';
  end if;

  if tg_table_name = 'masters' then
    raise exception 'Мастера доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:masters';
  end if;

  if tg_table_name = 'invoices' then
    -- Сторно уже выписанного инвойса своей компании проходит на любом тарифе.
    if new.kind = 'credit_note' and exists (
      select 1
        from public.invoices original
       where original.id = new.credit_note_of_id
         and original.tenant_id = new.tenant_id
         and original.kind = 'invoice'
    ) then
      return new;
    end if;
    raise exception 'Документы доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:documents';
  end if;

  if tg_table_name = 'receipts' then
    raise exception 'Документы доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:documents';
  end if;

  return new;
end;
$function$;

-- Пробный — на всё: в компании «полный доступ» (было «Про» на 5 и 5).
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.create_company(text)'::regprocedure) into v_def;
  if position($q$case when v_trial then 'pro' end$q$ in v_def) = 0 then
    raise exception 'create_company: якорь пробного не найден';
  end if;
  execute replace(v_def, $q$case when v_trial then 'pro' end$q$, $q$case when v_trial then 'max' end$q$);

  select pg_get_functiondef('public.start_trial(text)'::regprocedure) into v_def;
  if position($q$  elsif p_tier = 'solo' then
    p_tier := 'pro';$q$ in v_def) = 0 then
    raise exception 'start_trial: якорь пробного не найден';
  end if;
  execute replace(v_def, $q$  elsif p_tier = 'solo' then
    p_tier := 'pro';$q$, $q$  else
    p_tier := 'max';$q$);
end;
$$;
