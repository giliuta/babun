-- ЛОГОТИП — ЧАСТЬ ДОКУМЕНТА, А НЕ ОФОРМЛЕНИЯ ПРИЛОЖЕНИЯ.
--
-- Логотип обязан попасть в СНИМОК продавца: сменили логотип через год — прошлые
-- счета должны остаться такими, какими их получил клиент. Старые снимки
-- логотипа не знают; для них рендер честно падает на текущий логотип компании.

create or replace function public.build_invoice_seller_snapshot(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'tenant_id', tenant.id,
    'name', coalesce(nullif(btrim(tenant.legal_name), ''), nullif(btrim(tenant.name), '')),
    'display_name', nullif(btrim(tenant.name), ''),
    'legal_name', nullif(btrim(tenant.legal_name), ''),
    'vat_number', nullif(btrim(tenant.vat_number), ''),
    'business_address', nullif(btrim(tenant.business_address), ''),
    'address', coalesce(
      nullif(btrim(tenant.business_address), ''),
      nullif(
        concat_ws(
          ', ',
          nullif(btrim(tenant.address), ''),
          nullif(btrim(tenant.city), '')
        ),
        ''
      )
    ),
    'city', nullif(btrim(tenant.city), ''),
    'country', nullif(btrim(tenant.country), ''),
    'contact_email', nullif(btrim(tenant.contact_email), ''),
    'contact_phone', nullif(btrim(tenant.contact_phone), ''),
    'iban', nullif(btrim(tenant.iban), ''),
    'bank_name', nullif(btrim(tenant.bank_name), ''),
    'logo_url', nullif(btrim(tenant.logo_url), ''),
    'currency', nullif(btrim(tenant.currency), '')
  )
    from public.tenants tenant
   where tenant.id = p_tenant_id
$$;
