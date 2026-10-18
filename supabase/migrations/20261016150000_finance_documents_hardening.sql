-- ДОКУМЕНТЫ И ПРАВА ФИНАНСОВ: ДЫРЫ, КОТОРЫЕ НАШЁЛ АУДИТ.
--
-- Что закрыто и зачем (подробности — у каждого куска ниже):
--   1. Снимки сторон чека и инвойса больше не хранят номера клиента: партнёр
--      с «Документы: Видит» читает снимки пачкой, а бумага номеров не печатает.
--   2. `update_invoice_draft` проверяет всё, что проверяет `issue_invoice`.
--   3. Последняя доля оплаты считает налог от суммы «минус сторнировано».
--   4. Доход с выданным чеком нельзя удалить и править в деньгах мимо чека.
--   5. Налог без ставки или больше суммы операции не сохраняется.
--   6. Возврат, закрытый кредит-нотой чека, не удаляется; «нота с деньгами»
--      у чека определяется по журналу, а не по совпадению времени.
--   7. Оплата и ожидание оплаты на скрытый счёт — только владельцу.
--   8. Чек и инвойс не выписываются будущей датой.
--   9. Кредит-нота к чеку проходит на любом тарифе, как нота к инвойсу.
--  10. Сторнированная сумма инвойса меняется только кредит-нотой.
--  11. Возврат по кредит-ноте можно начать с выбранного платежа.

-- ======================================================================
-- Служебные помощники: наружу не торчат.
-- ======================================================================

-- Счёт, на который документ ждёт оплату: свой, не закрытый, обслуживает
-- команду документа; скрытый счёт не-владельцу не существует.
create or replace function public._assert_invoice_wait_account(
  p_tenant_id uuid,
  p_account_id uuid,
  p_team_id text,
  p_check_hidden boolean
) returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if p_account_id is null then
    return;
  end if;
  if not exists (
    select 1 from public.accounts a
     where a.id = p_account_id
       and a.tenant_id = p_tenant_id
       and (
         not (p_check_hidden and a.is_hidden)
         or public.current_user_role() is not distinct from 'owner'
       )
  ) then
    raise exception 'Счёт не найден или недоступен'
      using errcode = 'P0001', hint = 'block:finance.documents';
  end if;
  if p_team_id is null or not public.account_serves_team(p_account_id, p_team_id) then
    raise exception 'Оплату по документу команды ждут на счёт этой команды'
      using errcode = 'P0001', hint = 'block:finance.documents';
  end if;
end;
$function$;
revoke all on function public._assert_invoice_wait_account(uuid, uuid, text, boolean) from public, anon, authenticated;

-- ======================================================================
-- 1. НОМЕРА КЛИЕНТА — НЕ В СНИМКАХ ДОКУМЕНТОВ
-- ======================================================================
-- Бумага печатает юрлицо, номера, почту и адрес — телефона в ней нет, а
-- снимок читается пачкой теми, у кого есть «Документы: Видит». Источник
-- ключей — построитель снимка; сторож на записи — для всего, что пришло
-- другой дорогой (копия снимка в кредит-ноте, правка вручную).

CREATE OR REPLACE FUNCTION public.build_invoice_client_snapshot(p_tenant_id uuid, p_client_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'schema_version', 1,
    'client_id', client.id,
    'full_name', nullif(btrim(client.full_name), ''),
    'legal_name', nullif(btrim(client.legal_name), ''),
    'vat_number', nullif(btrim(client.vat_number), ''),
    'reg_number', nullif(btrim(client.reg_number), ''),
    'billing_address', nullif(btrim(client.billing_address), ''),
    'email', nullif(btrim(client.email), ''),
    'address', nullif(btrim(client.address), ''),
    'city', nullif(btrim(client.city), ''),
    'primary_address', coalesce(
      location.address,
      nullif(
        concat_ws(
          ', ',
          nullif(btrim(client.address), ''),
          nullif(btrim(client.city), '')
        ),
        ''
      )
    ),
    'archived', client.deleted_at is not null,
    'deleted_at', client.deleted_at
  )
    from public.clients client
    left join lateral (
      select nullif(btrim(entry.value ->> 'address'), '') as address
        from jsonb_array_elements(
          case
            when jsonb_typeof(client.locations) = 'array' then client.locations
            else '[]'::jsonb
          end
        ) with ordinality as entry(value, position)
       where nullif(btrim(entry.value ->> 'address'), '') is not null
       order by
         case when lower(coalesce(entry.value ->> 'isPrimary', 'false')) = 'true'
           then 0 else 1
         end,
         entry.position
       limit 1
    ) location on true
   where client.id = p_client_id
     and client.tenant_id = p_tenant_id
$function$;

create or replace function public.strip_snapshot_contact_keys()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.client_snapshot is not null and jsonb_typeof(new.client_snapshot) = 'object' then
    new.client_snapshot := new.client_snapshot - 'phone' - 'phone_e164' - 'whatsapp_phone';
  end if;
  return new;
end;
$function$;
revoke all on function public.strip_snapshot_contact_keys() from public, anon, authenticated;

-- Имя сортируется после `trg_capture_invoice_document_snapshots`: сторож
-- видит уже собранный снимок.
drop trigger if exists trg_strip_snapshot_contacts on public.invoices;
create trigger trg_strip_snapshot_contacts
  before insert or update on public.invoices
  for each row execute function public.strip_snapshot_contact_keys();

drop trigger if exists trg_strip_snapshot_contacts on public.receipts;
create trigger trg_strip_snapshot_contacts
  before insert or update on public.receipts
  for each row execute function public.strip_snapshot_contact_keys();

-- Уже сохранённые снимки. Пользовательские триггеры на время чистки
-- выключены: выставленный документ по правилам неизменяем (триггер снимков
-- пересобрал бы снимок из живого клиента, а журнал и `updated_at` записали
-- бы правку, которой пользователь не делал). Чистится только набор ключей
-- контактов; всё остальное в снимке остаётся как было.
alter table public.invoices disable trigger user;
update public.invoices
   set client_snapshot = client_snapshot - 'phone' - 'phone_e164' - 'whatsapp_phone'
 where client_snapshot ?| array['phone', 'phone_e164', 'whatsapp_phone'];
alter table public.invoices enable trigger user;

alter table public.receipts disable trigger user;
update public.receipts
   set client_snapshot = client_snapshot - 'phone' - 'phone_e164' - 'whatsapp_phone'
 where client_snapshot ?| array['phone', 'phone_e164', 'whatsapp_phone'];
alter table public.receipts enable trigger user;

-- ======================================================================
-- 2. update_invoice_draft ПРОВЕРЯЕТ ТО ЖЕ, ЧТО issue_invoice
-- ======================================================================
-- Правка черновика — вторая дверь в документ: всё, что выпуск не пропустит,
-- не должно проходить через неё (чужая команда, чужой клиент, налог без
-- номера, чужой или скрытый счёт, инвойс под кредит-нотой, будущая дата).

CREATE OR REPLACE FUNCTION public.update_invoice_draft(p_invoice_id uuid, p_due_on date, p_client_id uuid, p_appointment_id uuid, p_brigade_id text, p_vat_mode text, p_vat_percent numeric, p_lines jsonb, p_notes text DEFAULT NULL::text, p_company_id uuid DEFAULT NULL::uuid, p_account_id uuid DEFAULT NULL::uuid, p_issued_on date DEFAULT NULL::date, p_location_id text DEFAULT NULL::text, p_client_requisites_id text DEFAULT NULL::text)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  invoice_row public.invoices%rowtype;
  line_item jsonb;
  line_title text;
  qty_value numeric;
  unit_price_value numeric;
  line_total numeric;
  base_total numeric := 0;
  vat_rate numeric := 0;
  vat_total numeric := 0;
  invoice_total numeric := 0;
  line_count integer := 0;
  discount_lines integer := 0;
  old_line_count integer := 0;
  affected integer := 0;
  appointment_client_id uuid;
  appointment_team_id text;
  resolved_client_id uuid := p_client_id;
  resolved_brigade_id text := p_brigade_id;
  invoice_vat_mode text;
  next_issued_on date;
  location_text text := nullif(btrim(p_location_id), '');
  requisites_text text := nullif(btrim(p_client_requisites_id), '');
begin
  if tenant_uuid is null or not (public._documents_write_invoice(p_invoice_id)
         and public._documents_write_team(coalesce(p_brigade_id,
               (select i.brigade_id from public.invoices i where i.id = p_invoice_id)))) then
    raise exception 'Нужно право «Документы: Выставляет» в команде документа';
  end if;

  select * into invoice_row
    from public.invoices
   where id = p_invoice_id
     and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Инвойс не найден или недоступен';
  end if;
  if invoice_row.kind <> 'invoice' then
    raise exception 'Кредит-нота не редактируется — она сама является сторно';
  end if;
  if invoice_row.status <> 'issued' then
    raise exception 'Редактировать можно только неоплаченный инвойс';
  end if;
  -- Инвойс со сторно правят кредит-нотой, а не бумагой: сумма ноты считана
  -- с прежних итогов, и новые итоги разошлись бы с ней.
  if invoice_row.credited_amount > 0 or exists (
    select 1 from public.invoices note
     where note.credit_note_of_id = invoice_row.id
       and note.tenant_id = tenant_uuid
       and note.kind = 'credit_note'
  ) then
    raise exception 'По инвойсу выписана кредит-нота — его не изменить';
  end if;
  if exists (
    select 1
      from public.finance_transactions
     where tenant_id = tenant_uuid
       and invoice_id = invoice_row.id
       and type in ('income', 'refund')
  ) or exists (
    select 1
      from public.finance_transactions refund
      join public.finance_transactions original on original.id = refund.refund_of_id
     where original.invoice_id = invoice_row.id
       and refund.type = 'refund'
  ) then
    raise exception 'Инвойс с платежами нельзя редактировать';
  end if;

  next_issued_on := coalesce(p_issued_on, invoice_row.issued_on);
  if p_issued_on is not null
     and p_issued_on is distinct from invoice_row.issued_on
     and p_issued_on > public.tenant_business_date(tenant_uuid) then
    raise exception 'Документ нельзя датировать будущим числом';
  end if;
  if extract(year from next_issued_on)::integer <> invoice_row.year then
    raise exception 'Дата инвойса — в пределах % года: номер % из серии этого года',
      invoice_row.year, invoice_row.number;
  end if;
  if location_text is not null and p_client_id is null and p_appointment_id is null then
    raise exception 'Объект выбирают у клиента — сначала клиент';
  end if;
  if p_due_on is not null and p_due_on < next_issued_on then
    raise exception 'Срок оплаты не может быть раньше даты выставления';
  end if;
  if p_appointment_id is not null then
    select client_id, team_id into appointment_client_id, appointment_team_id
      from public.appointments
     where id = p_appointment_id
       and tenant_id = tenant_uuid;
    if not found then
      raise exception 'Заявка не найдена или недоступна';
    end if;
    if resolved_client_id is not null
       and resolved_client_id is distinct from appointment_client_id then
      raise exception 'Клиент инвойса не совпадает с клиентом заявки';
    end if;
    if resolved_brigade_id is not null
       and resolved_brigade_id is distinct from appointment_team_id then
      raise exception 'Команда инвойса не совпадает с командой заявки';
    end if;
    resolved_client_id := appointment_client_id;
    resolved_brigade_id := appointment_team_id;
  end if;
  if resolved_client_id is not null and not exists (
    select 1 from public.clients where id = resolved_client_id and tenant_id = tenant_uuid
  ) then
    raise exception 'Клиент не найден или недоступен';
  end if;
  if resolved_brigade_id is not null and not exists (
    select 1 from public.teams where id = resolved_brigade_id and tenant_id = tenant_uuid
  ) then
    raise exception 'Команда не найдена или недоступна';
  end if;
  -- Не-владелец: команда проверяется ту, в которую документ попадёт после
  -- разбора записи (запись чужой команды при пустой команде в запросе иначе
  -- уводила бы документ туда, где у него нет права), клиент — из его базы.
  if public.current_user_role() is distinct from 'owner' then
    if (resolved_brigade_id = any(public.access_calendars('finance.documents', 'write'))) is not true then
      raise exception 'Нет права выставлять документы этой команды'
        using errcode = '42501', hint = 'block:finance.documents';
    end if;
    if resolved_client_id is not null
       and resolved_client_id is distinct from invoice_row.client_id
       and p_appointment_id is null
       and (resolved_client_id = any(
         public.access_client_ids_in(public.access_calendars('clients', 'read'))
       )) is not true then
      raise exception 'Клиент не найден или недоступен'
        using errcode = '42501', hint = 'block:clients';
    end if;
  end if;
  if p_vat_mode is null or p_vat_mode not in ('off', 'inclusive', 'exclusive') then
    raise exception 'Некорректный режим VAT';
  end if;
  if p_vat_percent is null
     or p_vat_percent = 'NaN'::numeric
     or p_vat_percent < 0
     or p_vat_percent > 100
     or round(p_vat_percent, 2) is distinct from p_vat_percent then
    raise exception 'VAT должен быть от 0 до 100%%';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Позиции инвойса должны быть списком';
  end if;
  line_count := jsonb_array_length(p_lines);
  if line_count < 1 or line_count > 100 then
    raise exception 'В инвойсе должно быть от 1 до 100 позиций';
  end if;

  for line_item in select value from jsonb_array_elements(p_lines)
  loop
    if jsonb_typeof(line_item) <> 'object'
       or jsonb_typeof(line_item -> 'title') <> 'string'
       or jsonb_typeof(line_item -> 'qty') <> 'number'
       or jsonb_typeof(line_item -> 'unit_price') <> 'number' then
      raise exception 'Позиция инвойса имеет неверный формат';
    end if;
    line_title := btrim(coalesce(line_item->>'title', ''));
    if line_title = '' or char_length(line_title) > 500 then
      raise exception 'Некорректное название позиции';
    end if;
    qty_value := (line_item->>'qty')::numeric;
    unit_price_value := (line_item->>'unit_price')::numeric;
    if qty_value is null or qty_value <= 0 or qty_value > 100000 then
      raise exception 'Некорректное количество: %', line_title;
    end if;
    if (line_item->>'discount') = 'true' then
      -- Скидка: одна строка, количество 1, цена меньше нуля.
      if unit_price_value is null or unit_price_value >= 0
         or unit_price_value < -999999999 or qty_value <> 1 then
        raise exception 'Некорректная скидка';
      end if;
      discount_lines := discount_lines + 1;
      if discount_lines > 1 then
        raise exception 'Скидка в инвойсе может быть только одна';
      end if;
    elsif unit_price_value is null or unit_price_value < 0 or unit_price_value > 999999999 then
      raise exception 'Некорректная цена: %', line_title;
    end if;
    if round(qty_value, 3) is distinct from qty_value
       or round(unit_price_value, 2) is distinct from unit_price_value then
      raise exception 'Слишком много знаков после запятой: %', line_title;
    end if;
    line_total := round(qty_value * unit_price_value, 2);
    if line_total > 9999999999.99 then
      raise exception 'Сумма позиции слишком большая: %', line_title;
    end if;
    base_total := base_total + line_total;
  end loop;

  base_total := round(base_total, 2);
  vat_rate := case when p_vat_mode = 'off' then 0 else round(p_vat_percent, 2) end;
  if p_vat_mode = 'inclusive' and vat_rate > 0 then
    invoice_total := base_total;
    vat_total := round(base_total - (base_total / (1 + vat_rate / 100)), 2);
    base_total := round(invoice_total - vat_total, 2);
  elsif p_vat_mode = 'exclusive' and vat_rate > 0 then
    vat_total := round(base_total * vat_rate / 100, 2);
    invoice_total := round(base_total + vat_total, 2);
  else
    vat_total := 0;
    invoice_total := base_total;
  end if;
  if invoice_total <= 0 then
    raise exception 'Итог инвойса должен быть больше нуля';
  end if;
  if invoice_total > 9999999999.99 then
    raise exception 'Итог инвойса слишком большой';
  end if;
  invoice_vat_mode := case when vat_rate > 0 then p_vat_mode else 'off' end;
  -- Плательщик VAT — юрлицо с VAT-номером: без номера налог не начисляется.
  if vat_rate > 0 and not exists (
    select 1 from public.legal_entities entity
     where entity.id = invoice_row.company_id
       and entity.tenant_id = tenant_uuid
       and nullif(btrim(entity.vat_number), '') is not null
  ) then
    raise exception 'Чтобы начислять VAT, впишите VAT-номер юрлица в реквизитах';
  end if;
  -- Счёт ожидания оплаты — счёт команды документа; скрытый не-владельцу
  -- можно только оставить прежним (он уже стоит в документе).
  perform public._assert_invoice_wait_account(
    tenant_uuid, p_account_id, resolved_brigade_id,
    p_account_id is distinct from invoice_row.account_id
  );

  update public.invoices
     set due_on = p_due_on,
         client_id = resolved_client_id,
         appointment_id = p_appointment_id,
         brigade_id = resolved_brigade_id,
         subtotal_net = base_total,
         vat_percent = vat_rate,
         vat_amount = vat_total,
         total = invoice_total,
         vat_mode = invoice_vat_mode,
         notes = nullif(btrim(p_notes), ''),
         company_id = coalesce(invoice_row.company_id, p_company_id),
         issued_on = next_issued_on,
         location_id = location_text,
         client_requisites_id = requisites_text,
         account_id = p_account_id
   where id = invoice_row.id
     and tenant_id = tenant_uuid
     and status = 'issued'
  returning * into invoice_row;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Реквизиты инвойса не обновлены';
  end if;

  select count(*) into old_line_count
    from public.invoice_lines
   where invoice_id = invoice_row.id;
  delete from public.invoice_lines where invoice_id = invoice_row.id;
  get diagnostics affected = row_count;
  if affected <> old_line_count then
    raise exception 'Не все старые позиции инвойса удалены';
  end if;

  insert into public.invoice_lines (
    invoice_id, position, title, description, unit, qty, unit_price, total
  )
  select
    invoice_row.id,
    ordinality::integer - 1,
    btrim(value->>'title'),
    nullif(btrim(coalesce(value->>'description', '')), ''),
    nullif(btrim(coalesce(value->>'unit', '')), ''),
    round((value->>'qty')::numeric, 3),
    round((value->>'unit_price')::numeric, 2),
    round(
      round((value->>'qty')::numeric, 3) *
      round((value->>'unit_price')::numeric, 2),
      2
    )
  from jsonb_array_elements(p_lines) with ordinality as entries(value, ordinality);
  get diagnostics affected = row_count;
  if affected <> line_count then
    raise exception 'Не все новые позиции инвойса сохранены';
  end if;

  return invoice_row;
end;
$function$;

-- ======================================================================
-- 7, 8. issue_invoice: СКРЫТЫЙ СЧЁТ И БУДУЩАЯ ДАТА
-- ======================================================================

CREATE OR REPLACE FUNCTION public.issue_invoice(p_request_id uuid, p_issued_on date, p_due_on date, p_client_id uuid, p_appointment_id uuid, p_brigade_id text, p_vat_mode text, p_vat_percent numeric, p_lines jsonb, p_notes text, p_link_to_tx_id uuid, p_company_id uuid DEFAULT NULL::uuid, p_account_id uuid DEFAULT NULL::uuid, p_location_id text DEFAULT NULL::text, p_client_requisites_id text DEFAULT NULL::text)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  invoice_row public.invoices%rowtype;
  transaction_row public.finance_transactions%rowtype;
  line_item jsonb;
  line_title text;
  qty_value numeric;
  unit_price_value numeric;
  line_total numeric;
  base_total numeric := 0;
  vat_rate numeric := 0;
  vat_total numeric := 0;
  invoice_total numeric := 0;
  line_count integer := 0;
  discount_lines integer := 0;
  affected integer := 0;
  invoice_year integer;
  invoice_seq integer;
  invoice_prefix text;
  invoice_number text;
  invoice_currency text := 'EUR';
  tenant_currency text;
  resolved_client_id uuid := p_client_id;
  resolved_appointment_id uuid := p_appointment_id;
  resolved_brigade_id text := p_brigade_id;
  appointment_client_id uuid;
  appointment_team_id text;
  invoice_vat_mode text;
  resolved_company_id uuid;
  resolved_location_id text := nullif(btrim(p_location_id), '');
  appointment_location_id text;
  resolved_requisites_id text := nullif(btrim(p_client_requisites_id), '');
begin
  -- 03.10: выставляет и партнёр с «Документы: Выставляет» — в команде, где у
  -- него это право (команда документа проверяется ниже, когда она известна).
  if tenant_uuid is null or (
    public.current_user_role() is distinct from 'owner'
    and cardinality(public.access_calendars('finance.documents', 'write')) = 0
  ) then
    raise exception 'Недостаточно прав для создания инвойса';
  end if;
  if p_request_id is null then
    raise exception 'Не указан идентификатор запроса';
  end if;

  select * into invoice_row
    from public.invoices
   where id = p_request_id
     and tenant_id = tenant_uuid;
  if found then
    -- 03.10: повтор запроса партнёра отдаёт только документ его команды.
    if public.current_user_role() is distinct from 'owner'
       and (invoice_row.brigade_id = any(public.access_calendars('finance.documents', 'write'))) is not true then
      raise exception 'Недостаточно прав для создания инвойса';
    end if;
    return invoice_row;
  end if;
  if p_issued_on is null then
    raise exception 'Не указана дата выставления';
  end if;
  if p_issued_on > public.tenant_business_date(tenant_uuid) then
    raise exception 'Документ нельзя датировать будущим числом';
  end if;
  if p_due_on is not null and p_due_on < p_issued_on then
    raise exception 'Срок оплаты не может быть раньше даты выставления';
  end if;
  if p_vat_mode is null or p_vat_mode not in ('off', 'inclusive', 'exclusive') then
    raise exception 'Некорректный режим VAT';
  end if;
  if p_vat_percent is null
     or p_vat_percent = 'NaN'::numeric
     or p_vat_percent < 0
     or p_vat_percent > 100
     or round(p_vat_percent, 2) is distinct from p_vat_percent then
    raise exception 'VAT должен быть от 0 до 100%%';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Позиции инвойса должны быть списком';
  end if;
  line_count := jsonb_array_length(p_lines);
  if line_count < 1 or line_count > 100 then
    raise exception 'В инвойсе должно быть от 1 до 100 позиций';
  end if;

  for line_item in select value from jsonb_array_elements(p_lines)
  loop
    if jsonb_typeof(line_item) <> 'object'
       or jsonb_typeof(line_item -> 'title') <> 'string'
       or jsonb_typeof(line_item -> 'qty') <> 'number'
       or jsonb_typeof(line_item -> 'unit_price') <> 'number' then
      raise exception 'Позиция инвойса имеет неверный формат';
    end if;
    line_title := btrim(coalesce(line_item->>'title', ''));
    if line_title = '' or char_length(line_title) > 500 then
      raise exception 'Некорректное название позиции';
    end if;
    qty_value := (line_item->>'qty')::numeric;
    unit_price_value := (line_item->>'unit_price')::numeric;
    if qty_value is null or qty_value <= 0 or qty_value > 100000 then
      raise exception 'Некорректное количество: %', line_title;
    end if;
    if (line_item->>'discount') = 'true' then
      -- Скидка: одна строка, количество 1, цена меньше нуля.
      if unit_price_value is null or unit_price_value >= 0
         or unit_price_value < -999999999 or qty_value <> 1 then
        raise exception 'Некорректная скидка';
      end if;
      discount_lines := discount_lines + 1;
      if discount_lines > 1 then
        raise exception 'Скидка в инвойсе может быть только одна';
      end if;
    elsif unit_price_value is null or unit_price_value < 0 or unit_price_value > 999999999 then
      raise exception 'Некорректная цена: %', line_title;
    end if;
    if round(qty_value, 3) is distinct from qty_value
       or round(unit_price_value, 2) is distinct from unit_price_value then
      raise exception 'Слишком много знаков после запятой: %', line_title;
    end if;
    line_total := round(qty_value * unit_price_value, 2);
    if line_total > 9999999999.99 then
      raise exception 'Сумма позиции слишком большая: %', line_title;
    end if;
    base_total := base_total + line_total;
  end loop;

  base_total := round(base_total, 2);
  vat_rate := case when p_vat_mode = 'off' then 0 else round(p_vat_percent, 2) end;
  if p_vat_mode = 'inclusive' and vat_rate > 0 then
    invoice_total := base_total;
    vat_total := round(base_total - (base_total / (1 + vat_rate / 100)), 2);
    base_total := round(invoice_total - vat_total, 2);
  elsif p_vat_mode = 'exclusive' and vat_rate > 0 then
    vat_total := round(base_total * vat_rate / 100, 2);
    invoice_total := round(base_total + vat_total, 2);
  else
    vat_total := 0;
    invoice_total := base_total;
  end if;
  if invoice_total <= 0 then
    raise exception 'Итог инвойса должен быть больше нуля';
  end if;
  if invoice_total > 9999999999.99 then
    raise exception 'Итог инвойса слишком большой';
  end if;
  invoice_vat_mode := case when vat_rate > 0 then p_vat_mode else 'off' end;

  if p_link_to_tx_id is not null then
    select * into transaction_row
      from public.finance_transactions
     where id = p_link_to_tx_id
       and tenant_id = tenant_uuid
     for update;
    if not found or transaction_row.type <> 'income' then
      raise exception 'Инвойс можно привязать только к операции дохода';
    end if;
    if transaction_row.invoice_id is not null then
      raise exception 'У этой операции уже есть инвойс';
    end if;
    if round(greatest(transaction_row.amount, 0), 2) <> invoice_total then
      raise exception 'Итог инвойса должен совпадать с доходом';
    end if;
    if exists (
      select 1 from public.finance_transactions
       where refund_of_id = transaction_row.id and type = 'refund'
    ) then
      raise exception 'Доход с оформленным возвратом нельзя привязать к инвойсу';
    end if;
    invoice_currency := transaction_row.currency;
    if transaction_row.appointment_id is not null then
      if resolved_appointment_id is not null
         and resolved_appointment_id is distinct from transaction_row.appointment_id then
        raise exception 'Заявка инвойса не совпадает с заявкой дохода';
      end if;
      resolved_appointment_id := transaction_row.appointment_id;
    end if;
    if transaction_row.client_id is not null then
      if resolved_client_id is not null
         and resolved_client_id is distinct from transaction_row.client_id then
        raise exception 'Клиент инвойса не совпадает с клиентом дохода';
      end if;
      resolved_client_id := transaction_row.client_id;
    end if;
    if transaction_row.team_id is not null then
      if resolved_brigade_id is not null
         and resolved_brigade_id is distinct from transaction_row.team_id then
        raise exception 'Команда инвойса не совпадает с командой дохода';
      end if;
      resolved_brigade_id := transaction_row.team_id;
    end if;
  end if;

  if resolved_appointment_id is not null then
    select client_id, team_id, location_id
      into appointment_client_id, appointment_team_id, appointment_location_id
      from public.appointments
     where id = resolved_appointment_id
       and tenant_id = tenant_uuid;
    if not found then
      raise exception 'Заявка не найдена или недоступна';
    end if;
    if resolved_client_id is not null
       and resolved_client_id is distinct from appointment_client_id then
      raise exception 'Клиент инвойса не совпадает с клиентом заявки';
    end if;
    if resolved_brigade_id is not null
       and resolved_brigade_id is distinct from appointment_team_id then
      raise exception 'Команда инвойса не совпадает с командой заявки';
    end if;
    resolved_client_id := appointment_client_id;
    resolved_brigade_id := appointment_team_id;
  end if;
  -- Объект — объект клиента; у счёта из записи по умолчанию объект записи.
  if resolved_location_id is null and appointment_location_id is not null then
    resolved_location_id := appointment_location_id;
  end if;
  if resolved_location_id is not null and resolved_client_id is null then
    raise exception 'Объект выбирают у клиента — сначала клиент';
  end if;
  if resolved_client_id is not null and not exists (
    select 1 from public.clients where id = resolved_client_id and tenant_id = tenant_uuid
  ) then
    raise exception 'Клиент не найден или недоступен';
  end if;
  -- Реквизиты клиента — набор этого клиента; чужой или удалённый — основной.
  if resolved_requisites_id is not null and resolved_requisites_id <> 'none' and not exists (
    select 1 from public.clients client
     cross join lateral jsonb_array_elements(client.requisites) entry
     where client.id = resolved_client_id and client.tenant_id = tenant_uuid
       and entry ->> 'id' = resolved_requisites_id
  ) then
    resolved_requisites_id := null;
  end if;
  if resolved_brigade_id is not null and not exists (
    select 1 from public.teams where id = resolved_brigade_id and tenant_id = tenant_uuid
  ) then
    raise exception 'Команда не найдена или недоступна';
  end if;
  -- 03.10: партнёр с «Документы: Выставляет» — только в команде, где у него
  -- это право, и от юрлица этой команды (у команды без своего юрлица — от
  -- основного). Клиент без записи и без дохода — из его базы клиентов; доход
  -- для привязки — который он видит («Доходы»); счёт оплаты — счёт команды
  -- документа.
  if public.current_user_role() is distinct from 'owner' then
    if (resolved_brigade_id = any(public.access_calendars('finance.documents', 'write'))) is not true then
      raise exception 'Нет права выставлять документы этой команды'
        using errcode = '42501', hint = 'block:finance.documents';
    end if;
    if p_company_id is not null
       and p_company_id is distinct from coalesce(
         public.legal_entity_of_team(tenant_uuid, resolved_brigade_id),
         public.resolve_company_id(tenant_uuid, null)
       ) then
      raise exception 'Документ команды выставляется от реквизитов этой команды'
        using errcode = '42501', hint = 'block:finance.documents';
    end if;
    if p_link_to_tx_id is not null
       and (transaction_row.team_id = any(public.access_calendars('finance.income', 'read'))) is not true then
      raise exception 'Нет права видеть этот доход'
        using errcode = '42501', hint = 'block:finance.income';
    end if;
    if resolved_client_id is not null
       and resolved_appointment_id is null
       and (p_link_to_tx_id is null or transaction_row.client_id is null)
       and (resolved_client_id = any(
         public.access_client_ids_in(public.access_calendars('clients', 'read'))
       )) is not true then
      raise exception 'Клиент не найден или недоступен'
        using errcode = '42501', hint = 'block:clients';
    end if;
    if p_account_id is not null and not exists (
      select 1
        from public.accounts acc
       where acc.id = p_account_id
         and acc.tenant_id = tenant_uuid
         and public.account_serves_team(acc.id, resolved_brigade_id)
         and not acc.is_hidden
    ) then
      raise exception 'Оплату по документу команды ждут на счёт этой команды'
        using errcode = '42501', hint = 'block:finance.documents';
    end if;
  end if;

  -- Серия номеров — у юрлица (STORY-101): выбранного в документе, иначе
  -- юрлица команды, иначе основного. Замок — на юрлицо: выпуски разных
  -- юрлиц друг друга не ждут.
  resolved_company_id := public.resolve_own_company_id(
    coalesce(p_company_id, public.legal_entity_of_team(tenant_uuid, resolved_brigade_id))
  );
  if resolved_company_id is null then
    raise exception 'Сначала добавьте реквизиты: Кабинет → Реквизиты';
  end if;
  -- Плательщик VAT — юрлицо с VAT-номером: без номера VAT не начисляется.
  if vat_rate > 0 and not exists (
    select 1 from public.legal_entities entity
     where entity.id = resolved_company_id
       and entity.tenant_id = tenant_uuid
       and nullif(btrim(entity.vat_number), '') is not null
  ) then
    raise exception 'Чтобы начислять VAT, впишите VAT-номер юрлица в реквизитах';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(tenant_uuid::text || ':' || coalesce(resolved_company_id::text, ''), 0)
  );
  select * into invoice_row
    from public.invoices
   where id = p_request_id
     and tenant_id = tenant_uuid;
  if found then
    -- 03.10: повтор запроса партнёра отдаёт только документ его команды.
    if public.current_user_role() is distinct from 'owner'
       and (invoice_row.brigade_id = any(public.access_calendars('finance.documents', 'write'))) is not true then
      raise exception 'Недостаточно прав для создания инвойса';
    end if;
    return invoice_row;
  end if;

  invoice_year := extract(year from p_issued_on)::integer;
  select tenant.currency
    into tenant_currency
    from public.tenants as tenant
   where tenant.id = tenant_uuid;
  if p_link_to_tx_id is null then
    invoice_currency := coalesce(nullif(btrim(tenant_currency), ''), 'EUR');
  end if;
  -- Номер — из серии юрлица (`document_sequences`): строка серии заперта до
  -- конца транзакции, и откат выпуска откатывает номер вместе с ним.
  select numbering.seq, numbering.number
    into invoice_seq, invoice_number
    from public.next_document_number(
      tenant_uuid, resolved_company_id, 'invoice', invoice_year
    ) as numbering;

  insert into public.invoices (
    id, tenant_id, number, year, seq, issued_on, due_on, client_id,
    appointment_id, brigade_id, subtotal_net, vat_percent, vat_amount,
    total, currency, status, notes, created_by, vat_mode,
    company_id, account_id, location_id, client_requisites_id
  ) values (
    p_request_id,
    tenant_uuid,
    invoice_number,
    invoice_year,
    invoice_seq,
    p_issued_on,
    p_due_on,
    resolved_client_id,
    resolved_appointment_id,
    resolved_brigade_id,
    base_total,
    vat_rate,
    vat_total,
    invoice_total,
    invoice_currency,
    'issued',
    nullif(btrim(p_notes), ''),
    auth.uid(),
    invoice_vat_mode,
    resolved_company_id,
    p_account_id,
    resolved_location_id,
    resolved_requisites_id
  )
  returning * into invoice_row;

  insert into public.invoice_lines (
    invoice_id, position, title, description, unit, qty, unit_price, total
  )
  select
    invoice_row.id,
    ordinality::integer - 1,
    btrim(value->>'title'),
    nullif(btrim(coalesce(value->>'description', '')), ''),
    nullif(btrim(coalesce(value->>'unit', '')), ''),
    round((value->>'qty')::numeric, 3),
    round((value->>'unit_price')::numeric, 2),
    round(
      round((value->>'qty')::numeric, 3) *
      round((value->>'unit_price')::numeric, 2),
      2
    )
  from jsonb_array_elements(p_lines) with ordinality as entries(value, ordinality);
  get diagnostics affected = row_count;
  if affected <> line_count then
    raise exception 'Не все позиции инвойса сохранены';
  end if;

  if p_link_to_tx_id is not null then
    update public.finance_transactions
       set invoice_id = invoice_row.id
     where id = transaction_row.id
       and tenant_id = tenant_uuid
       and invoice_id is null;
    get diagnostics affected = row_count;
    if affected <> 1 then
      raise exception 'Доход не привязан к инвойсу';
    end if;
  end if;

  select * into invoice_row
    from public.invoices
   where id = p_request_id
     and tenant_id = tenant_uuid;
  if not found then
    raise exception 'Созданный инвойс не подтверждён';
  end if;
  return invoice_row;
end;
$function$;

-- ======================================================================
-- 3, 7. record_invoice_payment: НАЛОГ ПОСЛЕДНЕЙ ДОЛИ И СКРЫТЫЙ СЧЁТ
-- ======================================================================

CREATE OR REPLACE FUNCTION public.record_invoice_payment(p_invoice_id uuid, p_request_id uuid, p_amount numeric, p_account_id uuid, p_payment_method text, p_occurred_on date DEFAULT NULL::date, p_notes text DEFAULT NULL::text)
 RETURNS finance_transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  invoice_row public.invoices%rowtype;
  account_row public.accounts%rowtype;
  payment_row public.finance_transactions%rowtype;
  appointment_row public.appointments%rowtype;
  income_total numeric(12,2) := 0;
  direct_refunds numeric(12,2) := 0;
  linked_refunds numeric(12,2) := 0;
  paid_total numeric(12,2) := 0;
  remaining_total numeric(12,2) := 0;
  amount_value numeric(12,2);
  payment_date date;
  affected integer := 0;
  payment_vat_mode text;
  payment_vat_rate numeric;
  payment_vat_amount numeric;
  -- Деньги заявки вне этого инвойса и работа инвойса (сумма его строк).
  credited_here numeric := 0;
  other_money numeric := 0;
  invoice_work numeric := 0;
begin
  if tenant_uuid is null or not public._documents_write_invoice(p_invoice_id) then
    raise exception 'Нужно право «Документы: Выставляет» в команде документа';
  end if;
  if p_request_id is null then
    raise exception 'Не указан идентификатор платежа';
  end if;

  amount_value := round(p_amount, 2);
  if amount_value is null or amount_value <= 0 then
    raise exception 'Сумма платежа должна быть больше нуля';
  end if;
  if amount_value is distinct from p_amount then
    raise exception 'Укажите не больше двух знаков после запятой';
  end if;
  if amount_value > 999999999.99 then
    raise exception 'Сумма платежа слишком большая';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash', 'card', 'transfer', 'other') then
    raise exception 'Некорректный способ оплаты';
  end if;
  payment_date := coalesce(
    p_occurred_on,
    public.tenant_business_date(tenant_uuid)
  );
  if payment_date > public.tenant_business_date(tenant_uuid) then
    raise exception 'Платёж нельзя записать будущей датой';
  end if;

  -- Idempotent network retry: return the payment committed by this request.
  select * into payment_row
    from public.finance_transactions
   where id = p_request_id
     and tenant_id = tenant_uuid
     and invoice_id = p_invoice_id
     and type = 'income';
  if found then
    if payment_row.amount <> amount_value
       or payment_row.account_id is distinct from p_account_id
       or payment_row.payment_method is distinct from p_payment_method
       or payment_row.occurred_on <> payment_date
       or (
         nullif(btrim(p_notes), '') is not null
         and payment_row.notes is distinct from nullif(btrim(p_notes), '')
       ) then
      raise exception 'Идентификатор платежа уже использован с другими данными';
    end if;
    return payment_row;
  end if;

  select * into invoice_row
    from public.invoices
   where id = p_invoice_id
     and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Инвойс не найден или недоступен';
  end if;

  -- A concurrent retry can pass the optimistic lookup before the first
  -- request commits, then wait here on the invoice lock. Recheck after the
  -- lock so that retry returns the committed row instead of a UUID conflict.
  select * into payment_row
    from public.finance_transactions
   where id = p_request_id
     and tenant_id = tenant_uuid
     and invoice_id = p_invoice_id
     and type = 'income';
  if found then
    if payment_row.amount <> amount_value
       or payment_row.account_id is distinct from p_account_id
       or payment_row.payment_method is distinct from p_payment_method
       or payment_row.occurred_on <> payment_date
       or (
         nullif(btrim(p_notes), '') is not null
         and payment_row.notes is distinct from nullif(btrim(p_notes), '')
       ) then
      raise exception 'Идентификатор платежа уже использован с другими данными';
    end if;
    return payment_row;
  end if;

  if invoice_row.status = 'void' then
    raise exception 'Аннулированный инвойс нельзя оплачивать';
  end if;
  -- ОТМЕНЁННЫЙ КРЕДИТ-НОТОЙ — ТОЖЕ КОНЕЦ ПУТИ (статус `cancelled` из
  -- 20260915120000). Отказ явный, как у аннулированного, и не ждёт, пока
  -- статус пересчитается по журналу.
  if invoice_row.status = 'cancelled' then
    raise exception 'Инвойс отменён кредит-нотой — оплату по нему принять нельзя';
  end if;

  select * into account_row
    from public.accounts
   where id = p_account_id
     and tenant_id = tenant_uuid
     and is_active = true
     and (not is_hidden or public.current_user_role() is not distinct from 'owner');
  if not found then
    raise exception 'Финансовый счёт не найден или закрыт';
  end if;
  if account_row.kind <> (case p_payment_method
       when 'cash' then 'cash'
       when 'card' then 'card'
       when 'transfer' then 'bank'
       else 'other'
     end) then
    raise exception 'Способ оплаты не соответствует выбранному счёту';
  end if;
  if invoice_row.brigade_id is not null
     and not public.account_serves_team(account_row.id, invoice_row.brigade_id) then
    raise exception 'Счёт должен принадлежать команде инвойса';
  end if;

  select
    coalesce(sum(case when type = 'income' then greatest(amount, 0) else 0 end), 0),
    coalesce(sum(case when type = 'refund' then abs(amount) else 0 end), 0)
    into income_total, direct_refunds
    from public.finance_transactions
   where tenant_id = tenant_uuid
     and invoice_id = p_invoice_id
     and type in ('income', 'refund');

  -- Older refund writers only set refund_of_id. Count those too, but not a
  -- refund already selected above through its own invoice_id.
  select coalesce(sum(abs(refund.amount)), 0)
    into linked_refunds
    from public.finance_transactions refund
    join public.finance_transactions original
      on original.id = refund.refund_of_id
   where original.tenant_id = tenant_uuid
     and original.invoice_id = p_invoice_id
     and original.type = 'income'
     and refund.tenant_id = tenant_uuid
     and refund.type = 'refund'
     and refund.invoice_id is null;

  paid_total := greatest(
    0,
    case
      when invoice_row.status = 'paid'
        then greatest(invoice_row.total - invoice_row.credited_amount, income_total)
      else income_total
    end - direct_refunds - linked_refunds
  );
  remaining_total := greatest(0, invoice_row.total - invoice_row.credited_amount - paid_total);

  if remaining_total <= 0 then
    raise exception 'Инвойс уже полностью оплачен';
  end if;
  if amount_value > remaining_total then
    raise exception 'Платёж превышает остаток % %', round(remaining_total, 2), invoice_row.currency;
  end if;

  -- ДЕНЬГИ ВНЕ ИНВОЙСА. Заявка уже держит деньги, пришедшие другой дорогой
  -- (предоплата, плитка, ручной доход, другой инвойс), и вместе с работой
  -- этого инвойса — суммой его строк, без налога «сверху» — они больше итога
  -- заявки: инвойс выставлен на уже оплаченную работу, и его деньги легли бы
  -- вторым доходом. Свой зачёт инвойса (элементы `pay-inv-…` его платежей)
  -- деньгами вне инвойса не считается: налог «сверху» после зачтённой работы
  -- принимается, settle зачтёт ноль. Проверка стоит после «Инвойс уже
  -- полностью оплачен» — у оплаченного инвойса ответ прежний. Отменённую
  -- заявку settle не трогает — здесь тоже. Заявка под замком: плитка,
  -- оплатившая её параллельно, дождётся или будет дождана.
  if invoice_row.appointment_id is not null then
    select * into appointment_row
      from public.appointments
     where id = invoice_row.appointment_id
       and tenant_id = tenant_uuid
     for update;
    if found
       and appointment_row.status <> 'cancelled'
       and appointment_row.payment_status <> 'refunded' then
      select coalesce(sum(least(credit.entry_sum, greatest(credit.net, 0))), 0)
        into credited_here
        from (
          select income.amount - coalesce((
                   select sum(abs(refund.amount))
                     from public.finance_transactions refund
                    where refund.refund_of_id = income.id
                      and refund.type = 'refund'
                 ), 0) as net,
                 (
                   select sum(round((e.elem ->> 'amount')::numeric, 2))
                     from jsonb_array_elements(coalesce(appointment_row.payments, '[]'::jsonb)) as e(elem)
                    where e.elem ->> 'id' = 'pay-inv-' || income.id::text
                 ) as entry_sum
            from public.finance_transactions income
           where income.appointment_id = appointment_row.id
             and income.invoice_id = invoice_row.id
             and income.type = 'income'
             and income.source = 'manual'
        ) credit
       where credit.entry_sum > 0;
      other_money := appointment_row.prepaid_amount + case
          when appointment_row.payment_status in ('partial', 'paid')
            then appointment_row.paid_amount
          else 0
        end - credited_here;
      select coalesce(sum(line.total), 0)
        into invoice_work
        from public.invoice_lines line
       where line.invoice_id = invoice_row.id;
      if other_money > 0
         and other_money + invoice_work > appointment_row.total_amount then
        if appointment_row.total_amount - other_money > 0 then
          raise exception 'По заявке уже есть оплата вне инвойса — аннулируйте инвойс и выставьте новый на остаток % %',
            round(appointment_row.total_amount - other_money, 2), invoice_row.currency;
        end if;
        raise exception 'По заявке уже есть оплата вне инвойса — аннулируйте инвойс';
      end if;
    end if;
  end if;

  -- Налог платежа — с бумаги, не из настроек: частичная оплата несёт
  -- пропорциональную долю напечатанного на инвойсе НДС.
  if coalesce(invoice_row.vat_amount, 0) <> 0 and coalesce(invoice_row.total, 0) <> 0 then
    payment_vat_mode := 'inclusive';
    payment_vat_rate := invoice_row.vat_percent;
    -- ПОСЛЕДНЯЯ ДОЛЯ ДОБИРАЕТ НАЛОГ БУМАГИ: доли, округлённые каждая до
    -- цента, расходились с напечатанным VAT. Платёж, закрывающий счёт без
    -- возвратов, несёт остаток — налог действующей части бумаги (без
    -- сторнированного) минус прежние доли. Налог всей бумаги кредит-нота
    -- уже унесла бы в минус вторым разом.
    if amount_value = remaining_total and direct_refunds = 0 and linked_refunds = 0 then
      payment_vat_amount := greatest(0,
        round(
          invoice_row.vat_amount * (invoice_row.total - invoice_row.credited_amount) / invoice_row.total,
          2
        ) - coalesce((
          select sum(coalesce(tx.vat_amount, 0))
            from public.finance_transactions tx
           where tx.tenant_id = tenant_uuid
             and tx.invoice_id = invoice_row.id
             and tx.type = 'income'
        ), 0)
      );
    else
      payment_vat_amount := round(invoice_row.vat_amount * amount_value / invoice_row.total, 2);
    end if;
  else
    payment_vat_mode := 'none';
    payment_vat_rate := null;
    payment_vat_amount := null;
  end if;

  insert into public.finance_transactions (
    id,
    tenant_id,
    type,
    amount,
    currency,
    account_id,
    appointment_id,
    client_id,
    team_id,
    payment_method,
    notes,
    occurred_on,
    invoice_id,
    source,
    vat_mode,
    vat_rate,
    vat_amount
  ) values (
    p_request_id,
    tenant_uuid,
    'income',
    amount_value,
    invoice_row.currency,
    account_row.id,
    invoice_row.appointment_id,
    invoice_row.client_id,
    coalesce(invoice_row.brigade_id, account_row.brigade_id),
    p_payment_method,
    coalesce(nullif(btrim(p_notes), ''), 'Оплата инвойса ' || invoice_row.number),
    payment_date,
    invoice_row.id,
    'manual',
    payment_vat_mode,
    payment_vat_rate,
    payment_vat_amount
  )
  returning * into payment_row;

  update public.invoices
     set status = case
       when paid_total + amount_value >= invoice_row.total - invoice_row.credited_amount then 'paid'
       else 'issued'
     end
   where id = invoice_row.id
     and tenant_id = tenant_uuid;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Статус инвойса не обновлён';
  end if;

  return payment_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.validate_invoice_payment_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  invoice_row public.invoices%rowtype;
  original_row public.finance_transactions%rowtype;
  appointment_row public.appointments%rowtype;
  income_total numeric := 0;
  direct_refunds numeric := 0;
  linked_refunds numeric := 0;
  paid_total numeric := 0;
  remaining_total numeric := 0;
  refunded_original numeric := 0;
  account_team_id text;
  account_kind text;
  -- Деньги заявки вне этого инвойса и работа инвойса (сумма его строк).
  credited_here numeric := 0;
  other_money numeric := 0;
  invoice_work numeric := 0;
begin
  if new.type = 'refund' and new.refund_of_id is not null then
    select * into original_row
      from public.finance_transactions
     where id = new.refund_of_id
       and tenant_id = new.tenant_id
       and type = 'income'
     for update;
    if not found then
      raise exception 'Исходный доход для возврата не найден';
    end if;
    if new.invoice_id is not null
       and new.invoice_id is distinct from original_row.invoice_id then
      raise exception 'Возврат относится к другому инвойсу';
    end if;
    if abs(new.amount) <= 0 then
      raise exception 'Сумма возврата должна быть больше нуля';
    end if;
    new.amount := -round(abs(new.amount), 2);
    if new.account_id is distinct from original_row.account_id
       or (
         new.team_id is not null
         and new.team_id is distinct from original_row.team_id
       ) then
      raise exception 'Возврат должен пройти по исходному счёту и команде';
    end if;
    if new.payment_method is not null
       and new.payment_method is distinct from original_row.payment_method then
      raise exception 'Возврат должен использовать способ исходного платежа';
    end if;

    select coalesce(sum(abs(amount)), 0) into refunded_original
      from public.finance_transactions
     where refund_of_id = original_row.id
       and type = 'refund';
    if refunded_original + abs(new.amount) > greatest(original_row.amount, 0) then
      raise exception 'Возврат превышает остаток исходного дохода';
    end if;

    new.invoice_id := original_row.invoice_id;
    new.currency := original_row.currency;
    new.appointment_id := original_row.appointment_id;
    new.client_id := original_row.client_id;
    new.team_id := original_row.team_id;
    new.master_id := original_row.master_id;
    new.payment_method := original_row.payment_method;
    if new.invoice_id is not null then
      select * into invoice_row
        from public.invoices
       where id = new.invoice_id
         and tenant_id = new.tenant_id
       for update;
      if not found or invoice_row.status = 'void' then
        raise exception 'Инвойс для возврата не найден или аннулирован';
      end if;
    end if;
    return new;
  end if;

  if new.invoice_id is null then
    return new;
  end if;
  if new.type <> 'income' or new.source <> 'manual' then
    raise exception 'К инвойсу можно добавить только ручной платёж или корректный возврат';
  end if;
  if new.amount <= 0 then
    raise exception 'Сумма платежа должна быть больше нуля';
  end if;
  if new.refund_of_id is not null or new.transfer_group_id is not null then
    raise exception 'Платёж инвойса не может быть возвратом или переводом';
  end if;
  if new.payment_method is null
     or new.payment_method not in ('cash', 'card', 'transfer', 'other') then
    raise exception 'Некорректный способ оплаты инвойса';
  end if;

  select * into invoice_row
    from public.invoices
   where id = new.invoice_id
     and tenant_id = new.tenant_id
   for update;
  if not found or invoice_row.status = 'void' then
    raise exception 'Инвойс не найден или аннулирован';
  end if;
  -- Отменённый кредит-нотой инвойс оплату не принимает ни одной дорогой.
  if invoice_row.status = 'cancelled' then
    raise exception 'Инвойс отменён кредит-нотой — оплату по нему принять нельзя';
  end if;
  select brigade_id, kind into account_team_id, account_kind
    from public.accounts
   where id = new.account_id
     and tenant_id = new.tenant_id
     and is_active = true
     and (
       not is_hidden
       or auth.uid() is null
       or public.current_user_role() is not distinct from 'owner'
     );
  if not found or (
    invoice_row.brigade_id is not null
    and not public.account_serves_team(new.account_id, invoice_row.brigade_id)
  ) then
    raise exception 'Финансовый счёт не найден или не относится к команде инвойса';
  end if;
  if account_kind <> (case new.payment_method
       when 'cash' then 'cash'
       when 'card' then 'card'
       when 'transfer' then 'bank'
       else 'other'
     end) then
    raise exception 'Способ оплаты не соответствует выбранному счёту';
  end if;

  new.currency := invoice_row.currency;
  new.appointment_id := invoice_row.appointment_id;
  new.client_id := invoice_row.client_id;
  new.team_id := coalesce(invoice_row.brigade_id, account_team_id);

  select
    coalesce(sum(case when type = 'income' then greatest(amount, 0) else 0 end), 0),
    coalesce(sum(case when type = 'refund' then abs(amount) else 0 end), 0)
    into income_total, direct_refunds
    from public.finance_transactions
   where invoice_id = invoice_row.id
     and type in ('income', 'refund');
  select coalesce(sum(abs(refund.amount)), 0) into linked_refunds
    from public.finance_transactions refund
    join public.finance_transactions original on original.id = refund.refund_of_id
   where original.invoice_id = invoice_row.id
     and original.type = 'income'
     and refund.type = 'refund'
     and refund.invoice_id is null;
  paid_total := greatest(
    0,
    case
      when invoice_row.status = 'paid' then greatest(invoice_row.total - invoice_row.credited_amount, income_total)
      else income_total
    end - direct_refunds - linked_refunds
  );
  remaining_total := greatest(0, invoice_row.total - invoice_row.credited_amount - paid_total);
  if remaining_total <= 0 or new.amount > remaining_total then
    raise exception 'Платёж превышает остаток инвойса';
  end if;

  -- ДЕНЬГИ ВНЕ ИНВОЙСА — то же правило, что в `record_invoice_payment`, и там
  -- же, после проверки остатка инвойса.
  if invoice_row.appointment_id is not null then
    select * into appointment_row
      from public.appointments
     where id = invoice_row.appointment_id
       and tenant_id = new.tenant_id
     for update;
    if found
       and appointment_row.status <> 'cancelled'
       and appointment_row.payment_status <> 'refunded' then
      select coalesce(sum(least(credit.entry_sum, greatest(credit.net, 0))), 0)
        into credited_here
        from (
          select income.amount - coalesce((
                   select sum(abs(refund.amount))
                     from public.finance_transactions refund
                    where refund.refund_of_id = income.id
                      and refund.type = 'refund'
                 ), 0) as net,
                 (
                   select sum(round((e.elem ->> 'amount')::numeric, 2))
                     from jsonb_array_elements(coalesce(appointment_row.payments, '[]'::jsonb)) as e(elem)
                    where e.elem ->> 'id' = 'pay-inv-' || income.id::text
                 ) as entry_sum
            from public.finance_transactions income
           where income.appointment_id = appointment_row.id
             and income.invoice_id = invoice_row.id
             and income.type = 'income'
             and income.source = 'manual'
        ) credit
       where credit.entry_sum > 0;
      other_money := appointment_row.prepaid_amount + case
          when appointment_row.payment_status in ('partial', 'paid')
            then appointment_row.paid_amount
          else 0
        end - credited_here;
      select coalesce(sum(line.total), 0)
        into invoice_work
        from public.invoice_lines line
       where line.invoice_id = invoice_row.id;
      if other_money > 0
         and other_money + invoice_work > appointment_row.total_amount then
        if appointment_row.total_amount - other_money > 0 then
          raise exception 'По заявке уже есть оплата вне инвойса — аннулируйте инвойс и выставьте новый на остаток % %',
            round(appointment_row.total_amount - other_money, 2), invoice_row.currency;
        end if;
        raise exception 'По заявке уже есть оплата вне инвойса — аннулируйте инвойс';
      end if;
    end if;
  end if;
  return new;
end;
$function$;

-- ======================================================================
-- 8. ЧЕК НЕ ВЫПИСЫВАЕТСЯ БУДУЩЕЙ ДАТОЙ
-- ======================================================================
-- Дата — по часовому поясу компании, как у операций. Повтор запроса на уже
-- выписанный чек дату не проверяет: он возвращает то, что есть.

CREATE OR REPLACE FUNCTION public.issue_receipt(p_transaction_id uuid, p_lines jsonb DEFAULT NULL::jsonb, p_company_id uuid DEFAULT NULL::uuid, p_issued_on date DEFAULT NULL::date, p_location_id text DEFAULT NULL::text, p_client_requisites_id text DEFAULT NULL::text)
 RETURNS receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  tx public.finance_transactions%rowtype;
  existing public.receipts%rowtype;
  result_row public.receipts%rowtype;
  refunded_amount numeric;
begin
  if auth.uid() is null or tenant_uuid is null then
    raise exception 'Войдите в приложение, чтобы выписать чек';
  end if;
  if p_transaction_id is null then
    raise exception 'Не указана операция';
  end if;
  select * into tx
    from public.finance_transactions
   where id = p_transaction_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Операция не найдена';
  end if;
  if public._receipt_tx_allowed(tx) is not true then
    raise exception 'Недостаточно прав, чтобы выписать чек по этой операции';
  end if;
  select * into existing from public.receipts where transaction_id = tx.id;
  if found then
    return existing;
  end if;
  if tx.type <> 'income' then
    raise exception 'Чек выписывается только на доход';
  end if;
  if tx.amount <= 0 then
    raise exception 'Сумма операции должна быть больше нуля';
  end if;
  if tx.client_id is null then
    raise exception 'У операции нет клиента — чек не нужен';
  end if;
  select coalesce(sum(abs(amount)), 0) into refunded_amount
    from public.finance_transactions
   where refund_of_id = tx.id and type = 'refund';
  if refunded_amount >= round(tx.amount, 2) then
    raise exception 'По операции оформлен полный возврат — чек не выписывается';
  end if;
  if p_issued_on is not null and p_issued_on > public.tenant_business_date(tenant_uuid) then
    raise exception 'Документ нельзя датировать будущим числом';
  end if;
  result_row := public._issue_receipt_core(
    tx, p_lines, p_company_id, p_issued_on, p_location_id, p_client_requisites_id
  );
  if result_row.id is null then
    select * into result_row from public.receipts where transaction_id = tx.id;
  end if;
  if result_row.id is null then
    raise exception 'Не удалось выписать чек';
  end if;
  return result_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_receipt(p_receipt_id uuid, p_lines jsonb DEFAULT NULL::jsonb, p_issued_on date DEFAULT NULL::date, p_location_id text DEFAULT NULL::text, p_client_requisites_id text DEFAULT NULL::text)
 RETURNS receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  target public.receipts%rowtype;
  tx public.finance_transactions%rowtype;
  next_date date;
  location_text text := nullif(btrim(p_location_id), '');
  requisites_text text := nullif(btrim(p_client_requisites_id), '');
  result_row public.receipts%rowtype;
begin
  if auth.uid() is null or tenant_uuid is null then
    raise exception 'Войдите в приложение, чтобы изменить чек';
  end if;
  select * into target
    from public.receipts
   where id = p_receipt_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Чек не найден';
  end if;
  if target.status <> 'issued' then
    raise exception 'Аннулированный чек не меняется';
  end if;
  select * into tx
    from public.finance_transactions
   where id = target.transaction_id and tenant_id = tenant_uuid;
  if not found then
    raise exception 'У чека нет оплаты — его не изменить';
  end if;
  if public._receipt_tx_allowed(tx) is not true then
    raise exception 'Недостаточно прав, чтобы изменить этот чек';
  end if;
  next_date := coalesce(p_issued_on, target.issued_on);
  if p_issued_on is not null
     and p_issued_on is distinct from target.issued_on
     and p_issued_on > public.tenant_business_date(tenant_uuid) then
    raise exception 'Документ нельзя датировать будущим числом';
  end if;
  if extract(year from next_date)::integer <> target.year then
    raise exception 'Дата чека — в пределах % года: номер % из серии этого года',
      target.year, target.number;
  end if;
  update public.receipts
     set lines = case when p_lines is null then lines else public._receipt_lines_snapshot(p_lines) end,
         issued_on = next_date,
         location_id = location_text,
         client_requisites_id = requisites_text,
         client_snapshot = public._receipt_client_snapshot(
           tenant_uuid, target.client_id, location_text, requisites_text
         )
   where id = target.id
  returning * into result_row;
  return result_row;
end;
$function$;

-- ======================================================================
-- 4. ДОХОД С ВЫДАННЫМ ЧЕКОМ: НИ УДАЛИТЬ, НИ ПЕРЕПИСАТЬ В ДЕНЬГАХ
-- ======================================================================
-- Чек — номерной документ на эти деньги: сумма, налог, счёт и способ в нём
-- не следуют за правкой дохода, а напечатанные строки остались бы прежними.
-- Прямое удаление (REST, минуя `delete_operation`) гасило чек молча. Теперь
-- отказ везде, кроме каскада компании и удаления календаря; изменить деньги
-- по чеку можно кредит-нотой (возврат), затем — новая операция.
-- Синхронизация чека с доходом больше не нужна: правки отвергаются раньше.
drop trigger if exists trg_sync_receipt_with_income on public.finance_transactions;
drop function if exists public.sync_receipt_with_income();

create or replace function public.guard_income_with_issued_receipt()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  receipt_number text;
begin
  if old.type is distinct from 'income' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  -- Каскад удаления компании: её строка к этому моменту дочернему триггеру
  -- не видна, и отказ оборвал бы восстановимое удаление.
  if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if row(new.amount, new.account_id, new.payment_method, new.vat_mode, new.vat_rate,
           new.vat_amount, new.occurred_on, new.type, new.currency)
       is not distinct from
       row(old.amount, old.account_id, old.payment_method, old.vat_mode, old.vat_rate,
           old.vat_amount, old.occurred_on, old.type, old.currency) then
      return new;
    end if;
  end if;
  if public.calendar_delete_in_progress() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  -- «Удалить» из приложения: свой сторож (`trash_deleted_operation`) отказывает
  -- своим текстом, который приложение знает.
  if tg_op = 'DELETE' and coalesce(current_setting('babun.operation_trash', true), '') = 'on' then
    return old;
  end if;
  select r.number into receipt_number
    from public.receipts r
   where r.transaction_id = old.id
     and r.status = 'issued'
   limit 1;
  if found then
    raise exception 'По доходу выдан чек % — сначала оформите кредит-ноту', receipt_number
      using errcode = '23514', hint = 'operation:has_receipt';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;
revoke all on function public.guard_income_with_issued_receipt() from public, anon, authenticated;

drop trigger if exists trg_guard_income_with_issued_receipt on public.finance_transactions;
create trigger trg_guard_income_with_issued_receipt
  before update or delete on public.finance_transactions
  for each row execute function public.guard_income_with_issued_receipt();

-- ======================================================================
-- КАСКАД УДАЛЕНИЯ КОМПАНИИ С ВЫДАННЫМИ ЧЕКАМИ
-- ======================================================================
-- Оба гасящих триггера правят чек, когда стирается доход или возврат. При
-- каскаде компании счёт чека к этому моменту удалён, правка нарушала связь
-- чека со счётом, и компания с выданным чеком не удалялась.

CREATE OR REPLACE FUNCTION public.void_receipt_on_income_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.type <> 'income' then
    return old;
  end if;
  -- Каскад удаления компании: счета уже стёрты, и правка чека упёрлась бы
  -- в связь с ними — компания с выданными чеками не удалялась.
  if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    return old;
  end if;
  update public.receipts
     set status = 'void'
   where transaction_id = old.id
     and status = 'issued';
  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION public.void_receipt_on_refund()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_id uuid;
  refunded numeric;
  original numeric;
begin
  if tg_op = 'DELETE' then
    if old.type <> 'refund' or old.refund_of_id is null then return old; end if;
    if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then return old; end if;
    target_id := old.refund_of_id;
  else
    if new.type <> 'refund' or new.refund_of_id is null then return new; end if;
    target_id := new.refund_of_id;
  end if;

  select amount into original
    from public.finance_transactions where id = target_id;
  select coalesce(sum(abs(amount)), 0) into refunded
    from public.finance_transactions
   where refund_of_id = target_id and type = 'refund';

  -- Гасим только при ПОЛНОМ возврате: частичный оставляет чек в силе,
  -- иначе документ на реально полученные деньги исчезал бы.
  if original is null then
    null;
  elsif refunded >= round(original, 2) then
    update public.receipts
       set status = 'void'
     where transaction_id = target_id
       and status = 'issued';
  else
    update public.receipts
       set status = 'issued'
     where transaction_id = target_id
       and status = 'void';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

-- ======================================================================
-- 5. НАЛОГ ОПЕРАЦИИ: СО СТАВКОЙ И НЕ БОЛЬШЕ СУММЫ
-- ======================================================================
-- `fill_transaction_vat` уважает присланный налог, если ставки или режима
-- нет: сумма 10 с налогом 500 сохранялась как есть. Проверка стоит ПОСЛЕ него
-- (имя сортируется следом) и смотрит на итог. Старые строки не трогаются:
-- проверяется вставка и правка, меняющая налог, ставку или сумму.
create or replace function public.assert_transaction_vat_sane()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.vat_amount is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.vat_amount is not distinct from old.vat_amount
     and new.vat_rate is not distinct from old.vat_rate
     and new.amount is not distinct from old.amount then
    return new;
  end if;
  if new.vat_amount <> 0 and new.vat_rate is null then
    raise exception 'Налог указан без ставки VAT'
      using errcode = 'P0001', hint = 'vat:snapshot';
  end if;
  if abs(new.vat_amount) > abs(new.amount) then
    raise exception 'Налог % больше суммы операции %', new.vat_amount, new.amount
      using errcode = 'P0001', hint = 'vat:snapshot';
  end if;
  return new;
end;
$function$;
revoke all on function public.assert_transaction_vat_sane() from public, anon, authenticated;

drop trigger if exists trg_fill_transaction_vat_sane on public.finance_transactions;
create trigger trg_fill_transaction_vat_sane
  before insert or update on public.finance_transactions
  for each row execute function public.assert_transaction_vat_sane();

-- ======================================================================
-- 6. ВОЗВРАТ ПОД КРЕДИТ-НОТОЙ ЧЕКА НЕ УДАЛЯЕТСЯ
-- ======================================================================
-- Удаление возврата оживляло погашенный чек (`void_receipt_on_refund`), а
-- кредит-нота на этот возврат продолжала действовать: чек в силе и сторно
-- на те же деньги. Возврат можно удалить, пока оставшихся возвратов хватает
-- на все ноты чека.
create or replace function public.guard_refund_delete_with_credit_note()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  receipt_row public.receipts%rowtype;
  covered numeric(12,2);
  refunded_after numeric(12,2);
begin
  if old.type is distinct from 'refund' or old.refund_of_id is null then
    return old;
  end if;
  if not exists (select 1 from public.tenants t where t.id = old.tenant_id)
     or public.calendar_delete_in_progress() then
    return old;
  end if;
  select * into receipt_row
    from public.receipts r
   where r.transaction_id = old.refund_of_id
     and r.tenant_id = old.tenant_id;
  if not found then
    return old;
  end if;
  select coalesce(sum(-note.total), 0) into covered
    from public.invoices note
   where note.tenant_id = old.tenant_id
     and note.kind = 'credit_note'
     and note.credit_note_of_receipt_id = receipt_row.id;
  -- Чек оплаты инвойса сторнируется нотой к инвойсу — она закрывает всё.
  if receipt_row.invoice_id is not null and exists (
    select 1 from public.invoices note
     where note.tenant_id = old.tenant_id
       and note.kind = 'credit_note'
       and note.credit_note_of_id = receipt_row.invoice_id
       and not note.credit_partial
  ) then
    covered := greatest(covered, round(receipt_row.amount, 2));
  end if;
  if covered <= 0 then
    return old;
  end if;
  select coalesce(sum(abs(r.amount)), 0) - abs(old.amount) into refunded_after
    from public.finance_transactions r
   where r.tenant_id = old.tenant_id
     and r.refund_of_id = old.refund_of_id
     and r.type = 'refund';
  if refunded_after + 0.004 < covered then
    raise exception 'На этот возврат выписана кредит-нота чека — его не удалить'
      using errcode = '23514', hint = 'operation:has_credit_note';
  end if;
  return old;
end;
$function$;
revoke all on function public.guard_refund_delete_with_credit_note() from public, anon, authenticated;

drop trigger if exists trg_guard_refund_delete_with_credit_note on public.finance_transactions;
create trigger trg_guard_refund_delete_with_credit_note
  before delete on public.finance_transactions
  for each row execute function public.guard_refund_delete_with_credit_note();

CREATE OR REPLACE FUNCTION public.delete_credit_note(p_note_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  note public.invoices%rowtype;
  original public.invoices%rowtype;
  receipt_row public.receipts%rowtype;
  last_seq integer;
  moved numeric(12,2) := 0;
  paid_total numeric(12,2);
  receipt_refunded numeric(12,2);
  other_cover numeric(12,2);
begin
  if tenant_uuid is null or not public._documents_write_invoice(p_note_id) then
    raise exception 'Нужно право «Документы: Выставляет» в команде документа'
      using errcode = '42501', hint = 'access:owner_only';
  end if;
  select * into note
    from public.invoices
   where id = p_note_id and tenant_id = tenant_uuid
   for update;
  if not found or note.kind <> 'credit_note' then
    raise exception 'Кредит-нота не найдена';
  end if;

  if note.credit_note_of_id is not null then
    -- Нота к инвойсу и её возвраты рождаются одной транзакцией
    -- (`issue_partial_credit_note`, `refund_receipt`): время создания у них
    -- общее и точно связывает возврат с нотой.
    select coalesce(sum(abs(tx.amount)), 0) into moved
      from public.finance_transactions tx
     where tx.tenant_id = tenant_uuid
       and tx.type = 'refund'
       and tx.invoice_id = note.credit_note_of_id
       and tx.created_at = note.created_at;
  elsif note.credit_note_of_receipt_id is not null then
    -- Нота к чеку документирует возврат, но выписывается и позже самого
    -- возврата (`issue_receipt_credit_note`), поэтому совпадение времени
    -- ничего не говорит. Деньги на ноте — возвраты по чеку, которые не
    -- закрыты остальными нотами этого чека.
    select * into receipt_row from public.receipts where id = note.credit_note_of_receipt_id;
    select coalesce(sum(abs(tx.amount)), 0) into receipt_refunded
      from public.finance_transactions tx
     where tx.tenant_id = tenant_uuid
       and tx.type = 'refund'
       and tx.refund_of_id = receipt_row.transaction_id;
    select coalesce(sum(-other.total), 0) into other_cover
      from public.invoices other
     where other.tenant_id = tenant_uuid
       and other.kind = 'credit_note'
       and other.credit_note_of_receipt_id = receipt_row.id
       and other.id <> note.id;
    moved := least(-note.total, greatest(0, receipt_refunded - other_cover));
  end if;
  if moved > 0 then
    raise exception 'Кредит-нота вернула клиенту % % — её не удалить: документ на эти деньги остаётся', moved, note.currency;
  end if;

  perform 1 from public.document_sequences s
   where s.tenant_id = tenant_uuid
     and s.legal_entity_id is not distinct from note.company_id
     and s.doc_type = 'credit_note'
     and s.year = note.year
   for update;
  select max(i.seq) into last_seq
    from public.invoices i
   where i.tenant_id = tenant_uuid
     and i.kind = 'credit_note'
     and i.company_id is not distinct from note.company_id
     and i.year = note.year;
  if last_seq is distinct from note.seq then
    raise exception 'Удалить можно только последнюю кредит-ноту серии (%) — после неё уже выписаны другие', last_seq;
  end if;

  perform set_config('babun.invoice_delete', note.id::text, true);
  delete from public.invoices where id = note.id;
  perform set_config('babun.invoice_delete', '', true);

  update public.document_sequences s
     set last_number = note.seq - 1,
         updated_at = now()
   where s.tenant_id = tenant_uuid
     and s.legal_entity_id is not distinct from note.company_id
     and s.doc_type = 'credit_note'
     and s.year = note.year
     and s.last_number = note.seq;

  if note.credit_note_of_id is not null then
    select * into original
      from public.invoices
     where id = note.credit_note_of_id and tenant_id = tenant_uuid
     for update;
    if note.credit_partial then
      update public.invoices
         set credited_amount = greatest(0, credited_amount + note.total)
       where id = original.id;
      select * into original from public.invoices where id = original.id;
    end if;
    select greatest(0,
             coalesce(sum(case when tx.type = 'income' then greatest(tx.amount, 0) else 0 end), 0)
           - coalesce(sum(case when tx.type = 'refund' then abs(tx.amount) else 0 end), 0))
      into paid_total
      from public.finance_transactions tx
     where tx.tenant_id = tenant_uuid
       and tx.invoice_id = original.id
       and tx.type in ('income', 'refund');
    perform set_config('babun.credit_note_undo', original.id::text, true);
    update public.invoices
       set status = case
         when paid_total >= original.total - original.credited_amount then 'paid'
         else 'issued'
       end,
           updated_at = now()
     where id = original.id
       and status is distinct from case
         when paid_total >= original.total - original.credited_amount then 'paid'
         else 'issued'
       end;
    perform set_config('babun.credit_note_undo', '', true);
  end if;
end;
$function$;

-- ======================================================================
-- 9. КРЕДИТ-НОТА К ЧЕКУ НА ЛЮБОМ ТАРИФЕ
-- ======================================================================

CREATE OR REPLACE FUNCTION public.enforce_plan_limits()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_plan text;
  v_limit integer;
  v_count integer;
begin
  if new.tenant_id is null then
    raise exception 'ограничение тарифа требует tenant_id' using errcode = '22023';
  end if;

  v_plan := public.tenant_effective_plan(new.tenant_id);

  -- Календари: новый или возвращённый из архива — в пределах лимита.
  if tg_table_name = 'teams' then
    if not new.is_active then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.is_active then
      return new;
    end if;
    v_limit := public.tenant_tier_limit(new.tenant_id, 'teams');
    select count(*)::integer into v_count
      from public.teams tm
     where tm.tenant_id = new.tenant_id
       and tm.is_active
       and tm.id <> new.id;
    if v_count >= v_limit then
      raise exception '%', case v_plan
          when 'pro' then 'В пробном Про — до 5 календарей'
          else 'Новые календари — после оплаты'
        end
        using errcode = 'P0001', hint = 'plan:teams';
    end if;
    return new;
  end if;

  -- Партнёры: приглашение — в пределах лимита (люди и ждущие приглашения).
  if tg_table_name = 'invitations' then
    if new.accepted_at is not null or new.expires_at <= statement_timestamp() then
      return new;
    end if;
    -- Тот же человек ещё раз (повтор ссылки, другая команда) — не новый партнёр.
    if exists (
      select 1
        from public.invitations i
       where i.tenant_id = new.tenant_id
         and lower(i.email) = lower(new.email)
         and i.id is distinct from new.id
         and i.accepted_at is null
         and i.expires_at > statement_timestamp()
    ) then
      return new;
    end if;
    v_limit := public.tenant_tier_limit(new.tenant_id, 'partners');
    select count(*)::integer into v_count
      from (
        select m.user_id::text as who
          from public.tenant_members m
         where m.tenant_id = new.tenant_id
           and m.role <> 'owner'
        union
        select lower(i.email)
          from public.invitations i
         where i.tenant_id = new.tenant_id
           and i.accepted_at is null
           and i.expires_at > statement_timestamp()
      ) people;
    if v_count >= v_limit then
      raise exception '%', case v_plan
          when 'pro' then 'В пробном Про — до 5 партнёров'
          else 'Партнёры — после оплаты календарей'
        end
        using errcode = 'P0001', hint = 'plan:partners';
    end if;
    return new;
  end if;

  -- Команда сверх лимита — только для просмотра.
  -- `team_id` есть не у каждой таблицы этого сторожа (у инвойса команда —
  -- `brigade_id`): PL/pgSQL разбирает выражение целиком до проверки имени
  -- таблицы, и `new.team_id` ронял любую вставку инвойса (аудит 03.10).
  if tg_table_name in ('appointments', 'clients')
     and (to_jsonb(new) ->> 'team_id') is not null
     and not public.team_is_working(new.tenant_id, to_jsonb(new) ->> 'team_id') then
    raise exception 'Эта команда сверх тарифа — только для просмотра'
      using errcode = 'P0001', hint = 'plan:team-frozen';
  end if;

  if v_plan is distinct from 'free' then
    return new;
  end if;

  if tg_table_name = 'appointments' then
    if new.kind = 'work' then
      raise exception 'Записывать клиентов можно после оплаты календаря'
        using errcode = 'P0001', hint = 'plan:book-clients';
    end if;
    return new;
  end if;

  if tg_table_name = 'clients' then
    raise exception 'Клиенты — после оплаты календаря'
      using errcode = 'P0001', hint = 'plan:clients';
  end if;

  if tg_table_name = 'services' then
    raise exception 'Услуги доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:services';
  end if;

  if tg_table_name = 'masters' then
    raise exception 'Мастера доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:masters';
  end if;

  if tg_table_name = 'invoices' then
    -- Сторно уже выписанного инвойса своей компании проходит на любом тарифе.
    if new.kind = 'credit_note' and exists (
      select 1
        from public.invoices original
       where original.id = new.credit_note_of_id
         and original.tenant_id = new.tenant_id
         and original.kind = 'invoice'
    ) then
      return new;
    end if;
    -- И возврат по чеку: нота к чеку своей компании — то же сторно.
    if new.kind = 'credit_note' and exists (
      select 1
        from public.receipts source
       where source.id = new.credit_note_of_receipt_id
         and source.tenant_id = new.tenant_id
    ) then
      return new;
    end if;
    raise exception 'Документы доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:documents';
  end if;

  if tg_table_name = 'receipts' then
    raise exception 'Документы доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:documents';
  end if;

  return new;
end;
$function$;

-- ======================================================================
-- 10. СТОРНИРОВАННАЯ СУММА ИНВОЙСА — ТОЛЬКО ИЗ КРЕДИТ-НОТЫ
-- ======================================================================
-- `credited_amount` и `credit_partial` сдвигают остаток к оплате, статус и
-- налог. Писать их умеют две функции кредит-нот (определитель `postgres`);
-- прямая правка приложением (роль `authenticated`) — подмена остатка.
create or replace function public.guard_invoice_credit_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if (tg_op = 'INSERT' and (new.credited_amount <> 0 or new.credit_partial))
     or (tg_op = 'UPDATE' and (
       new.credited_amount is distinct from old.credited_amount
       or new.credit_partial is distinct from old.credit_partial
     )) then
    raise exception 'Сторнированная сумма меняется только кредит-нотой'
      using errcode = '42501', hint = 'block:finance.documents';
  end if;
  return new;
end;
$function$;
revoke all on function public.guard_invoice_credit_columns() from public, anon, authenticated;

drop trigger if exists trg_guard_invoice_credit_columns on public.invoices;
create trigger trg_guard_invoice_credit_columns
  before insert or update on public.invoices
  for each row execute function public.guard_invoice_credit_columns();

-- ======================================================================
-- 11. ВОЗВРАТ ПО КРЕДИТ-НОТЕ — С ВЫБРАННОГО ПЛАТЕЖА
-- ======================================================================
-- Прежде возврат шёл с самых новых платежей, а клиент нажимал «Вернуть» на
-- конкретном. Параметр необязательный: выпущенные сборки зовут функцию без
-- него. Перегрузка с новым параметром рядом со старой сделала бы вызов с
-- именованными аргументами неоднозначным, поэтому старые подписи снимаются.
drop function if exists public._refund_invoice_money(public.invoices, numeric, date, text);

CREATE OR REPLACE FUNCTION public._refund_invoice_money(p_invoice invoices, p_amount numeric, p_on date, p_note text, p_payment_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  income_row public.finance_transactions%rowtype;
  to_refund numeric(12,2) := round(coalesce(p_amount, 0), 2);
  refundable numeric(12,2);
  step numeric(12,2);
begin
  -- Платёж, с которого человек нажал «Вернуть», обязан быть платежом этого
  -- инвойса; возврат идёт с него первым, остаток — прежним правилом.
  if p_payment_id is not null and not exists (
    select 1 from public.finance_transactions tx
     where tx.id = p_payment_id
       and tx.tenant_id = p_invoice.tenant_id
       and tx.invoice_id = p_invoice.id
       and tx.type = 'income'
  ) then
    raise exception 'Платёж не относится к этому инвойсу';
  end if;
  while to_refund > 0 loop
    select tx.* into income_row
      from public.finance_transactions tx
     where tx.tenant_id = p_invoice.tenant_id
       and tx.invoice_id = p_invoice.id
       and tx.type = 'income'
       and greatest(tx.amount, 0) > coalesce((
         select sum(abs(r.amount)) from public.finance_transactions r
          where r.refund_of_id = tx.id and r.type = 'refund'
       ), 0)
     order by (tx.id is not distinct from p_payment_id) desc, tx.created_at desc
     limit 1
     for update;
    if not found then
      raise exception 'Не нашлось платежа инвойса для возврата';
    end if;
    if income_row.source = 'auto' or income_row.appointment_payment_kind is not null then
      raise exception 'Деньги по записи возвращаются в самой записи';
    end if;
    select greatest(income_row.amount, 0) - coalesce(sum(abs(r.amount)), 0)
      into refundable
      from public.finance_transactions r
     where r.refund_of_id = income_row.id and r.type = 'refund';
    step := least(to_refund, refundable);
    insert into public.finance_transactions (
      tenant_id, type, amount, currency, category_id, account_id,
      appointment_id, client_id, team_id, master_id, payment_method, notes,
      occurred_on, invoice_id, refund_of_id, source, created_by
    ) values (
      p_invoice.tenant_id, 'refund', -step, income_row.currency, income_row.category_id,
      income_row.account_id, income_row.appointment_id, income_row.client_id,
      income_row.team_id, income_row.master_id, income_row.payment_method,
      p_note,
      greatest(p_on, income_row.occurred_on),
      p_invoice.id, income_row.id, 'manual', auth.uid()
    );
    to_refund := to_refund - step;
  end loop;
end;
$function$;

revoke all on function public._refund_invoice_money(public.invoices, numeric, date, text, uuid) from public, anon, authenticated;

drop function if exists public.issue_partial_credit_note(uuid, uuid, numeric, text, text);

CREATE OR REPLACE FUNCTION public.issue_partial_credit_note(p_invoice_id uuid, p_request_id uuid, p_amount numeric, p_reason text DEFAULT NULL::text, p_language text DEFAULT 'en'::text, p_payment_id uuid DEFAULT NULL::uuid)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  invoice_row public.invoices%rowtype;
  note_row public.invoices%rowtype;
  amount_value numeric(12,2);
  effective numeric(12,2);
  income_total numeric(12,2);
  refunds_total numeric(12,2);
  paid_total numeric(12,2);
  to_refund numeric(12,2);
  note_vat numeric(12,2);
  business_date date;
  note_year integer;
  note_seq integer;
  note_number text;
  note_id uuid;
  full_cancel boolean;
  reason_text text := nullif(btrim(p_reason), '');
  language_value text := coalesce(nullif(btrim(p_language), ''), 'en');
begin
  if tenant_uuid is null or not public._documents_write_invoice(p_invoice_id) then
    raise exception 'Нужно право «Документы: Выставляет» в команде документа'
      using errcode = '42501', hint = 'access:owner_only';
  end if;
  if p_request_id is null then
    raise exception 'Не указан идентификатор кредит-ноты';
  end if;

  select * into invoice_row
    from public.invoices
   where id = p_invoice_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Инвойс не найден';
  end if;

  select * into note_row from public.invoices where id = p_request_id and tenant_id = tenant_uuid;
  if found then
    return note_row;
  end if;

  if invoice_row.kind <> 'invoice' then
    raise exception 'Кредит-нота не сторнируется — она сама является сторно';
  end if;
  if invoice_row.status not in ('issued', 'paid') then
    raise exception 'Инвойс уже отменён — сторнировать нечего';
  end if;

  amount_value := round(p_amount, 2);
  if amount_value is null or amount_value = 'NaN'::numeric or amount_value <= 0 then
    raise exception 'Сумма кредит-ноты должна быть больше нуля';
  end if;
  if amount_value is distinct from p_amount then
    raise exception 'Укажите не больше двух знаков после запятой';
  end if;
  effective := invoice_row.total - invoice_row.credited_amount;
  if amount_value > effective then
    raise exception 'Больше суммы инвойса сторнировать нельзя: % %', effective, invoice_row.currency;
  end if;
  full_cancel := amount_value = effective;

  select
    coalesce(sum(case when tx.type = 'income' then greatest(tx.amount, 0) else 0 end), 0),
    coalesce(sum(case when tx.type = 'refund' then abs(tx.amount) else 0 end), 0)
    into income_total, refunds_total
    from public.finance_transactions tx
   where tx.tenant_id = tenant_uuid
     and tx.invoice_id = invoice_row.id
     and tx.type in ('income', 'refund');
  paid_total := greatest(0, income_total - refunds_total);
  to_refund := greatest(0, paid_total - (effective - amount_value));
  business_date := public.tenant_business_date(tenant_uuid);

  if full_cancel then
    perform public._refund_invoice_money(invoice_row, to_refund, business_date, 'Возврат по отмене инвойса ' || invoice_row.number, p_payment_id);
    note_id := public._issue_credit_note(invoice_row.id, reason_text);
    update public.invoices set status = 'cancelled', updated_at = now() where id = invoice_row.id;
    update public.invoices
       set language = case when language_value in ('ru', 'en', 'bg', 'el', 'uk', 'de', 'es') then language_value else language end
     where id = note_id and language is distinct from language_value;
    select * into note_row from public.invoices where id = note_id;
    return note_row;
  end if;

  note_year := extract(year from business_date)::integer;
  select numbering.seq, numbering.number
    into note_seq, note_number
    from public.next_document_number(
      tenant_uuid, invoice_row.company_id, 'credit_note', note_year
    ) as numbering;
  note_vat := case
    when coalesce(invoice_row.vat_amount, 0) > 0 and invoice_row.total > 0
      then round(invoice_row.vat_amount * amount_value / invoice_row.total, 2)
    else 0
  end;

  insert into public.invoices (
    id, tenant_id, number, year, seq, issued_on, client_id, appointment_id,
    brigade_id, subtotal_net, vat_percent, vat_amount, total, currency,
    status, kind, credit_note_of_id, credit_partial, notes, created_by,
    language, vat_mode, seller_snapshot, client_snapshot
  ) values (
    p_request_id, tenant_uuid, note_number, note_year, note_seq, business_date,
    invoice_row.client_id, invoice_row.appointment_id, invoice_row.brigade_id,
    -(amount_value - note_vat), invoice_row.vat_percent, -note_vat,
    -amount_value, invoice_row.currency, 'issued', 'credit_note',
    invoice_row.id, true,
    coalesce(reason_text, 'Частичная отмена инвойса ' || invoice_row.number),
    auth.uid(),
    case when language_value in ('ru', 'en', 'bg', 'el', 'uk', 'de', 'es')
      then language_value else 'en' end,
    invoice_row.vat_mode,
    invoice_row.seller_snapshot,
    invoice_row.client_snapshot
  )
  returning * into note_row;

  update public.invoices
     set credited_amount = credited_amount + amount_value
   where id = invoice_row.id;

  perform public._refund_invoice_money(invoice_row, to_refund, business_date, 'Возврат по кредит-ноте ' || note_number, p_payment_id);

  select greatest(0,
           coalesce(sum(case when tx.type = 'income' then greatest(tx.amount, 0) else 0 end), 0)
         - coalesce(sum(case when tx.type = 'refund' then abs(tx.amount) else 0 end), 0))
    into paid_total
    from public.finance_transactions tx
   where tx.tenant_id = tenant_uuid
     and tx.invoice_id = invoice_row.id
     and tx.type in ('income', 'refund');
  update public.invoices
     set status = case
       when paid_total >= total - credited_amount then 'paid'
       else 'issued'
     end
   where id = invoice_row.id
     and status is distinct from case
       when paid_total >= total - credited_amount then 'paid'
       else 'issued'
     end;

  return note_row;
end;
$function$;

revoke all on function public.issue_partial_credit_note(uuid, uuid, numeric, text, text, uuid) from public, anon;
grant execute on function public.issue_partial_credit_note(uuid, uuid, numeric, text, text, uuid) to authenticated;

-- ======================================================================
-- СТОРОЖ
-- ======================================================================
do $guard$
declare
  def text;
  bad integer;
begin
  -- 1. Номера клиента — ни в построителе, ни в сохранённых снимках.
  def := pg_get_functiondef('public.build_invoice_client_snapshot(uuid, uuid)'::regprocedure);
  if def ~ 'phone' or def ~ 'whatsapp' then
    raise exception 'миграция: снимок клиента снова кладёт номера';
  end if;
  select (select count(*) from public.invoices
           where client_snapshot ?| array['phone', 'phone_e164', 'whatsapp_phone'])
       + (select count(*) from public.receipts
           where client_snapshot ?| array['phone', 'phone_e164', 'whatsapp_phone'])
    into bad;
  if bad > 0 then
    raise exception 'миграция: в снимках документов остались номера (%)', bad;
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.invoices'::regclass and tgname = 'trg_strip_snapshot_contacts' and tgenabled = 'O')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.receipts'::regclass and tgname = 'trg_strip_snapshot_contacts' and tgenabled = 'O') then
    raise exception 'миграция: нет сторожа номеров в снимках';
  end if;
  -- Чистка выключала пользовательские триггеры: все должны быть включены.
  if exists (
    select 1 from pg_trigger
     where tgrelid in ('public.invoices'::regclass, 'public.receipts'::regclass)
       and not tgisinternal and tgenabled <> 'O'
  ) then
    raise exception 'миграция: после чистки снимков остался выключенный триггер';
  end if;

  -- 2, 7, 8. Правка черновика и выпуск.
  def := pg_get_functiondef('public.update_invoice_draft(uuid, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, date, text, text)'::regprocedure);
  if def not like '%access_client_ids_in%' or def not like '%_assert_invoice_wait_account%'
     or def not like '%tenant_business_date%' or def not like '%vat_number%'
     or def not like '%credited_amount > 0%' then
    raise exception 'миграция: правка черновика потеряла проверки выпуска';
  end if;
  def := pg_get_functiondef('public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text, text)'::regprocedure);
  if def not like '%tenant_business_date%' or def not like '%not acc.is_hidden%' then
    raise exception 'миграция: выпуск инвойса потерял проверку даты или скрытого счёта';
  end if;
  def := pg_get_functiondef('public.issue_receipt(uuid, jsonb, uuid, date, text, text)'::regprocedure);
  if def not like '%tenant_business_date%' then
    raise exception 'миграция: выпуск чека потерял проверку даты';
  end if;

  -- 3, 7. Оплата.
  def := pg_get_functiondef('public.record_invoice_payment(uuid, uuid, numeric, uuid, text, date, text)'::regprocedure);
  if def not like '%invoice_row.total - invoice_row.credited_amount) / invoice_row.total%'
     or def not like '%not is_hidden%' then
    raise exception 'миграция: оплата инвойса потеряла налог последней доли или скрытый счёт';
  end if;
  if pg_get_functiondef('public.validate_invoice_payment_insert()'::regprocedure) not like '%not is_hidden%' then
    raise exception 'миграция: сторож платежа потерял скрытый счёт';
  end if;

  -- 4, 5, 6, 10. Сторожа строк.
  if exists (select 1 from pg_trigger where tgrelid = 'public.finance_transactions'::regclass and tgname = 'trg_sync_receipt_with_income') then
    raise exception 'миграция: чек снова следует за правкой дохода';
  end if;
  for def in
    select unnest(array[
      'trg_guard_income_with_issued_receipt',
      'trg_fill_transaction_vat_sane',
      'trg_guard_refund_delete_with_credit_note'
    ])
  loop
    if not exists (select 1 from pg_trigger where tgrelid = 'public.finance_transactions'::regclass and tgname = def and tgenabled = 'O') then
      raise exception 'миграция: нет сторожа % у операций', def;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.invoices'::regclass and tgname = 'trg_guard_invoice_credit_columns' and tgenabled = 'O') then
    raise exception 'миграция: нет сторожа сторнированной суммы';
  end if;
  if pg_get_functiondef('public.delete_credit_note(uuid)'::regprocedure) like '%tx.created_at = note.created_at%'
     and pg_get_functiondef('public.delete_credit_note(uuid)'::regprocedure) not like '%receipt_refunded%' then
    raise exception 'миграция: нота к чеку снова определяется по времени';
  end if;

  if pg_get_functiondef('public.void_receipt_on_income_delete()'::regprocedure) not like '%public.tenants%'
     or pg_get_functiondef('public.void_receipt_on_refund()'::regprocedure) not like '%public.tenants%' then
    raise exception 'миграция: гасящие чек триггеры снова ломают каскад компании';
  end if;

  -- 9. Тариф.
  if pg_get_functiondef('public.enforce_plan_limits()'::regprocedure) not like '%credit_note_of_receipt_id%' then
    raise exception 'миграция: нота к чеку снова упирается в тариф';
  end if;

  -- 11. Одна подпись у кредит-ноты и у возврата, права как прежде.
  if (select count(*) from pg_proc where proname = 'issue_partial_credit_note' and pronamespace = 'public'::regnamespace) <> 1
     or (select count(*) from pg_proc where proname = '_refund_invoice_money' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'миграция: у кредит-ноты или возврата осталась лишняя перегрузка';
  end if;
  if not has_function_privilege('authenticated', 'public.issue_partial_credit_note(uuid, uuid, numeric, text, text, uuid)', 'execute')
     or has_function_privilege('anon', 'public.issue_partial_credit_note(uuid, uuid, numeric, text, text, uuid)', 'execute') then
    raise exception 'миграция: права кредит-ноты разошлись с прежними';
  end if;

  -- Новые служебные функции приложению не видны.
  for def in
    select unnest(array[
      'public._assert_invoice_wait_account(uuid, uuid, text, boolean)',
      'public.strip_snapshot_contact_keys()',
      'public.guard_income_with_issued_receipt()',
      'public.assert_transaction_vat_sane()',
      'public.guard_refund_delete_with_credit_note()',
      'public.guard_invoice_credit_columns()',
      'public._refund_invoice_money(public.invoices, numeric, date, text, uuid)'
    ])
  loop
    if has_function_privilege('anon', def::regprocedure, 'execute')
       or has_function_privilege('authenticated', def::regprocedure, 'execute') then
      raise exception 'миграция: служебная функция % открыта приложению', def;
    end if;
  end loop;
end
$guard$;
