-- ФУНКЦИИ БЕЗ ВХОДА — ТОЛЬКО СТРАНИЦЫ ПО ТОКЕНУ; ПУСТЫЕ БАКЕТЫ УБРАНЫ
-- (аудит 035: srv/S-03, srv/S-06).
--
-- 1. Советчик Supabase держит 19 «SECURITY DEFINER исполнима для anon». Дыр
--    среди них нет (разбор S-03): помощники политик без входа отдают NULL,
--    триггерные функции PostgREST вызвать не может. Но привычные 19 строк
--    прячут новую опасную функцию — так `seed_records_level` сутки писал права
--    без входа. Остаются для anon только страницы по токену:
--    `/r` (`appointment_link_*`), приглашение (`invitation_preview`), адрес
--    (`location_request_*`), оценка (`lookup_rating_token`, `submit_rating`),
--    онлайн-запись (`online_booking_page/slots/create`).
--    • помощники политик — у PUBLIC и anon; `authenticated` и `service_role`
--      сохраняют право (политики и условия триггеров считаются от их имени —
--      `calendar_delete_in_progress()` стоит в WHEN триггеров записей и денег);
--    • триггерные функции — у PUBLIC, anon и authenticated: при срабатывании
--      триггера право исполнения не проверяется;
--    • `purge_expired_clients` — у всех людей: её зовёт только pg_cron.
-- 2. Бакеты `avatars` (публичный), `client-avatars`, `invoices`, `order-photos`,
--    `tenant-assets` пусты, без политик, кодом не используются. Удаляются только
--    если в них по-прежнему ни одного файла.

revoke execute on function public.calendar_delete_in_progress() from public, anon;
grant execute on function public.calendar_delete_in_progress() to authenticated, service_role;

revoke execute on function public.current_tenant_id() from public, anon;
grant execute on function public.current_tenant_id() to authenticated;

revoke execute on function public.current_user_can_delete_appointment_blob(uuid) from public, anon;
grant execute on function public.current_user_can_delete_appointment_blob(uuid) to authenticated;

revoke execute on function public.current_user_has_calendar_grants() from public, anon;
grant execute on function public.current_user_has_calendar_grants() to authenticated;

revoke execute on function public.current_user_master_id() from public, anon;
grant execute on function public.current_user_master_id() to authenticated;

revoke execute on function public.current_user_team_ids() from public, anon;
grant execute on function public.current_user_team_ids() to authenticated;

revoke execute on function public.effective_vat_settings(text) from public, anon;
grant execute on function public.effective_vat_settings(text) to authenticated;

revoke execute on function public.void_invoice(uuid) from public, anon;
grant execute on function public.void_invoice(uuid) to authenticated;

revoke execute on function public.location_request_coord(numeric) from public, anon;
revoke execute on function public.personal_calendar_name(text) from public, anon;

revoke execute on function public.fill_transaction_vat() from public, anon, authenticated;
revoke execute on function public.guard_account_delete_with_history() from public, anon, authenticated;
revoke execute on function public.guard_team_delete_with_history() from public, anon, authenticated;
revoke execute on function public.settle_appointment_from_invoice_payment() from public, anon, authenticated;
revoke execute on function public.void_receipt_on_refund() from public, anon, authenticated;
revoke execute on function public.check_max_photos() from public, anon, authenticated;
revoke execute on function public.protect_last_owner() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.touch_event_template_updated_at() from public, anon, authenticated;

revoke execute on function public.purge_expired_clients() from public, anon, authenticated;

-- `storage.protect_delete` не даёт стирать таблицы Storage мимо API, чтобы не
-- осиротить файлы; здесь файлов нет по условию — флаг только на эту транзакцию.
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.buckets b
 where b.id in ('avatars', 'client-avatars', 'invoices', 'order-photos', 'tenant-assets')
   and not exists (select 1 from storage.objects o where o.bucket_id = b.id);
