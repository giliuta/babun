-- ЗАКРЫТЬ ТРИ ДВЕРИ SECURITY DEFINER, ОТКРЫТЫЕ ЛЮБОМУ ВОШЕДШЕМУ (аудит 23.09,
-- STORY-087: перед приглашением живых сотрудников).
--
-- 1. `add_platform_admin(text)` — бутстрап администратора платформы без единой
--    проверки. Исполнение у `authenticated` осталось с мая: любой вошедший
--    (мастер, чужой владелец) делал себя администратором платформы и читал
--    все компании через `admin_*`.
-- 2. Снимки получателя инвойса — `build_invoice_client_snapshot_for`,
--    `build_invoice_client_snapshot_with_object`, `invoice_object_snapshot`.
--    Компания приходит аргументом и ни с чем не сверяется: зная два uuid,
--    любой вошедший читал имя, телефон, адрес, VAT и объект клиента ЧУЖОЙ
--    компании. Звать их напрямую приложению незачем — их зовут только
--    определители (`issue_invoice`, триггер `capture_invoice_document_
--    snapshots`), а тем исполнение у вызывающего не нужно.
-- 3. `tenant_quota_summary(uuid)` — счётчики любой компании по её id.
--    Ни приложение, ни функции базы её не зовут.
--
-- Отзывается только исполнение: тела, владельцы и вызовы изнутри
-- определителей не меняются.

revoke execute on function public.add_platform_admin(text) from public, anon, authenticated;
revoke execute on function public.build_invoice_client_snapshot_for(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.build_invoice_client_snapshot_with_object(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.invoice_object_snapshot(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.tenant_quota_summary(uuid) from public, anon, authenticated;

-- ─── Сторож ──────────────────────────────────────────────────────────────
do $audit$
declare
  fn text;
begin
  foreach fn in array array[
    'public.add_platform_admin(text)',
    'public.build_invoice_client_snapshot_for(uuid, uuid, text)',
    'public.build_invoice_client_snapshot_with_object(uuid, uuid, text)',
    'public.invoice_object_snapshot(uuid, uuid, text)',
    'public.tenant_quota_summary(uuid)'
  ] loop
    if has_function_privilege('anon', fn, 'execute')
       or has_function_privilege('authenticated', fn, 'execute') then
      raise exception '% is still callable by anon/authenticated', fn;
    end if;
  end loop;
  -- Снимки зовёт только триггер `capture_invoice_document_snapshots` — он
  -- определитель, отзыв его не трогает. Функция, что работает с правами
  -- вызывающего и зовёт снимок, после отзыва упала бы — такой быть не должно
  -- (`issue_invoice` — вызывающий, но снимки сама не зовёт: их пишет триггер).
  if exists (
    select 1 from pg_proc
     where pronamespace = 'public'::regnamespace
       and not prosecdef
       and (prosrc ilike '%build_invoice_client_snapshot%'
            or prosrc ilike '%invoice_object_snapshot%'
            or prosrc ilike '%tenant_quota_summary%'
            or prosrc ilike '%add_platform_admin%')
       and proname not in ('build_invoice_client_snapshot_for',
                           'build_invoice_client_snapshot_with_object',
                           'invoice_object_snapshot',
                           'tenant_quota_summary',
                           'add_platform_admin')
  ) then
    raise exception 'an invoker function still calls a revoked helper';
  end if;
  if not exists (
    select 1 from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname = 'capture_invoice_document_snapshots'
       and prosecdef
  ) then
    raise exception 'capture_invoice_document_snapshots must stay SECURITY DEFINER';
  end if;
end
$audit$;
