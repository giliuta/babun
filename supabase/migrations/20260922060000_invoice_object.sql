-- ОБЪЕКТ В ИНВОЙСЕ.
--
-- Владелец 22.09: «компания может предоставлять нам несколько объектов, и под
-- каждый объект надо выписывать свой инвойс — объект фиксируется, как клиент.
-- В инвойсе не нужно писать номер телефона клиента, а адрес он берёт из
-- объекта — только точный адрес; если точного адреса нет, никакой адрес не
-- вставляется».
--
-- • `invoices.location_id` — объект клиента (id элемента `clients.locations`).
--   Пусто у счёта из записи — берётся объект записи.
-- • Снимок получателя (`client_snapshot`) получает ключ `object`:
--   `{id, label, address_parts}`; `address_parts` — ТОЧНЫЙ адрес (улица,
--   комплекс, подъезд, этаж, квартира, город, индекс) и только когда в нём есть
--   «где» (улица, комплекс или город). Строку адреса печатает бумага на своём
--   языке: «эт. 3» — русское слово, английскому счёту нужен «Floor 3».
-- • `issue_invoice` получает `p_location_id` (по умолчанию пусто). Старая
--   сигнатура из 13 параметров удаляется: иначе было бы две перегрузки.

begin;

set local lock_timeout = '5s';

alter table public.invoices add column if not exists location_id text;
comment on column public.invoices.location_id is
  'Объект клиента (id элемента clients.locations), под который выписан счёт.';

-- Объект клиента для бумаги: только точный адрес, пусто — адреса нет.
create or replace function public.invoice_object_snapshot(
  p_tenant_id uuid, p_client_id uuid, p_location_id text
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', entry.value ->> 'id',
    'label', nullif(btrim(entry.value ->> 'label'), ''),
    'address_parts', case
      when coalesce(
        nullif(btrim(entry.value -> 'addressParts' ->> 'street'), ''),
        nullif(btrim(entry.value -> 'addressParts' ->> 'complex'), ''),
        nullif(btrim(entry.value -> 'addressParts' ->> 'city'), '')
      ) is null then null
      else jsonb_strip_nulls(jsonb_build_object(
        'street', nullif(btrim(entry.value -> 'addressParts' ->> 'street'), ''),
        'complex', nullif(btrim(entry.value -> 'addressParts' ->> 'complex'), ''),
        'entrance', nullif(btrim(entry.value -> 'addressParts' ->> 'entrance'), ''),
        'floor', nullif(btrim(entry.value -> 'addressParts' ->> 'floor'), ''),
        'apartment', nullif(btrim(entry.value -> 'addressParts' ->> 'apartment'), ''),
        'city', nullif(btrim(entry.value -> 'addressParts' ->> 'city'), ''),
        'zip', nullif(btrim(entry.value -> 'addressParts' ->> 'zip'), '')
      ))
    end
  )
    from public.clients client
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(client.locations) = 'array' then client.locations else '[]'::jsonb end
    ) as entry(value)
   where client.id = p_client_id
     and client.tenant_id = p_tenant_id
     and p_location_id is not null
     and entry.value ->> 'id' = p_location_id
   limit 1;
$$;

-- Снимок получателя вместе с объектом. Объект указан, но у клиента его нет —
-- отказ: бумага не имеет права молча потерять адрес.
create or replace function public.build_invoice_client_snapshot_with_object(
  p_tenant_id uuid, p_client_id uuid, p_location_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  base jsonb;
  object jsonb;
begin
  base := public.build_invoice_client_snapshot(p_tenant_id, p_client_id);
  if base is null then
    return null;
  end if;
  if p_location_id is null then
    return base || jsonb_build_object('object', null);
  end if;
  object := public.invoice_object_snapshot(p_tenant_id, p_client_id, p_location_id);
  if object is null then
    raise exception 'Объект не найден у клиента инвойса';
  end if;
  return base || jsonb_build_object('object', object);
end;
$$;

revoke all on function public.invoice_object_snapshot(uuid, uuid, text) from public, anon;
revoke all on function public.build_invoice_client_snapshot_with_object(uuid, uuid, text) from public, anon;
grant execute on function public.invoice_object_snapshot(uuid, uuid, text) to authenticated;
grant execute on function public.build_invoice_client_snapshot_with_object(uuid, uuid, text) to authenticated;

-- Триггер снимков: получатель — с объектом; смена объекта — смена документа.
do $migration$
declare
  body text;
  old_build constant text :=
    'public.build_invoice_client_snapshot(new.tenant_id, new.client_id)';
  new_build constant text :=
    'public.build_invoice_client_snapshot_with_object(new.tenant_id, new.client_id, new.location_id)';
  old_new_row constant text :=
    '    new.appointment_id, new.brigade_id, new.company_id, new.account_id,';
  new_new_row constant text :=
    '    new.appointment_id, new.brigade_id, new.company_id, new.account_id, new.location_id,';
  old_old_row constant text :=
    '    old.appointment_id, old.brigade_id, old.company_id, old.account_id,';
  new_old_row constant text :=
    '    old.appointment_id, old.brigade_id, old.company_id, old.account_id, old.location_id,';
begin
  select pg_get_functiondef('public.capture_invoice_document_snapshots'::regproc) into body;
  if (length(body) - length(replace(body, old_build, ''))) / length(old_build) <> 2 then
    raise exception 'capture_invoice_document_snapshots: expected two client snapshot builds';
  end if;
  if (length(body) - length(replace(body, old_new_row, ''))) / length(old_new_row) <> 1
     or (length(body) - length(replace(body, old_old_row, ''))) / length(old_old_row) <> 1 then
    raise exception 'capture_invoice_document_snapshots: document row anchors not unique';
  end if;
  execute replace(replace(replace(body, old_build, new_build), old_new_row, new_new_row),
                  old_old_row, new_old_row);
end
$migration$;

-- issue_invoice: объект — параметром; у счёта из записи — объект записи.
do $migration$
declare
  body text;
  old_head constant text := 'p_account_id uuid DEFAULT NULL::uuid)';
  new_head constant text := 'p_account_id uuid DEFAULT NULL::uuid, p_location_id text DEFAULT NULL::text)';
  old_decl constant text :=
    '  resolved_company_id uuid;' || chr(10) || 'begin';
  new_decl constant text :=
    '  resolved_company_id uuid;' || chr(10) ||
    '  resolved_location_id text := nullif(btrim(p_location_id), '''');' || chr(10) ||
    '  appointment_location_id text;' || chr(10) || 'begin';
  old_appt constant text :=
    '    select client_id, team_id into appointment_client_id, appointment_team_id';
  new_appt constant text :=
    '    select client_id, team_id, location_id' || chr(10) ||
    '      into appointment_client_id, appointment_team_id, appointment_location_id';
  old_client_check constant text :=
    '  if resolved_client_id is not null and not exists (';
  new_client_check constant text :=
    '  -- Объект — объект клиента; у счёта из записи по умолчанию объект записи.' || chr(10) ||
    '  if resolved_location_id is null and appointment_location_id is not null then' || chr(10) ||
    '    resolved_location_id := appointment_location_id;' || chr(10) ||
    '  end if;' || chr(10) ||
    '  if resolved_location_id is not null and resolved_client_id is null then' || chr(10) ||
    '    raise exception ''Объект выбирают у клиента — сначала клиент'';' || chr(10) ||
    '  end if;' || chr(10) ||
    '  if resolved_client_id is not null and not exists (';
  old_cols constant text :=
    '    company_id, account_id' || chr(10) || '  ) values (';
  new_cols constant text :=
    '    company_id, account_id, location_id' || chr(10) || '  ) values (';
  old_vals constant text :=
    '    resolved_company_id,' || chr(10) || '    p_account_id' || chr(10) || '  )';
  new_vals constant text :=
    '    resolved_company_id,' || chr(10) || '    p_account_id,' || chr(10) ||
    '    resolved_location_id' || chr(10) || '  )';
  anchors text[] := array[old_head, old_decl, old_appt, old_client_check, old_cols, old_vals];
  anchor text;
begin
  select pg_get_functiondef(
    'public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid)'::regprocedure
  ) into body;
  foreach anchor in array anchors loop
    if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
      raise exception 'issue_invoice: anchor not unique: %', left(anchor, 60);
    end if;
  end loop;
  body := replace(body, old_head, new_head);
  body := replace(body, old_decl, new_decl);
  body := replace(body, old_appt, new_appt);
  body := replace(body, old_client_check, new_client_check);
  body := replace(body, old_cols, new_cols);
  body := replace(body, old_vals, new_vals);
  drop function public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid);
  execute body;
end
$migration$;

revoke all on function public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text) to authenticated;

-- Сторож.
do $$
begin
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'issue_invoice') <> 1 then
    raise exception 'issue_invoice must have exactly one overload';
  end if;
  if not exists (
    select 1 from pg_proc
     where pronamespace = 'public'::regnamespace and proname = 'issue_invoice'
       and prosrc like '%resolved_location_id%'
       and prosrc like '%next_company_invoice_number%'
  ) then
    raise exception 'issue_invoice lost the object or the requisites numbering';
  end if;
  if not exists (
    select 1 from pg_proc
     where pronamespace = 'public'::regnamespace and proname = 'capture_invoice_document_snapshots'
       and prosrc like '%build_invoice_client_snapshot_with_object%'
       and prosrc like '%new.location_id,%'
  ) then
    raise exception 'invoice snapshots do not carry the object';
  end if;
  if has_function_privilege('anon', 'public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.invoice_object_snapshot(uuid, uuid, text)', 'execute') then
    raise exception 'invoice object functions are callable by anon';
  end if;
end
$$;

commit;
