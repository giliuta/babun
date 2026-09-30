-- ПРАВКА ЧЕРНОВИКА УМЕЕТ МЕНЯТЬ РЕКВИЗИТЫ И СЧЁТ.
--
-- Вчерашняя `20260921000000` дала инвойсу `company_id` и `account_id`, но
-- принимала их ТОЛЬКО `issue_invoice`. У выставленного (ещё не оплаченного)
-- счёта обе строки на экране пришлось сделать НЕнажимаемыми: живой контрол,
-- который ничего не сохраняет, хуже отсутствующего — человек увидел бы свой
-- выбор и поверил ему.
--
-- Эта миграция открывает ту же дверь на правке. Тело `update_invoice_draft`
-- ниже — ЖИВОЕ, снятое из базы перед правкой (`pg_proc.prosrc`), и изменено
-- ровно в трёх местах: два новых параметра, две новые колонки в `update` и
-- комментарий. Все прежние сторожа — роль владельца, «только неоплаченный»,
-- «с платежами нельзя», проверки позиций и ставки — на месте дословно.
--
-- ПРАВКА ЗАМЕНЯЕТ ЧЕРНОВИК ЦЕЛИКОМ, И ЭТО ЕЁ ПРЕЖНЕЕ ПОВЕДЕНИЕ: `client_id`,
-- `appointment_id`, `brigade_id`, `notes` она и раньше писала тем, что
-- прислали, без «не трогать, если не передали». Реквизиты и счёт живут по тому
-- же правилу. Последствие названо вслух: приложение СТАРОЙ сборки, которое
-- про эти два параметра не знает, при правке черновика обнулит выбранный счёт,
-- а реквизиты вернутся к основным (лестница `resolve_company_id` в триггере).
-- Номер, дата выставления и суммы при этом не страдают.

begin;

set local lock_timeout = '5s';

-- СНАЧАЛА `drop`: `create or replace` с новым параметром заводит ВТОРУЮ
-- функцию-перегрузку, а не заменяет прежнюю, и PostgREST потом выбирает одну
-- из двух по числу ключей в теле запроса — молча и не ту.
--
-- Умолчание у `p_notes` СОХРАНЕНО: снять `default` с существующего параметра
-- `create or replace` не умеет вовсе (42P13), а старые вызовы шлют восемь
-- аргументов.
drop function if exists public.update_invoice_draft(
  uuid, date, uuid, uuid, text, text, numeric, jsonb, text
);

create function public.update_invoice_draft(
  p_invoice_id uuid,
  p_due_on date,
  p_client_id uuid,
  p_appointment_id uuid,
  p_brigade_id text,
  p_vat_mode text,
  p_vat_percent numeric,
  p_lines jsonb,
  p_notes text default null,
  p_company_id uuid default null,
  p_account_id uuid default null
) returns public.invoices
language plpgsql
as $$
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
  old_line_count integer := 0;
  affected integer := 0;
  appointment_client_id uuid;
  appointment_team_id text;
  resolved_client_id uuid := p_client_id;
  resolved_brigade_id text := p_brigade_id;
  invoice_vat_mode text;
begin
  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Недостаточно прав для редактирования инвойса';
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

  if p_due_on is not null and p_due_on < invoice_row.issued_on then
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
    if unit_price_value is null or unit_price_value < 0 or unit_price_value > 999999999 then
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
  -- Режим документа — тот, которым он посчитан: при ставке 0 это «off».
  invoice_vat_mode := case when vat_rate > 0 then p_vat_mode else 'off' end;

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
         -- Чужой набор реквизитов отобьёт `resolve_company_id` в триггере, а
         -- чужой счёт — `assert_invoice_account`: здесь передаём ровно то, что
         -- выбрал человек, и снимок продавца пересобирается там же.
         company_id = p_company_id,
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
$$;

-- ДВЕРЬ НЕ ДЛЯ ГОСТЯ: права не переезжают на новое тело, их выдают заново.
revoke all on function public.update_invoice_draft(
  uuid, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid
) from public, anon;
grant execute on function public.update_invoice_draft(
  uuid, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid
) to authenticated;

commit;
