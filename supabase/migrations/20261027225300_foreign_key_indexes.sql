-- ИНДЕКСЫ ПОД ВНЕШНИЕ КЛЮЧИ (аудит 035, srv/B-08; советчик Supabase
-- `unindexed_foreign_keys`, 51 ключ).
--
-- Без индекса на ссылающейся колонке каждое удаление строки, на которую
-- ссылаются (`ON DELETE SET NULL / CASCADE / RESTRICT`), читает всю таблицу
-- ссылок, а соединения по ключу идут перебором. Сейчас строк сотни и это
-- незаметно; с ростом аккаунтов — удаление клиента, счёта или записи
-- замедляется пропорционально всей таблице денег и чеков.
--
-- Здесь — ключи на таблицы продукта (клиенты, записи, счета, категории,
-- инвойсы, команды, права). Ключи на `auth.users` (`created_by`,
-- `deleted_by`, `granted_by`, `invited_by_user_id`, `masters.user_id`,
-- `calendar_feed_tokens.user_id`) не индексируются: пользователь удаляется
-- раз в жизни аккаунта, а поиска по автору нет. `debts.client_id` — в
-- `20261027225305_trash_knows_client_history.sql`.
--
-- Дублирующие разрешающие политики (73 по советчику) этой миграцией не
-- сливаются: каждое слияние меняет формулу доступа и требует прогона матрицы
-- прав партнёра; на нынешних объёмах выигрыша нет.

create index if not exists appointment_links_tenant_id_idx on public.appointment_links (tenant_id);
create index if not exists client_tag_assignments_tag_id_idx on public.client_tag_assignments (tag_id);
create index if not exists clients_referred_by_client_id_idx on public.clients (referred_by_client_id);
create index if not exists debts_category_id_idx on public.debts (category_id);
create index if not exists finance_category_hidden_category_id_idx on public.finance_category_hidden (category_id);
create index if not exists finance_category_order_category_id_idx on public.finance_category_order (category_id);
create index if not exists finance_templates_account_id_idx on public.finance_templates (account_id);
create index if not exists finance_templates_category_id_idx on public.finance_templates (category_id);
create index if not exists finance_transactions_category_id_idx on public.finance_transactions (category_id);
create index if not exists finance_transactions_refund_of_id_idx on public.finance_transactions (refund_of_id);
create index if not exists invitations_tenant_master_idx on public.invitations (tenant_id, master_id);
create index if not exists invitations_tenant_team_idx on public.invitations (tenant_id, team_id);
create index if not exists invoices_account_id_idx on public.invoices (account_id);
create index if not exists invoices_tenant_company_idx on public.invoices (tenant_id, company_id);
create index if not exists location_requests_tenant_id_idx on public.location_requests (tenant_id);
create index if not exists master_rating_tokens_appointment_id_idx on public.master_rating_tokens (appointment_id);
create index if not exists master_ratings_client_id_idx on public.master_ratings (client_id);
create index if not exists member_access_block_idx on public.member_access (block);
create index if not exists member_access_calendar_idx on public.member_access (tenant_id, user_id, team_id);
create index if not exists member_calendars_tenant_team_idx on public.member_calendars (tenant_id, team_id);
create index if not exists online_booking_pages_tenant_id_idx on public.online_booking_pages (tenant_id);
create index if not exists online_booking_requests_tenant_id_idx on public.online_booking_requests (tenant_id);
create index if not exists receipts_account_id_idx on public.receipts (account_id);
create index if not exists receipts_appointment_id_idx on public.receipts (appointment_id);
create index if not exists receipts_client_id_idx on public.receipts (client_id);
create index if not exists receipts_invoice_id_idx on public.receipts (invoice_id);
create index if not exists services_tenant_copied_from_idx on public.services (tenant_id, copied_from_service_id);
create index if not exists sms_alerts_tenant_id_idx on public.sms_alerts (tenant_id);
create index if not exists sms_logs_appointment_id_idx on public.sms_logs (appointment_id);
create index if not exists sms_messages_client_id_idx on public.sms_messages (client_id);
create index if not exists team_notification_prefs_tenant_team_idx on public.team_notification_prefs (tenant_id, team_id);
create index if not exists teams_tenant_legal_entity_idx on public.teams (tenant_id, legal_entity_id);
create index if not exists user_hidden_calendars_tenant_team_idx on public.user_hidden_calendars (tenant_id, team_id);
