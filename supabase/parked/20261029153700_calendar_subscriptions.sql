-- ТАРИФ — У КАЛЕНДАРЯ. Каждый рабочий календарь оплачивается своей
-- подпиской Stripe: €9,99 в месяц или €7,99 в месяц при оплате за год. Можно
-- оплатить один календарь и не платить за другой. Люди бесплатно.
--
-- Было: одна подписка на аккаунт, количество — живые календари с работой
-- (`tenants.stripe_subscription_id`, `paid_calendars`). Стало:
--   • `calendar_subscriptions` — строка на календарь: его подписка, статус,
--     период и конец оплаченного срока. Пишет только `stripe-webhook`
--     (служебный ключ); приложение читает `calendar_tariffs()`.
--   • `calendar_effective_plan(аккаунт, календарь)` — тариф КАЛЕНДАРЯ:
--     «навсегда» и пробный аккаунта открывают все его календари, иначе —
--     живая подписка этого календаря.
--   • `tenant_effective_plan(аккаунт)` — тариф АККАУНТА для того, что у
--     аккаунта одно (партнёры, профиль, пробный): платный, если оплачен хоть
--     один календарь.
--   • Сторожа записей (`enforce_plan_limits`, `tenant_free_readonly_guard`,
--     `sms_messages_tier_guard`) и онлайн-запись судят по календарю СТРОКИ:
--     клиенты, записи, услуги, документы и SMS неоплаченного календаря —
--     только для просмотра, остальные календари работают.
--   • Календари больше не упираются в лимит: новый бесплатен, пока в нём нет
--     работы. «Рабочие команды сверх лимита» (`team_is_working`) уходят —
--     у каждого календаря своя оплата.
--   • Живая подписка аккаунта (на 29.10 она одна — аккаунт с одним
--     календарём) переезжает строкой на этот календарь; поля подписки у
--     аккаунта чистятся, клиент Stripe остаётся у аккаунта (карта одна на
--     все календари).

set local lock_timeout = '5s';

-- ─── Подписки календарей ─────────────────────────────────────────────────

create table public.calendar_subscriptions (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- Без внешнего ключа на календарь: календарь удаляют насовсем, а подписка
  -- в Stripe живёт до отмены — строка нужна вебхуку, чтобы её снять.
  team_id text not null,
  stripe_subscription_id text not null unique,
  status text not null
    check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete')),
  period text not null default 'month' check (period in ('month', 'year')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, team_id)
);

comment on table public.calendar_subscriptions is
  'Подписка Stripe каждого календаря. Пишет только stripe-webhook; читают calendar_tariffs() и функции тарифа.';

alter table public.calendar_subscriptions enable row level security;
-- Политик нет намеренно: ни чтения, ни записи с ключа приложения.
revoke all on public.calendar_subscriptions from public, anon, authenticated;
grant all on public.calendar_subscriptions to service_role;

-- ─── Тариф календаря и тариф аккаунта ────────────────────────────────────

create or replace function public.calendar_effective_plan(p_tenant uuid, p_team text)
returns text
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
    when t.plan_override in ('lifetime', 'beta_unlimited') then 'max'
    when t.trial_tier is not null and t.trial_ends_at > now() then t.trial_tier
    when exists (
      select 1
        from public.calendar_subscriptions s
       where s.tenant_id = t.id
         and s.team_id = p_team
         and s.status in ('active', 'trialing', 'past_due')
         and (s.current_period_end is null or s.current_period_end > now())
    ) then 'max'
    else 'free'
  end
    from public.tenants t
   where t.id = p_tenant
$function$;

revoke all on function public.calendar_effective_plan(uuid, text) from public, anon, authenticated;
grant execute on function public.calendar_effective_plan(uuid, text) to service_role;

create or replace function public.tenant_effective_plan(t_id uuid)
returns text
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
    when t.plan_override in ('lifetime', 'beta_unlimited') then 'max'
    when t.trial_tier is not null and t.trial_ends_at > now() then t.trial_tier
    when exists (
      select 1
        from public.calendar_subscriptions s
       where s.tenant_id = t.id
         and s.status in ('active', 'trialing', 'past_due')
         and (s.current_period_end is null or s.current_period_end > now())
    ) then 'max'
    else 'free'
  end
    from public.tenants t
   where t.id = t_id
$function$;

-- ─── Перенос живой подписки аккаунта на его календарь ────────────────────

do $$
declare
  v_ambiguous integer;
begin
  -- Подписку можно перенести, только если календарь один: при двух и больше
  -- непонятно, какой из них оплачен. Такой аккаунт останавливает накат.
  select count(*) into v_ambiguous
    from public.tenants t
   where t.stripe_subscription_id is not null
     and t.subscription_status in ('active', 'trialing', 'past_due')
     and t.plan_override is null
     and (select count(*) from public.teams tm where tm.tenant_id = t.id and tm.is_active) <> 1;
  if v_ambiguous > 0 then
    raise exception 'calendar_subscriptions: % аккаунт(ов) с живой подпиской и не одним календарём', v_ambiguous;
  end if;
end;
$$;

insert into public.calendar_subscriptions
  (tenant_id, team_id, stripe_subscription_id, status, period, current_period_end)
select t.id,
       tm.id,
       t.stripe_subscription_id,
       t.subscription_status,
       -- Годовая подписка оплачена больше чем на месяц вперёд; вебхук всё
       -- равно перепишет период по цене подписки при первом же событии.
       case when t.current_period_end > now() + interval '40 days' then 'year' else 'month' end,
       t.current_period_end
  from public.tenants t
  join public.teams tm on tm.tenant_id = t.id and tm.is_active
 where t.stripe_subscription_id is not null
   and t.subscription_status in ('active', 'trialing', 'past_due')
   and t.plan_override is null;

update public.tenants
   set plan = 'free',
       subscription_status = null,
       stripe_subscription_id = null,
       current_period_end = null,
       paid_calendars = null
 where stripe_subscription_id is not null
    or subscription_status is not null
    or paid_calendars is not null;

-- ─── Что видит приложение ────────────────────────────────────────────────

-- Тариф каждого календаря, который человек видит: владелец — все календари
-- аккаунта, партнёр — прикреплённые к нему. Оплачен ли календарь, знают все
-- (по нему экран гасит запись клиентов); срок, период и отмена — только
-- владелец и партнёр с правом «Тариф».
create or replace function public.calendar_tariffs()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'team_id', tm.id,
        'plan', public.calendar_effective_plan(tm.tenant_id, tm.id)
      )
      || case
        when public.current_user_role() = 'owner'
          or public.access_company('cabinet.tariff', 'read') then
          jsonb_build_object(
            'status', s.status,
            'period', s.period,
            'current_period_end', s.current_period_end,
            'cancel_at_period_end', s.cancel_at_period_end
          )
        else '{}'::jsonb
      end
      order by tm.id
    ),
    '[]'::jsonb
  )
    from public.teams tm
    left join public.calendar_subscriptions s
      on s.tenant_id = tm.tenant_id and s.team_id = tm.id
   where auth.uid() is not null
     and tm.tenant_id = public.current_tenant_id()
     and (
       public.current_user_role() = 'owner'
       or exists (
         select 1
           from public.member_calendars mc
          where mc.tenant_id = tm.tenant_id
            and mc.user_id = auth.uid()
            and mc.team_id = tm.id
       )
     )
$function$;

revoke all on function public.calendar_tariffs() from public, anon;
grant execute on function public.calendar_tariffs() to authenticated;

-- Оплаты тарифа — с подпиской и календарём каждой строки; `p_team` оставляет
-- только оплаты этого календаря (его подписки по метке и нынешняя по id —
-- перенесённая подписка метки календаря не несёт).
drop function if exists public.cabinet_tariff_payments(integer);

create function public.cabinet_tariff_payments(p_limit integer default 200, p_team text default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  active_tenant uuid := public.current_tenant_id();
  current_sub text;
  result jsonb;
begin
  if auth.uid() is null or active_tenant is null
     or not (public.current_user_role() = 'owner' or public.access_company('cabinet.tariff_payments', 'read')) then
    raise exception 'Оплаты тарифа открывает владелец аккаунта'
      using errcode = '42501', hint = 'access:not_owner';
  end if;

  select s.stripe_subscription_id into current_sub
    from public.calendar_subscriptions s
   where s.tenant_id = active_tenant
     and s.team_id = p_team;

  select coalesce(jsonb_agg(row_json order by processed_at desc), '[]'::jsonb)
    into result
    from (
      select e.processed_at,
             jsonb_build_object(
               'id', e.id,
               'event_type', e.event_type,
               'processed_at', e.processed_at,
               'payload', jsonb_build_object(
                 'created', e.payload -> 'created',
                 'data', jsonb_build_object(
                   'object', jsonb_build_object(
                     'id', inv -> 'id',
                     'amount_due', inv -> 'amount_due',
                     'amount_paid', inv -> 'amount_paid',
                     'total', inv -> 'total',
                     'currency', inv -> 'currency',
                     'created', inv -> 'created',
                     'status_transitions', jsonb_build_object('paid_at', inv -> 'status_transitions' -> 'paid_at'),
                     'hosted_invoice_url', inv -> 'hosted_invoice_url',
                     'invoice_pdf', inv -> 'invoice_pdf',
                     'subscription_details', jsonb_build_object('metadata', inv -> 'subscription_details' -> 'metadata'),
                     'parent', jsonb_build_object(
                       'subscription_details', jsonb_build_object(
                         'metadata', inv -> 'parent' -> 'subscription_details' -> 'metadata'
                       )
                     ),
                     'lines', jsonb_build_object(
                       'data', coalesce((
                         select jsonb_agg(jsonb_build_object(
                                  'amount', l -> 'amount',
                                  'description', l -> 'description',
                                  'period', l -> 'period',
                                  'metadata', l -> 'metadata',
                                  'price', jsonb_build_object(
                                    'metadata', l -> 'price' -> 'metadata',
                                    'lookup_key', l -> 'price' -> 'lookup_key',
                                    'nickname', l -> 'price' -> 'nickname'
                                  )
                                ))
                           from jsonb_array_elements(
                             case when jsonb_typeof(inv -> 'lines' -> 'data') = 'array'
                                  then inv -> 'lines' -> 'data' else '[]'::jsonb end
                           ) l
                       ), '[]'::jsonb)
                     )
                   )
                 )
               )
             ) as row_json
        from public.billing_events e
        cross join lateral (select e.payload -> 'data' -> 'object' as inv) x
        cross join lateral (
          select coalesce(
                   inv ->> 'subscription',
                   inv -> 'parent' -> 'subscription_details' ->> 'subscription'
                 ) as sub_id,
                 coalesce(
                   inv -> 'subscription_details' -> 'metadata' ->> 'team_id',
                   inv -> 'parent' -> 'subscription_details' -> 'metadata' ->> 'team_id'
                 ) as team_id
        ) tag
       where e.tenant_id = active_tenant
         and e.event_type in ('invoice.payment_succeeded', 'invoice.payment_failed')
         and (
           p_team is null
           or tag.team_id = p_team
           or (tag.team_id is null and tag.sub_id is not null and tag.sub_id = current_sub)
         )
       order by e.processed_at desc
       limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) rows;

  return result;
end;
$function$;

revoke all on function public.cabinet_tariff_payments(integer, text) from public, anon;
grant execute on function public.cabinet_tariff_payments(integer, text) to authenticated;

-- ─── Сторожа записей — по календарю строки ───────────────────────────────

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
  v_team text;
begin
  if new.tenant_id is null then
    raise exception 'ограничение тарифа требует tenant_id' using errcode = '22023';
  end if;

  -- Партнёры — у аккаунта: приглашают, когда оплачен хоть один календарь
  -- (люди и ждущие приглашения).
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
    v_plan := public.tenant_effective_plan(new.tenant_id);
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

  -- ТАРИФ — У КАЛЕНДАРЯ СТРОКИ. Календарь есть не у каждой таблицы этого
  -- сторожа и зовётся по-разному (у инвойса — `brigade_id`): PL/pgSQL
  -- разбирает выражение целиком до проверки имени таблицы, поэтому поле
  -- читается из `to_jsonb(new)`, а не `new.team_id`. Строка без календаря
  -- судится тарифом аккаунта.
  v_team := coalesce(to_jsonb(new) ->> 'team_id', to_jsonb(new) ->> 'brigade_id');
  v_plan := case
    when v_team is not null then public.calendar_effective_plan(new.tenant_id, v_team)
    else public.tenant_effective_plan(new.tenant_id)
  end;

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
    -- И возврат по чеку: нота к чеку своей компании — то же сторно.
    if new.kind = 'credit_note' and exists (
      select 1
        from public.receipts source
       where source.id = new.credit_note_of_receipt_id
         and source.tenant_id = new.tenant_id
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

-- Календари не ограничены числом: новый бесплатен, пока в нём нет работы.
drop trigger if exists teams_enforce_plan on public.teams;

create or replace function public.tenant_free_readonly_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team text;
begin
  if auth.uid() is null then
    return new;
  end if;

  -- Календарь строки; у файлов и тегов — календарь их клиента.
  if tg_table_name in ('appointments', 'clients') then
    v_team := to_jsonb(new) ->> 'team_id';
  else
    select c.team_id into v_team
      from public.clients c
     where c.tenant_id = new.tenant_id
       and c.id::text = to_jsonb(new) ->> 'client_id';
  end if;

  if (case
        when v_team is not null then public.calendar_effective_plan(new.tenant_id, v_team)
        else public.tenant_effective_plan(new.tenant_id)
      end) is distinct from 'free' then
    return new;
  end if;

  if tg_table_name = 'appointments' then
    if new.kind = 'work' or (tg_op = 'UPDATE' and old.kind = 'work') then
      raise exception 'Записи клиентов без тарифа — только для просмотра'
        using errcode = 'P0001', hint = 'plan:book-clients';
    end if;
    return new;
  end if;

  if tg_table_name = 'clients' then
    -- Архив — можно: он ничего не добавляет базе.
    if tg_op = 'UPDATE'
       and (to_jsonb(new) - 'deleted_at' - 'purge_at' - 'updated_at')
         = (to_jsonb(old) - 'deleted_at' - 'purge_at' - 'updated_at') then
      return new;
    end if;
    raise exception 'Клиенты без тарифа — только для просмотра'
      using errcode = 'P0001', hint = 'plan:clients';
  end if;

  -- Файлы и теги клиента.
  raise exception 'Клиенты без тарифа — только для просмотра'
    using errcode = 'P0001', hint = 'plan:clients';
end;
$function$;

create or replace function public.sms_messages_tier_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (case
        when new.team_id is not null then public.calendar_effective_plan(new.tenant_id, new.team_id)
        else public.tenant_effective_plan(new.tenant_id)
      end) is distinct from 'free' then
    return new;
  end if;
  if auth.uid() is not null then
    raise exception 'SMS — в тарифах Соло, Про и Макс'
      using errcode = 'P0001', hint = 'plan:sms';
  end if;
  -- Автоматическое без тарифа — не ставим в очередь.
  return null;
end;
$function$;

create or replace function public.online_booking_resolve(p_token text)
returns table(tenant_id uuid, team_id text, state text, business_name text, logo_url text, calendar_name text, country text, tz text)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  r record;
begin
  if p_token is null or p_token !~ '^[0-9A-Za-z]{10,64}$' then
    return;
  end if;
  select p.tenant_id, p.team_id, p.enabled, t.is_active, t.name as calendar_name,
         tn.name as business_name, tn.logo_url, tn.country,
         coalesce(nullif(t.timezone, ''), nullif(cs.timezone, ''), 'Europe/Nicosia') as tz
    into r
    from public.online_booking_pages p
    join public.teams t on t.tenant_id = p.tenant_id and t.id = p.team_id
    join public.tenants tn on tn.id = p.tenant_id
    left join public.calendar_settings cs on cs.tenant_id = p.tenant_id
   where p.token = p_token;
  if not found then
    return;
  end if;
  tenant_id := r.tenant_id;
  team_id := r.team_id;
  business_name := r.business_name;
  logo_url := r.logo_url;
  calendar_name := r.calendar_name;
  country := r.country;
  tz := r.tz;
  -- Закрыто: выключили, календарь в архиве или не оплачен — запись всё
  -- равно не встала бы.
  state := case
    when r.enabled is not true or r.is_active is not true then 'closed'
    when public.calendar_effective_plan(r.tenant_id, r.team_id) is not distinct from 'free' then 'closed'
    else 'open' end;
  return next;
end;
$function$;

-- «Рабочие команды сверх лимита» больше не судят: у каждого календаря своя
-- оплата. Звали её только два сторожа выше.
drop function if exists public.team_is_working(uuid, text);

-- ─── Сторож ──────────────────────────────────────────────────────────────

do $$
begin
  if exists (
    select 1 from public.tenants
     where stripe_subscription_id is not null or subscription_status is not null
  ) then
    raise exception 'calendar_subscriptions: у аккаунта осталась подписка';
  end if;
  if exists (
    select 1
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('calendar_effective_plan', 'calendar_tariffs', 'cabinet_tariff_payments')
       and has_function_privilege('anon', p.oid, 'execute')
  ) then
    raise exception 'calendar_subscriptions: функция тарифа исполнима без входа';
  end if;
  if has_table_privilege('authenticated', 'public.calendar_subscriptions', 'select') then
    raise exception 'calendar_subscriptions: таблица читается ключом приложения';
  end if;
  if exists (
    select 1
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and pg_get_functiondef(p.oid) like '%team_is_working(%'
  ) then
    raise exception 'calendar_subscriptions: team_is_working ещё зовут';
  end if;
end;
$$;
