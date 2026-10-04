-- ОПЛАТЫ ТАРИФА ДЛЯ ПАРТНЁРА — ТОЛЬКО ПОЛЯ ОПЛАТЫ, БЕЗ СЫРЫХ СОБЫТИЙ STRIPE
-- (находка аудита сессии 017, 04.10, по миграции 20261004052917).
--
-- Политика `billing_events_select_cabinet` отдавала партнёру с правом
-- «Оплаты тарифа: Видит» строки `billing_events` целиком: любые события
-- (пополнения SMS с почтой, телефоном и адресом плательщика, `charge.*` с
-- картой) и полный `payload`. Отбор `invoice.*` делало только приложение.
--
-- Теперь партнёр сырых строк не читает. Оплаты отдаёт функция
-- `cabinet_tariff_payments`: только `invoice.payment_succeeded|failed` и
-- только поля, из которых страница строит оплату (сумма, валюта, даты,
-- период и тариф строки, ссылка на счёт) — в той же форме `payload`, чтобы
-- разбор в приложении (`tariff-payments.ts`) остался прежним. Владелец читает
-- через неё же; его политика на таблицу — без изменений.

drop policy if exists billing_events_select_cabinet on public.billing_events;

create or replace function public.cabinet_tariff_payments(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  active_tenant uuid := public.current_tenant_id();
  result jsonb;
begin
  if auth.uid() is null or active_tenant is null
     or not (public.current_user_role() = 'owner' or public.access_company('cabinet.tariff_payments', 'read')) then
    raise exception 'Оплаты тарифа открывает владелец аккаунта'
      using errcode = '42501', hint = 'access:not_owner';
  end if;

  select coalesce(jsonb_agg(row_json order by processed_at desc), '[]'::jsonb)
    into result
    from (
      select e.processed_at,
             jsonb_build_object(
               'id', e.id,
               'event_type', e.event_type,
               'processed_at', e.processed_at,
               'payload', jsonb_build_object(
                 'created', e.payload -> 'created',
                 'data', jsonb_build_object(
                   'object', jsonb_build_object(
                     'id', inv -> 'id',
                     'amount_due', inv -> 'amount_due',
                     'amount_paid', inv -> 'amount_paid',
                     'total', inv -> 'total',
                     'currency', inv -> 'currency',
                     'created', inv -> 'created',
                     'status_transitions', jsonb_build_object('paid_at', inv -> 'status_transitions' -> 'paid_at'),
                     'hosted_invoice_url', inv -> 'hosted_invoice_url',
                     'invoice_pdf', inv -> 'invoice_pdf',
                     'subscription_details', jsonb_build_object('metadata', inv -> 'subscription_details' -> 'metadata'),
                     'parent', jsonb_build_object(
                       'subscription_details', jsonb_build_object(
                         'metadata', inv -> 'parent' -> 'subscription_details' -> 'metadata'
                       )
                     ),
                     'lines', jsonb_build_object(
                       'data', coalesce((
                         select jsonb_agg(jsonb_build_object(
                                  'amount', l -> 'amount',
                                  'description', l -> 'description',
                                  'period', l -> 'period',
                                  'metadata', l -> 'metadata',
                                  'price', jsonb_build_object(
                                    'metadata', l -> 'price' -> 'metadata',
                                    'lookup_key', l -> 'price' -> 'lookup_key',
                                    'nickname', l -> 'price' -> 'nickname'
                                  )
                                ))
                           from jsonb_array_elements(
                             case when jsonb_typeof(inv -> 'lines' -> 'data') = 'array'
                                  then inv -> 'lines' -> 'data' else '[]'::jsonb end
                           ) l
                       ), '[]'::jsonb)
                     )
                   )
                 )
               )
             ) as row_json
        from public.billing_events e
        cross join lateral (select e.payload -> 'data' -> 'object' as inv) x
       where e.tenant_id = active_tenant
         and e.event_type in ('invoice.payment_succeeded', 'invoice.payment_failed')
       order by e.processed_at desc
       limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) rows;

  return result;
end;
$$;
revoke all on function public.cabinet_tariff_payments(integer) from public, anon;
grant execute on function public.cabinet_tariff_payments(integer) to authenticated;

update public.access_blocks
   set enforced_by = array['function:public.cabinet_tariff_payments(integer)']
 where key = 'cabinet.tariff_payments';
