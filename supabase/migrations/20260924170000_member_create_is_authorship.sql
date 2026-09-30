-- НОВАЯ ЗАПИСЬ СОТРУДНИКА — ЦЕЛИКОМ ЕГО (STORY-088, волна 1, поправка).
--
-- Первая редакция двери создания (20260924150000) проверяла каждое поле новой
-- записи тем же блоком, что правку: клиента — «Клиент: Меняет», услуги —
-- «Сумма: Меняет». На телефоне это упёрлось в простое: запись клиента без
-- клиента не сохраняется, и сотрудник с «Новыми записями», но без права
-- менять клиента, не мог создать вообще ничего — право на экране обещало то,
-- чего не давало.
--
-- Правило теперь такое: «Новые записи: Может» — это авторство новой записи.
-- Клиента, объект, услуги, метку, цвет и заметку сотрудник выбирает сам;
-- блоки записи решают ПРАВКУ уже созданной. Что остаётся строгим:
--   • только знакомые поля (деньги оплаты, служебное — отказ `access:field`);
--   • клиент — только тот, кого человек и так видит (`access:client`);
--   • событие — прежним правилом («События: Меняет», поля своего события).
-- Тело переписано со снятого `pg_proc.prosrc` (md5 23d3f8e4…), изменён
-- ровно цикл проверки полей.

create or replace function public.member_appointment_create(p_row jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_kind text := coalesce(p_row ->> 'kind', 'work');
  v_team text := p_row ->> 'team_id';
  v_id uuid;
  v_rest jsonb;
  k text;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'master' then
    raise exception 'only an employee can use this appointment create' using errcode = '42501';
  end if;
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    raise exception 'appointment row must be an object' using errcode = '22023';
  end if;
  if v_kind not in ('work', 'event') then
    raise exception 'unsupported appointment kind' using errcode = '22023';
  end if;
  if v_team is null or (p_row ->> 'date') is null
     or (p_row ->> 'time_start') is null or (p_row ->> 'time_end') is null then
    raise exception 'team, date and time are required' using errcode = '22023';
  end if;
  if v_kind = 'work' and not public.member_can('calendar.create', 'write', v_team) then
    raise exception 'access:block:calendar.create' using errcode = '42501';
  end if;
  if v_kind = 'event' and not public.member_can('calendar.events', 'write', v_team) then
    raise exception 'access:block:calendar.events' using errcode = '42501';
  end if;

  v_id := coalesce(nullif(p_row ->> 'id', '')::uuid, gen_random_uuid());
  -- НОВАЯ ЗАПИСЬ — ЦЕЛИКОМ ЕГО (20260924170000). «Новые записи: Может»
  -- значит: клиента, объект, услуги, метку, цвет и заметку своей новой
  -- записи сотрудник выбирает сам — запись клиента без клиента не бывает.
  -- Блоки записи решают ПРАВКУ созданной, а не её рождение. Незнакомое поле
  -- по-прежнему не принимается, клиент — только тот, кого он и так видит.
  -- Событие — прежним правилом: «События: Меняет», поля своего события.
  v_rest := p_row - array['id', 'kind', 'team_id', 'date', 'time_start', 'time_end',
                          'total_duration', 'status', 'tenant_id', 'created_by'];
  for k in select jsonb_object_keys(v_rest) loop
    if v_kind = 'work' then
      if k not in ('comment', 'client_id', 'location_id', 'address', 'address_note',
                   'address_lat', 'address_lng', 'services', 'service_ids', 'total_amount',
                   'custom_total', 'discount_amount', 'global_discount',
                   'service_price_overrides', 'vat_mode', 'vat_rate', 'city',
                   'color_override', 'master_id') then
        raise exception 'access:field:%', k using errcode = '42501';
      end if;
    else
      perform public.member_check_appointment_field(
        k, v_rest -> k, v_kind, v_team, auth.uid(), 'scheduled'
      );
    end if;
  end loop;
  if v_rest ? 'client_id' and jsonb_typeof(v_rest -> 'client_id') <> 'null' then
    if not public.current_user_can_access_client((v_rest ->> 'client_id')::uuid)
       and not ((v_rest ->> 'client_id')::uuid = any(public.access_client_ids())) then
      raise exception 'access:client' using errcode = '42501';
    end if;
  end if;

  insert into public.appointments (id, tenant_id, team_id, kind, date, time_start, time_end,
                                   total_duration, status, created_by)
  values (v_id, public.current_tenant_id(), v_team, v_kind, p_row ->> 'date',
          p_row ->> 'time_start', p_row ->> 'time_end',
          coalesce(
            nullif(p_row ->> 'total_duration', '')::integer,
            greatest(0, (extract(epoch from ((p_row ->> 'time_end')::time
                                             - (p_row ->> 'time_start')::time)) / 60)::integer)
          ),
          'scheduled', auth.uid());

  if v_rest <> '{}'::jsonb then
    perform set_config('babun.member_write', 'on', true);
    update public.appointments x
       set (client_id, location_id, comment, address, address_note, address_lat, address_lng,
            services, service_ids, total_amount, custom_total, discount_amount, global_discount,
            service_price_overrides, vat_mode, vat_rate, city, color_override, master_id,
            event_all_day, event_notes, event_url, event_push_enabled, event_push_offsets,
            event_push_at, event_repeat)
         = (select r.client_id, r.location_id, r.comment, r.address, r.address_note, r.address_lat,
                   r.address_lng, r.services, r.service_ids, r.total_amount, r.custom_total,
                   r.discount_amount, r.global_discount, r.service_price_overrides, r.vat_mode,
                   r.vat_rate, r.city, r.color_override, r.master_id, r.event_all_day,
                   r.event_notes, r.event_url, r.event_push_enabled, r.event_push_offsets,
                   r.event_push_at, r.event_repeat
              from jsonb_populate_record(x, v_rest) r)
     where x.id = v_id;
    perform set_config('babun.member_write', 'off', true);
  end if;

  return jsonb_build_object('id', v_id);
end;
$function$;

revoke all on function public.member_appointment_create(jsonb) from public, anon;
grant execute on function public.member_appointment_create(jsonb) to authenticated;

do $audit$
begin
  if has_function_privilege('anon', 'public.member_appointment_create(jsonb)', 'execute') then
    raise exception 'member_appointment_create is callable by anon';
  end if;
end
$audit$;
