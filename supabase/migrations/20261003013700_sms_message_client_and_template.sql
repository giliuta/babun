-- SMS ЗАКРЕПЛЕНЫ ЗА КЛИЕНТОМ; В ИСТОРИИ — ИМЯ ШАБЛОНА (STORY-089; владелец
-- 03.10: «при смене клиента SMS фиксируются за клиентом… внизу просто
-- история SMS, которые отправили для этого клиента… не нужно полноценно
-- переписывать SMS — отправленное SMS, дата, время»).
--
-- Что было. Строка истории (`sms_message_json`) не знала ни клиента, ни
-- шаблона. Запись показывала все свои SMS — и после смены клиента под новым
-- клиентом висели SMS прежнему; строка истории называлась поводом
-- («Вручную»), а не шаблоном, по которому ушло («За день»).
--
-- Что теперь. В строке — `client_id` (кому ушло; приложение показывает в
-- записи только SMS её нынешнему клиенту) и `template_name` (имя шаблона,
-- если он ещё есть). Номер и деньги по-прежнему только владельцу.
-- Функция вызывается только из definer-функций истории (sms_for_appointment,
-- sms_for_client, sms_history); права на неё не меняются.

create or replace function public.sms_message_json(m sms_messages, p_owner boolean)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', m.id,
    'created_at', m.created_at,
    'send_after', m.send_after,
    'status', m.status,
    'trigger', m.trigger_type,
    'appointment_id', m.appointment_id,
    'team_id', m.team_id,
    -- Кому ушло: SMS закреплены за клиентом (03.10).
    'client_id', m.client_id,
    -- Номер получателя — только владельцу (защита базы 30.09): история SMS
    -- иначе вытягивала бы номера мимо двери «номер по одному».
    'to_phone', case when p_owner then m.to_phone else '' end,
    'body', m.message_body,
    'template_body', m.template_body,
    -- Шаблон, по которому ушло, — именем; удалён — пусто.
    'template_name', (
      select t.name from public.sms_team_templates t
       where t.tenant_id = m.tenant_id and t.id::text = m.template_id
    ),
    'segments', m.segments,
    'error', m.error_message,
    'cost_cents', case when p_owner then m.cost_cents else 0 end,
    'was_free', case when p_owner then m.was_free else false end
  )
$function$;
