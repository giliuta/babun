-- SMS, ВОЛНА 5 (STORY-089): ИСТОРИЯ SMS В ЗАПИСИ И У КЛИЕНТА.
--
-- Владелец 25.09: «история SMS к клиенту… и на записи в самом низу блок —
-- что мы уже отправили ему или не отправили… зашёл в запись, нажал кнопку
-- „Отправить SMS“ — и оно сразу отправляет то, что записал… вручную».
--
-- Две функции чтения, права — как у самой записи:
--   • `sms_for_appointment` — сообщения этой записи и текст «Новая запись»
--     её команды (свой текст команды → текст компании → стандартный) —
--     его лист «Отправить SMS» подставляет первым, даже если автоматическая
--     отправка события выключена;
--   • `sms_for_client` — сообщения клиента: владельцу — все, сотруднику —
--     по календарям, которые он видит (ручные SMS из карточки без записи —
--     только владельцу, как и отправка).
-- Цена сообщения — только владельцу: деньги компании.

/** Видит ли человек календарь записи — тем же правилом, что окно записей
 *  и ручная отправка (`sms_send_manual`). */
create or replace function public.sms_can_see_team(p_team text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select public.current_user_role() = 'owner'
      or (p_team is not null and (
            p_team = any(public.current_user_calendar_ids('view'))
            or p_team = any(public.current_user_team_ids())
          ))
$function$;

/** Сообщение — для записи и карточки клиента. */
create or replace function public.sms_message_json(m public.sms_messages, p_owner boolean)
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
    'to_phone', m.to_phone,
    'body', m.message_body,
    'template_body', m.template_body,
    'segments', m.segments,
    'error', m.error_message,
    'cost_cents', case when p_owner then m.cost_cents else 0 end,
    'was_free', case when p_owner then m.was_free else false end
  )
$function$;

create or replace function public.sms_for_appointment(p_appointment_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  is_owner boolean := public.current_user_role() = 'owner';
  a record;
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  select ap.id, ap.team_id into a
    from public.appointments ap
   where ap.id = p_appointment_id and ap.tenant_id = v_tenant;
  if not found or not public.sms_can_see_team(a.team_id) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'confirm_body', coalesce(
      (select nullif(r.body, '') from public.sms_rules r
        where r.tenant_id = v_tenant and r.team_id = coalesce(a.team_id, '') and r.team_id <> ''
          and r.event = 'new_appointment' and r.mode = 'on'),
      (select nullif(r.body, '') from public.sms_rules r
        where r.tenant_id = v_tenant and r.team_id = '' and r.event = 'new_appointment'),
      (select d.body from public.sms_rule_default('new_appointment') d)
    ),
    'messages', coalesce((
      select jsonb_agg(public.sms_message_json(m, is_owner) order by m.created_at desc)
        from public.sms_messages m
       where m.tenant_id = v_tenant and m.appointment_id = a.id
    ), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.sms_for_client(p_client_id uuid, p_limit integer default 50)
returns setof jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  is_owner boolean := public.current_user_role() = 'owner';
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  return query
  select public.sms_message_json(m, is_owner)
    from public.sms_messages m
   where m.tenant_id = v_tenant
     and m.client_id = p_client_id
     and (is_owner or (m.team_id is not null and public.sms_can_see_team(m.team_id)))
   order by m.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$function$;

revoke all on function public.sms_can_see_team(text) from public, anon, authenticated;
revoke all on function public.sms_message_json(public.sms_messages, boolean) from public, anon, authenticated;
revoke all on function public.sms_for_appointment(uuid) from public, anon;
revoke all on function public.sms_for_client(uuid, integer) from public, anon;
grant execute on function public.sms_for_appointment(uuid) to authenticated;
grant execute on function public.sms_for_client(uuid, integer) to authenticated;

do $audit$
begin
  if has_function_privilege('anon', 'public.sms_for_appointment(uuid)', 'execute')
     or has_function_privilege('anon', 'public.sms_for_client(uuid, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.sms_can_see_team(text)', 'execute') then
    raise exception 'sms log functions: wrong grants';
  end if;
end
$audit$;
