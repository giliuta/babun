-- «ИСТОРИЯ ЗАПИСЕЙ» КЛИЕНТА — СВОЕЙ ДОРОГОЙ (проверка глазами 01.10).
--
-- Право «История записей: Видит» обещает «Видит историю записей клиента»,
-- но своей дороги у него не было: карточка и строка списка брали записи из
-- календаря сотрудника (`list_master_appointments_safe`), а там клиент
-- записи открыт только правом «Клиент в записи» и только около записи. У
-- Дмитрия с открытой историей у всех клиентов было «нет записей».
--
-- Теперь история приходит отсюда: записи (только работы) клиентов, у
-- которых сотруднику открыт блок «История записей» (`access_client_blocks`
-- — команды, через которые клиент виден). В строке — дата, время, статус,
-- команда, мастер, услуги без цен. Остальное — по блокам этого клиента:
--   · суммы и оплата — при «Долг и деньги»;
--   · объект записи — при «Объекты»;
--   · заметки записи, адреса, метки дня — никогда (это права календаря).
-- Форма строки — та же, что у списка мастера: приложение склеивает их по id.
--
-- `p_client` — одна карточка; без него — все клиенты с открытой историей
-- (строка списка: «был …», «записан …»).

create or replace function public.member_client_history(p_client uuid default null)
 returns setof jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  active_tenant uuid := public.current_tenant_id();
begin
  if auth.uid() is null or active_tenant is null
     or public.current_user_role() is distinct from 'master' then
    return;
  end if;

  return query
    with open_history as (
      select cb.client_id,
             cb.blocks ->> 'clients.money' in ('read', 'write') as see_money,
             cb.blocks ->> 'clients.objects' in ('read', 'write') as see_object
        from public.access_client_blocks() cb
       where cb.blocks ->> 'clients.history' in ('read', 'write')
         and (p_client is null or cb.client_id = p_client)
    )
    select jsonb_build_object(
      'id', a.id,
      'tenant_id', a.tenant_id,
      'client_id', a.client_id,
      'team_id', a.team_id,
      'master_id', a.master_id,
      'location_id', case when h.see_object then a.location_id end,
      'date', a.date,
      'time_start', a.time_start,
      'time_end', a.time_end,
      'kind', a.kind,
      'status', a.status,
      'comment', '',
      'address', '',
      'address_note', '',
      'address_lat', null,
      'address_lng', null,
      'cancel_reason', null,
      'source', a.source,
      'is_online_booking', a.is_online_booking,
      'consent_given', a.consent_given,
      'color_override', null,
      'city', null,
      'reminder_enabled', false,
      'reminder_offsets', '[]'::jsonb,
      'reminder_template', null,
      'service_ids', coalesce(a.service_ids, '[]'::jsonb),
      'total_duration', a.total_duration,
      'created_by', a.created_by,
      'created_at', a.created_at,
      'updated_at', a.updated_at,
      'event_all_day', false,
      'event_notes', '',
      'event_url', '',
      'event_push_enabled', false,
      'event_push_offsets', '[]'::jsonb,
      'event_push_at', null,
      'event_repeat', null,
      'total_amount', case when h.see_money then coalesce(a.total_amount, 0) else 0 end,
      'custom_total', case when h.see_money then coalesce(a.custom_total, false) else false end,
      'discount_amount', case when h.see_money then coalesce(a.discount_amount, 0) else 0 end,
      'prepaid_amount', 0,
      'paid_amount', case when h.see_money then coalesce(a.paid_amount, 0) else 0 end,
      'payment_status', case when h.see_money then coalesce(a.payment_status, 'unpaid') else 'unpaid' end,
      'payment_method', null,
      'payments', '[]'::jsonb,
      'payment', null,
      'expenses', '[]'::jsonb,
      'services', case
        when jsonb_typeof(a.services) is distinct from 'array' then '[]'::jsonb
        else (
          select coalesce(jsonb_agg(
                   jsonb_strip_nulls(jsonb_build_object(
                     'serviceId', line -> 'serviceId',
                     'serviceName', line -> 'serviceName',
                     'quantity', line -> 'quantity',
                     'unit', line -> 'unit',
                     'duration', line -> 'duration',
                     'variantId', line -> 'variantId'
                   )) || case
                     when h.see_money then jsonb_strip_nulls(jsonb_build_object(
                       'pricePerUnit', line -> 'pricePerUnit',
                       'originalPrice', line -> 'originalPrice',
                       'totalPrice', line -> 'totalPrice'
                     ))
                     else '{"pricePerUnit": 0, "originalPrice": 0, "totalPrice": 0}'::jsonb
                   end
                   order by ord), '[]'::jsonb)
            from jsonb_array_elements(a.services) with ordinality as l(line, ord)
        )
      end,
      'service_price_overrides', '{}'::jsonb,
      'global_discount', null
    )
      from public.appointments a
      join open_history h on h.client_id = a.client_id
     where a.tenant_id = active_tenant
       and a.kind = 'work'
     order by a.date, a.time_start, a.id;
end;
$function$;

revoke execute on function public.member_client_history(uuid) from public, anon;
grant execute on function public.member_client_history(uuid) to authenticated;

update public.access_blocks
   set enforced_by = array[
         'function:public.access_client_blocks()',
         'function:public.member_client_history(uuid)'
       ]
 where key = 'clients.history';
