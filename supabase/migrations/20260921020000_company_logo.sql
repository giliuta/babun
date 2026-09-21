-- ЛОГОТИП ПЕРЕЕЗЖАЕТ В РЕКВИЗИТЫ.
--
-- Владелец 2026-09-20: «туда надо будет добавить ещё логотип — логотип, я
-- думаю, мы будем добавлять это в реквизиты». До сих пор он был ОДИН на всего
-- арендатора (`tenants.logo_url`), а наборов реквизитов у компании несколько:
-- две фирмы в одном приложении подписывали бумагу разными именами и одной
-- картинкой.
--
-- АРЕНДАТОРСКИЙ ЛОГОТИП ОСТАЁТСЯ ЗАПАСНЫМ, а не удаляется: у всех 19
-- арендаторов набор реквизитов перенесён из их же настроек и своей картинки
-- пока не имеет — обнулив запас, мы стёрли бы логотип со всех документов
-- разом. Порядок: логотип набора → логотип арендатора → нет логотипа.

begin;

set local lock_timeout = '5s';

-- БЕЗ `default`: `add column … default` вычисляется один раз и прошивает
-- значение во все прошлые строки.
alter table public.companies
  add column if not exists logo_url text;

comment on column public.companies.logo_url is
  'Логотип ЭТОГО набора реквизитов. Пусто — печатается логотип арендатора.';

-- Тело ниже — вчерашнее `build_seller_snapshot` дословно, изменена ОДНА
-- строка: `logo_url` в ветке набора берётся у набора, а у арендатора остаётся
-- запасным. Ветка «набора нет» не тронута вовсе.
create or replace function public.build_seller_snapshot(
  p_tenant_id uuid,
  p_company_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when company.id is null then
      jsonb_build_object(
        'schema_version', 1,
        'tenant_id', tenant.id,
        'company_id', null,
        'name', coalesce(nullif(btrim(tenant.legal_name), ''), nullif(btrim(tenant.name), '')),
        'display_name', nullif(btrim(tenant.name), ''),
        'legal_name', nullif(btrim(tenant.legal_name), ''),
        'vat_number', nullif(btrim(tenant.vat_number), ''),
        'reg_number', null,
        'business_address', nullif(btrim(tenant.business_address), ''),
        'address', coalesce(
          nullif(btrim(tenant.business_address), ''),
          nullif(concat_ws(', ', nullif(btrim(tenant.address), ''), nullif(btrim(tenant.city), '')), '')
        ),
        'city', nullif(btrim(tenant.city), ''),
        'country', nullif(btrim(tenant.country), ''),
        'contact_email', nullif(btrim(tenant.contact_email), ''),
        'contact_phone', nullif(btrim(tenant.contact_phone), ''),
        'iban', nullif(btrim(tenant.iban), ''),
        'bank_name', nullif(btrim(tenant.bank_name), ''),
        'logo_url', nullif(btrim(tenant.logo_url), ''),
        'currency', nullif(btrim(tenant.currency), ''),
        'vat_mode', tenant.vat_mode
      )
    else
      jsonb_build_object(
        'schema_version', 1,
        'tenant_id', tenant.id,
        'company_id', company.id,
        'name', coalesce(nullif(btrim(company.legal_name), ''), nullif(btrim(company.name), '')),
        'display_name', nullif(btrim(company.name), ''),
        'legal_name', nullif(btrim(company.legal_name), ''),
        'vat_number', nullif(btrim(company.vat_number), ''),
        'reg_number', nullif(btrim(company.reg_number), ''),
        'business_address', nullif(btrim(company.business_address), ''),
        'address', coalesce(
          nullif(btrim(company.business_address), ''),
          nullif(concat_ws(', ', nullif(btrim(tenant.address), ''), nullif(btrim(tenant.city), '')), '')
        ),
        'city', nullif(btrim(tenant.city), ''),
        'country', nullif(btrim(tenant.country), ''),
        'contact_email', coalesce(nullif(btrim(company.contact_email), ''), nullif(btrim(tenant.contact_email), '')),
        'contact_phone', coalesce(nullif(btrim(company.contact_phone), ''), nullif(btrim(tenant.contact_phone), '')),
        'iban', nullif(btrim(company.iban), ''),
        'bank_name', nullif(btrim(company.bank_name), ''),
        -- ЛОГОТИП НАБОРА, А ЕСЛИ ЕГО НЕТ — АРЕНДАТОРСКИЙ.
        'logo_url', coalesce(nullif(btrim(company.logo_url), ''), nullif(btrim(tenant.logo_url), '')),
        'currency', nullif(btrim(tenant.currency), ''),
        'vat_mode', tenant.vat_mode
      )
  end
    from public.tenants tenant
    left join public.companies company
      on company.id = p_company_id
     and company.tenant_id = tenant.id
   where tenant.id = p_tenant_id
$$;

revoke all on function public.build_seller_snapshot(uuid, uuid) from public, anon, authenticated;

commit;
