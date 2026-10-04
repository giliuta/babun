-- ОТЛОЖЕННАЯ SMS НЕ УХОДИТ КЛИЕНТУ, КОТОРЫЙ УЖЕ ОТКАЗАЛСЯ (03.10, сессия 017).
--
-- Было: `sms_enqueue` сверял «Присылать SMS», чёрный список и удаление
-- клиента только В МОМЕНТ ПОСТАНОВКИ в очередь, а `sms_claim` и `sms_charge`
-- перед отправкой клиента не смотрели. Шаблон «После визита» на +2 ч: запись
-- выполнена → сообщение ждёт; клиент просит не писать, в карточке выключают
-- «Присылать SMS» — через два часа SMS всё равно уходит, и с баланса
-- списывается.
--
-- Стало: `sms_charge` (зовётся функцией отправки прямо перед Twilio, под
-- замком строки) первым делом спрашивает клиента сообщения — свой
-- `client_id`, а без него клиента записи. Отказ, чёрный список или карточка в
-- корзине → статус `blocked`, `error_code = 'opt_out'`, причина словами, ответ
-- `no_funds` — тот же канал «заблокировано», что у «страна не разрешена» и
-- «отправка остановлена»: send_sms считает его blocked, Twilio не зовётся,
-- журнал денег не трогается. Тело функции — живое (`pg_get_functiondef`
-- перед правкой), изменён только этот кусок; права не меняются
-- (`create or replace` сохраняет ACL).

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
  v_opt_out boolean;
  v_black boolean;
  v_deleted boolean;
begin
  select * into m from public.sms_messages where id = p_id for update;
  if not found or m.status <> 'sending' then
    return 'gone';
  end if;

  -- КЛИЕНТ ОТКАЗАЛСЯ, ПОКА СООБЩЕНИЕ ЖДАЛО ОЧЕРЕДИ (03.10). Отказ от SMS,
  -- чёрный список и удаление `sms_enqueue` проверяет только при постановке, а
  -- отложенное сообщение («После визита» +N ч, сдвиг в окно 8–21) лежит в
  -- очереди часами. Решение — здесь, под замком строки, перед списанием и
  -- отправкой: ни денег, ни SMS. Без клиента (проверка своего номера) — мимо.
  select c.sms_opt_out, c.blacklisted, c.deleted_at is not null
    into v_opt_out, v_black, v_deleted
    from public.clients c
   where c.id = coalesce(
           m.client_id,
           (select a.client_id from public.appointments a where a.id = m.appointment_id)
         );
  if coalesce(v_opt_out, false) or coalesce(v_black, false) or coalesce(v_deleted, false) then
    update public.sms_messages
       set status = 'blocked', message_body = p_body,
           segments = segs,
           error_code = 'opt_out',
           error_message = case
             when v_deleted then 'Клиент удалён'
             when v_black then 'Клиент в чёрном списке'
             else 'Клиент просил не писать'
           end
     where id = p_id;
    return 'no_funds';
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
  if not public.sms_phone_allowed(m.to_phone) then
    update public.sms_messages
       set status = 'blocked', message_body = p_body, segments = segs,
           error_code = 'country', error_message = 'Страна номера не разрешена для SMS'
     where id = p_id;
    return 'no_funds';
  end if;
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

do $guard$
declare
  v_def text := pg_get_functiondef('public.sms_charge(uuid, text, integer)'::regprocedure);
begin
  if position('sms_opt_out' in v_def) = 0
     or position('blacklisted' in v_def) = 0
     or position('deleted_at is not null' in v_def) = 0 then
    raise exception 'sms opt-out: sms_charge не проверяет клиента перед отправкой';
  end if;
  if position('sms_opt_out' in v_def) > position('sms_ledger_post' in v_def) then
    raise exception 'sms opt-out: проверка клиента стоит после списания';
  end if;
end;
$guard$;
