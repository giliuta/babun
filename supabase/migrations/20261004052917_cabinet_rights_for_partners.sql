-- КАБИНЕТ ДЛЯ ПАРТНЁРА — ПРАВА «ТАРИФ», «ОПЛАТЫ ТАРИФА», «SMS» (владелец 04.10:
-- «если мы даём доступ к нашим командам, то можем дать доступ и к кабинету —
-- реквизиты, тариф, SMS, оплата, чтоб кто-то тоже мог оплачивать; но это
-- должно быть зафиксировано за нашей командой, чтобы человек случайно не
-- перепутал и не оплатил что-то своё»).
--
-- Три права аккаунта (scope `company`, раздел страницы прав «Кабинет»; рядом
-- с ними встаёт уже живое «Реквизиты» — `finance.settings_requisites`):
--   • `cabinet.tariff` — Скрыт · Видит · Оплачивает. «Видит» — действующий
--     тариф со сроками и подпиской; «Оплачивает» — оформить и оплатить тариф,
--     пока подписки нет (смену тарифа в действующей подписке и управление
--     подпиской оставляет за собой владелец: это списания с его карты).
--   • `cabinet.tariff_payments` — Скрыты · Видит: история оплат тарифа.
--   • `cabinet.sms` — Скрыт · Видит · Пополняет: баланс SMS и траты месяца;
--     «Пополняет» — разовое пополнение. Автопополнение (сохранённая карта) и
--     тревоги сверки — только владельцу.
-- Новому и нынешним партнёрам — «Скрыт» (первая ступень): сегодня этого у
-- них нет, и само ничего не открывается.
--
-- Держит сервер:
--   • `current_tenant_profile_safe` отдаёт партнёру поля тарифа при «Тариф:
--     Видит» (ключи Stripe — никогда);
--   • `billing_events` — политика чтения по «Оплатам тарифа»;
--   • `sms_account` отдаёт баланс и месяц при «SMS: Видит»;
--   • оплату пускают функции `tariff-checkout` / `sms-checkout` (тот же
--     коммит) по `access_company(<право>, 'write')` — в аккаунт из заголовка
--     `x-babun-tenant`, который приложение берёт из блока аккаунта в
--     Кабинете, а не из открытого на телефоне календаря.
--
-- Тела функций переписаны целиком из `pg_proc.prosrc`, снятого 04.10 (md5
-- сверяется): у профиля добавлен один кусок, у `sms_account` — ветка партнёра.

set local lock_timeout = '5s';

do $check$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.current_tenant_profile_safe()'::regprocedure)
     is distinct from '09aad15ce6dc955ea3654f755e0d4387' then
    raise exception 'current_tenant_profile_safe изменилась после 04.10 — перечитать тело перед правкой';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.sms_account()'::regprocedure)
     is distinct from 'e2c2be82d5ed454afd5e5fa49f0a1867' then
    raise exception 'sms_account изменилась после 04.10 — перечитать тело перед правкой';
  end if;
end
$check$;

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values
  ('cabinet.tariff', 'company', 'company', array['off', 'read', 'write'], 'Тариф', false, true,
   array['function:public.current_tenant_profile_safe()', 'edge:tariff-checkout'], 371),
  ('cabinet.tariff_payments', 'company', 'company', array['off', 'read'], 'Оплаты тарифа', false, true,
   array['policy:public.billing_events.billing_events_select_cabinet'], 372),
  ('cabinet.sms', 'company', 'company', array['off', 'read', 'write'], 'SMS', false, true,
   array['function:public.sms_account()', 'edge:sms-checkout'], 373);

create or replace function public.current_tenant_profile_safe()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when public.current_user_role() = 'owner' then
      to_jsonb(t) || jsonb_build_object('tier', public.tenant_effective_plan(t.id))
    when public.current_user_role() in ('dispatcher', 'master') then
      jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'vertical', t.vertical,
        'city', t.city,
        'country', t.country,
        'address', t.address,
        'logo_url', t.logo_url,
        'contact_phone', t.contact_phone,
        'contact_email', t.contact_email,
        'contact_whatsapp', t.contact_whatsapp,
        'contact_telegram', t.contact_telegram,
        'contact_instagram', t.contact_instagram,
        'onboarded_at', t.onboarded_at,
        'personal_calendar_enabled', t.personal_calendar_enabled,
        'track_units', t.track_units,
        -- валюта сумм: без неё сотрудник видит € у любой компании (этап 0(е))
        'currency', t.currency,
        'created_at', t.created_at,
        -- тариф владельца команды: партнёр работает по нему (01.10)
        'tier', public.tenant_effective_plan(t.id)
      )
      -- Бланк инвойса (03.10): тому, кто видит «Инвойсы» в шестерёнке, и
      -- тому, кто сам выставляет инвойсы, — его новый счёт берёт срок,
      -- строки и приписку компании, а не умолчания приложения.
      || case
        when cardinality(public.access_calendars('finance.documents', 'write')) > 0 then
          jsonb_build_object(
            'invoice_due_days', t.invoice_due_days,
            'invoice_line_source', t.invoice_line_source,
            'invoice_default_line_title', t.invoice_default_line_title,
            'invoice_footer_note', t.invoice_footer_note
          )
        else '{}'::jsonb
      end
      -- ТАРИФ АККАУНТА — партнёру с правом «Тариф» (04.10): сроки, подписка
      -- и рабочие команды, как у владельца; ключи Stripe не отдаются.
      || case
        when public.access_company('cabinet.tariff', 'read') then
          jsonb_build_object(
            'plan', t.plan,
            'plan_override', t.plan_override,
            'trial_tier', t.trial_tier,
            'trial_started_at', t.trial_started_at,
            'trial_ends_at', t.trial_ends_at,
            'subscription_status', t.subscription_status,
            'current_period_end', t.current_period_end,
            'working_team_ids', t.working_team_ids
          )
        else '{}'::jsonb
      end
    else null
  end
    from public.tenants t
   where t.id = public.current_tenant_id()
   limit 1
$function$;

drop policy if exists billing_events_select_cabinet on public.billing_events;
create policy billing_events_select_cabinet on public.billing_events
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.access_company('cabinet.tariff_payments', 'read'))
  );

create or replace function public.sms_account()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  is_owner boolean := public.current_user_role() = 'owner';
  cfg public.tenant_sms_config%rowtype;
  auto public.sms_autotopup%rowtype;
  price integer := public.sms_price_cents();
  frozen boolean;
  base jsonb;
  money jsonb;
  month_start timestamptz := date_trunc('month', now());
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms: no access' using errcode = '42501';
  end if;
  select * into cfg from public.tenant_sms_config where tenant_id = v_tenant;
  frozen := cfg.frozen_at is not null;
  base := jsonb_build_object(
    'service_on', public.sms_service_on(),
    'enabled', coalesce(cfg.enabled, false),
    'team_ids', to_jsonb(coalesce(cfg.team_ids, '{}'::text[])),
    'price_cents', price,
    'can_pay', coalesce(cfg.balance_cents, 0) >= price and not coalesce(frozen, false),
    'frozen', coalesce(frozen, false),
    'senders', coalesce((
      select jsonb_object_agg(s.team_id, s.sender_name)
        from public.sms_team_senders s where s.tenant_id = v_tenant
    ), '{}'::jsonb)
  );
  -- ДЕНЬГИ SMS — владельцу и партнёру с правом «SMS» (04.10).
  if not is_owner and public.access_company('cabinet.sms', 'read') is not true then
    return base;
  end if;
  money := jsonb_build_object(
    'balance_cents', coalesce(cfg.balance_cents, 0),
    'free_left', 0,
    'month', (
      select jsonb_build_object(
               'count', count(*) filter (where m.status in ('sending', 'sent', 'delivered')),
               'cents', coalesce(sum(m.cost_cents) filter (where m.status in ('sending', 'sent', 'delivered')), 0)
             )
        from public.sms_messages m
       where m.tenant_id = v_tenant and m.created_at >= month_start
    ),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
               'team_id', s.team_id,
               'count', s.sent,
               'segments', s.segments,
               'cents', s.cents,
               'delivered', s.delivered,
               'failed', s.failed
             ) order by s.team_id)
        from (
          select coalesce(m.team_id, '') as team_id,
                 count(*) filter (where m.status in ('sending', 'sent', 'delivered')) as sent,
                 coalesce(sum(m.segments) filter (where m.status in ('sending', 'sent', 'delivered')), 0) as segments,
                 coalesce(sum(m.cost_cents) filter (where m.status in ('sending', 'sent', 'delivered')), 0) as cents,
                 count(*) filter (where m.status = 'delivered') as delivered,
                 count(*) filter (where m.status in ('failed', 'undelivered', 'blocked')) as failed
            from public.sms_messages m
           where m.tenant_id = v_tenant and m.created_at >= month_start
           group by coalesce(m.team_id, '')
        ) s
    ), '[]'::jsonb),
    'template_counts', coalesce((
      select jsonb_object_agg(t.team_id, t.n)
        from (select team_id, count(*) as n from public.sms_team_templates
               where tenant_id = v_tenant group by team_id) t
    ), '{}'::jsonb)
  );
  -- Автопополнение (сохранённая карта владельца) и тревоги сверки — только
  -- владельцу.
  if not is_owner then
    return base || money;
  end if;
  select * into auto from public.sms_autotopup where tenant_id = v_tenant;
  return base || money || jsonb_build_object(
    'autotopup', jsonb_build_object(
      'enabled', coalesce(auto.enabled, false),
      'threshold_cents', coalesce(auto.threshold_cents, 500),
      'amount_cents', coalesce(auto.amount_cents, 2500),
      'card', auto.card_label,
      'error', auto.last_error
    ),
    'alerts', coalesce((
      select jsonb_agg(jsonb_build_object('kind', a.kind, 'message', a.message, 'at', a.created_at, 'own', a.tenant_id = v_tenant)
                       order by a.created_at desc)
        from public.sms_alerts a
       where a.resolved_at is null
         and (a.tenant_id = v_tenant or public.is_platform_admin())
    ), '[]'::jsonb)
  );
end;
$function$;

do $guard$
begin
  if (select count(*) from public.access_blocks
       where key in ('cabinet.tariff', 'cabinet.tariff_payments', 'cabinet.sms') and live and scope = 'company') <> 3 then
    raise exception 'сторож: права Кабинета не встали в реестр';
  end if;
  if position('cabinet.tariff' in (select prosrc from pg_proc where oid = 'public.current_tenant_profile_safe()'::regprocedure)) = 0 then
    raise exception 'сторож: профиль аккаунта не спрашивает «Тариф»';
  end if;
  if position('cabinet.sms' in (select prosrc from pg_proc where oid = 'public.sms_account()'::regprocedure)) = 0 then
    raise exception 'сторож: sms_account не спрашивает «SMS»';
  end if;
  if not exists (select 1 from pg_policy where polrelid = 'public.billing_events'::regclass and polname = 'billing_events_select_cabinet') then
    raise exception 'сторож: нет политики «Оплат тарифа»';
  end if;
  if has_function_privilege('anon', 'public.current_tenant_profile_safe()', 'execute')
     or has_function_privilege('anon', 'public.sms_account()', 'execute') then
    raise exception 'сторож: профиль или SMS открылись anon';
  end if;
end
$guard$;
