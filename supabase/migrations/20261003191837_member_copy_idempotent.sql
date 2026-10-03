-- КОПИЯ ЗАПИСИ ПАРТНЁРОМ БЕЗ ДУБЛЕЙ (аудит параллельных правок 03.10).
--
-- Дверь `member_appointment_copy` сама придумывала номер новой записи. На
-- слабой связи копия вставала, а ответ обрывался по таймауту: телефон
-- говорил «Не удалось скопировать», человек повторял — и в календаре
-- оказывались две одинаковые записи (а клиенту при включённом шаблоне — два
-- SMS о записи). У владельца так не бывает: номер записи придумывает
-- телефон, и повтор упирается в уже существующую строку.
--
-- Теперь и партнёрская копия принимает номер от телефона (`p_id`). Повтор с
-- тем же номером, если такая запись уже есть и её завёл этот же человек в
-- этой компании, возвращает её, а не заводит вторую. Без `p_id` (старые
-- сборки приложения) — как раньше.
--
-- Новый параметр — значит новая сигнатура: прежнюю снимаем, иначе
-- `create or replace` молча завёл бы вторую перегрузку. Тело — живое тело
-- функции (03.10) с двумя правками; права — те же: только `authenticated`.

drop function if exists public.member_appointment_copy(uuid, text, text, text);

create or replace function public.member_appointment_copy(
  p_source uuid,
  p_date text,
  p_time_start text,
  p_time_end text,
  p_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s public.appointments%rowtype;
  v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'master' then
    raise exception 'only an employee can use this appointment copy' using errcode = '42501';
  end if;
  if p_source is null or p_date is null or p_time_start is null or p_time_end is null then
    raise exception 'source, date and time are required' using errcode = '22023';
  end if;

  -- ПОВТОР ПОСЛЕ ПОТЕРЯННОГО ОТВЕТА: копия с этим номером уже встала — её же
  -- и возвращаем. Только свою и только в своей компании: чужой номер так не
  -- подсмотреть (ответ — тот же номер, что и прислан).
  if p_id is not null and exists (
       select 1 from public.appointments x
        where x.id = p_id
          and x.tenant_id = public.current_tenant_id()
          and x.created_by = auth.uid()
     ) then
    return jsonb_build_object('id', p_id);
  end if;

  select * into s
    from public.appointments x
   where x.id = p_source
     and x.tenant_id = public.current_tenant_id();
  if not found
     or s.team_id is null
     or s.kind <> 'work'
     or not public.member_sees_calendar(s.team_id) then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;
  -- «Перенос записей: Может» — всё меню записи, копия в том числе.
  if not public.member_can('calendar.move', 'write', s.team_id) then
    raise exception 'access:block:calendar.move' using errcode = '42501';
  end if;
  -- Клиента копия несёт, только если он виден человеку в этой команде (защита
  -- базы 30.09): копия давней записи на сегодня не возвращает давнего клиента
  -- в окно «Около записи».
  if s.client_id is not null and not public.member_client_in_team(s.client_id, s.team_id) then
    raise exception 'access:client' using errcode = '42501';
  end if;

  -- КОПИЯ — В ТУ ЖЕ КОМАНДУ: команды в вызове нет, она берётся у оригинала.
  -- Оплата, статус, отмена, фото и напоминания не копируются — как у копии
  -- владельца (`duplicateAppointment`).
  insert into public.appointments (id, tenant_id, team_id, kind, date, time_start, time_end,
                                   total_duration, status, created_by)
  values (v_id, s.tenant_id, s.team_id, 'work', p_date, p_time_start, p_time_end,
          greatest(0, (extract(epoch from (p_time_end::time - p_time_start::time)) / 60)::integer),
          'scheduled', auth.uid());

  perform set_config('babun.member_write', 'on', true);
  update public.appointments x
     set (client_id, location_id, comment, address, address_note, address_lat, address_lng,
          services, service_ids, total_amount, custom_total, discount_amount, global_discount,
          service_price_overrides, vat_mode, vat_rate, city, color_override, master_id)
       = (s.client_id, s.location_id, s.comment, s.address, s.address_note, s.address_lat,
          s.address_lng, s.services, s.service_ids, s.total_amount, s.custom_total,
          s.discount_amount, s.global_discount, s.service_price_overrides, s.vat_mode,
          s.vat_rate, s.city, s.color_override, s.master_id)
   where x.id = v_id;
  perform set_config('babun.member_write', 'off', true);

  return jsonb_build_object('id', v_id);
end;
$function$;

-- Новая функция исполнима для PUBLIC и anon по умолчанию — дверь писателя
-- закрываем той же миграцией, как была закрыта прежняя.
revoke all on function public.member_appointment_copy(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.member_appointment_copy(uuid, text, text, text, uuid) to authenticated;
