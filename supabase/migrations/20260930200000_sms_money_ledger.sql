-- SMS, ВОЛНА 13 (STORY-089): ДЕНЬГИ КОМПАНИЙ — ЖУРНАЛОМ, ВОЗВРАТЫ И СПОРЫ,
-- СВЕРКА, ПРЕДОХРАНИТЕЛИ, АВТОПОПОЛНЕНИЕ.
--
-- Владелец 30.09: «делай абсолютно всё, чтобы защитить нас… чтобы счета
-- перекрывали баланс, чтобы не было багов и никто не мог взломать».
--
--   • ЖУРНАЛ `sms_ledger` — каждое движение денег компании отдельной
--     строкой: пополнение, списание за SMS, возврат за неушедшее, возврат
--     оплаты в Stripe, спор по карте и его выигрыш, ручная правка. Журнал
--     только дописывается. Баланс `tenant_sms_config.balance_cents` меняет
--     ОДНА функция `sms_ledger_post` вместе со строкой журнала; любую другую
--     запись баланса база отклоняет (сторож-триггер) — и нашу будущую
--     ошибку тоже.
--   • ВОЗВРАТ И СПОР ПО КАРТЕ (Stripe `charge.refunded`,
--     `charge.dispute.created/closed`) снимают деньги с баланса. Баланс
--     может уйти в минус — это долг: SMS не уходят, следующее пополнение
--     сначала гасит его.
--   • СВЕРКА каждый час: баланс = сумма журнала, каждое пополнение и каждое
--     списание есть в журнале. Не сошлось — отправка компании
--     замораживается, тревогу видят её владелец и администраторы платформы
--     (Кабинет → SMS).
--   • ПРЕДОХРАНИТЕЛИ: не больше `sms_hourly_cap` SMS в час на всю платформу
--     и `sms_tenant_hourly_cap` на компанию — лишнее ждёт в очереди, а не
--     уходит в Twilio за наш счёт. Подписи «Babun» больше нет.
--   • АВТОПОПОЛНЕНИЕ: партнёр сохраняет карту при оплате на сайте, задаёт
--     порог и сумму; баланс ниже порога — сервер сам списывает с карты
--     (не чаще 3 раз в сутки, не чаще раза в 15 минут). Отказ банка
--     выключает автопополнение и пишет причину.
--
-- Накат 30.09 (`sms_money_ledger`): текст, прошедший прогон в откате (47
-- сценариев), — этот файл без комментариев и пустых строк. Тела 28 функций
-- в базе сверены по md5 с телами отсюда за вычетом комментариев.

-- ───────────────────────── 1. ЖУРНАЛ ─────────────────────────

create table public.sms_ledger (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in (
    'opening', 'topup', 'send', 'send_refund', 'stripe_refund', 'dispute', 'dispute_won', 'adjust'
  )),
  amount_cents integer not null check (amount_cents <> 0),
  balance_after integer not null,
  ref text,
  note text,
  created_at timestamptz not null default now(),
  constraint sms_ledger_sign check (
    (kind in ('topup', 'send_refund', 'dispute_won') and amount_cents > 0)
    or (kind in ('send', 'stripe_refund', 'dispute') and amount_cents < 0)
    or kind in ('opening', 'adjust')
  )
);
comment on table public.sms_ledger is
  'Движение денег SMS каждой компании (STORY-089, волна 13). Только дописывается; баланс меняет sms_ledger_post.';

-- Одна и та же операция (оплата, SMS, возврат) — одна строка: повтор
-- события Stripe или гонка двух курьеров упирается в этот индекс.
create unique index sms_ledger_kind_ref on public.sms_ledger (kind, ref) where ref is not null;
create index sms_ledger_tenant on public.sms_ledger (tenant_id, id desc);
create index sms_ledger_send_time on public.sms_ledger (created_at) where kind = 'send';

alter table public.sms_ledger enable row level security;
revoke all on table public.sms_ledger from public, anon, authenticated;

create or replace function public.sms_ledger_append_only()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  raise exception 'sms_ledger: журнал только дописывается' using errcode = '42501';
end;
$function$;

create trigger sms_ledger_no_update before update on public.sms_ledger
  for each row execute function public.sms_ledger_append_only();
create trigger sms_ledger_no_truncate before truncate on public.sms_ledger
  for each statement execute function public.sms_ledger_append_only();

-- ───────────────────────── 2. ТРЕВОГИ ─────────────────────────

create table public.sms_alerts (
  id bigint generated always as identity primary key,
  -- null — тревога всей платформы (предохранитель).
  tenant_id uuid references public.tenants(id) on delete cascade,
  kind text not null,
  message text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index sms_alerts_open on public.sms_alerts (
  coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), kind
) where resolved_at is null;
alter table public.sms_alerts enable row level security;
revoke all on table public.sms_alerts from public, anon, authenticated;

/** Открыть тревогу; такая же открытая уже есть — ничего. */
create or replace function public.sms_alert(p_tenant uuid, p_kind text, p_message text)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.sms_alerts (tenant_id, kind, message)
  values (p_tenant, p_kind, left(p_message, 500))
  on conflict (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), kind)
    where resolved_at is null
  do nothing;
$function$;

-- ─────────────── 3. БАЛАНС: ДОЛГ, ЗАМОРОЗКА, СТОРОЖ ───────────────

alter table public.tenant_sms_config
  add column if not exists frozen_at timestamptz,
  add column if not exists frozen_reason text;

-- Долг после возврата или спора — законное состояние: баланс бывает < 0.
-- Бесплатных SMS нет (волна 10) — и не появится ни одной.
alter table public.tenant_sms_config drop constraint if exists tenant_sms_config_money_nonnegative;
alter table public.tenant_sms_config drop constraint if exists tenant_sms_config_no_free;
update public.tenant_sms_config set free_sms_remaining = 0 where free_sms_remaining <> 0;
alter table public.tenant_sms_config add constraint tenant_sms_config_no_free check (free_sms_remaining = 0);

create or replace function public.sms_balance_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('babun.sms_ledger', true), '') <> 'on' then
    if tg_op = 'INSERT' and coalesce(new.balance_cents, 0) <> 0 then
      raise exception 'sms: баланс меняется только журналом (sms_ledger_post)' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.balance_cents is distinct from old.balance_cents then
      raise exception 'sms: баланс меняется только журналом (sms_ledger_post)' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists sms_balance_guard on public.tenant_sms_config;
create trigger sms_balance_guard before insert or update on public.tenant_sms_config
  for each row execute function public.sms_balance_guard();

/** Единственная дверь к балансу: строка журнала и новый баланс — вместе.
 *  `null` — эта операция (kind, ref) уже проведена, баланс не тронут. */
create or replace function public.sms_ledger_post(
  p_tenant uuid,
  p_kind text,
  p_amount integer,
  p_ref text,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_balance integer;
begin
  if p_tenant is null or p_amount is null or p_amount = 0 then
    raise exception 'sms_ledger_post: пустая операция' using errcode = '22023';
  end if;
  insert into public.tenant_sms_config (tenant_id) values (p_tenant)
  on conflict (tenant_id) do nothing;
  select balance_cents into v_balance
    from public.tenant_sms_config where tenant_id = p_tenant for update;
  if p_ref is not null and exists (
    select 1 from public.sms_ledger where kind = p_kind and ref = p_ref
  ) then
    return null;
  end if;
  v_balance := v_balance + p_amount;
  perform set_config('babun.sms_ledger', 'on', true);
  update public.tenant_sms_config
     set balance_cents = v_balance, updated_at = now()
   where tenant_id = p_tenant;
  perform set_config('babun.sms_ledger', 'off', true);
  insert into public.sms_ledger (tenant_id, kind, amount_cents, balance_after, ref, note)
  values (p_tenant, p_kind, p_amount, v_balance, p_ref, left(p_note, 200));
  return v_balance;
end;
$function$;

/** Отправка компании заморожена сверкой. */
create or replace function public.sms_frozen(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.tenant_sms_config where tenant_id = p_tenant and frozen_at is not null
  );
$function$;

-- Балансы, которые уже есть, открывают журнал одной строкой — сверка
-- начинается с равенства.
insert into public.sms_ledger (tenant_id, kind, amount_cents, balance_after, ref, note)
select c.tenant_id, 'opening', c.balance_cents, c.balance_cents, 'opening:' || c.tenant_id, 'Баланс до журнала'
  from public.tenant_sms_config c
 where c.balance_cents <> 0;

-- ─────────────── 4. АВТОПОПОЛНЕНИЕ: ТАБЛИЦА ───────────────

create table public.sms_autotopup (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  threshold_cents integer not null default 500 check (threshold_cents in (500, 1000, 2500)),
  amount_cents integer not null default 2500 check (amount_cents in (1000, 2500, 5000, 10000)),
  stripe_customer text,
  payment_method text,
  card_label text,
  -- Попытка в пути: ключ идемпотентности Stripe. Повтор той же попытки
  -- идёт с тем же ключом — Stripe вернёт тот же платёж, второго не будет.
  pending_key text,
  pending_since timestamptz,
  last_success_at timestamptz,
  day date,
  day_count integer not null default 0,
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint sms_autotopup_card_needed check (not enabled or (payment_method is not null and stripe_customer is not null))
);
alter table public.sms_autotopup enable row level security;
revoke all on table public.sms_autotopup from public, anon, authenticated;

insert into public.edge_cron_secrets (name, secret)
values ('sms-autotopup', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

create or replace function public.sms_autotopup_wake()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform net.http_post(
    url := 'https://rdtokosbqvgemicqeqwz.supabase.co/functions/v1/sms-autotopup',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select secret from public.edge_cron_secrets where name = 'sms-autotopup')
    )
  );
exception when others then
  -- Не разбудили — расписание заберёт через 5 минут.
  raise warning 'sms_autotopup_wake: %', sqlerrm;
end;
$function$;

/** Условия, при которых компании пора пополниться. */
create or replace function public.sms_autotopup_is_due(a public.sms_autotopup, p_balance integer, p_frozen boolean)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select a.enabled
     and a.payment_method is not null
     and a.stripe_customer is not null
     and not coalesce(p_frozen, false)
     and coalesce(p_balance, 0) < a.threshold_cents
     and (a.pending_since is null or a.pending_since < now() - interval '30 minutes')
     and (a.last_success_at is null or a.last_success_at < now() - interval '15 minutes')
     and (a.day is distinct from current_date or a.day_count < 3);
$function$;

/** После списания: баланс опустился ниже порога — разбудить пополнение. */
create or replace function public.sms_autotopup_poke(p_tenant uuid, p_balance integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if exists (
    select 1 from public.sms_autotopup a
     where a.tenant_id = p_tenant and public.sms_autotopup_is_due(a, p_balance, false)
  ) then
    perform public.sms_autotopup_wake();
  end if;
end;
$function$;

-- ─────────────── 5. СПИСАНИЕ, ВОЗВРАТ, ЗАЧИСЛЕНИЕ — ЧЕРЕЗ ЖУРНАЛ ───────────────

create or replace function public.sms_charge(p_id uuid, p_body text, p_segments integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m public.sms_messages%rowtype;
  cfg public.tenant_sms_config%rowtype;
  segs integer := greatest(1, coalesce(p_segments, 1));
  cost integer;
  v_after integer;
begin
  select * into m from public.sms_messages where id = p_id for update;
  if not found or m.status <> 'sending' then
    return 'gone';
  end if;
  select * into cfg from public.tenant_sms_config where tenant_id = m.tenant_id for update;
  if not found then
    update public.sms_messages
       set status = 'blocked', message_body = p_body, segments = segs,
           error_code = 'no_config', error_message = 'SMS у компании не настроены'
     where id = p_id;
    return 'no_funds';
  end if;
  if cfg.frozen_at is not null then
    update public.sms_messages
       set status = 'blocked', message_body = p_body, segments = segs,
           error_code = 'frozen', error_message = 'Отправка SMS остановлена — проверяем баланс'
     where id = p_id;
    return 'no_funds';
  end if;

  cost := segs * public.sms_price_cents();
  if cfg.balance_cents < cost then
    update public.sms_messages
       set status = 'blocked', message_body = p_body, segments = segs,
           error_code = 'no_funds', error_message = 'Не хватило баланса'
     where id = p_id;
    return 'no_funds';
  end if;

  v_after := public.sms_ledger_post(m.tenant_id, 'send', -cost, m.id::text, null);
  if v_after is null then
    -- За это сообщение уже списано: второй раз его не отправляем.
    return 'gone';
  end if;
  update public.sms_messages
     set message_body = p_body, segments = segs, cost_cents = cost, was_free = false
   where id = p_id;
  update public.tenant_sms_config
     set total_sent_count = total_sent_count + 1
   where tenant_id = m.tenant_id;
  perform public.sms_autotopup_poke(m.tenant_id, v_after);
  return 'paid';
end;
$function$;

create or replace function public.sms_mark(
  p_id uuid,
  p_status text,
  p_sid text,
  p_error_code text,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m public.sms_messages%rowtype;
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'sms_mark: bad status %', p_status using errcode = '22023';
  end if;
  select * into m from public.sms_messages where id = p_id for update;
  if not found or m.status <> 'sending' then
    return;
  end if;
  if p_status = 'sent' then
    update public.sms_messages
       set status = 'sent', twilio_sid = nullif(p_sid, ''), error_code = null, error_message = null
     where id = p_id;
    return;
  end if;
  update public.sms_messages
     set status = 'failed', error_code = p_error_code, error_message = left(p_error_message, 500)
   where id = p_id;
  -- Не ушло — деньги назад той же строкой журнала (одна на сообщение).
  if coalesce(m.cost_cents, 0) > 0 then
    perform public.sms_ledger_post(m.tenant_id, 'send_refund', m.cost_cents, m.id::text, left(coalesce(p_error_code, ''), 100));
    update public.tenant_sms_config
       set total_sent_count = greatest(0, total_sent_count - 1), updated_at = now()
     where tenant_id = m.tenant_id;
    update public.sms_messages set cost_cents = 0 where id = p_id;
  end if;
end;
$function$;

create or replace function public.sms_credit_topup(
  p_tenant uuid,
  p_amount_cents integer,
  p_session text,
  p_payment_intent text,
  p_pack text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inserted uuid;
begin
  if p_amount_cents is null or p_amount_cents <= 0 or p_payment_intent is null then
    raise exception 'sms_credit_topup: bad payment' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'sms_credit_topup: no tenant' using errcode = '22023';
  end if;
  insert into public.sms_topups (
    tenant_id, amount_cents, credits_added, pack_label,
    stripe_session_id, stripe_payment_intent_id, status, completed_at
  ) values (
    p_tenant, p_amount_cents, p_amount_cents / greatest(1, public.sms_price_cents()), p_pack,
    p_session, p_payment_intent, 'completed', now()
  )
  on conflict (stripe_payment_intent_id) do nothing
  returning id into inserted;
  if inserted is null then
    return false;
  end if;
  perform public.sms_ledger_post(p_tenant, 'topup', p_amount_cents, p_payment_intent, p_pack);
  return true;
end;
$function$;

/** Ручная правка баланса (служебная): отдельной строкой журнала. */
create or replace function public.bump_sms_balance(p_tenant_id uuid, p_amount_cents integer)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_balance integer;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    return json_build_object('error', 'amount_must_be_positive');
  end if;
  v_balance := public.sms_ledger_post(p_tenant_id, 'adjust', p_amount_cents, null, 'Ручное зачисление');
  return json_build_object('balance_cents', v_balance);
end;
$function$;

-- Старые резервы (10 центов без журнала) — не вызываются никем с волны 2.
drop function if exists public.reserve_sms_credit(uuid);
drop function if exists public.release_sms_credit(uuid, text);

-- ─────────────── 6. ВОЗВРАТ ОПЛАТЫ И СПОР ПО КАРТЕ ───────────────

/** Сколько по пополнению уже снято возвратами и спорами (не выигранными). */
create or replace function public.sms_topup_reversed(p_payment_intent text, out refunded integer, out disputed integer)
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(-sum(amount_cents) filter (where kind = 'stripe_refund'), 0)::integer,
         (coalesce(-sum(amount_cents) filter (where kind = 'dispute'), 0)
          - coalesce(sum(amount_cents) filter (where kind = 'dispute_won'), 0))::integer
    from public.sms_ledger
   where kind in ('stripe_refund', 'dispute', 'dispute_won')
     and split_part(ref, ':', 1) = p_payment_intent;
$function$;

/** Stripe вернул деньги по пополнению. `p_refunded_total` — сколько всего
 *  возвращено по платежу (Stripe шлёт нарастающим итогом): снимается
 *  разница, повтор и запоздалое событие ничего не делают. Никогда больше
 *  суммы пополнения за вычетом уже снятого. */
create or replace function public.sms_stripe_refund(p_payment_intent text, p_refunded_total integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  t public.sms_topups%rowtype;
  r record;
  take integer;
begin
  select * into t from public.sms_topups where stripe_payment_intent_id = p_payment_intent for update;
  if not found or t.status not in ('completed', 'refunded') then
    return 0; -- не пополнение SMS (подписка) или не зачислено
  end if;
  select * into r from public.sms_topup_reversed(p_payment_intent);
  take := least(greatest(coalesce(p_refunded_total, 0), 0), t.amount_cents) - r.refunded;
  take := least(take, t.amount_cents - r.refunded - r.disputed);
  if take <= 0 then
    return 0;
  end if;
  perform public.sms_ledger_post(
    t.tenant_id, 'stripe_refund', -take,
    p_payment_intent || ':refund:' || (r.refunded + take), 'Возврат оплаты в Stripe'
  );
  if r.refunded + take >= t.amount_cents then
    update public.sms_topups set status = 'refunded' where id = t.id;
  end if;
  return take;
end;
$function$;

/** Спор по карте: открыт — деньги снимаются сразу (банк их уже забрал),
 *  автопополнение выключается, платформа видит тревогу; выигран — деньги
 *  возвращаются той же суммой. Проигран — снятое остаётся снятым. */
create or replace function public.sms_stripe_dispute(
  p_payment_intent text,
  p_dispute text,
  p_amount integer,
  p_won boolean
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  t public.sms_topups%rowtype;
  r record;
  opened integer;
  take integer;
begin
  if p_dispute is null then
    return 0;
  end if;
  select * into t from public.sms_topups where stripe_payment_intent_id = p_payment_intent for update;
  if not found or t.status not in ('completed', 'refunded') then
    return 0;
  end if;
  select -amount_cents into opened
    from public.sms_ledger
   where kind = 'dispute' and ref = p_payment_intent || ':dispute:' || p_dispute;

  if not coalesce(p_won, false) then
    if opened is not null then
      return 0;
    end if;
    select * into r from public.sms_topup_reversed(p_payment_intent);
    take := least(greatest(coalesce(p_amount, 0), 0), t.amount_cents - r.refunded - r.disputed);
    update public.sms_autotopup
       set enabled = false, last_error = 'Спор по карте — автопополнение выключено', last_error_at = now(), updated_at = now()
     where tenant_id = t.tenant_id;
    perform public.sms_alert(t.tenant_id, 'dispute', 'Спор по оплате SMS в банке — деньги сняты с баланса компании');
    if take <= 0 then
      return 0;
    end if;
    perform public.sms_ledger_post(
      t.tenant_id, 'dispute', -take, p_payment_intent || ':dispute:' || p_dispute, 'Спор по карте'
    );
    return take;
  end if;

  if opened is null then
    return 0;
  end if;
  perform public.sms_ledger_post(
    t.tenant_id, 'dispute_won', opened, p_payment_intent || ':dispute_won:' || p_dispute, 'Спор выигран'
  );
  return opened;
end;
$function$;

-- ─────────────── 7. СВЕРКА ───────────────

/** Каждый час: баланс = сумма журнала; каждое пополнение и каждое списание
 *  есть в журнале. Расхождение замораживает отправку компании и открывает
 *  тревогу. Возвращает число найденных расхождений. */
create or replace function public.sms_reconcile()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  n integer := 0;
begin
  for r in
    select c.tenant_id, c.balance_cents,
           coalesce((select sum(l.amount_cents) from public.sms_ledger l where l.tenant_id = c.tenant_id), 0) as ledger_sum
      from public.tenant_sms_config c
  loop
    if r.balance_cents <> r.ledger_sum then
      n := n + 1;
      update public.tenant_sms_config
         set frozen_at = coalesce(frozen_at, now()), frozen_reason = 'ledger_mismatch'
       where tenant_id = r.tenant_id;
      perform public.sms_alert(r.tenant_id, 'ledger_mismatch',
        format('Баланс %s ц. не равен журналу %s ц. — отправка остановлена', r.balance_cents, r.ledger_sum));
    end if;
  end loop;

  for r in
    select t.tenant_id, t.stripe_payment_intent_id
      from public.sms_topups t
     where t.status in ('completed', 'refunded')
       and not exists (select 1 from public.sms_ledger l where l.kind = 'topup' and l.ref = t.stripe_payment_intent_id)
  loop
    n := n + 1;
    update public.tenant_sms_config
       set frozen_at = coalesce(frozen_at, now()), frozen_reason = 'topup_missing'
     where tenant_id = r.tenant_id;
    perform public.sms_alert(r.tenant_id, 'topup_missing',
      format('Оплата %s не в журнале — отправка остановлена', r.stripe_payment_intent_id));
  end loop;

  for r in
    select m.tenant_id, m.id
      from public.sms_messages m
     where m.cost_cents > 0
       and not exists (select 1 from public.sms_ledger l where l.kind = 'send' and l.ref = m.id::text)
  loop
    n := n + 1;
    update public.tenant_sms_config
       set frozen_at = coalesce(frozen_at, now()), frozen_reason = 'send_missing'
     where tenant_id = r.tenant_id;
    perform public.sms_alert(r.tenant_id, 'send_missing',
      format('Списание за SMS %s не в журнале — отправка остановлена', r.id));
  end loop;
  return n;
end;
$function$;

/** Разморозить компанию после разбора (служебная, руками). */
create or replace function public.sms_unfreeze(p_tenant uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.tenant_sms_config set frozen_at = null, frozen_reason = null where tenant_id = p_tenant;
  update public.sms_alerts set resolved_at = now()
   where tenant_id = p_tenant and resolved_at is null
     and kind in ('ledger_mismatch', 'topup_missing', 'send_missing');
$function$;

-- ─────────────── 8. ОЧЕРЕДЬ: ПРЕДОХРАНИТЕЛИ ───────────────

insert into public.app_settings (key, value) values ('sms_hourly_cap', '2000') on conflict (key) do nothing;
insert into public.app_settings (key, value) values ('sms_tenant_hourly_cap', '1000') on conflict (key) do nothing;

create or replace function public.sms_claim(p_limit integer default 20)
returns setof jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cap_platform integer := coalesce(
    (select nullif(value, '')::integer from public.app_settings where key = 'sms_hourly_cap'), 2000);
  cap_tenant integer := coalesce(
    (select nullif(value, '')::integer from public.app_settings where key = 'sms_tenant_hourly_cap'), 1000);
begin
  -- Вся платформа за час — не больше предела: ошибка в очереди не
  -- разошлёт тысячи SMS за наш счёт. Лишнее ждёт.
  if (select count(*) from public.sms_ledger
       where kind = 'send' and created_at > now() - interval '1 hour') >= cap_platform then
    perform public.sms_alert(null, 'platform_cap',
      format('За час ушло %s SMS — отправка всей платформы на паузе', cap_platform));
    return;
  end if;

  return query
  with picked as (
    select m.id
      from public.sms_messages m
     where m.status = 'queued'
       and (m.send_after is null or m.send_after <= now())
       -- Замороженная компания ждёт разбора: её SMS остаются в очереди.
       and not exists (
         select 1 from public.tenant_sms_config f
          where f.tenant_id = m.tenant_id and f.frozen_at is not null
       )
       and (
         select count(*) from public.sms_ledger l
          where l.tenant_id = m.tenant_id and l.kind = 'send'
            and l.created_at > now() - interval '1 hour'
       ) < cap_tenant
     order by coalesce(m.send_after, m.created_at)
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 20), 100))
  ), claimed as (
    update public.sms_messages m
       set status = 'sending'
      from picked
     where m.id = picked.id
    returning m.*
  ), texts as (
    select c.*,
           coalesce(c.template_body, (
             select tpl ->> 'body'
               from public.tenant_state ts,
                    jsonb_array_elements(coalesce(ts.prototype_state -> 'smsTemplates', '[]'::jsonb)) tpl
              where ts.tenant_id = c.tenant_id and tpl ->> 'id' = c.template_id
              limit 1
           )) as tpl_text
      from claimed c
  )
  select jsonb_build_object(
    'id', c.id,
    'tenant_id', c.tenant_id,
    'to_phone', c.to_phone,
    'body', c.message_body,
    'trigger_type', c.trigger_type,
    'template_body', c.tpl_text,
    'sender', public.sms_team_sender(c.tenant_id, coalesce(a.team_id, c.team_id)),
    'vars', jsonb_build_object(
      'name', coalesce(nullif(trim(cl.sms_name), ''), split_part(trim(coalesce(cl.full_name, '')), ' ', 1)),
      'date', a.date,
      'time', a.time_start,
      'calendar', t.name,
      'services', coalesce((
        select jsonb_agg(line ->> 'serviceName')
          from jsonb_array_elements(case when jsonb_typeof(a.services) = 'array' then a.services else '[]'::jsonb end) line
      ), '[]'::jsonb),
      'address', a.address,
      'total', a.total_amount,
      'company', tn.name,
      'currency', tn.currency,
      'link', case
        when c.appointment_id is not null and coalesce(c.tpl_text, '') ~ '\[(Ссылка|Link)\]'
          then public.appointment_link_url(c.appointment_id)
      end
    )
  )
    from texts c
    left join public.appointments a on a.id = c.appointment_id
    left join public.clients cl on cl.id = c.client_id
    left join public.teams t on t.tenant_id = c.tenant_id and t.id = coalesce(a.team_id, c.team_id)
    left join public.tenants tn on tn.id = c.tenant_id;
end;
$function$;

-- ─────────────── 9. ОТПРАВКА ВРУЧНУЮ И РАССЫЛКА — С ЗАМОРОЗКОЙ ───────────────

create or replace function public.sms_send_manual(
  p_appointment_id uuid,
  p_client_id uuid,
  p_body text,
  p_template_id text default null,
  p_team_id text default null,
  p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  is_owner boolean := public.current_user_role() = 'owner';
  a record;
  v_client uuid := p_client_id;
  v_team text := nullif(trim(coalesce(p_team_id, '')), '');
  c record;
  phone text;
  v_body text := trim(coalesce(p_body, ''));
  v_balance integer;
  v_id uuid;
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  if not public.sms_service_on() then
    raise exception 'sms:service_off' using errcode = 'P0001';
  end if;
  -- Отправка компании остановлена сверкой — ни в очередь, ни в Twilio.
  if public.sms_frozen(v_tenant) then
    raise exception 'sms:frozen' using errcode = 'P0001';
  end if;
  if length(v_body) = 0 or length(v_body) > 1000 then
    raise exception 'sms:body' using errcode = '22023';
  end if;

  if p_appointment_id is not null then
    select ap.client_id, ap.team_id into a
      from public.appointments ap
     where ap.id = p_appointment_id and ap.tenant_id = v_tenant;
    if not found or a.client_id is null then
      raise exception 'sms:appointment' using errcode = 'P0001';
    end if;
    v_client := a.client_id;
    v_team := a.team_id;
  end if;
  if v_team is null or v_client is null then
    raise exception 'sms:calendar' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.teams t where t.tenant_id = v_tenant and t.id = v_team) then
    raise exception 'sms:calendar' using errcode = 'P0001';
  end if;
  -- Команда, которую человек видит, — тем же правилом, что окно записей.
  if not is_owner and not public.sms_can_see_team(v_team) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  if public.sms_team_sender(v_tenant, v_team) is null then
    raise exception 'sms:sender' using errcode = 'P0001';
  end if;

  select cl.phone, cl.phone_e164, cl.sms_opt_out, cl.blacklisted, cl.deleted_at
    into c
    from public.clients cl
   where cl.id = v_client and cl.tenant_id = v_tenant;
  if not found or c.deleted_at is not null then
    raise exception 'sms:client' using errcode = 'P0001';
  end if;
  if c.sms_opt_out or coalesce(c.blacklisted, false) then
    raise exception 'sms:opt_out' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_phone, '')), '') is not null then
    if not public.sms_client_owns_phone(v_client, p_phone) then
      raise exception 'sms:phone' using errcode = 'P0001';
    end if;
    phone := trim(p_phone);
  else
    phone := coalesce(nullif(trim(c.phone_e164), ''), nullif(trim(c.phone), ''));
  end if;
  if phone is null then
    raise exception 'sms:phone' using errcode = 'P0001';
  end if;
  select balance_cents into v_balance from public.tenant_sms_config where tenant_id = v_tenant;
  if coalesce(v_balance, 0) < public.sms_price_cents() then
    raise exception 'sms:funds' using errcode = 'P0001';
  end if;

  insert into public.sms_messages (
    tenant_id, appointment_id, client_id, team_id, to_phone, message_body,
    trigger_type, template_id, status, mode, sent_by
  ) values (
    v_tenant, p_appointment_id, v_client, v_team, phone, v_body,
    'manual', nullif(p_template_id, ''), 'queued', 'platform', auth.uid()
  )
  returning sms_messages.id into v_id;

  perform public.sms_wake();
  return v_id;
end;
$function$;

create or replace function public.sms_send_bulk(p_team_id text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_team text := nullif(trim(coalesce(p_team_id, '')), '');
  it jsonb;
  c record;
  phone text;
  v_body text;
  v_balance integer;
  n_items integer;
  queued integer := 0;
  skipped integer := 0;
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  if not public.sms_service_on() then
    raise exception 'sms:service_off' using errcode = 'P0001';
  end if;
  -- Отправка компании остановлена сверкой — ни в очередь, ни в Twilio.
  if public.sms_frozen(v_tenant) then
    raise exception 'sms:frozen' using errcode = 'P0001';
  end if;
  if v_team is null or not exists (select 1 from public.teams t where t.tenant_id = v_tenant and t.id = v_team) then
    raise exception 'sms:calendar' using errcode = 'P0001';
  end if;
  if public.sms_team_sender(v_tenant, v_team) is null then
    raise exception 'sms:sender' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'sms:body' using errcode = '22023';
  end if;
  n_items := jsonb_array_length(p_items);
  if n_items = 0 or n_items > 500 then
    raise exception 'sms:body' using errcode = '22023';
  end if;
  select balance_cents into v_balance from public.tenant_sms_config where tenant_id = v_tenant;
  if coalesce(v_balance, 0) < public.sms_price_cents() * n_items then
    raise exception 'sms:funds' using errcode = 'P0001';
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_body := trim(coalesce(it ->> 'body', ''));
    select cl.id, cl.phone, cl.phone_e164, cl.sms_opt_out, cl.blacklisted, cl.deleted_at
      into c
      from public.clients cl
     where cl.id = nullif(it ->> 'client_id', '')::uuid and cl.tenant_id = v_tenant;
    phone := case when found then coalesce(nullif(trim(c.phone_e164), ''), nullif(trim(c.phone), '')) end;
    if phone is null or c.deleted_at is not null or c.sms_opt_out or coalesce(c.blacklisted, false)
       or length(v_body) = 0 or length(v_body) > 1000 then
      skipped := skipped + 1;
      continue;
    end if;
    insert into public.sms_messages (
      tenant_id, client_id, team_id, to_phone, message_body, trigger_type, status, mode, sent_by
    ) values (
      v_tenant, c.id, v_team, phone, v_body, 'bulk', 'queued', 'platform', auth.uid()
    );
    queued := queued + 1;
  end loop;

  if queued > 0 then
    perform public.sms_wake();
  end if;
  return jsonb_build_object('queued', queued, 'skipped', skipped);
end;
$function$;

-- ─────────────── 10. АВТОПОПОЛНЕНИЕ: СЕРВЕР ───────────────

/** Забрать компании, которым пора пополниться (для `sms-autotopup`).
 *  Новая попытка — новый ключ и +1 к счёту суток; зависшая попытка (30 мин)
 *  повторяется С ТЕМ ЖЕ ключом: Stripe вернёт тот же платёж, а не второй. */
create or replace function public.sms_autotopup_claim()
returns table (tenant_id uuid, customer text, payment_method text, amount_cents integer, idem_key text)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  a public.sms_autotopup%rowtype;
  bal integer;
  frozen boolean;
begin
  for a in
    select * from public.sms_autotopup x where x.enabled for update skip locked
  loop
    select c.balance_cents, c.frozen_at is not null into bal, frozen
      from public.tenant_sms_config c where c.tenant_id = a.tenant_id;
    if not public.sms_autotopup_is_due(a, coalesce(bal, 0), coalesce(frozen, false)) then
      continue;
    end if;
    if a.pending_key is null then
      a.pending_key := gen_random_uuid()::text;
      a.day_count := case when a.day is distinct from current_date then 1 else a.day_count + 1 end;
      a.day := current_date;
    end if;
    update public.sms_autotopup x
       set pending_key = a.pending_key, pending_since = now(), day = a.day, day_count = a.day_count, updated_at = now()
     where x.tenant_id = a.tenant_id;
    tenant_id := a.tenant_id;
    customer := a.stripe_customer;
    payment_method := a.payment_method;
    amount_cents := a.amount_cents;
    idem_key := 'sms-autotopup-' || a.pending_key;
    return next;
  end loop;
end;
$function$;

/** Итог попытки. Удача — деньги зачислены (`sms_credit_topup` по тому же
 *  платежу, повтор из вебхука ничего не прибавит); отказ банка —
 *  автопополнение выключается, причина видна владельцу. */
create or replace function public.sms_autotopup_result(p_tenant uuid, p_key text, p_ok boolean, p_error text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.sms_autotopup
     set pending_key = null,
         pending_since = null,
         last_success_at = case when p_ok then now() else last_success_at end,
         enabled = case when p_ok then enabled else false end,
         last_error = case when p_ok then null else left(coalesce(p_error, 'Банк отклонил списание'), 300) end,
         last_error_at = case when p_ok then last_error_at else now() end,
         updated_at = now()
   where tenant_id = p_tenant and 'sms-autotopup-' || pending_key = p_key;
end;
$function$;

/** Карта сохранена при оплате на сайте (вебхук `checkout.session.completed`
 *  с просьбой об автопополнении): включить с выбранными порогом и суммой. */
create or replace function public.sms_autotopup_card(
  p_tenant uuid,
  p_customer text,
  p_payment_method text,
  p_label text,
  p_threshold integer,
  p_amount integer
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_threshold integer := case when p_threshold in (500, 1000, 2500) then p_threshold else 500 end;
  v_amount integer := case when p_amount in (1000, 2500, 5000, 10000) then p_amount else 2500 end;
begin
  if p_tenant is null or nullif(p_customer, '') is null or nullif(p_payment_method, '') is null then
    raise exception 'sms_autotopup_card: no card' using errcode = '22023';
  end if;
  insert into public.sms_autotopup (
    tenant_id, enabled, threshold_cents, amount_cents, stripe_customer, payment_method, card_label
  ) values (
    p_tenant, true, v_threshold, v_amount, p_customer, p_payment_method, left(p_label, 60)
  )
  on conflict (tenant_id) do update set
    enabled = true,
    threshold_cents = excluded.threshold_cents,
    amount_cents = excluded.amount_cents,
    stripe_customer = excluded.stripe_customer,
    payment_method = excluded.payment_method,
    card_label = excluded.card_label,
    pending_key = null,
    pending_since = null,
    last_error = null,
    last_error_at = null,
    updated_at = now();
end;
$function$;

/** Stripe-клиент компании — чтобы вторая карта легла тому же клиенту. */
create or replace function public.sms_autotopup_customer(p_tenant uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select stripe_customer from public.sms_autotopup where tenant_id = p_tenant;
$function$;

-- ─────────────── 11. ЛИЦО: ОТВЕТ СТРАНИЦЕ И ПРАВКИ ВЛАДЕЛЬЦА ───────────────

create or replace function public.sms_account()
returns jsonb
language plpgsql
stable
security definer
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
    -- Замороженная компания не отправляет — пути отправки не предлагаются.
    'can_pay', coalesce(cfg.balance_cents, 0) >= price and not coalesce(frozen, false),
    'frozen', coalesce(frozen, false),
    -- Имя отправителя каждой команды: без него команда не отправляет.
    'senders', coalesce((
      select jsonb_object_agg(s.team_id, s.sender_name)
        from public.sms_team_senders s where s.tenant_id = v_tenant
    ), '{}'::jsonb)
  );
  if not is_owner then
    return base;
  end if;
  select * into auto from public.sms_autotopup where tenant_id = v_tenant;
  return base || jsonb_build_object(
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
    -- Счёт месяца по командам: ушло, частей, стоимость, доставлено, не дошло.
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
    -- Сколько шаблонов у каждой команды — подпись строки команды.
    'template_counts', coalesce((
      select jsonb_object_agg(t.team_id, t.n)
        from (select team_id, count(*) as n from public.sms_team_templates
               where tenant_id = v_tenant group by team_id) t
    ), '{}'::jsonb),
    -- Автопополнение: карта — только подписью «Visa •••• 4242».
    'autotopup', jsonb_build_object(
      'enabled', coalesce(auto.enabled, false),
      'threshold_cents', coalesce(auto.threshold_cents, 500),
      'amount_cents', coalesce(auto.amount_cents, 2500),
      'card', auto.card_label,
      'error', auto.last_error
    ),
    -- Открытые тревоги: своей компании, а администратору платформы — и всей
    -- платформы (предохранитель, расхождения у партнёров).
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

/** Владелец меняет автопополнение: включить (только с картой), порог, сумма. */
create or replace function public.sms_autotopup_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  a public.sms_autotopup%rowtype;
  v_enabled boolean;
  v_threshold integer;
  v_amount integer;
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sms: bad settings' using errcode = '22023';
  end if;
  select * into a from public.sms_autotopup where tenant_id = v_tenant for update;
  v_enabled := coalesce(case when p ? 'enabled' then (p ->> 'enabled')::boolean end, a.enabled, false);
  v_threshold := coalesce(case when p ? 'threshold_cents' then (p ->> 'threshold_cents')::integer end, a.threshold_cents, 500);
  v_amount := coalesce(case when p ? 'amount_cents' then (p ->> 'amount_cents')::integer end, a.amount_cents, 2500);
  if v_threshold not in (500, 1000, 2500) or v_amount not in (1000, 2500, 5000, 10000) then
    raise exception 'sms:autotopup_amount' using errcode = '22023';
  end if;
  if v_enabled and (a.payment_method is null or a.stripe_customer is null) then
    raise exception 'sms:autotopup_card' using errcode = 'P0001';
  end if;
  -- Строки нет — карты нет, включить нельзя (отказ выше): только порог и
  -- сумма на будущее. Проверку «нужна карта» база делает ещё до слияния,
  -- поэтому не upsert.
  if a.tenant_id is null then
    insert into public.sms_autotopup (tenant_id, enabled, threshold_cents, amount_cents)
    values (v_tenant, false, v_threshold, v_amount)
    on conflict (tenant_id) do nothing;
  else
    update public.sms_autotopup
       set enabled = v_enabled,
           threshold_cents = v_threshold,
           amount_cents = v_amount,
           last_error = case when v_enabled then null else last_error end,
           updated_at = now()
     where tenant_id = v_tenant;
  end if;
  if v_enabled then
    perform public.sms_autotopup_poke(v_tenant, (select balance_cents from public.tenant_sms_config where tenant_id = v_tenant));
  end if;
  return public.sms_account();
end;
$function$;

/** Владелец убирает карту: автопополнение выключается. */
create or replace function public.sms_autotopup_forget()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  update public.sms_autotopup
     set enabled = false, payment_method = null, card_label = null,
         pending_key = null, pending_since = null, last_error = null, updated_at = now()
   where tenant_id = v_tenant;
  return public.sms_account();
end;
$function$;

-- ─────────────── 12. РАСПИСАНИЕ ───────────────

create or replace function public.sms_tick()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  stuck record;
begin
  if not public.sms_service_on() then
    return;
  end if;
  perform public.sms_enqueue_due();
  for stuck in
    select id from public.sms_messages
     where status = 'sending' and created_at < now() - interval '15 minutes'
  loop
    perform public.sms_mark(stuck.id, 'failed', null, 'timeout', 'Отправка не завершилась');
  end loop;
  if exists (
    select 1 from public.sms_messages
     where status = 'queued' and (send_after is null or send_after <= now())
  ) then
    perform public.sms_wake();
  end if;
  -- Автопополнение, которое не разбудило списание (зависшая попытка,
  -- снятый спор), — раз в 5 минут.
  if exists (
    select 1 from public.sms_autotopup a
      left join public.tenant_sms_config c on c.tenant_id = a.tenant_id
     where public.sms_autotopup_is_due(a, coalesce(c.balance_cents, 0), c.frozen_at is not null)
  ) then
    perform public.sms_autotopup_wake();
  end if;
end;
$function$;

select cron.unschedule(jobid) from cron.job where jobname = 'sms_reconcile';
select cron.schedule('sms_reconcile', '7 * * * *', 'select public.sms_reconcile()');

-- ─────────────── 13. ПРАВА ───────────────

-- Служебное: только база и серверные функции (service_role).
revoke all on function public.sms_ledger_append_only() from public, anon, authenticated;
revoke all on function public.sms_balance_guard() from public, anon, authenticated;
revoke all on function public.sms_alert(uuid, text, text) from public, anon, authenticated;
revoke all on function public.sms_ledger_post(uuid, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.sms_frozen(uuid) from public, anon, authenticated;
revoke all on function public.sms_autotopup_wake() from public, anon, authenticated;
revoke all on function public.sms_autotopup_is_due(public.sms_autotopup, integer, boolean) from public, anon, authenticated;
revoke all on function public.sms_autotopup_poke(uuid, integer) from public, anon, authenticated;
revoke all on function public.sms_charge(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.sms_mark(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.sms_credit_topup(uuid, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.bump_sms_balance(uuid, integer) from public, anon, authenticated;
revoke all on function public.sms_topup_reversed(text) from public, anon, authenticated;
revoke all on function public.sms_stripe_refund(text, integer) from public, anon, authenticated;
revoke all on function public.sms_stripe_dispute(text, text, integer, boolean) from public, anon, authenticated;
revoke all on function public.sms_reconcile() from public, anon, authenticated;
revoke all on function public.sms_unfreeze(uuid) from public, anon, authenticated;
revoke all on function public.sms_claim(integer) from public, anon, authenticated;
revoke all on function public.sms_autotopup_claim() from public, anon, authenticated;
revoke all on function public.sms_autotopup_result(uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function public.sms_autotopup_card(uuid, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.sms_autotopup_customer(uuid) from public, anon, authenticated;
revoke all on function public.sms_tick() from public, anon, authenticated;
grant execute on function public.sms_charge(uuid, text, integer) to service_role;
grant execute on function public.sms_mark(uuid, text, text, text, text) to service_role;
grant execute on function public.sms_credit_topup(uuid, integer, text, text, text) to service_role;
grant execute on function public.bump_sms_balance(uuid, integer) to service_role;
grant execute on function public.sms_stripe_refund(text, integer) to service_role;
grant execute on function public.sms_stripe_dispute(text, text, integer, boolean) to service_role;
grant execute on function public.sms_claim(integer) to service_role;
grant execute on function public.sms_autotopup_claim() to service_role;
grant execute on function public.sms_autotopup_result(uuid, text, boolean, text) to service_role;
grant execute on function public.sms_autotopup_card(uuid, text, text, text, integer, integer) to service_role;
grant execute on function public.sms_autotopup_customer(uuid) to service_role;
grant execute on function public.sms_reconcile() to service_role;
grant execute on function public.sms_unfreeze(uuid) to service_role;

-- Лицо: вошедшему человеку, решает сама функция.
revoke all on function public.sms_account() from public, anon;
grant execute on function public.sms_account() to authenticated;
revoke all on function public.sms_autotopup_save(jsonb) from public, anon;
grant execute on function public.sms_autotopup_save(jsonb) to authenticated;
revoke all on function public.sms_autotopup_forget() from public, anon;
grant execute on function public.sms_autotopup_forget() to authenticated;
revoke all on function public.sms_send_manual(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.sms_send_manual(uuid, uuid, text, text, text, text) to authenticated;
revoke all on function public.sms_send_bulk(text, jsonb) from public, anon;
grant execute on function public.sms_send_bulk(text, jsonb) to authenticated;

-- ─────────────── 14. СТОРОЖ МИГРАЦИИ ───────────────

do $audit$
declare
  fn text;
begin
  foreach fn in array array[
    'public.sms_alert(uuid, text, text)',
    'public.sms_ledger_post(uuid, text, integer, text, text)',
    'public.sms_frozen(uuid)',
    'public.sms_autotopup_wake()',
    'public.sms_autotopup_poke(uuid, integer)',
    'public.sms_charge(uuid, text, integer)',
    'public.sms_mark(uuid, text, text, text, text)',
    'public.sms_credit_topup(uuid, integer, text, text, text)',
    'public.bump_sms_balance(uuid, integer)',
    'public.sms_topup_reversed(text)',
    'public.sms_stripe_refund(text, integer)',
    'public.sms_stripe_dispute(text, text, integer, boolean)',
    'public.sms_reconcile()',
    'public.sms_unfreeze(uuid)',
    'public.sms_claim(integer)',
    'public.sms_autotopup_claim()',
    'public.sms_autotopup_result(uuid, text, boolean, text)',
    'public.sms_autotopup_card(uuid, text, text, text, integer, integer)',
    'public.sms_autotopup_customer(uuid)',
    'public.sms_tick()'
  ] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'служебная функция открыта наружу: %', fn;
    end if;
  end loop;
  foreach fn in array array[
    'public.sms_account()',
    'public.sms_autotopup_save(jsonb)',
    'public.sms_autotopup_forget()',
    'public.sms_send_manual(uuid, uuid, text, text, text, text)',
    'public.sms_send_bulk(text, jsonb)'
  ] loop
    if has_function_privilege('anon', fn, 'execute') or not has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'права лица неверны: %', fn;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.sms_ledger', 'select')
     or has_table_privilege('authenticated', 'public.sms_alerts', 'select')
     or has_table_privilege('authenticated', 'public.sms_autotopup', 'select')
     or has_table_privilege('anon', 'public.sms_ledger', 'select') then
    raise exception 'таблицы денег открыты наружу';
  end if;
  if (select count(*) from pg_proc where proname in ('sms_send_manual', 'sms_claim', 'sms_charge', 'sms_mark', 'sms_account')
        and pronamespace = 'public'::regnamespace) <> 5 then
    raise exception 'осталась вторая перегрузка';
  end if;
  if exists (select 1 from pg_proc where proname in ('reserve_sms_credit', 'release_sms_credit') and pronamespace = 'public'::regnamespace) then
    raise exception 'старые резервы остались';
  end if;
  if public.sms_reconcile() <> 0 then
    raise exception 'журнал не сошёлся с балансами сразу после миграции';
  end if;
end
$audit$;
