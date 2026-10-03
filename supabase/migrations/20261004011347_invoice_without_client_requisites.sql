-- ИНВОЙС НА ИМЯ КЛИЕНТА, ДАЖЕ КОГДА У НЕГО ЕСТЬ РЕКВИЗИТЫ (владелец
-- 2026-10-03: «выставить инвойс можно без реквизитов и без объекта — только
-- на имя»).
--
-- До этой миграции `client_requisites_id is null` значило «основной набор»:
-- снимок (`build_invoice_client_snapshot`) всегда нёс юрназвание, VAT, рег.
-- номер и юрадрес основного набора, и клиенту с реквизитами выставить
-- инвойс просто на имя было нельзя. Теперь у выбора три значения:
--   • null    — основной набор (как было);
--   • '<id>'  — выбранный набор (как было);
--   • 'none'  — без реквизитов: в снимке четыре поля реквизитов пустые, на
--               бумаге — имя клиента.
-- `issue_invoice` раньше сбрасывал неизвестный id в null (набор удалили
-- после выбора) — 'none' он теперь пропускает как есть. Тело функции
-- берётся из живого `pg_get_functiondef`, меняется одна строка проверки:
-- умолчания параметров, definer и search_path остаются ровно какими были.

create or replace function public.build_invoice_client_snapshot_for(
  p_tenant_id uuid,
  p_client_id uuid,
  p_requisites_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  base jsonb;
  chosen jsonb;
begin
  base := public.build_invoice_client_snapshot(p_tenant_id, p_client_id);
  if base is null or nullif(btrim(p_requisites_id), '') is null then
    return base;
  end if;
  -- Без реквизитов — на имя: поля набора пустые, имя остаётся.
  if btrim(p_requisites_id) = 'none' then
    return base || jsonb_build_object(
      'legal_name', null,
      'vat_number', null,
      'reg_number', null,
      'billing_address', null
    );
  end if;
  select entry into chosen
    from public.clients client
   cross join lateral jsonb_array_elements(client.requisites) entry
   where client.id = p_client_id
     and client.tenant_id = p_tenant_id
     and entry ->> 'id' = btrim(p_requisites_id)
   limit 1;
  -- Набор не найден (удалён после выбора) — основной, то есть зеркало.
  if chosen is null then
    return base;
  end if;
  return base || jsonb_build_object(
    'legal_name', chosen -> 'legal_name',
    'vat_number', chosen -> 'vat_number',
    'reg_number', chosen -> 'reg_number',
    'billing_address', chosen -> 'billing_address'
  );
end;
$$;

revoke all on function public.build_invoice_client_snapshot_for(uuid, uuid, text) from public, anon;

do $migration$
declare
  fn_oid oid;
  def text;
  patched text;
  needle constant text :=
    'if resolved_requisites_id is not null and not exists (';
  replacement constant text :=
    'if resolved_requisites_id is not null and resolved_requisites_id <> ''none'' and not exists (';
begin
  select p.oid into strict fn_oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'issue_invoice';

  def := pg_get_functiondef(fn_oid);
  if (length(def) - length(replace(def, needle, ''))) / length(needle) <> 1 then
    raise exception 'issue_invoice: requisites check not found exactly once';
  end if;
  patched := replace(def, needle, replacement);
  execute patched;

  if position(replacement in pg_get_functiondef(fn_oid)) = 0 then
    raise exception 'issue_invoice was not patched';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'issue_invoice') <> 1 then
    raise exception 'issue_invoice must have exactly one overload';
  end if;
  if has_function_privilege('anon', 'public.build_invoice_client_snapshot_for(uuid, uuid, text)', 'execute') then
    raise exception 'requisites functions are callable by anon';
  end if;
end;
$migration$;
