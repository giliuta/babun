-- СОТРУДНИКИ ВИДЯТ ВАЛЮТУ КОМПАНИИ (этап 0(е) плана доступа).
--
-- Было: `current_tenant_profile_safe()` отдавала владельцу строку компании
-- целиком, а диспетчеру и мастеру — 16 безопасных полей БЕЗ валюты. Экран
-- сотрудника ставил валюту форматтеров из пустой строки, и суммы у него всегда
-- печатались в евро, какая бы валюта ни стояла у компании.
--
-- Валюта — не секрет: это единица, в которой сотрудник видит суммы, которые
-- ему и так положено видеть. В плане блок `company.currency` вовсе не имеет
-- положения «выкл». Реквизиты, банк, НДС, тариф и подписка остаются только у
-- владельца — сторож ниже не даст им просочиться.
--
-- Тело — живое (`pg_get_functiondef`, 14.09) плюс ОДИН ключ. Ветка владельца не
-- меняется. Права на выполнение — прежние: только authenticated.

create or replace function public.current_tenant_profile_safe()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
    when public.current_user_role() = 'owner' then to_jsonb(t)
    when public.current_user_role() in ('dispatcher', 'master') then
      jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'vertical', t.vertical,
        'city', t.city,
        'country', t.country,
        'address', t.address,
        'logo_url', t.logo_url,
        'contact_phone', t.contact_phone,
        'contact_email', t.contact_email,
        'contact_whatsapp', t.contact_whatsapp,
        'contact_telegram', t.contact_telegram,
        'contact_instagram', t.contact_instagram,
        'onboarded_at', t.onboarded_at,
        'personal_calendar_enabled', t.personal_calendar_enabled,
        'track_units', t.track_units,
        -- валюта сумм: без неё сотрудник видит € у любой компании (этап 0(е))
        'currency', t.currency,
        'created_at', t.created_at
      )
    else null
  end
    from public.tenants t
   where t.id = public.current_tenant_id()
   limit 1
$function$;

revoke all on function public.current_tenant_profile_safe() from public, anon;
grant execute on function public.current_tenant_profile_safe() to authenticated;

do $guard$
declare
  body text := pg_get_functiondef('public.current_tenant_profile_safe()'::regprocedure);
begin
  if position('''currency'', t.currency' in body) = 0 then
    raise exception 'миграция: у сотрудников нет валюты в профиле компании';
  end if;
  if body ~ '''(iban|bank_name|vat_number|vat_mode|vat_rate|legal_name|business_address|plan|plan_override|stripe_customer_id|stripe_subscription_id|subscription_status|trial_ends_at|current_period_end|document_language|booking_slug|invoice_[a-z_]+)''' then
    raise exception 'миграция: в профиль сотрудника попало поле только для владельца';
  end if;
  if has_function_privilege('anon', 'public.current_tenant_profile_safe()', 'execute') then
    raise exception 'миграция: профиль компании доступен анонимному ключу';
  end if;
end
$guard$;
