-- МАСТЕР МОЖЕТ СМЕНИТЬ СТАТУС СВОЕЙ ЗАПИСИ: СТОРОЖ КОЛОНОК БЕЗ `is_demo`.
--
-- Нашлось 15.09 прогоном «мастер работает в Команде 1» (сессия 010): любая
-- правка записи мастером — статус «в работе», заметка — падала
-- `42703 record "new" has no field "is_demo"`. Сторож
-- `appointments_master_column_guard` (`20260720210001_role_rls_hardening.sql`)
-- сравнивает `new.is_demo` со `old.is_demo`, а колонки `is_demo` на боевой нет
-- ни в одной таблице (`information_schema.columns`, 15.09): её сняли мимо
-- файлов миграций. Сторож срабатывает только у роли «мастер», поэтому
-- владелец и диспетчер этого не видели, а работающих мастеров в базе не было.
--
-- Тело — живое (`pg_get_functiondef`, 15.09) без двух сравнений `is_demo`;
-- остальные проверки и тексты отказов прежние.

create or replace function public.appointments_master_column_guard()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if public.current_user_role() is distinct from 'master' then
    return new;
  end if;

  if old.kind = 'work' then
    if new.id is distinct from old.id
      or new.tenant_id is distinct from old.tenant_id
      or new.client_id is distinct from old.client_id
      or new.team_id is distinct from old.team_id
      or new.master_id is distinct from old.master_id
      or new.location_id is distinct from old.location_id
      or new.date is distinct from old.date
      or new.time_start is distinct from old.time_start
      or new.time_end is distinct from old.time_end
      or new.kind is distinct from old.kind
      or new.total_amount is distinct from old.total_amount
      or new.custom_total is distinct from old.custom_total
      or new.discount_amount is distinct from old.discount_amount
      or new.prepaid_amount is distinct from old.prepaid_amount
      or new.paid_amount is distinct from old.paid_amount
      or new.payment_status is distinct from old.payment_status
      or new.payment_method is distinct from old.payment_method
      or new.address is distinct from old.address
      or new.address_note is distinct from old.address_note
      or new.address_lat is distinct from old.address_lat
      or new.address_lng is distinct from old.address_lng
      or new.cancel_reason is distinct from old.cancel_reason
      or new.source is distinct from old.source
      or new.is_online_booking is distinct from old.is_online_booking
      or new.consent_given is distinct from old.consent_given
      or new.color_override is distinct from old.color_override
      or new.reminder_enabled is distinct from old.reminder_enabled
      or new.reminder_offsets is distinct from old.reminder_offsets
      or new.reminder_template is distinct from old.reminder_template
      or new.service_ids is distinct from old.service_ids
      or new.services is distinct from old.services
      or new.service_price_overrides is distinct from old.service_price_overrides
      or new.expenses is distinct from old.expenses
      or new.payments is distinct from old.payments
      or new.payment is distinct from old.payment
      or new.global_discount is distinct from old.global_discount
      or new.total_duration is distinct from old.total_duration
      or new.event_all_day is distinct from old.event_all_day
      or new.event_notes is distinct from old.event_notes
      or new.event_url is distinct from old.event_url
      or new.event_push_enabled is distinct from old.event_push_enabled
      or new.event_push_offsets is distinct from old.event_push_offsets
      or new.event_push_at is distinct from old.event_push_at
      or new.event_repeat is distinct from old.event_repeat
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.updated_at is distinct from old.updated_at then
      raise exception 'master role can only update status and comment on work appointments'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.kind in ('event', 'personal') then
    if old.created_by is distinct from auth.uid()
      or new.id is distinct from old.id
      or new.tenant_id is distinct from old.tenant_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.kind is distinct from old.kind
      or new.client_id is distinct from old.client_id
      or new.team_id is distinct from old.team_id
      or new.master_id is distinct from old.master_id
      or new.location_id is distinct from old.location_id
      or new.total_amount is distinct from old.total_amount
      or new.custom_total is distinct from old.custom_total
      or new.discount_amount is distinct from old.discount_amount
      or new.prepaid_amount is distinct from old.prepaid_amount
      or new.paid_amount is distinct from old.paid_amount
      or new.payment_status is distinct from old.payment_status
      or new.payment_method is distinct from old.payment_method
      or new.service_ids is distinct from old.service_ids
      or new.services is distinct from old.services
      or new.service_price_overrides is distinct from old.service_price_overrides
      or new.expenses is distinct from old.expenses
      or new.payments is distinct from old.payments
      or new.payment is distinct from old.payment
      or new.global_discount is distinct from old.global_discount
      or new.source is distinct from old.source
      or new.is_online_booking is distinct from old.is_online_booking
      or new.consent_given is distinct from old.consent_given
      or new.reminder_enabled is distinct from old.reminder_enabled
      or new.reminder_offsets is distinct from old.reminder_offsets
      or new.reminder_template is distinct from old.reminder_template then
      raise exception 'master role cannot change assignment, client or finance fields on a personal event'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'unsupported appointment kind for master role'
    using errcode = '42501';
end;
$function$;

do $guard$
begin
  if position('is_demo' in pg_get_functiondef('public.appointments_master_column_guard()'::regprocedure)) > 0 then
    raise exception 'миграция: сторож колонок записи всё ещё читает is_demo';
  end if;
end
$guard$;
