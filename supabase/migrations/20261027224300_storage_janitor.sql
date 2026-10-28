-- УБОРЩИК STORAGE: ночной снос файлов, на которые ничто не ссылается.
--
-- Строки уходят из базы каскадами и ночными очистками (`purge_deleted_
-- appointments`, `purge_deleted_operations`, `purge_expired_clients`,
-- `delete_calendar`, удаление аккаунта), а блобы остаются: SQL их стереть не
-- может (`storage.protect_delete()`), а у крона нет телефона, который позвал
-- бы `remove()`. Фото объектов клиентов жили вечно, файлы стёртого клиента
-- становились недостижимы (политики бакета требуют живого клиента).
--
-- Делёж работы:
--   • эта функция РЕШАЕТ, что сносить, — только она видит `storage.objects`
--     рядом со всеми ссылками;
--   • edge-функция `storage-janitor` СНОСИТ через Storage API сервисным
--     ключом (мимо политик) и зовёт функцию снова, пока есть кандидаты.
--
-- Правила, по бакету (первая часть пути — id компании):
--   tenant_gone   — компании нет: любой файл любого из пяти бакетов, сразу;
--   unreferenced  — компания жива, а на файл не ссылается ни одна строка и ни
--                   один снимок в ящиках «Удалённые …», и файлу больше
--                   p_min_age. Возраст нужен, потому что приложение сначала
--                   заливает файл, а строку пишет следом (фото записи, файл
--                   клиента, чек открытой операции).
--   Ссылки: appointment-photos — `appointment_photos.storage_path` и фото в
--   снимке `deleted_appointments.dependents->'photos'`; client-attachments —
--   `client_attachments.storage_path`; partner-files —
--   `partner_files.storage_path`; receipts — `receipt_url` операций, долгов,
--   дней и снимков `deleted_operations`; tenant-logos — `logo_url` компании и
--   реквизитов плюс снимки продавца в выставленных инвойсах и чеках (логотип
--   напечатан в документе).
--
-- ПОРЯДОК НАКАТА: сперва выложить edge-функцию `storage-janitor`, потом эту
-- миграцию (она ставит крон, который зовёт функцию). Наоборот — крон ночью
-- получит 404, вреда нет, но и уборки нет.

create or replace function public.storage_janitor_candidates(
  p_limit integer default 500,
  p_min_age interval default interval '2 days'
)
returns table (bucket_id text, name text, reason text)
language sql
stable
security definer
set search_path = public, storage
as $function$
  with objects as (
    select o.bucket_id::text as bucket_id,
           o.name::text as name,
           o.created_at,
           split_part(o.name, '/', 1) as prefix
      from storage.objects o
     where o.bucket_id in (
       'appointment-photos', 'client-attachments', 'partner-files',
       'receipts', 'tenant-logos'
     )
  ), classified as (
    select ob.bucket_id,
           ob.name,
           case
             when ob.prefix !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then null
             when not exists (
               select 1 from public.tenants t where t.id::text = ob.prefix
             ) then 'tenant_gone'
             when ob.created_at > now() - p_min_age then null
             when ob.bucket_id = 'appointment-photos' and not exists (
               select 1 from public.appointment_photos p
                where p.storage_path = ob.name
             ) and not exists (
               select 1
                 from public.deleted_appointments d,
                      jsonb_array_elements(coalesce(d.dependents -> 'photos', '[]'::jsonb)) ph
                where ph ->> 'storage_path' = ob.name
             ) then 'unreferenced'
             when ob.bucket_id = 'client-attachments' and not exists (
               select 1 from public.client_attachments a
                where a.storage_path = ob.name
             ) then 'unreferenced'
             when ob.bucket_id = 'partner-files' and not exists (
               select 1 from public.partner_files f
                where f.storage_path = ob.name
             ) then 'unreferenced'
             when ob.bucket_id = 'receipts'
               and not exists (select 1 from public.finance_transactions x where strpos(x.receipt_url, ob.name) > 0)
               and not exists (select 1 from public.debts x where strpos(x.receipt_url, ob.name) > 0)
               and not exists (select 1 from public.day_extras x where strpos(x.receipt_url, ob.name) > 0)
               and not exists (
                 select 1 from public.deleted_operations x
                  where strpos(x.operation ->> 'receipt_url', ob.name) > 0
               )
               then 'unreferenced'
             when ob.bucket_id = 'tenant-logos'
               and not exists (select 1 from public.tenants x where strpos(x.logo_url, ob.name) > 0)
               and not exists (select 1 from public.legal_entities x where strpos(x.logo_url, ob.name) > 0)
               and not exists (select 1 from public.invoices x where strpos(x.seller_snapshot::text, ob.name) > 0)
               and not exists (select 1 from public.receipts x where strpos(x.seller_snapshot::text, ob.name) > 0)
               then 'unreferenced'
             else null
           end as reason
      from objects ob
  )
  select c.bucket_id, c.name, c.reason
    from classified c
   where c.reason is not null
   order by c.bucket_id, c.name
   limit greatest(1, least(coalesce(p_limit, 500), 1000));
$function$;

comment on function public.storage_janitor_candidates(integer, interval) is
  'Файлы Storage без компании или без ссылки (старше p_min_age) — кандидаты на снос edge-функцией storage-janitor. Только service_role.';

revoke all on function public.storage_janitor_candidates(integer, interval)
  from public, anon, authenticated;
grant execute on function public.storage_janitor_candidates(integer, interval)
  to service_role;

insert into public.edge_cron_secrets (name, secret)
values ('storage-janitor', encode(gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

-- После ночных очисток (03:17–03:57): строки уже ушли, их файлы — кандидаты.
select cron.unschedule(jobid) from cron.job where jobname = 'storage-janitor';
select cron.schedule(
  'storage-janitor',
  '23 5 * * *',
  $cron$
    select net.http_post(
      url     := 'https://rdtokosbqvgemicqeqwz.supabase.co/functions/v1/storage-janitor',
      body    := '{"mode":"run"}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cleanup-secret', (
          select secret
            from public.edge_cron_secrets
           where name = 'storage-janitor'
        )
      )
    );
  $cron$
);

-- Сторож: функция закрыта от людей, крон стоит.
do $guard$
begin
  if has_function_privilege('authenticated', 'public.storage_janitor_candidates(integer, interval)', 'execute')
     or has_function_privilege('anon', 'public.storage_janitor_candidates(integer, interval)', 'execute') then
    raise exception 'storage janitor: candidates must be service-only';
  end if;
  if not exists (select 1 from cron.job where jobname = 'storage-janitor') then
    raise exception 'storage janitor: cron job is missing';
  end if;
end;
$guard$;
