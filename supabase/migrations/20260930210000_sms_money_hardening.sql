-- SMS, ВОЛНА 13.1 (STORY-089): ИСПРАВЛЕНИЯ ПО ПРОВЕРКЕ ДЕНЕГ.
--
-- Независимая проверка безопасности (30.09) чужих путей к деньгам не нашла,
-- а в расчётах нашла — здесь всё, что правится в базе:
--   • сторож зависших SMS считал от создания, а не от забора в отправку:
--     старое напоминание срывалось, ушедшая SMS возвращала деньги —
--     `claimed_at`;
--   • зачисление — только суммы пакетов в евро (пересчёт в чужую валюту
--     дал бы €10 000 за €25) — иначе тревога и ноль;
--   • возврат оплаты выключает автопополнение; долг карта не гасит сама;
--   • повтор сигнала Stripe не включает снова убранную карту
--     (`card_session`), попытка в пути не теряется, повтор попытки идёт с
--     той же суммой (`pending_amount`);
--   • спор: открыт (и запрос банка) — только выключить автопополнение и
--     забыть карту; деньги снимаются, когда банк их реально забрал, и
--     возвращаются, когда вернул (`funds_withdrawn` / `funds_reinstated`);
--   • части SMS считает и база: эмодзи — две единицы UTF-16, как у Twilio;
--   • страны номера — только из списка `sms_allowed_prefixes` (Кипр):
--     накачка SMS в дорогие сети;
--   • сотрудник — не больше `sms_member_daily_cap` SMS в сутки;
--   • Twilio сказал «failed» после «sent» — деньги назад (не выставляет);
--   • журнал нельзя и стереть (кроме удаления компании целиком);
--   • сверка сравнивает списание каждого сообщения с журналом;
--   • имя отправителя — одно на всю платформу, чужие бренды нельзя;
--   • предел платформы 5000/час, компании 600/час; пауза платформы
--     снимается сама.
--
-- Накат 30.09 (`sms_money_hardening`, по слову владельца «накатывай»): текст,
-- прошедший прогон в откате (26 сценариев), — этот файл без комментариев и
-- пустых строк. Тела 21 функции в базе сверены по md5.

-- ─────────────── 1. СХЕМА ───────────────

alter table public.sms_messages add column if not exists claimed_at timestamptz;
alter table public.sms_autotopup
  add column if not exists card_session text,
  add column if not exists pending_amount integer;

-- Журнал нельзя стереть: только вместе с компанией (каскад идёт глубже
-- первого уровня триггеров).
create or replace function public.sms_ledger_no_delete()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if pg_trigger_depth() <= 1 then
    raise exception 'sms_ledger: журнал не стирается' using errcode = '42501';
  end if;
  return old;
end;
$function$;
drop trigger if exists sms_ledger_no_delete on public.sms_ledger;
create trigger sms_ledger_no_delete before delete on public.sms_ledger
  for each row execute function public.sms_ledger_no_delete();

-- Служебная роль — явной политикой, как у остальных таблиц проекта.
drop policy if exists sms_ledger_service_role on public.sms_ledger;
create policy sms_ledger_service_role on public.sms_ledger for all to service_role using (true) with check (true);
drop policy if exists sms_alerts_service_role on public.sms_alerts;
create policy sms_alerts_service_role on public.sms_alerts for all to service_role using (true) with check (true);
drop policy if exists sms_autotopup_service_role on public.sms_autotopup;
create policy sms_autotopup_service_role on public.sms_autotopup for all to service_role using (true) with check (true);

insert into public.app_settings (key, value) values ('sms_allowed_prefixes', '+357') on conflict (key) do nothing;
insert into public.app_settings (key, value) values ('sms_member_daily_cap', '100') on conflict (key) do nothing;
update public.app_settings set value = '5000' where key = 'sms_hourly_cap';
update public.app_settings set value = '600' where key = 'sms_tenant_hourly_cap';

-- ─────────────── 2. ПОМОЩНИКИ ───────────────

/** Можно ли слать SMS на этот номер: E.164 и начало из списка
 *  `sms_allowed_prefixes`. Номер без кода страны пропускается — его
 *  отбракует курьер («Номер без кода страны»). */
create or replace function public.sms_phone_allowed(p_phone text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  n text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  prefixes text[];
begin
  if n like '00%' then
    n := '+' || substr(n, 3);
  end if;
  if n not like '+%' then
    return true;
  end if;
  select coalesce(array_agg(trim(x)), '{}') into prefixes
    from unnest(string_to_array(coalesce(
      (select value from public.app_settings where key = 'sms_allowed_prefixes'), '+357'), ',')) x
   where trim(x) <> '';
  return exists (select 1 from unnest(prefixes) p where n like p || '%');
end;
$function$;

/** Не меньше скольких частей SMS по мнению базы: текст с символами за
 *  пределами BMP (эмодзи) — UCS-2, и каждый такой символ — две единицы
 *  UTF-16. Для остального верит курьеру. */
create or replace function public.sms_min_segments(p_body text)
returns integer
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  astral integer := char_length(regexp_replace(coalesce(p_body, ''), '[^\U00010000-\U0010FFFF]', '', 'g'));
  units integer;
begin
  if astral = 0 then
    return 1;
  end if;
  units := char_length(p_body) + astral;
  return case when units <= 70 then 1 else ceil(units / 67.0)::integer end;
end;
$function$;

-- ─────────────── 3. ОЧЕРЕДЬ, СПИСАНИЕ, ЗАЧИСЛЕНИЕ, ВОЗВРАТ ───────────────


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
  -- Ниже предела — пауза платформы (если была) снята.
  update public.sms_alerts set resolved_at = now()
   where tenant_id is null and kind = 'platform_cap' and resolved_at is null;

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
       set status = 'sending', claimed_at = now()
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
     where status = 'sending' and coalesce(claimed_at, created_at) < now() - interval '15 minutes'
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

  -- Страна номера — только из разрешённых (накачка SMS в дорогие сети).
  if not public.sms_phone_allowed(m.to_phone) then
    update public.sms_messages
       set status = 'blocked', message_body = p_body, segments = segs,
           error_code = 'country', error_message = 'Страна номера не разрешена для SMS'
     where id = p_id;
    return 'no_funds';
  end if;
  -- Части считает и база: эмодзи — две единицы UTF-16, Twilio берёт по ним.
  segs := greatest(segs, public.sms_min_segments(p_body));
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
  paid integer;
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
  -- Возвращается ровно списанное журналом за это сообщение.
  select -amount_cents into paid from public.sms_ledger where kind = 'send' and ref = m.id::text;
  if coalesce(paid, 0) > 0 then
    perform public.sms_ledger_post(m.tenant_id, 'send_refund', paid, m.id::text, left(coalesce(p_error_code, ''), 100));
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
  -- Только суммы пакетов в евро: чужая валюта (пересчёт Stripe) или
  -- странная сумма не зачисляется — тревога, разбор руками.
  if p_amount_cents not in (1000, 2500, 5000, 10000) then
    perform public.sms_alert(p_tenant, 'topup_amount',
      format('Оплата %s на %s ц. — не сумма пакета, не зачислена', p_payment_intent, p_amount_cents));
    return false;
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
  -- Вернули деньги — карту больше не списываем сами.
  update public.sms_autotopup
     set enabled = false, last_error = 'Возврат оплаты — автопополнение выключено', last_error_at = now(), updated_at = now()
   where tenant_id = t.tenant_id and enabled;
  return take;
end;
$function$;

-- ─────────────── 4. СПОР ПО КАРТЕ — ПО ДЕНЬГАМ БАНКА ───────────────

drop function if exists public.sms_stripe_dispute(text, text, integer, boolean);

/** Спор по пополнению: `opened` (и запрос банка без списания) — выключить
 *  автопополнение, забыть карту, тревога; `withdrawn` — банк забрал деньги,
 *  снять с баланса; `reinstated` — вернул, вернуть той же суммой. */
create or replace function public.sms_stripe_dispute(
  p_payment_intent text,
  p_dispute text,
  p_amount integer,
  p_phase text
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
  if p_dispute is null or p_phase not in ('opened', 'withdrawn', 'reinstated') then
    return 0;
  end if;
  select * into t from public.sms_topups where stripe_payment_intent_id = p_payment_intent for update;
  if not found or t.status not in ('completed', 'refunded') then
    return 0;
  end if;
  if p_phase in ('opened', 'withdrawn') then
    update public.sms_autotopup
       set enabled = false, payment_method = null, card_label = null,
           pending_key = null, pending_since = null, pending_amount = null,
           last_error = 'Спор по оплате — сохраните новую карту', last_error_at = now(), updated_at = now()
     where tenant_id = t.tenant_id;
    perform public.sms_alert(t.tenant_id, 'dispute', 'Спор по оплате SMS в банке');
  end if;
  if p_phase = 'opened' then
    return 0;
  end if;
  select -amount_cents into opened
    from public.sms_ledger
   where kind = 'dispute' and ref = p_payment_intent || ':dispute:' || p_dispute;
  if p_phase = 'withdrawn' then
    if opened is not null then
      return 0;
    end if;
    select * into r from public.sms_topup_reversed(p_payment_intent);
    take := least(greatest(coalesce(p_amount, 0), 0), t.amount_cents - r.refunded - r.disputed);
    if take <= 0 then
      return 0;
    end if;
    perform public.sms_ledger_post(
      t.tenant_id, 'dispute', -take, p_payment_intent || ':dispute:' || p_dispute, 'Банк забрал деньги по спору'
    );
    return take;
  end if;
  if opened is null then
    return 0;
  end if;
  if public.sms_ledger_post(
    t.tenant_id, 'dispute_won', opened, p_payment_intent || ':dispute_won:' || p_dispute, 'Банк вернул деньги по спору'
  ) is null then
    return 0;
  end if;
  update public.sms_alerts set resolved_at = now()
   where tenant_id = t.tenant_id and kind = 'dispute' and resolved_at is null;
  return opened;
end;
$function$;

-- ─────────────── 5. КАРТА АВТОПОПОЛНЕНИЯ — ОДИН РАЗ НА ОПЛАТУ ───────────────

drop function if exists public.sms_autotopup_card(uuid, text, text, text, integer, integer);

/** Карта сохранена оплатой на сайте. Та же оплата второй раз (Stripe
 *  повторил сигнал) — ничего: карту, которую владелец убрал или которую
 *  забыл спор, повтор не вернёт. Попытка в пути (моложе 30 минут) не
 *  трогается — её доведёт повтор тем же ключом. `false` — повтор. */
create or replace function public.sms_autotopup_card(
  p_tenant uuid,
  p_session text,
  p_customer text,
  p_payment_method text,
  p_label text,
  p_threshold integer,
  p_amount integer
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_threshold integer := case when p_threshold in (500, 1000, 2500) then p_threshold else 500 end;
  v_amount integer := case when p_amount in (1000, 2500, 5000, 10000) then p_amount else 2500 end;
  a public.sms_autotopup%rowtype;
begin
  if p_tenant is null or nullif(p_session, '') is null or nullif(p_customer, '') is null
     or nullif(p_payment_method, '') is null then
    raise exception 'sms_autotopup_card: no card' using errcode = '22023';
  end if;
  select * into a from public.sms_autotopup where tenant_id = p_tenant for update;
  if not found then
    insert into public.sms_autotopup (
      tenant_id, enabled, threshold_cents, amount_cents, stripe_customer, payment_method, card_label, card_session
    ) values (
      p_tenant, true, v_threshold, v_amount, p_customer, p_payment_method, left(p_label, 60), p_session
    )
    on conflict (tenant_id) do nothing;
    return true;
  end if;
  if a.card_session = p_session then
    return false;
  end if;
  update public.sms_autotopup
     set enabled = true,
         threshold_cents = v_threshold,
         amount_cents = v_amount,
         stripe_customer = p_customer,
         payment_method = p_payment_method,
         card_label = left(p_label, 60),
         card_session = p_session,
         pending_key = case when pending_since > now() - interval '30 minutes' then pending_key end,
         pending_amount = case when pending_since > now() - interval '30 minutes' then pending_amount end,
         pending_since = case when pending_since > now() - interval '30 minutes' then pending_since end,
         last_error = null,
         last_error_at = null,
         updated_at = now()
   where tenant_id = p_tenant;
  return true;
end;
$function$;

-- ─────────────── 6. TWILIO НЕ ОТПРАВИЛ ПОСЛЕ «SENT» — ДЕНЬГИ НАЗАД ───────────────

/** Twilio не выставляет счёт за 'failed' — и мы возвращаем списанное,
 *  даже если «не отправлено» пришло статусом после «отправлено». За
 *  'undelivered' Twilio берёт деньги — оно остаётся оплаченным. */
create or replace function public.sms_refund_failed_after_sent()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  paid integer;
begin
  if old.status = 'sent' and new.status = 'failed' then
    select -amount_cents into paid from public.sms_ledger where kind = 'send' and ref = new.id::text;
    if coalesce(paid, 0) > 0 then
      perform public.sms_ledger_post(new.tenant_id, 'send_refund', paid, new.id::text, 'Twilio: не отправлено');
      new.cost_cents := 0;
    end if;
  end if;
  return new;
end;
$function$;
drop trigger if exists sms_refund_failed_after_sent on public.sms_messages;
create trigger sms_refund_failed_after_sent before update of status on public.sms_messages
  for each row execute function public.sms_refund_failed_after_sent();

-- ─────────────── 7. ИМЯ ОТПРАВИТЕЛЯ — ОДНО НА ПЛАТФОРМУ ───────────────

create or replace function public.sms_save_team_sender(p_team_id text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms: owner only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.teams t where t.tenant_id = v_tenant and t.id = p_team_id) then
    raise exception 'sms: bad team' using errcode = '22023';
  end if;
  if v_name = '' then
    delete from public.sms_team_senders where tenant_id = v_tenant and team_id = p_team_id;
    return public.sms_account();
  end if;
  if not (v_name ~ '^[A-Za-z0-9 ]{1,11}$' and v_name ~ '[A-Za-z]') then
    raise exception 'sms:sender_format' using errcode = '22023';
  end if;
  -- Все компании шлют с одного счёта Twilio: чужое имя (другой компании
  -- или известный бренд) подставит под блокировку всех.
  if lower(replace(v_name, ' ', '')) = any (array[
       'babun', 'twilio', 'stripe', 'paypal', 'visa', 'mastercard', 'apple', 'google',
       'revolut', 'bank', 'police', 'cyta', 'epic', 'verify', 'sms', 'info', 'test'
     ])
     or exists (
       select 1 from public.sms_team_senders s
        where lower(s.sender_name) = lower(v_name) and s.tenant_id <> v_tenant
     ) then
    raise exception 'sms:sender_taken' using errcode = 'P0001';
  end if;
  insert into public.sms_team_senders (tenant_id, team_id, sender_name)
  values (v_tenant, p_team_id, v_name)
  on conflict (tenant_id, team_id) do update set sender_name = excluded.sender_name, updated_at = now();
  return public.sms_account();
end;
$function$;

-- ─────────────── 8. ОСТАЛЬНЫЕ ПРАВКИ ФУНКЦИЙ ───────────────

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
    select m.tenant_id, m.id, m.cost_cents, coalesce(l.net, 0) as net
      from public.sms_messages m
      left join (
        select ref, sum(amount_cents) as net
          from public.sms_ledger
         where kind in ('send', 'send_refund')
         group by ref
      ) l on l.ref = m.id::text
     where m.created_at > now() - interval '60 days'
       and coalesce(l.net, 0) <> -coalesce(m.cost_cents, 0)
  loop
    n := n + 1;
    update public.tenant_sms_config
       set frozen_at = coalesce(frozen_at, now()), frozen_reason = 'send_mismatch'
     where tenant_id = r.tenant_id;
    perform public.sms_alert(r.tenant_id, 'send_mismatch',
      format('SMS %s: списано %s ц., журнал %s ц. — отправка остановлена', r.id, r.cost_cents, -r.net));
  end loop;
  return n;
end;
$function$;
create or replace function public.sms_unfreeze(p_tenant uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.tenant_sms_config set frozen_at = null, frozen_reason = null where tenant_id = p_tenant;
  update public.sms_alerts set resolved_at = now()
   where tenant_id = p_tenant and resolved_at is null
     and kind in ('ledger_mismatch', 'topup_missing', 'send_missing', 'send_mismatch', 'topup_amount');
$function$;
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
     and coalesce(p_balance, 0) >= 0
     and (a.pending_since is null or a.pending_since < now() - interval '30 minutes')
     and (a.last_success_at is null or a.last_success_at < now() - interval '15 minutes')
     and (a.day is distinct from current_date or a.day_count < 3);
$function$;
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
      a.pending_amount := a.amount_cents;
      a.day_count := case when a.day is distinct from current_date then 1 else a.day_count + 1 end;
      a.day := current_date;
    end if;
    update public.sms_autotopup x
       set pending_key = a.pending_key, pending_amount = a.pending_amount, pending_since = now(),
           day = a.day, day_count = a.day_count, updated_at = now()
     where x.tenant_id = a.tenant_id;
    tenant_id := a.tenant_id;
    customer := a.stripe_customer;
    payment_method := a.payment_method;
    -- Повтор попытки — с той же суммой, что и первый раз: иначе Stripe
    -- отвергнет ключ, а сумму владелец мог сменить в пути.
    amount_cents := coalesce(a.pending_amount, a.amount_cents);
    idem_key := 'sms-autotopup-' || a.pending_key;
    return next;
  end loop;
end;
$function$;
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
         pending_amount = null,
         last_success_at = case when p_ok then now() else last_success_at end,
         enabled = case when p_ok then enabled else false end,
         last_error = case when p_ok then null else left(coalesce(p_error, 'Банк отклонил списание'), 300) end,
         last_error_at = case when p_ok then last_error_at else now() end,
         updated_at = now()
   where tenant_id = p_tenant and 'sms-autotopup-' || pending_key = p_key;
end;
$function$;
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
         pending_key = null, pending_since = null, pending_amount = null, last_error = null, updated_at = now()
   where tenant_id = v_tenant;
  return public.sms_account();
end;
$function$;
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
  cap_member integer := coalesce(
    (select nullif(value, '')::integer from public.app_settings where key = 'sms_member_daily_cap'), 100);
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
  -- Сотрудник — не больше предела в сутки: баланс и карта — владельца.
  if not is_owner and (
    select count(*) from public.sms_messages
     where sent_by = auth.uid() and created_at > now() - interval '1 day'
  ) >= cap_member then
    raise exception 'sms:limit' using errcode = 'P0001';
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
  if not public.sms_phone_allowed(phone) then
    raise exception 'sms:country' using errcode = 'P0001';
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
    if phone is null or not public.sms_phone_allowed(phone)
       or c.deleted_at is not null or c.sms_opt_out or coalesce(c.blacklisted, false)
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

-- ─────────────── 9. ПРАВА ───────────────

revoke all on function public.sms_ledger_no_delete() from public, anon, authenticated;
revoke all on function public.sms_phone_allowed(text) from public, anon, authenticated;
revoke all on function public.sms_min_segments(text) from public, anon, authenticated;
revoke all on function public.sms_refund_failed_after_sent() from public, anon, authenticated;
revoke all on function public.sms_stripe_dispute(text, text, integer, text) from public, anon, authenticated;
revoke all on function public.sms_autotopup_card(uuid, text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.sms_stripe_dispute(text, text, integer, text) to service_role;
grant execute on function public.sms_autotopup_card(uuid, text, text, text, text, integer, integer) to service_role;
-- Вебхук открывает тревогу, когда оплата пришла не в евро.
grant execute on function public.sms_alert(uuid, text, text) to service_role;
revoke all on function public.sms_save_team_sender(text, text) from public, anon;
grant execute on function public.sms_save_team_sender(text, text) to authenticated;

-- ─────────────── 10. СТОРОЖ МИГРАЦИИ ───────────────

do $audit$
declare
  fn text;
begin
  foreach fn in array array[
    'public.sms_phone_allowed(text)',
    'public.sms_min_segments(text)',
    'public.sms_stripe_dispute(text, text, integer, text)',
    'public.sms_autotopup_card(uuid, text, text, text, text, integer, integer)',
    'public.sms_alert(uuid, text, text)',
    'public.sms_charge(uuid, text, integer)',
    'public.sms_mark(uuid, text, text, text, text)',
    'public.sms_credit_topup(uuid, integer, text, text, text)',
    'public.sms_stripe_refund(text, integer)',
    'public.sms_claim(integer)',
    'public.sms_autotopup_claim()',
    'public.sms_autotopup_result(uuid, text, boolean, text)',
    'public.sms_reconcile()',
    'public.sms_unfreeze(uuid)',
    'public.sms_tick()'
  ] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'служебная функция открыта наружу: %', fn;
    end if;
  end loop;
  foreach fn in array array[
    'public.sms_stripe_dispute(text, text, integer, text)',
    'public.sms_autotopup_card(uuid, text, text, text, text, integer, integer)',
    'public.sms_alert(uuid, text, text)',
    'public.sms_credit_topup(uuid, integer, text, text, text)',
    'public.sms_stripe_refund(text, integer)',
    'public.sms_autotopup_result(uuid, text, boolean, text)'
  ] loop
    if not has_function_privilege('service_role', fn, 'execute') then
      raise exception 'серверу не хватает права: %', fn;
    end if;
  end loop;
  foreach fn in array array[
    'public.sms_send_manual(uuid, uuid, text, text, text, text)',
    'public.sms_send_bulk(text, jsonb)',
    'public.sms_save_team_sender(text, text)',
    'public.sms_autotopup_forget()'
  ] loop
    if has_function_privilege('anon', fn, 'execute') or not has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'права лица неверны: %', fn;
    end if;
  end loop;
  if (select count(*) from pg_proc where proname in ('sms_stripe_dispute', 'sms_autotopup_card', 'sms_save_team_sender', 'sms_send_manual')
        and pronamespace = 'public'::regnamespace) <> 4 then
    raise exception 'осталась вторая перегрузка';
  end if;
  if public.sms_min_segments('Привет') <> 1
     or public.sms_min_segments(repeat('😀', 35)) <> 1
     or public.sms_min_segments(repeat('😀', 36)) <> 2
     or public.sms_min_segments(repeat('😀', 70)) <> 3 then
    raise exception 'счёт частей с эмодзи неверен';
  end if;
  if not public.sms_phone_allowed('+35799123456') or public.sms_phone_allowed('+88299123456')
     or not public.sms_phone_allowed('0035799123456') or not public.sms_phone_allowed('99123456') then
    raise exception 'список стран работает не так';
  end if;
  if public.sms_reconcile() <> 0 then
    raise exception 'журнал не сошёлся с балансами';
  end if;
end
$audit$;
