-- ПОМОЩНИК СЧЁТА ОПЛАТЫ — БЕЗ ПРЯМОГО ВЫЗОВА; ЧИСТЫМ ФУНКЦИЯМ — СВОЙ ПУТЬ
-- ПОИСКА (STORY-087, проверка Supabase 24.09).
--
-- 1. `resolve_appointment_payment_account(p_tenant_id, …)` — определитель,
--    компания приходит аргументом и ни с чем не сверяется, а исполнение
--    открыто и `anon`, и `authenticated`: без входа по чужому id компании
--    отдавался id её счёта. Зовёт её только определитель
--    `reconcile_appointment_finance` — ему исполнение у вызывающего не нужно.
-- 2. Четыре чистые функции без `search_path` (формат номера инвойса, числа и
--    строки чека, координата): данных не читают, но путь поиска закрепляем,
--    чтобы проверка базы молчала о настоящем.

revoke execute on function public.resolve_appointment_payment_account(uuid, text, text, uuid)
  from public, anon, authenticated;

alter function public.format_invoice_number(text, integer, integer, integer, boolean) set search_path = public;
alter function public._receipt_num(text) set search_path = public;
alter function public._receipt_lines_snapshot(jsonb) set search_path = public;
alter function public.location_request_coord(numeric) set search_path = public;

-- ─── Сторож ──────────────────────────────────────────────────────────────
do $audit$
begin
  if has_function_privilege('anon', 'public.resolve_appointment_payment_account(uuid, text, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.resolve_appointment_payment_account(uuid, text, text, uuid)', 'execute') then
    raise exception 'resolve_appointment_payment_account is still callable directly';
  end if;
  if exists (
    select 1 from pg_proc
     where pronamespace = 'public'::regnamespace
       and not prosecdef
       and prosrc ilike '%resolve_appointment_payment_account(%'
       and proname <> 'resolve_appointment_payment_account'
  ) then
    raise exception 'an invoker function still calls resolve_appointment_payment_account';
  end if;
end
$audit$;
