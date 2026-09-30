-- ПРОВЕРКИ ПРАВ — ТОЛЬКО ДЛЯ ВОШЕДШИХ.
--
-- `definer_functions_obey_calendar_grants` завела две проверки, и Postgres по
-- умолчанию выдал их на выполнение PUBLIC — то есть и анонимному ключу.
-- Вреда нет (без входа обе отвечают «нет»), но советник безопасности Supabase
-- сразу это отметил, и соседние проверки (`current_user_can_pay_appointment`)
-- анониму не выданы. Держим одно правило для всех.

revoke all on function public.current_user_can_edit_work_appointment(text) from public, anon;
revoke all on function public.current_user_can_edit_client(uuid) from public, anon;

grant execute on function public.current_user_can_edit_work_appointment(text) to authenticated, service_role;
grant execute on function public.current_user_can_edit_client(uuid) to authenticated, service_role;
