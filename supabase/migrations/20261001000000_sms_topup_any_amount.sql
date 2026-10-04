-- SMS: ПОПОЛНЕНИЕ НА ЛЮБУЮ СУММУ (STORY-089, волна 14.3).
--
-- Владелец 30.09: «открывается шторка, я вписываю туда сумму и нажимаю
-- оплатить». До этого баланс принимал только пакеты €10 / 25 / 50 / 100:
-- `sms_credit_topup` любую другую сумму не зачислял и поднимал тревогу.
--
-- Теперь — любая сумма целыми евро в пределах `app_settings`
-- (`sms_topup_min_cents` = €5, `sms_topup_max_cents` = €500). Защита та же:
--   • сумму выбирает приложение, функция `sms-checkout` кладёт её в метаданные
--     Stripe, вебхук зачисляет только если Stripe списал ровно её;
--   • всё, что вне пределов или не целыми евро, — тревога, не зачисление
--     (предел сверху — от ошибки и от чужой карты: большой платёж потом
--     оспаривают целиком).
-- Повтор той же оплаты по-прежнему ничего не делает (UNIQUE по payment_intent).

insert into public.app_settings (key, value) values ('sms_topup_min_cents', '500') on conflict (key) do nothing;
insert into public.app_settings (key, value) values ('sms_topup_max_cents', '50000') on conflict (key) do nothing;

create or replace function public.sms_credit_topup(p_tenant uuid, p_amount_cents integer, p_session text, p_payment_intent text, p_pack text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  inserted uuid;
  min_cents integer := coalesce((select value::integer from public.app_settings where key = 'sms_topup_min_cents'), 500);
  max_cents integer := coalesce((select value::integer from public.app_settings where key = 'sms_topup_max_cents'), 50000);
begin
  if p_amount_cents is null or p_amount_cents <= 0 or p_payment_intent is null then
    raise exception 'sms_credit_topup: bad payment' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'sms_credit_topup: no tenant' using errcode = '22023';
  end if;
  if p_amount_cents < min_cents or p_amount_cents > max_cents or p_amount_cents % 100 <> 0 then
    perform public.sms_alert(p_tenant, 'topup_amount',
      format('Оплата %s на %s ц. — вне пределов пополнения, не зачислена', p_payment_intent, p_amount_cents));
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

-- Права не меняются (`create or replace` их сохраняет), но проверяем:
-- зачислять может только сервер.
do $audit$
begin
  if has_function_privilege('anon', 'public.sms_credit_topup(uuid,integer,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.sms_credit_topup(uuid,integer,text,text,text)', 'execute') then
    raise exception 'sms_topup_any_amount: sms_credit_topup открыта не только серверу';
  end if;
end;
$audit$;
