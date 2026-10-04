-- ТАРИФЫ «СОЛО · ПРО · МАКС» (владелец 01.10).
--
-- Модель владельца:
--   • без тарифа — свой календарь («Личный»), события, свои финансы; клиенты,
--     записи клиентов, услуги, мастера, инвойсы и чеки закрыты;
--   • Соло €6.99 — всё это открыто, один календарь, без партнёров;
--   • Про €29.99 — до 5 команд и 5 партнёров;
--   • Макс €59.99 — до 50 команд и 50 партнёров («крайние ограничения, чтоб
--     не охуевали»);
--   • клиенты — без лимита на всех платных;
--   • пробный 14 дней — один раз, на выбранный тариф, без карты;
--   • подписка кончилась — всё видно, новое серым (сервер: новое не
--     создаётся); партнёры в командах владельца — так же;
--   • команд больше лимита (переход ниже, конец пробного) — владелец выбирает
--     рабочие, остальные только для просмотра;
--   • тариф — у аккаунта-владельца команды: партнёр в чужой команде работает
--     по тарифу её владельца.
--
-- Что было: `plan` free/pro/business + `plan_override` lifetime/beta, лимиты
-- клиентов 100/1000 и людей 1/5, лимита команд нет. Колонки оплаты «закрыты»
-- отзывом прав по колонкам (20260506_003), но у authenticated остался
-- табличный UPDATE — и отзыв по колонкам при нём не действует: владелец
-- запросом к API ставил себе `plan_override = 'lifetime'`. Здесь их держит
-- сторож-триггер.

-- ── 1. Тарифы, пробный период, рабочие команды ─────────────────────────────
alter table public.tenants drop constraint if exists tenants_plan_check;
update public.tenants set plan = 'max' where plan = 'business';
alter table public.tenants
  add constraint tenants_plan_check check (plan in ('free', 'solo', 'pro', 'max'));

alter table public.tenants
  add column if not exists trial_tier text,
  add column if not exists trial_started_at timestamptz,
  add column if not exists working_team_ids text[];

alter table public.tenants drop constraint if exists tenants_trial_tier_check;
alter table public.tenants
  add constraint tenants_trial_tier_check
  check (trial_tier is null or trial_tier in ('solo', 'pro', 'max'));

comment on column public.tenants.trial_tier is
  'Тариф пробного периода (один раз на аккаунт, 14 дней) — start_trial().';
comment on column public.tenants.working_team_ids is
  'Рабочие команды, когда команд больше лимита тарифа — choose_working_teams(). null — первые по дате.';

-- Аккаунты, что уже есть (владелец 01.10): его Giliuta — Макс навсегда,
-- остальные (AirFix) — по новой схеме, без тарифа.
update public.tenants
   set plan_override = null
 where plan_override is not null
   and id <> '11365a87-bef9-4f6c-a030-b15083fe646b';

-- ── 2. Сторож колонок оплаты ───────────────────────────────────────────────
-- Пишут их только вебхук Stripe (service_role), миграции и cron (без JWT) и
-- двери этой миграции (start_trial, choose_working_teams) — флагом
-- транзакции `babun.billing_write`.
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
     or new.working_team_ids is distinct from old.working_team_ids then
    raise exception 'Тариф меняется только оплатой или пробным периодом'
      using errcode = '42501', hint = 'plan:billing';
  end if;
  return new;
end;
$function$;

revoke execute on function public.tenants_guard_billing() from public, anon;

drop trigger if exists tenants_guard_billing on public.tenants;
create trigger tenants_guard_billing
  before update on public.tenants
  for each row execute function public.tenants_guard_billing();

-- ── 3. Действующий тариф ───────────────────────────────────────────────────
-- 'free' | 'solo' | 'pro' | 'max'. Оплачено (Stripe: active/trialing, а
-- past_due — пока Stripe повторяет списание) → тариф подписки; идёт пробный
-- → его тариф; иначе — без тарифа. lifetime/beta — Макс навсегда.
create or replace function public.tenant_effective_plan(t_id uuid)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when t.plan_override in ('lifetime', 'beta_unlimited') then 'max'
    when t.plan in ('solo', 'pro', 'max')
         and t.subscription_status in ('active', 'trialing', 'past_due')
         and (t.current_period_end is null or t.current_period_end > now())
      then t.plan
    when t.trial_tier is not null and t.trial_ends_at > now() then t.trial_tier
    else 'free'
  end
    from public.tenants t
   where t.id = t_id
$function$;

-- ── 4. Лимиты тарифа ───────────────────────────────────────────────────────
-- teams: без тарифа и Соло — 1, Про — 5, Макс — 50.
-- partners (люди кроме владельца): без тарифа и Соло — 0, Про — 5, Макс — 50.
create or replace function public.tenant_tier_limit(t_id uuid, p_what text)
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case public.tenant_effective_plan(t_id)
    when 'max' then 50
    when 'pro' then 5
    else case p_what when 'teams' then 1 else 0 end
  end
$function$;

-- Клиентов — без лимита на всех платных; без тарифа клиентов нет вовсе (это
-- решает `enforce_plan_limits` с русским ответом), поэтому и здесь потолка
-- нет. Людей считает дверь приглашения ниже — по партнёрам тарифа.
create or replace function public.tenant_quota_clients(t_id uuid)
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select 999999999
$function$;

create or replace function public.tenant_quota_appointments_month(t_id uuid)
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select 999999999
$function$;

create or replace function public.tenant_quota_team_members(t_id uuid)
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select 999999999
$function$;

-- ── 5. Рабочие команды ─────────────────────────────────────────────────────
-- Команд в пределах лимита — все рабочие. Больше — рабочие выбранные
-- владельцем (не больше лимита), а пока не выбрал — первые по дате.
create or replace function public.team_is_working(p_tenant uuid, p_team text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with lim as (
    select public.tenant_tier_limit(p_tenant, 'teams') as n
  ),
  live as (
    select tm.id, tm.created_at
      from public.teams tm
     where tm.tenant_id = p_tenant
       and tm.is_active
  ),
  chosen as (
    select coalesce(t.working_team_ids, array[]::text[]) as ids
      from public.tenants t
     where t.id = p_tenant
  ),
  -- Выбранные владельцем — первыми и в его порядке; свободные места (команду
  -- из выбора убрали в архив, лимит вырос) добираются живыми по созданию.
  ranked as (
    select l.id,
           row_number() over (
             order by array_position(c.ids, l.id) nulls last, l.created_at, l.id
           ) as rn
      from live l
      cross join chosen c
  )
  select case
    when (select count(*) from live) <= (select n from lim) then true
    else exists (
      select 1 from ranked r where r.id = p_team and r.rn <= (select n from lim)
    )
  end
$function$;

-- ── 6. Двери тарифа на сервере ─────────────────────────────────────────────
-- Тело — живое (md5 ca611e34) с прежними ответами для без тарифа; добавлены
-- клиенты и чеки, команды и партнёры по лимитам, рабочие команды.
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

  -- Команды: новая или возвращённая из архива — в пределах лимита тарифа.
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
          when 'max' then 'В тарифе Макс — до 50 команд'
          when 'pro' then 'В тарифе Про — до 5 команд'
          else 'Новые команды — в тарифах Про и Макс'
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
          when 'max' then 'В тарифе Макс — до 50 партнёров'
          when 'pro' then 'В тарифе Про — до 5 партнёров'
          else 'Партнёры — в тарифах Про и Макс'
        end
        using errcode = 'P0001', hint = 'plan:partners';
    end if;
    return new;
  end if;

  -- Команда сверх лимита — только для просмотра.
  if tg_table_name in ('appointments', 'clients')
     and new.team_id is not null
     and not public.team_is_working(new.tenant_id, new.team_id) then
    raise exception 'Эта команда сверх тарифа — только для просмотра'
      using errcode = 'P0001', hint = 'plan:team-frozen';
  end if;

  if v_plan is distinct from 'free' then
    return new;
  end if;

  if tg_table_name = 'appointments' then
    if new.kind = 'work' then
      raise exception 'Записывать клиентов в этом тарифе нельзя'
        using errcode = 'P0001', hint = 'plan:book-clients';
    end if;
    return new;
  end if;

  if tg_table_name = 'clients' then
    raise exception 'Клиенты доступны в тарифах Соло, Про и Макс'
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

drop trigger if exists clients_enforce_plan on public.clients;
create trigger clients_enforce_plan
  before insert on public.clients
  for each row execute function public.enforce_plan_limits();

drop trigger if exists receipts_enforce_plan on public.receipts;
create trigger receipts_enforce_plan
  before insert on public.receipts
  for each row execute function public.enforce_plan_limits();

drop trigger if exists teams_enforce_plan on public.teams;
create trigger teams_enforce_plan
  before insert or update of is_active on public.teams
  for each row execute function public.enforce_plan_limits();

drop trigger if exists invitations_enforce_plan on public.invitations;
create trigger invitations_enforce_plan
  before insert on public.invitations
  for each row execute function public.enforce_plan_limits();

-- ── 7. Пробный период ──────────────────────────────────────────────────────
create or replace function public.start_trial(p_tier text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_started timestamptz;
  v_ends timestamptz := now() + interval '14 days';
begin
  if auth.uid() is null or v_tenant is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'Пробный период включает владелец аккаунта'
      using errcode = '42501', hint = 'plan:owner';
  end if;
  if p_tier is null or p_tier not in ('solo', 'pro', 'max') then
    raise exception 'Неизвестный тариф' using errcode = '22023';
  end if;
  select t.trial_started_at into v_started
    from public.tenants t
   where t.id = v_tenant
     for update;
  if v_started is not null then
    raise exception 'Пробный период уже был'
      using errcode = 'P0001', hint = 'plan:trial-used';
  end if;
  if public.tenant_effective_plan(v_tenant) is distinct from 'free' then
    raise exception 'Тариф уже действует'
      using errcode = 'P0001', hint = 'plan:active';
  end if;
  perform set_config('babun.billing_write', 'on', true);
  update public.tenants
     set trial_tier = p_tier,
         trial_started_at = now(),
         trial_ends_at = v_ends
   where id = v_tenant;
  perform set_config('babun.billing_write', 'off', true);
  return jsonb_build_object('tier', p_tier, 'trial_ends_at', v_ends);
end;
$function$;

revoke execute on function public.start_trial(text) from public, anon;
grant execute on function public.start_trial(text) to authenticated;

-- ── 8. Выбор рабочих команд ────────────────────────────────────────────────
create or replace function public.choose_working_teams(p_team_ids text[])
 returns text[]
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_limit integer;
  v_ids text[] := coalesce(p_team_ids, array[]::text[]);
begin
  if auth.uid() is null or v_tenant is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'Рабочие команды выбирает владелец аккаунта'
      using errcode = '42501', hint = 'plan:owner';
  end if;
  v_limit := public.tenant_tier_limit(v_tenant, 'teams');
  if cardinality(v_ids) = 0 or cardinality(v_ids) > v_limit then
    raise exception 'Выберите от 1 до % команд', v_limit
      using errcode = '22023', hint = 'plan:teams';
  end if;
  if exists (
    select 1
      from unnest(v_ids) as chosen(id)
     where not exists (
       select 1
         from public.teams tm
        where tm.tenant_id = v_tenant
          and tm.id = chosen.id
          and tm.is_active
     )
  ) then
    raise exception 'Команда не найдена' using errcode = '23503';
  end if;
  perform set_config('babun.billing_write', 'on', true);
  update public.tenants set working_team_ids = v_ids where id = v_tenant;
  perform set_config('babun.billing_write', 'off', true);
  return v_ids;
end;
$function$;

revoke execute on function public.choose_working_teams(text[]) from public, anon;
grant execute on function public.choose_working_teams(text[]) to authenticated;

-- ── 9. Тариф в профиле аккаунта ────────────────────────────────────────────
-- Тело — живое (md5 b7eec616) + `tier`: владельцу и партнёрам — действующий
-- тариф аккаунта (партнёр работает по нему: серое и плашка у него те же).
-- Оплата, Stripe и пробный — по-прежнему только владельцу (полная строка).
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
    else null
  end
    from public.tenants t
   where t.id = public.current_tenant_id()
   limit 1
$function$;

-- ── 10. Внутренние помощники — не двери наружу ─────────────────────────────
-- Новые функции по умолчанию исполнимы для PUBLIC и anon. Лимиты и рабочие
-- команды зовут только двери выше (definer); тариф чужого аккаунта по
-- произвольному id аноним не узнаёт.
revoke execute on function public.tenant_tier_limit(uuid, text) from public, anon, authenticated;
revoke execute on function public.team_is_working(uuid, text) from public, anon, authenticated;
revoke execute on function public.tenant_effective_plan(uuid) from public, anon;

-- ── 11. Подписка кончилась — партнёры видят, но не меняют ──────────────────
-- Владелец 01.10: «всё видно, новое серым; партнёры в командах владельца
-- видят, но не меняют». Тариф без партнёров (нет тарифа, Соло) — любой
-- партнёр аккаунта только смотрит: запись, клиенты, деньги, график и
-- настройки команды не пишутся ни дверью, ни напрямую. Сторож стоит
-- триггером на самих таблицах, поэтому его не обойти ни одной дорогой
-- (`member_*`, политики таблиц, старая сборка). Владелец, сервер и cron (без
-- JWT) не задеты; журналы чтения (открытый номер клиента) — тоже: их таблиц
-- в списке нет.
create or replace function public.tenant_partner_writes_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_role text;
begin
  if tg_op = 'DELETE' then
    v_tenant := old.tenant_id;
  else
    v_tenant := new.tenant_id;
  end if;
  if v_uid is not null and v_tenant is not null then
    select tm.role into v_role
      from public.tenant_members tm
     where tm.tenant_id = v_tenant
       and tm.user_id = v_uid;
    if v_role is not null and v_role <> 'owner'
       and public.tenant_tier_limit(v_tenant, 'partners') = 0 then
      raise exception 'Тариф владельца команды закончился — можно только смотреть'
        using errcode = 'P0001', hint = 'plan:partner-frozen';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke execute on function public.tenant_partner_writes_guard() from public, anon;

do $do$
declare
  t text;
begin
  foreach t in array array[
    'appointments', 'appointment_photos', 'clients', 'client_attachments',
    'client_tag_assignments', 'client_tags', 'location_labels', 'day_cities',
    'day_extras', 'debts', 'finance_transactions', 'invoices', 'receipts',
    'team_schedules', 'team_design', 'services', 'service_variants',
    'equipment', 'teams', 'cities'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_partner_writes_guard', t);
    execute format(
      'create trigger %I before insert or update or delete on public.%I '
      'for each row execute function public.tenant_partner_writes_guard()',
      t || '_partner_writes_guard', t
    );
  end loop;
end
$do$;

-- ── 12. Сколько партнёров у аккаунта — для смены тарифа ────────────────────
-- Понижение тарифа при лишних партнёрах — отказ «сначала уберите лишних»
-- (`tariff-checkout`). Те же люди, что считает дверь приглашения: участники
-- кроме владельца и ждущие приглашения. Только служебному ключу.
create or replace function public.tariff_partner_count(p_tenant uuid)
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select count(*)::integer
    from (
      select m.user_id::text
        from public.tenant_members m
       where m.tenant_id = p_tenant
         and m.role <> 'owner'
      union
      select lower(i.email)
        from public.invitations i
       where i.tenant_id = p_tenant
         and i.accepted_at is null
         and i.expires_at > now()
    ) people
$function$;

revoke execute on function public.tariff_partner_count(uuid) from public, anon, authenticated;
grant execute on function public.tariff_partner_count(uuid) to service_role;
