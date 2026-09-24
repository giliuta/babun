-- НЕСКОЛЬКО НАБОРОВ РЕКВИЗИТОВ У КЛИЕНТА.
--
-- Владелец 22.09: «один и тот же клиент может попросить выставить один инвойс
-- на эти реквизиты, а второй — на эти. Сделать как объекты: добавлять
-- несколько реквизитов».
--
-- 1. `clients.requisites jsonb` — массив наборов
--    `{id, legal_name, vat_number, reg_number, billing_address, is_default}`,
--    тем же путём, что `clients.locations`: карточка пишет массив целиком.
--    Default — КОНСТАНТА `'[]'`: она ложится в прошлые строки «пропущенным
--    значением» (`atthasmissing`) и ничего чужого не прошивает; сторож в конце
--    проверяет, что пропущенное значение именно `[]`.
--
-- 2. ЧЕТЫРЕ СТАРЫЕ КОЛОНКИ ОСТАЮТСЯ — ЗЕРКАЛОМ ОСНОВНОГО НАБОРА. Их читают
--    снимок получателя инвойса, поиск, «Поделиться», маска сотрудника и
--    сборки на руках у владельца. Триггер держит зеркало в обе стороны:
--    • правка `requisites` → основной набор ложится в четыре колонки
--      (пусто — null);
--    • правка ТОЛЬКО четырёх колонок (прошлая сборка приложения, сотрудник,
--      которому можно юр. имя) → она правит ОСНОВНОЙ набор, а не молча
--      затирается зеркалом. Все четыре пусто — основной набор убран.
--    Правка обоих сразу — главнее `requisites`.
--
-- 3. НОРМАЛИЗАЦИЯ — В ОДНОЙ ФУНКЦИИ, её зовёт триггер: не массив или не
--    объекты — 22023; пустые наборы (все четыре пусто) выкидываются; ровно
--    один основной (нет ни одного — первый; несколько — первый из отмеченных);
--    `id` обязателен (нет или повтор — новый); VAT и рег. номер — trim и
--    upper; лишние ключи срезаются.
--
-- 4. РЕКВИЗИТЫ — ДЕЛО ВЛАДЕЛЬЦА: `requisites` встаёт рядом с `vat_number` в
--    запрет сотруднику (`update_client_with_tags`) и в обнуление при создании
--    (`create_client_with_tags`); маска `client_without_money` гасит её до
--    `[]`.
--
-- 5. ВЫБОР НАБОРА В ИНВОЙСЕ — ТЕМ ЖЕ ПУТЁМ, ЧТО ОБЪЕКТ (20260922060000):
--    колонка `invoices.client_requisites_id`, параметр
--    `issue_invoice(p_client_requisites_id)` (старая сигнатура удаляется —
--    одна перегрузка), снимок получателя кладёт поля выбранного набора
--    (`build_invoice_client_snapshot_for` — НОВОЕ ИМЯ, а не параметр у
--    старой). Набора нет или не найден — основной, то есть зеркало.
--
-- Тела `create_client_with_tags`, `update_client_with_tags`, `issue_invoice`
-- и `capture_invoice_document_snapshots` правятся точечной заменой по
-- `pg_get_functiondef` ЖИВОЙ базы с проверкой, что каждый якорь встречается
-- ровно столько раз, сколько ожидается: переписать их целиком из файла
-- значило бы откатить чужие правки, накаченные после этого файла.

begin;

set local lock_timeout = '5s';

-- ─── Колонка ─────────────────────────────────────────────────────────────
alter table public.clients
  add column if not exists requisites jsonb not null default '[]'::jsonb;

alter table public.clients
  drop constraint if exists clients_requisites_is_array;
alter table public.clients
  add constraint clients_requisites_is_array
  check (jsonb_typeof(requisites) = 'array');

comment on column public.clients.requisites is
  'Наборы реквизитов клиента [{id, legal_name, vat_number, reg_number, '
  'billing_address, is_default}]. Основной зеркалится в четыре колонки '
  'legal_name / vat_number / reg_number / billing_address.';

-- ─── Нормализация ────────────────────────────────────────────────────────
create or replace function public.normalize_client_requisites(p_sets jsonb)
 returns jsonb
 language plpgsql
 volatile
 set search_path to 'public'
as $function$
declare
  entry jsonb;
  field text;
  result jsonb := '[]'::jsonb;
  seen_ids text[] := array[]::text[];
  default_taken boolean := false;
  set_id text;
  v_legal text;
  v_vat text;
  v_reg text;
  v_address text;
  v_default boolean;
begin
  if p_sets is null or jsonb_typeof(p_sets) = 'null' then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_sets) <> 'array' then
    raise exception 'client requisites must be an array'
      using errcode = '22023';
  end if;

  for entry in select value from jsonb_array_elements(p_sets)
  loop
    if jsonb_typeof(entry) <> 'object' then
      raise exception 'client requisites entry must be an object'
        using errcode = '22023';
    end if;
    foreach field in array array['id', 'legal_name', 'vat_number', 'reg_number', 'billing_address']
    loop
      if entry ? field and jsonb_typeof(entry -> field) not in ('string', 'number', 'null') then
        raise exception 'client requisites field % must be text', field
          using errcode = '22023';
      end if;
    end loop;

    v_legal := nullif(btrim(entry ->> 'legal_name'), '');
    v_vat := upper(nullif(btrim(entry ->> 'vat_number'), ''));
    v_reg := upper(nullif(btrim(entry ->> 'reg_number'), ''));
    v_address := nullif(btrim(entry ->> 'billing_address'), '');
    -- Пустой набор — не набор: печатать с него нечего.
    if v_legal is null and v_vat is null and v_reg is null and v_address is null then
      continue;
    end if;

    set_id := nullif(btrim(entry ->> 'id'), '');
    if set_id is null or set_id = any(seen_ids) then
      set_id := gen_random_uuid()::text;
    end if;
    seen_ids := seen_ids || set_id;

    v_default := not default_taken
      and lower(coalesce(entry ->> 'is_default', 'false')) = 'true';
    if v_default then
      default_taken := true;
    end if;

    result := result || jsonb_build_array(jsonb_build_object(
      'id', set_id,
      'legal_name', v_legal,
      'vat_number', v_vat,
      'reg_number', v_reg,
      'billing_address', v_address,
      'is_default', v_default
    ));
  end loop;

  if not default_taken and jsonb_array_length(result) > 0 then
    result := jsonb_set(result, '{0,is_default}', 'true'::jsonb);
  end if;
  return result;
end;
$function$;

comment on function public.normalize_client_requisites(jsonb) is
  'Чистит массив наборов реквизитов клиента: пустые наборы прочь, ровно один '
  'основной, id у каждого, VAT и рег. номер заглавными, лишние ключи прочь.';

-- ─── Триггер: нормализация + зеркало в обе стороны ──────────────────────
create or replace function public.sync_client_requisites()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  sets jsonb;
  main jsonb;
  legacy jsonb;
  requisites_changed boolean;
  legacy_changed boolean;
begin
  if tg_op = 'INSERT' then
    requisites_changed := coalesce(new.requisites, '[]'::jsonb) <> '[]'::jsonb;
    legacy_changed := not requisites_changed;
  else
    requisites_changed := new.requisites is distinct from old.requisites;
    legacy_changed := row(new.legal_name, new.vat_number, new.reg_number, new.billing_address)
      is distinct from row(old.legal_name, old.vat_number, old.reg_number, old.billing_address);
  end if;

  sets := public.normalize_client_requisites(new.requisites);

  -- Писатель старых колонок правит ОСНОВНОЙ набор: иначе зеркало молча
  -- вернуло бы старое значение поверх его правки.
  if legacy_changed and not requisites_changed then
    legacy := jsonb_build_object(
      'legal_name', new.legal_name,
      'vat_number', new.vat_number,
      'reg_number', new.reg_number,
      'billing_address', new.billing_address
    );
    if exists (
      select 1 from jsonb_array_elements(sets) e
       where (e ->> 'is_default')::boolean
    ) then
      select jsonb_agg(
               case when (e.value ->> 'is_default')::boolean then e.value || legacy else e.value end
               order by e.ordinality
             )
        into sets
        from jsonb_array_elements(sets) with ordinality e;
    else
      sets := sets || jsonb_build_array(legacy || jsonb_build_object('is_default', true));
    end if;
    sets := public.normalize_client_requisites(sets);
  end if;

  new.requisites := sets;
  select e into main
    from jsonb_array_elements(sets) e
   where (e ->> 'is_default')::boolean
   limit 1;
  new.legal_name := main ->> 'legal_name';
  new.vat_number := main ->> 'vat_number';
  new.reg_number := main ->> 'reg_number';
  new.billing_address := main ->> 'billing_address';
  return new;
end;
$function$;

drop trigger if exists clients_sync_requisites on public.clients;
create trigger clients_sync_requisites
  before insert or update of requisites, legal_name, vat_number, reg_number, billing_address
  on public.clients
  for each row execute function public.sync_client_requisites();

-- ─── Перенос: у кого заполнено хоть одно поле — один основной набор ─────
-- Через триггер: `requisites` меняется, он нормализует набор и переписывает
-- зеркало тем же значением (VAT и рег. номер — заглавными).
update public.clients
   set requisites = jsonb_build_array(jsonb_build_object(
         'id', gen_random_uuid()::text,
         'legal_name', legal_name,
         'vat_number', vat_number,
         'reg_number', reg_number,
         'billing_address', billing_address,
         'is_default', true
       ))
 where requisites = '[]'::jsonb
   and coalesce(nullif(btrim(legal_name), ''), nullif(btrim(vat_number), ''),
                nullif(btrim(reg_number), ''), nullif(btrim(billing_address), '')) is not null;

-- ─── Маска сотрудника гасит и наборы ────────────────────────────────────
create or replace function public.client_without_money(p_client jsonb)
 returns jsonb
 language sql
 immutable
 set search_path to 'public'
as $function$
  select p_client || jsonb_build_object(
    'balance', 0,
    'discount', 0,
    'vat_number', null,
    'reg_number', null,
    'billing_address', null,
    'requisites', '[]'::jsonb
  )
$function$;

-- ─── create_client_with_tags: белый список, запрет сотруднику, вставка ──
do $migration$
declare
  body text;
  old_white constant text := '''billing_address'',' || chr(10) || '       ''memberships''' || chr(10) || '     )';
  new_white constant text := '''billing_address'',' || chr(10) || '       ''memberships'',' || chr(10) ||
                             '       ''requisites''' || chr(10) || '     )';
  old_staff constant text := '    input_row.billing_address := null;';
  new_staff constant text := '    input_row.billing_address := null;' || chr(10) ||
                             '    input_row.requisites := ''[]''::jsonb;';
  old_cols constant text := '    billing_address,' || chr(10) || '    memberships' || chr(10) || '  ) values (';
  new_cols constant text := '    billing_address,' || chr(10) || '    memberships,' || chr(10) ||
                            '    requisites' || chr(10) || '  ) values (';
  old_vals constant text := '    coalesce(input_row.memberships, ''[]''::jsonb)' || chr(10) || '  )' || chr(10) ||
                            '  returning * into saved_row;';
  new_vals constant text := '    coalesce(input_row.memberships, ''[]''::jsonb),' || chr(10) ||
                            '    coalesce(input_row.requisites, ''[]''::jsonb)' || chr(10) || '  )' || chr(10) ||
                            '  returning * into saved_row;';
  anchors text[] := array[old_white, old_staff, old_cols, old_vals];
  anchor text;
begin
  select pg_get_functiondef('public.create_client_with_tags(uuid, uuid, jsonb, uuid[])'::regprocedure)
    into body;
  foreach anchor in array anchors loop
    if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
      raise exception 'create_client_with_tags: anchor not unique: %', left(anchor, 60);
    end if;
  end loop;
  body := replace(body, old_white, new_white);
  body := replace(body, old_staff, new_staff);
  body := replace(body, old_cols, new_cols);
  body := replace(body, old_vals, new_vals);
  execute body;
end
$migration$;

-- ─── update_client_with_tags: белый список, запрет сотруднику, запись ───
do $migration$
declare
  body text;
  old_white constant text := '''billing_address'',' || chr(10) || '       ''memberships''' || chr(10) || '     )';
  new_white constant text := '''billing_address'',' || chr(10) || '       ''memberships'',' || chr(10) ||
                             '       ''requisites''' || chr(10) || '     )';
  old_staff constant text := '''vat_number'', ''reg_number'', ''billing_address''] then';
  new_staff constant text := '''vat_number'', ''reg_number'', ''billing_address'',' || chr(10) ||
                             '                        ''requisites''] then';
  old_set constant text := '         memberships = coalesce(next_row.memberships, ''[]''::jsonb)' || chr(10) ||
                           '   where client.id = p_client_id';
  new_set constant text := '         memberships = coalesce(next_row.memberships, ''[]''::jsonb),' || chr(10) ||
                           '         requisites = coalesce(next_row.requisites, ''[]''::jsonb)' || chr(10) ||
                           '   where client.id = p_client_id';
  anchors text[] := array[old_white, old_staff, old_set];
  anchor text;
begin
  select pg_get_functiondef('public.update_client_with_tags(uuid, uuid, jsonb, uuid[])'::regprocedure)
    into body;
  foreach anchor in array anchors loop
    if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
      raise exception 'update_client_with_tags: anchor not unique: %', left(anchor, 60);
    end if;
  end loop;
  body := replace(body, old_white, new_white);
  body := replace(body, old_staff, new_staff);
  body := replace(body, old_set, new_set);
  execute body;
end
$migration$;

-- ─── Снимок получателя с выбранным набором ──────────────────────────────
create or replace function public.build_invoice_client_snapshot_for(
  p_tenant_id uuid, p_client_id uuid, p_requisites_id text
) returns jsonb
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
grant execute on function public.build_invoice_client_snapshot_for(uuid, uuid, text) to authenticated;
-- Нормализацию зовёт триггер от лица пишущего (владелец может править
-- строку и напрямую, под RLS), поэтому `authenticated` она нужна.
revoke all on function public.normalize_client_requisites(jsonb) from public, anon;
grant execute on function public.normalize_client_requisites(jsonb) to authenticated;
revoke all on function public.sync_client_requisites() from public, anon;

-- ─── Инвойс помнит выбранный набор ──────────────────────────────────────
alter table public.invoices add column if not exists client_requisites_id text;
comment on column public.invoices.client_requisites_id is
  'Набор реквизитов клиента (id элемента clients.requisites), на который '
  'выписан счёт. Пусто — основной набор.';

-- Триггер снимков: получатель — с объектом и выбранным набором; смена
-- набора — смена документа.
do $migration$
declare
  body text;
  old_build constant text :=
    'public.build_invoice_client_snapshot_with_object(new.tenant_id, new.client_id, new.location_id)';
  new_build constant text :=
    '(public.build_invoice_client_snapshot_with_object(new.tenant_id, new.client_id, new.location_id)'
    || ' || public.build_invoice_client_snapshot_for(new.tenant_id, new.client_id, new.client_requisites_id))';
  old_new_row constant text := 'new.account_id, new.location_id,';
  new_new_row constant text := 'new.account_id, new.location_id, new.client_requisites_id,';
  old_old_row constant text := 'old.account_id, old.location_id,';
  new_old_row constant text := 'old.account_id, old.location_id, old.client_requisites_id,';
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

-- issue_invoice: набор — параметром. Чужой или удалённый набор не
-- запоминается (null — основной): колонка не должна называть то, чего нет.
do $migration$
declare
  body text;
  old_head constant text := 'p_location_id text DEFAULT NULL::text)';
  new_head constant text := 'p_location_id text DEFAULT NULL::text, p_client_requisites_id text DEFAULT NULL::text)';
  old_decl constant text := '  appointment_location_id text;' || chr(10) || 'begin';
  new_decl constant text := '  appointment_location_id text;' || chr(10) ||
    '  resolved_requisites_id text := nullif(btrim(p_client_requisites_id), '''');' || chr(10) || 'begin';
  old_team_check constant text := '  if resolved_brigade_id is not null and not exists (';
  new_team_check constant text :=
    '  -- Реквизиты клиента — набор этого клиента; чужой или удалённый — основной.' || chr(10) ||
    '  if resolved_requisites_id is not null and not exists (' || chr(10) ||
    '    select 1 from public.clients client' || chr(10) ||
    '     cross join lateral jsonb_array_elements(client.requisites) entry' || chr(10) ||
    '     where client.id = resolved_client_id and client.tenant_id = tenant_uuid' || chr(10) ||
    '       and entry ->> ''id'' = resolved_requisites_id' || chr(10) ||
    '  ) then' || chr(10) ||
    '    resolved_requisites_id := null;' || chr(10) ||
    '  end if;' || chr(10) ||
    '  if resolved_brigade_id is not null and not exists (';
  old_cols constant text := '    company_id, account_id, location_id' || chr(10) || '  ) values (';
  new_cols constant text := '    company_id, account_id, location_id, client_requisites_id' || chr(10) || '  ) values (';
  old_vals constant text := '    resolved_location_id' || chr(10) || '  )' || chr(10) || '  returning * into invoice_row;';
  new_vals constant text := '    resolved_location_id,' || chr(10) || '    resolved_requisites_id' || chr(10) ||
                            '  )' || chr(10) || '  returning * into invoice_row;';
  anchors text[] := array[old_head, old_decl, old_team_check, old_cols, old_vals];
  anchor text;
begin
  select pg_get_functiondef(
    'public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text)'::regprocedure
  ) into body;
  foreach anchor in array anchors loop
    if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
      raise exception 'issue_invoice: anchor not unique: %', left(anchor, 60);
    end if;
  end loop;
  body := replace(body, old_head, new_head);
  body := replace(body, old_decl, new_decl);
  body := replace(body, old_team_check, new_team_check);
  body := replace(body, old_cols, new_cols);
  body := replace(body, old_vals, new_vals);
  drop function public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text);
  execute body;
end
$migration$;

revoke all on function public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text, text) to authenticated;

-- ─── Сторожа ─────────────────────────────────────────────────────────────
do $audit$
declare
  missing_value text;
  bad integer;
begin
  -- Default — константа `[]`, прошлые строки получили ровно её.
  select pg_get_expr(d.adbin, d.adrelid) into missing_value
    from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.clients'::regclass and a.attname = 'requisites';
  if missing_value is distinct from '''[]''::jsonb' then
    raise exception 'clients.requisites default must be the constant []: %', missing_value;
  end if;
  select a.attmissingval::text into missing_value
    from pg_attribute a
   where a.attrelid = 'public.clients'::regclass and a.attname = 'requisites' and a.atthasmissing;
  if missing_value is not null and missing_value <> '{[]}' then
    raise exception 'clients.requisites stamped past rows with %', missing_value;
  end if;

  -- Перенос: у каждого, у кого есть реквизиты, ровно один основной набор, и
  -- зеркало совпадает с ним; у кого нет — пустой массив.
  select count(*) into bad
    from public.clients c
   where (select count(*) from jsonb_array_elements(c.requisites) e where (e ->> 'is_default')::boolean)
         <> case when jsonb_array_length(c.requisites) > 0 then 1 else 0 end
      or (jsonb_array_length(c.requisites) = 0) <>
         (coalesce(c.legal_name, c.vat_number, c.reg_number, c.billing_address) is null)
      or exists (
           select 1 from jsonb_array_elements(c.requisites) e
            where (e ->> 'is_default')::boolean
              and row(e ->> 'legal_name', e ->> 'vat_number', e ->> 'reg_number', e ->> 'billing_address')
                  is distinct from row(c.legal_name, c.vat_number, c.reg_number, c.billing_address)
         );
  if bad > 0 then
    raise exception 'client requisites: % rows out of sync with the mirror', bad;
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.clients'::regclass and tgname = 'clients_sync_requisites' and not tgisinternal
  ) then
    raise exception 'clients_sync_requisites trigger is missing';
  end if;

  if not exists (
    select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'update_client_with_tags'
       and prosrc like '%''billing_address'',' || chr(10) || '                        ''requisites''] then%'
       and prosrc like '%requisites = coalesce(next_row.requisites%'
       and prosrc like '%''memberships'',' || chr(10) || '       ''requisites''%'
  ) then
    raise exception 'update_client_with_tags does not guard or write requisites';
  end if;
  if not exists (
    select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_client_with_tags'
       and prosrc like '%input_row.requisites := ''[]''::jsonb;%'
       and prosrc like '%coalesce(input_row.requisites, ''[]''::jsonb)%'
  ) then
    raise exception 'create_client_with_tags does not guard or write requisites';
  end if;
  if public.client_without_money('{"requisites":[{"id":"x"}]}'::jsonb) -> 'requisites' <> '[]'::jsonb then
    raise exception 'client_without_money leaks requisites';
  end if;

  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'issue_invoice') <> 1 then
    raise exception 'issue_invoice must have exactly one overload';
  end if;
  if not exists (
    select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'issue_invoice'
       and prosrc like '%resolved_requisites_id%'
       and prosrc like '%resolved_location_id%'
       and prosrc like '%next_company_invoice_number%'
  ) then
    raise exception 'issue_invoice lost the requisites, the object or the numbering';
  end if;
  if not exists (
    select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'capture_invoice_document_snapshots'
       and prosrc like '%build_invoice_client_snapshot_for(new.tenant_id, new.client_id, new.client_requisites_id)%'
       and prosrc like '%new.client_requisites_id,%'
  ) then
    raise exception 'invoice snapshots do not carry the chosen requisites';
  end if;

  if has_function_privilege('anon', 'public.build_invoice_client_snapshot_for(uuid, uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'public.normalize_client_requisites(jsonb)', 'execute') then
    raise exception 'requisites functions are callable by anon';
  end if;
end
$audit$;

commit;
