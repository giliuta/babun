-- «ИСТОРИЯ ИЗМЕНЕНИЙ» ПАРТНЁРА — БЕЗ ПОЛЕЙ СКРЫТЫХ ОТ НЕГО БЛОКОВ.
--
-- Политика `change_log_select_partner` открывала партнёру строку журнала по
-- праву раздела («Записи клиентов», «Клиенты» …) и отдавала её целиком: в
-- `changes` лежали телефон, заметка, сумма, адрес, а в `label` записи — имя
-- клиента, даже когда блок «Клиент», «Заметка», «Сумма» или «Объект» у него
-- в этой команде скрыт. В самой записи и в карточке клиента те же поля ему
-- приходят пустыми (`list_master_appointments_safe`,
-- `client_masked_for_member`) — журнал был обходом.
--
-- Теперь журнал партнёра читается только функцией `list_change_log`:
--   • владелец — весь журнал аккаунта, как политика `change_log_select`;
--   • остальные — те же строки, что открывала политика партнёра (её условие
--     перенесено сюда без изменений), а прямое чтение таблицы им закрыто;
--   • диспетчеру строки отдаются как есть, партнёру (`master`) поля закрытых
--     в команде строки блоков вырезаются (`change_log_partner_view`).
--
-- Карта «поле → блок» — та же, что у записи и карточки клиента:
--   записи (у события — блоки события):
--     client_id                          — «Клиент в записи» / «Клиент события»
--     location_id, address*              — «Объект в записи» / «Объект события»
--     comment                            — «Заметка записи» / «Тип события»
--     event_notes, event_url             — «Заметка события»
--     city                               — «Метка дня» и «Метка записи» / «Метка события»
--     service_ids, services              — «Услуги в записи»
--     total_amount, скидки, цены, VAT    — «Сумма и услуги записи»
--     paid_amount, prepaid_amount        — «Оплата» и «Сумма»
--     payment_status                     — «Оплата в записи»
--     payment*, prepayments, expenses,
--     material_lines                     — никогда (их нет и в записи партнёра)
--   клиенты: контакты — «Клиент», заметки — «Заметка», связи — «Люди»,
--     объекты и адрес — «Объекты», метка — «Метка», тег — «Тег», личное —
--     «Личное», реквизиты — «Реквизиты», баланс и скидка — «История».
--   Поле, которого нет в карте, партнёру не отдаётся: новая колонка
--   остаётся скрытой, пока её не внесли сюда.
--
-- Подпись записи (`label`) — имя клиента ИЛИ заметка записи, и по строке
-- журнала не понять, что именно. Поэтому партнёр видит её, только когда
-- открыты оба блока: и «Клиент», и «Заметка» (у события — «Клиент события»
-- и «Тип события»). Иначе подпись пустая — приложение показывает строку без
-- имени.

set local lock_timeout = '5s';

-- ─── 1. Что из строки журнала видно партнёру ───

-- Чистая функция: строка журнала и список блоков, открытых партнёру в
-- команде строки, → подпись и изменения, которые ему можно показать.
create function public.change_log_partner_view(
  p_entity text,
  p_meta jsonb,
  p_label text,
  p_changes jsonb,
  p_open jsonb
)
returns jsonb
language sql
immutable
set search_path = public
as $function$
  with k as (
    select coalesce(p_meta ->> 'kind', 'work') <> 'work' as ev,
           coalesce(p_open, '[]'::jsonb) as o
  ),
  kept as (
    select key
      from k,
           jsonb_object_keys(
             case when jsonb_typeof(p_changes) = 'object' then p_changes else '{}'::jsonb end
           ) as key
     where case p_entity
       when 'appointments' then case
         when key in ('date', 'time_start', 'time_end', 'status', 'cancel_reason', 'kind',
                      'team_id', 'master_id', 'color_override', 'total_duration', 'source',
                      'is_online_booking', 'consent_given', 'reminder_enabled',
                      'reminder_offsets', 'reminder_template', 'event_all_day',
                      'event_push_enabled', 'event_push_offsets', 'event_push_at',
                      'event_repeat', 'created_by')
           then true
         when key = 'client_id'
           then k.o ? (case when k.ev then 'event.client' else 'record.client' end)
         when key in ('location_id', 'address', 'address_note', 'address_lat', 'address_lng')
           then k.o ? (case when k.ev then 'event.object' else 'record.object' end)
         when key = 'comment'
           then k.o ? (case when k.ev then 'event.type' else 'record.note' end)
         when key in ('event_notes', 'event_url')
           then k.ev and k.o ? 'event.note'
         when key = 'city'
           then k.o ? 'calendar.day_labels'
                and k.o ? (case when k.ev then 'event.label' else 'record.label' end)
         when key in ('service_ids', 'services')
           then k.ev or k.o ? 'record.services'
         when key in ('total_amount', 'custom_total', 'discount_amount',
                      'service_price_overrides', 'global_discount', 'vat_mode', 'vat_rate')
           then k.ev or k.o ? 'record.amount'
         when key in ('paid_amount', 'prepaid_amount')
           then k.ev or (k.o ? 'record.payment' and k.o ? 'record.amount')
         when key = 'payment_status'
           then k.ev or k.o ? 'record.payment'
         else false
       end
       when 'clients' then case
         when key in ('full_name', 'team_id', 'created_by', 'blacklisted', 'reminder_at',
                      'favorite_master_id', 'sms_opt_out', 'deleted_at')
           then true
         when key in ('phone', 'whatsapp_phone', 'email', 'telegram_username',
                      'instagram_username', 'phones', 'phone_e164', 'avatar_url')
           then k.o ? 'clients.client'
         when key = 'sms_name'
           then k.o ? 'clients.client' or k.o ? 'clients.sms'
         when key = 'memberships'
           then k.o ? 'clients.client' and k.o ? 'clients.people'
         when key in ('comment', 'notes')
           then k.o ? 'clients.note'
         when key in ('locations', 'equipment', 'address', 'property_type')
           then k.o ? 'clients.objects'
         when key in ('city', 'city_manual')
           then k.o ? 'clients.labels'
         when key = 'tag_ids'
           then k.o ? 'clients.tags'
         when key in ('birthday', 'language', 'acquisition_source', 'referred_by_client_id',
                      'first_contact_date')
           then k.o ? 'clients.personal'
         when key in ('legal_name', 'vat_number', 'reg_number', 'billing_address', 'requisites')
           then k.o ? 'clients.requisites'
         when key in ('balance', 'discount')
           then k.o ? 'clients.history'
         else false
       end
       else true
     end
  )
  select jsonb_build_object(
    'label',
    case
      when p_entity in ('appointments', 'appointment_photos')
           and not (
             (select k.o ? (case when k.ev then 'event.client' else 'record.client' end) from k)
             and (select k.o ? (case when k.ev then 'event.type' else 'record.note' end) from k)
           )
        then null
      else p_label
    end,
    'changes',
    case
      when p_entity in ('appointments', 'clients') and jsonb_typeof(p_changes) = 'object' then
        (select case when count(*) = 0 then null else jsonb_object_agg(kept.key, p_changes -> kept.key) end
           from kept)
      else p_changes
    end
  )
$function$;

revoke all on function public.change_log_partner_view(text, jsonb, text, jsonb, jsonb)
  from public, anon, authenticated;

-- ─── 2. Чтение журнала ───

create function public.list_change_log(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_before bigint default null,
  p_actor uuid default null,
  p_limit integer default 1000
)
returns table (
  id bigint,
  team_id text,
  actor_id uuid,
  actor_name text,
  entity text,
  entity_id text,
  action text,
  label text,
  meta jsonb,
  changes jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_role text := public.current_user_role();
  v_limit integer := greatest(1, least(coalesce(p_limit, 1000), 1000));
  v_mask boolean;
  v_open jsonb := '{}'::jsonb;
  v_key text;
  v_team text;
  -- Блоки, по которым режутся поля (см. карту в шапке миграции).
  v_mask_keys constant text[] := array[
    'record.client', 'record.object', 'record.note', 'record.label', 'record.services',
    'record.amount', 'record.payment', 'calendar.day_labels',
    'event.client', 'event.object', 'event.type', 'event.note', 'event.label',
    'clients.client', 'clients.sms', 'clients.people', 'clients.note', 'clients.objects',
    'clients.labels', 'clients.tags', 'clients.personal', 'clients.requisites',
    'clients.history'
  ];
begin
  if auth.uid() is null or v_tenant is null then
    return;
  end if;

  if v_role = 'owner' then
    return query
      select c.id, c.team_id, c.actor_id, c.actor_name, c.entity, c.entity_id, c.action,
             c.label, c.meta, c.changes, c.created_at
        from public.change_log c
       where c.tenant_id = v_tenant
         and (p_from is null or c.created_at >= p_from)
         and (p_to is null or c.created_at < p_to)
         and (p_before is null or c.id < p_before)
         and (p_actor is null or c.actor_id = p_actor)
       order by c.id desc
       limit v_limit;
    return;
  end if;

  if not public.access_company('cabinet.history', 'read') then
    return;
  end if;

  v_mask := v_role is distinct from 'dispatcher';
  if v_mask then
    foreach v_key in array v_mask_keys loop
      foreach v_team in array coalesce(public.access_calendars(v_key, 'read'), array[]::text[]) loop
        v_open := jsonb_set(
          v_open, array[v_team], coalesce(v_open -> v_team, '[]'::jsonb) || to_jsonb(v_key)
        );
      end loop;
    end loop;
  end if;

  return query
    select c.id, c.team_id, c.actor_id, c.actor_name, c.entity, c.entity_id, c.action,
           case when v_mask then v.shown ->> 'label' else c.label end,
           c.meta,
           case when v_mask then nullif(v.shown -> 'changes', 'null'::jsonb) else c.changes end,
           c.created_at
      from public.change_log c
     cross join lateral (
       select case when v_mask
                then public.change_log_partner_view(c.entity, c.meta, c.label, c.changes, v_open -> c.team_id)
              end as shown
     ) v
     where c.tenant_id = v_tenant
       and (p_from is null or c.created_at >= p_from)
       and (p_to is null or c.created_at < p_to)
       and (p_before is null or c.id < p_before)
       and (p_actor is null or c.actor_id = p_actor)
       -- Условие бывшей политики `change_log_select_partner` — без изменений.
       and c.team_id is not null
       and case c.entity
         when 'appointments' then (c.team_id in (select unnest(public.access_calendars('calendar.records', 'read'))))
         when 'appointment_photos' then (c.team_id in (select unnest(public.access_calendars('record.files', 'read'))))
         when 'day_cities' then (c.team_id in (select unnest(public.access_calendars('calendar.day_labels', 'read'))))
         when 'clients' then (c.team_id in (select unnest(public.access_calendars('clients', 'read'))))
         when 'client_attachments' then (c.team_id in (select unnest(public.access_calendars('clients.files', 'read'))))
         when 'client_tag_assignments' then (c.team_id in (select unnest(public.access_calendars('clients.tags', 'read'))))
         when 'client_tags' then (c.team_id in (select unnest(public.access_calendars('clients.settings_tags', 'read'))))
         when 'client_sources' then (c.team_id in (select unnest(public.access_calendars('clients.settings_sources', 'read'))))
         when 'finance_transactions' then (
           (c.meta ? 'account_id')
           and (((c.meta ->> 'account_id') is null)
                or ((c.meta ->> 'account_id') <> all (((select public.hidden_account_ids()))::text[])))
           and ((((c.meta ->> 'debt_id') is not null)
                 and (c.team_id in (select unnest(public.access_calendars('finance.debts', 'read')))))
             or (((c.meta ->> 'type') = any (array['income', 'refund']))
                 and (c.team_id in (select unnest(public.access_calendars('finance.income', 'read')))))
             or (((c.meta ->> 'type') = 'expense')
                 and (c.team_id in (select unnest(public.access_calendars('finance.expense', 'read')))))
             or (((c.meta ->> 'type') = 'transfer')
                 and (c.team_id in (select unnest(public.access_calendars('finance.accounts', 'read'))))))
           and (((c.meta ->> 'debt_id') is not null)
             or ((c.meta ->> 'type') <> all (array['income', 'refund', 'expense']))
             or (((select public.member_finance_window_starts()) ->> c.team_id) is null)
             or (((c.meta ->> 'date'))::date >= (((select public.member_finance_window_starts()) ->> c.team_id))::date))
         )
         when 'finance_categories' then (c.team_id in (select unnest(((public.access_calendars('finance.settings_categories_income', 'read') || public.access_calendars('finance.settings_categories_expense', 'read')) || public.access_calendars('finance.settings_categories_debts', 'read')))))
         when 'debts' then (c.team_id in (select unnest(public.access_calendars('finance.debts', 'read'))))
         when 'accounts' then ((c.team_id in (select unnest(public.access_calendars('finance.accounts', 'read'))))
                               and ((c.entity_id is null)
                                    or (c.entity_id <> all (((select public.hidden_account_ids()))::text[]))))
         when 'invoices' then (c.team_id in (select unnest(public.access_calendars('finance.documents', 'read'))))
         when 'receipts' then (c.team_id in (select unnest(public.access_calendars('finance.documents', 'read'))))
         when 'services' then (c.team_id in (select unnest(public.access_calendars('calendar.services', 'read'))))
         when 'cities' then (c.team_id in (select unnest(public.access_calendars('calendar.labels', 'read'))))
         when 'location_labels' then (c.team_id in (select unnest(public.access_calendars('calendar.labels', 'read'))))
         when 'team_schedules' then (c.team_id in (select unnest(public.access_calendars('calendar.schedule', 'read'))))
         when 'teams' then (c.team_id in (select unnest(public.access_calendars('calendar.identity', 'read'))))
         when 'calendar_settings' then (c.team_id in (select unnest(public.access_calendars('calendar.hours', 'read'))))
         when 'team_design' then (c.team_id in (select unnest(public.access_calendars('calendar.booking_form', 'read'))))
         when 'personal_event_types' then (c.team_id in (select unnest(public.access_calendars('calendar.booking_form', 'read'))))
         else false
       end
     order by c.id desc
     limit v_limit;
end;
$function$;

revoke all on function public.list_change_log(timestamptz, timestamptz, bigint, uuid, integer)
  from public, anon;
grant execute on function public.list_change_log(timestamptz, timestamptz, bigint, uuid, integer)
  to authenticated;

-- ─── 3. Прямое чтение — только владельцу ───

-- Иначе партнёр прочёл бы те же строки целиком мимо функции.
drop policy change_log_select_partner on public.change_log;

do $guard$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'change_log'
       and cmd in ('SELECT', 'ALL') and policyname <> 'change_log_select'
  ) then
    raise exception 'сторож: у change_log осталась политика чтения кроме владельца';
  end if;
  if has_function_privilege('anon', 'public.list_change_log(timestamptz, timestamptz, bigint, uuid, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.change_log_partner_view(text, jsonb, text, jsonb, jsonb)', 'execute') then
    raise exception 'сторож: функции журнала открыты не тем ролям';
  end if;
end
$guard$;
