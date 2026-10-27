-- «ОБЪЕДИНИТЬ С ДУБЛЕМ» — ОДНОЙ ТРАНЗАКЦИЕЙ, И ДУБЛЬ НЕ УНОСИТ НИЧЕГО С СОБОЙ.
--
-- Слияние шло с телефона пятью запросами без транзакции и переносило только
-- визиты. Всё прочее оставалось за дублем, а дубль уходил в «Удалённые
-- клиенты» и через 30 дней стирался `purge_expired_clients` — и с ним:
--   • файлы карточки (`client_attachments`, on delete cascade);
--   • долги (`debts.client_id` → null: долг пропадал из карточки);
--   • записи дубля, лежащие в «Удалённых записях» (возврат — без клиента);
--   • напоминания, SMS, оценки, запросы адреса.
-- Обрыв посреди пяти запросов оставлял полуслияние: патч основной лёг,
-- визиты — частью.
--
-- Теперь `merge_clients` делает всё одним вызовом: дописывает основную
-- карточку (тем же `update_client_with_tags`, что и обычная правка — те же
-- поля и проверки), переносит отказ от SMS, визиты (с переездом объекта),
-- снимки в «Удалённых записях», файлы, долги, напоминания, SMS, оценки,
-- запросы адреса и ссылки «Кто привёл», и кладёт дубль в «Удалённые
-- клиенты». Что-то не легло — не легло ничего.
--
-- Деньги и документы дубля (операции, инвойсы, чеки) НЕ переносятся: у
-- автоматических операций клиента не сменить, а инвойс выставлен на того,
-- кто в нём напечатан. Пока они есть, дубль из корзины не стирается
-- (`client_history_never_purges`) — история цела, просто живёт за ним.
--
-- ФАЙЛЫ КАРТОЧКИ. Путь файла — `<компания>/<клиент>/<файл>`, и политики
-- бакета `client-attachments` брали клиента из пути. После переноса строка
-- файла принадлежит основной карточке, а путь всё ещё называет дубля: после
-- стирания дубля файл стал бы недостижим. Блоб в Storage не переименовать из
-- SQL (ключ хранилища привязан к имени), поэтому политики берут клиента из
-- СТРОКИ файла (`client_attachment_owner`), а путь — только когда строки нет
-- (заливка до записи строки).
--
-- Право: «Объединить с дублем» — хозяйство своей базы, то есть владелец
-- (`caps.manage`); сервер проверяет то же.

-- ─── Клиент файла: по строке, путь — запасной ─────────────────────────────

create or replace function public.client_attachment_owner(p_name text)
returns uuid
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(
    (select a.client_id
       from public.client_attachments a
      where a.storage_path = p_name
      limit 1),
    public.try_uuid(split_part(p_name, '/', 2))
  );
$function$;

comment on function public.client_attachment_owner(text) is
  'Клиент файла бакета client-attachments: из строки client_attachments (файл мог переехать к другой карточке при слиянии), а без строки — из пути. Для политик Storage.';

revoke all on function public.client_attachment_owner(text) from public, anon;
grant execute on function public.client_attachment_owner(text) to authenticated;

-- СТРОКА ФАЙЛА НЕ ПЕРЕПИСЫВАЕТ ЧУЖОЙ ФАЙЛ. Раз политики Storage верят
-- строке, строке нельзя назвать чужой путь: партнёр с «Файлы: Меняет» у своего
-- клиента X вставил бы строку {client_id: X, storage_path: файл клиента Y} — и
-- читал бы и удалял файл Y. Поэтому:
--   • путь — один на строку (уникальный индекс);
--   • при вставке путь начинается с `<компания строки>/<клиент строки>/`;
--   • путь и компанию строки не правит никто, а клиента — только слияние
--     (`merge_clients` ставит флаг транзакции `babun.merge_clients`).
create unique index if not exists client_attachments_storage_path_key
  on public.client_attachments (storage_path);

create or replace function public.client_attachments_path_guard()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if tg_op = 'INSERT' then
    if split_part(new.storage_path, '/', 1) is distinct from new.tenant_id::text
       or split_part(new.storage_path, '/', 2) is distinct from new.client_id::text then
      raise exception 'attachment path must belong to its client'
        using errcode = '42501', hint = 'block:clients.files';
    end if;
    return new;
  end if;
  if new.storage_path is distinct from old.storage_path
     or new.tenant_id is distinct from old.tenant_id then
    raise exception 'attachment path cannot change'
      using errcode = '42501', hint = 'block:clients.files';
  end if;
  if new.client_id is distinct from old.client_id
     and coalesce(current_setting('babun.merge_clients', true), '') <> 'on' then
    raise exception 'attachment moves to another client only by merge'
      using errcode = '42501', hint = 'block:clients.files';
  end if;
  return new;
end;
$function$;

revoke all on function public.client_attachments_path_guard() from public, anon, authenticated;

drop trigger if exists client_attachments_path_guard on public.client_attachments;
create trigger client_attachments_path_guard
  before insert or update on public.client_attachments
  for each row execute function public.client_attachments_path_guard();

alter policy storage_client_attachments_select on storage.objects
  using ((bucket_id = 'client-attachments'::text) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])) AND ((storage.foldername(name))[1] = (( SELECT current_tenant_id() AS current_tenant_id))::text) AND current_user_can_access_client(public.client_attachment_owner(name)));

alter policy storage_client_attachments_delete on storage.objects
  using ((bucket_id = 'client-attachments'::text) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])) AND ((storage.foldername(name))[1] = (( SELECT current_tenant_id() AS current_tenant_id))::text) AND current_user_can_access_client(public.client_attachment_owner(name)));

alter policy storage_client_attachments_update on storage.objects
  using ((bucket_id = 'client-attachments'::text) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])) AND ((storage.foldername(name))[1] = (( SELECT current_tenant_id() AS current_tenant_id))::text) AND current_user_can_access_client(public.client_attachment_owner(name)))
  with check ((bucket_id = 'client-attachments'::text) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])) AND ((storage.foldername(name))[1] = (( SELECT current_tenant_id() AS current_tenant_id))::text) AND current_user_can_access_client(public.client_attachment_owner(name)));

alter policy storage_client_attachments_select_block on storage.objects
  using ((bucket_id = 'client-attachments'::text) AND ((storage.foldername(name))[1] = (( SELECT current_tenant_id() AS current_tenant_id))::text) AND (public.client_attachment_owner(name) IN ( SELECT unnest(access_block_client_ids('clients.files'::text, 'read'::text)) AS unnest)));

alter policy storage_client_attachments_delete_block on storage.objects
  using ((bucket_id = 'client-attachments'::text) AND ((storage.foldername(name))[1] = (( SELECT current_tenant_id() AS current_tenant_id))::text) AND (public.client_attachment_owner(name) IN ( SELECT unnest(access_block_client_ids('clients.files'::text, 'write'::text)) AS unnest)));

alter policy storage_client_attachments_update_block on storage.objects
  using ((bucket_id = 'client-attachments'::text) AND ((storage.foldername(name))[1] = (( SELECT current_tenant_id() AS current_tenant_id))::text) AND (public.client_attachment_owner(name) IN ( SELECT unnest(access_block_client_ids('clients.files'::text, 'write'::text)) AS unnest)))
  with check ((bucket_id = 'client-attachments'::text) AND ((storage.foldername(name))[1] = (( SELECT current_tenant_id() AS current_tenant_id))::text) AND (public.client_attachment_owner(name) IN ( SELECT unnest(access_block_client_ids('clients.files'::text, 'write'::text)) AS unnest)));

-- ─── Слияние ───────────────────────────────────────────────────────────────

create or replace function public.merge_clients(
  p_primary uuid,
  p_duplicate uuid,
  p_patch jsonb default '{}'::jsonb,
  p_tag_ids uuid[] default null,
  p_location_remap jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  active_tenant uuid := public.current_tenant_id();
  dup public.clients%rowtype;
  prim public.clients%rowtype;
  remap jsonb := coalesce(p_location_remap, '{}'::jsonb);
  moved_visits integer := 0;
  moved_trash integer := 0;
  moved_files integer := 0;
  moved_debts integer := 0;
  moved_other integer := 0;
  n integer;
  paid integer;
begin
  if auth.uid() is null or active_tenant is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'only the owner merges clients'
      using errcode = '42501', hint = 'block:clients';
  end if;
  if p_primary is null or p_duplicate is null or p_primary = p_duplicate then
    raise exception 'two different clients are required'
      using errcode = '22023';
  end if;
  if jsonb_typeof(remap) <> 'object' then
    raise exception 'location remap must be an object'
      using errcode = '22023';
  end if;

  -- Обе карточки — под замок в одном порядке: встречное слияние той же пары
  -- с другого телефона ждёт, а не сливает дважды.
  perform 1 from public.clients c
   where c.id in (p_primary, p_duplicate) and c.tenant_id = active_tenant
   order by c.id
   for update;
  select * into prim from public.clients where id = p_primary and tenant_id = active_tenant;
  select * into dup from public.clients where id = p_duplicate and tenant_id = active_tenant;
  if prim.id is null or dup.id is null
     or prim.deleted_at is not null or dup.deleted_at is not null then
    raise exception 'client not found'
      using errcode = 'P0002';
  end if;

  -- Визит с живыми деньгами клиента не меняет (`protect_paid_appointment_
  -- finance`); отказ — до первой записи, теми же признаками, что у телефона.
  select count(*) into paid
    from public.appointments a
   where a.tenant_id = active_tenant
     and a.client_id = p_duplicate
     and (a.payment_status in ('paid', 'partial')
          or coalesce(a.prepaid_amount, 0) > 0
          or coalesce(a.paid_amount, 0) > 0);
  if paid > 0 then
    raise exception 'duplicate has paid visits'
      using errcode = '55000', hint = 'merge:paid_visits';
  end if;

  -- 1. Основная карточка: те же поля и проверки, что у обычной правки.
  if coalesce(p_patch, '{}'::jsonb) <> '{}'::jsonb or p_tag_ids is not null then
    perform public.update_client_with_tags(active_tenant, p_primary, coalesce(p_patch, '{}'::jsonb), p_tag_ids);
  end if;
  if dup.sms_opt_out is true and prim.sms_opt_out is not true then
    perform public.set_client_sms_opt_out(p_primary, true);
  end if;

  -- 2. Визиты — с переездом на совпавший объект основной.
  update public.appointments a
     set client_id = p_primary,
         location_id = coalesce(remap ->> a.location_id, a.location_id)
   where a.tenant_id = active_tenant
     and a.client_id = p_duplicate;
  get diagnostics moved_visits = row_count;

  -- 3. Снимки в «Удалённых записях»: «Вернуть» ставит запись основной.
  update public.deleted_appointments d
     set appointment = jsonb_set(
           case
             when remap ? (d.appointment ->> 'location_id')
               then jsonb_set(d.appointment, '{location_id}', remap -> (d.appointment ->> 'location_id'))
             else d.appointment
           end,
           '{client_id}', to_jsonb(p_primary::text))
   where d.tenant_id = active_tenant
     and d.appointment ->> 'client_id' = p_duplicate::text;
  get diagnostics moved_trash = row_count;

  -- 4. Файлы карточки (путь не меняется — см. `client_attachment_owner`).
  --    Клиента строки файла меняет только слияние: флаг до конца транзакции
  --    (`client_attachments_path_guard`), снимается сразу после.
  perform set_config('babun.merge_clients', 'on', true);
  update public.client_attachments
     set client_id = p_primary
   where tenant_id = active_tenant and client_id = p_duplicate;
  get diagnostics moved_files = row_count;
  perform set_config('babun.merge_clients', '', true);

  -- 5. Долги.
  update public.debts
     set client_id = p_primary
   where tenant_id = active_tenant and client_id = p_duplicate;
  get diagnostics moved_debts = row_count;

  -- 6. Остальное, что держится за клиента.
  update public.recurring_reminders set client_id = p_primary
   where tenant_id = active_tenant and client_id = p_duplicate;
  get diagnostics n = row_count; moved_other := moved_other + n;
  update public.sms_messages set client_id = p_primary
   where tenant_id = active_tenant and client_id = p_duplicate;
  get diagnostics n = row_count; moved_other := moved_other + n;
  update public.master_ratings set client_id = p_primary
   where tenant_id = active_tenant and client_id = p_duplicate;
  get diagnostics n = row_count; moved_other := moved_other + n;
  update public.location_requests r
     set client_id = p_primary,
         location_id = case
           when (remap ->> r.location_id::text) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then (remap ->> r.location_id::text)::uuid
           else r.location_id
         end
   where r.tenant_id = active_tenant and r.client_id = p_duplicate;
  get diagnostics n = row_count; moved_other := moved_other + n;
  update public.clients set referred_by_client_id = p_primary
   where tenant_id = active_tenant
     and referred_by_client_id = p_duplicate
     and id <> p_primary;
  get diagnostics n = row_count; moved_other := moved_other + n;

  -- 7. Дубль — в «Удалённые клиенты». Визитов у него больше нет, поэтому
  --    срок 30 дней; оставшиеся деньги и документы срок снимут сами
  --    (`client_history_never_purges`).
  update public.clients
     set deleted_at = now(),
         purge_at = now() + interval '30 days'
   where id = p_duplicate and tenant_id = active_tenant;

  return jsonb_build_object(
    'visits', moved_visits,
    'deleted_visits', moved_trash,
    'files', moved_files,
    'debts', moved_debts,
    'other', moved_other
  );
end;
$function$;

comment on function public.merge_clients(uuid, uuid, jsonb, uuid[], jsonb) is
  '«Объединить с дублем»: правка основной (update_client_with_tags), визиты, «Удалённые записи», файлы, долги, напоминания, SMS, оценки, запросы адреса — к основной; дубль — в «Удалённые клиенты». Одна транзакция, только владелец.';

revoke all on function public.merge_clients(uuid, uuid, jsonb, uuid[], jsonb) from public, anon;
grant execute on function public.merge_clients(uuid, uuid, jsonb, uuid[], jsonb) to authenticated;

-- Сторож.
do $guard$
begin
  if has_function_privilege('anon', 'public.merge_clients(uuid, uuid, jsonb, uuid[], jsonb)', 'execute')
     or has_function_privilege('anon', 'public.client_attachment_owner(text)', 'execute') then
    raise exception 'merge clients: functions must not be anon-callable';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname like 'storage_client_attachments_%'
       and policyname not like '%_insert%'
       and policyname not like '%_record'
       and (coalesce(qual, '') like '%foldername(name))[2]%'
            or coalesce(with_check, '') like '%foldername(name))[2]%')
  ) then
    raise exception 'merge clients: a client-attachments policy still takes the client from the path';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'client_attachments_path_guard'
                    and tgrelid = 'public.client_attachments'::regclass)
     or not exists (select 1 from pg_indexes where schemaname = 'public'
                    and indexname = 'client_attachments_storage_path_key') then
    raise exception 'merge clients: attachment path guard is missing';
  end if;
end;
$guard$;
