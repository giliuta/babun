-- Snapshot of the live `public` schema: row-level security policies.
-- Taken 2026-10-13 from production with read-only catalog queries
-- (see docs/db/README.md). Reference only — never apply this file;
-- the history that built it is supabase/migrations/.

create policy access_blocks_read on public.access_blocks as PERMISSIVE for SELECT to authenticated
  using (true);

create policy access_templates_owner_all on public.access_templates as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy account_deletion_cleanup_service_role on public.account_deletion_cleanup as PERMISSIVE for ALL to service_role
  using (true)
  with check (true);

create policy account_teams_owner_all on public.account_teams as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy account_teams_select_calendar on public.account_teams as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'read'::text)) AS unnest)) OR (team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'read'::text)) AS unnest)) OR (team_id IN ( SELECT unnest(access_calendars('finance.accounts'::text, 'read'::text)) AS unnest)) OR (team_id IN ( SELECT unnest(access_calendars('calendar.day_money'::text, 'read'::text)) AS unnest)))));

create policy accounts_hidden_owner_only on public.accounts as RESTRICTIVE for ALL to authenticated
  using (((NOT is_hidden) OR (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((NOT is_hidden) OR (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy accounts_insert_calendar on public.accounts as PERMISSIVE for INSERT to authenticated
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (brigade_id IN ( SELECT unnest(access_calendars('finance.settings_accounts'::text, 'write'::text)) AS unnest)) AND ((created_by IS NULL) OR (created_by = ( SELECT auth.uid() AS uid)))));

create policy accounts_owner_all on public.accounts as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy accounts_select on public.accounts as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (brigade_id IN ( SELECT unnest(access_calendars('finance.accounts'::text, 'read'::text)) AS unnest)) OR (id IN ( SELECT unnest(access_accounts_for('finance.income'::text, 'read'::text)) AS unnest)) OR (id IN ( SELECT unnest(access_accounts_for('finance.expense'::text, 'read'::text)) AS unnest)) OR (id IN ( SELECT unnest(access_accounts_for('finance.accounts'::text, 'read'::text)) AS unnest)) OR (id IN ( SELECT unnest(access_accounts_for('calendar.day_money'::text, 'read'::text)) AS unnest)))));

create policy accounts_select_settings on public.accounts as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (brigade_id IN ( SELECT unnest(access_calendars('finance.settings_accounts'::text, 'read'::text)) AS unnest))));

create policy accounts_update_calendar on public.accounts as PERMISSIVE for UPDATE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (brigade_id IN ( SELECT unnest(access_calendars('finance.settings_accounts'::text, 'write'::text)) AS unnest))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (brigade_id IN ( SELECT unnest(access_calendars('finance.settings_accounts'::text, 'write'::text)) AS unnest))));

create policy app_release_read on public.app_release as PERMISSIVE for SELECT to anon, authenticated
  using (true);

create policy app_settings_service_role_all on public.app_settings as PERMISSIVE for ALL to service_role
  using (true)
  with check (true);

create policy app_settings_service_role_select on public.app_settings as PERMISSIVE for SELECT to service_role
  using (true);

create policy appointment_photos_delete_files_right on public.appointment_photos as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND current_user_can_mutate_appointment_photo(appointment_id)));

create policy appointment_photos_delete_operator on public.appointment_photos as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])) AND current_user_can_mutate_appointment_photo(appointment_id)));

create policy appointment_photos_insert_visible on public.appointment_photos as PERMISSIVE for INSERT to authenticated
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND current_user_can_mutate_appointment_photo(appointment_id)));

create policy appointment_photos_select_visible on public.appointment_photos as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND current_user_can_access_appointment(appointment_id) AND current_user_can_see_appointment_files(appointment_id)));

create policy appointment_photos_update_operator on public.appointment_photos as PERMISSIVE for UPDATE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])) AND current_user_can_mutate_appointment_photo(appointment_id)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])) AND current_user_can_mutate_appointment_photo(appointment_id)));

create policy appointments_delete on public.appointments as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR ((( SELECT current_user_role() AS current_user_role) = 'dispatcher'::text) AND (NOT ( SELECT current_user_has_calendar_grants() AS current_user_has_calendar_grants))) OR (team_id IN ( SELECT unnest(current_user_calendar_ids('edit_all'::text)) AS unnest))) AND ((kind = 'work'::text) OR ((kind = ANY (ARRAY['event'::text, 'personal'::text])) AND (created_by = ( SELECT auth.uid() AS uid))))));

create policy appointments_insert on public.appointments as PERMISSIVE for INSERT to authenticated
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR ((( SELECT current_user_role() AS current_user_role) = 'dispatcher'::text) AND (NOT ( SELECT current_user_has_calendar_grants() AS current_user_has_calendar_grants))) OR (team_id IN ( SELECT unnest(current_user_calendar_ids('book'::text)) AS unnest))) AND ((kind = 'work'::text) OR ((kind = ANY (ARRAY['event'::text, 'personal'::text])) AND (created_by = ( SELECT auth.uid() AS uid))))));

create policy appointments_select on public.appointments as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR ((( SELECT current_user_role() AS current_user_role) = 'dispatcher'::text) AND (NOT ( SELECT current_user_has_calendar_grants() AS current_user_has_calendar_grants))) OR ((( SELECT current_user_role() AS current_user_role) = 'dispatcher'::text) AND (team_id IN ( SELECT unnest(current_user_calendar_ids('view'::text)) AS unnest)))) AND ((kind = 'work'::text) OR ((kind = ANY (ARRAY['event'::text, 'personal'::text])) AND ((team_id IS NOT NULL) OR (created_by = ( SELECT auth.uid() AS uid)))))));

create policy appointments_update on public.appointments as PERMISSIVE for UPDATE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR ((( SELECT current_user_role() AS current_user_role) = 'dispatcher'::text) AND (NOT ( SELECT current_user_has_calendar_grants() AS current_user_has_calendar_grants))) OR (team_id IN ( SELECT unnest(current_user_calendar_ids('edit_all'::text)) AS unnest))) AND ((kind = 'work'::text) OR ((kind = ANY (ARRAY['event'::text, 'personal'::text])) AND (created_by = ( SELECT auth.uid() AS uid))))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR ((( SELECT current_user_role() AS current_user_role) = 'dispatcher'::text) AND (NOT ( SELECT current_user_has_calendar_grants() AS current_user_has_calendar_grants))) OR (team_id IN ( SELECT unnest(current_user_calendar_ids('edit_all'::text)) AS unnest))) AND ((kind = 'work'::text) OR ((kind = ANY (ARRAY['event'::text, 'personal'::text])) AND (created_by = ( SELECT auth.uid() AS uid))))));

create policy billing_events_owner_select on public.billing_events as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy billing_events_service_role_all on public.billing_events as PERMISSIVE for ALL to service_role
  using (true)
  with check (true);

create policy calendar_members_select on public.calendar_members as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR (( SELECT current_user_role() AS current_user_role) = 'owner'::text))));

create policy calendar_members_write_owner on public.calendar_members as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy calendar_settings_select_operator on public.calendar_settings as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text]))));

create policy calendar_settings_write_owner on public.calendar_settings as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy change_log_select on public.change_log as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy change_log_select_partner on public.change_log as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ( SELECT access_company('cabinet.history'::text, 'read'::text) AS access_company) AND (team_id IS NOT NULL) AND
CASE entity
    WHEN 'appointments'::text THEN (team_id IN ( SELECT unnest(access_calendars('calendar.records'::text, 'read'::text)) AS unnest))
    WHEN 'appointment_photos'::text THEN (team_id IN ( SELECT unnest(access_calendars('record.files'::text, 'read'::text)) AS unnest))
    WHEN 'day_cities'::text THEN (team_id IN ( SELECT unnest(access_calendars('calendar.day_labels'::text, 'read'::text)) AS unnest))
    WHEN 'clients'::text THEN (team_id IN ( SELECT unnest(access_calendars('clients'::text, 'read'::text)) AS unnest))
    WHEN 'client_attachments'::text THEN (team_id IN ( SELECT unnest(access_calendars('clients.files'::text, 'read'::text)) AS unnest))
    WHEN 'client_tag_assignments'::text THEN (team_id IN ( SELECT unnest(access_calendars('clients.tags'::text, 'read'::text)) AS unnest))
    WHEN 'client_tags'::text THEN (team_id IN ( SELECT unnest(access_calendars('clients.settings_tags'::text, 'read'::text)) AS unnest))
    WHEN 'client_sources'::text THEN (team_id IN ( SELECT unnest(access_calendars('clients.settings_sources'::text, 'read'::text)) AS unnest))
    WHEN 'finance_transactions'::text THEN (team_id IN ( SELECT unnest((access_calendars('finance.income'::text, 'read'::text) || access_calendars('finance.expense'::text, 'read'::text))) AS unnest))
    WHEN 'finance_categories'::text THEN (team_id IN ( SELECT unnest(((access_calendars('finance.settings_categories_income'::text, 'read'::text) || access_calendars('finance.settings_categories_expense'::text, 'read'::text)) || access_calendars('finance.settings_categories_debts'::text, 'read'::text))) AS unnest))
    WHEN 'debts'::text THEN (team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'read'::text)) AS unnest))
    WHEN 'accounts'::text THEN (team_id IN ( SELECT unnest(access_calendars('finance.accounts'::text, 'read'::text)) AS unnest))
    WHEN 'invoices'::text THEN (team_id IN ( SELECT unnest(access_calendars('finance.documents'::text, 'read'::text)) AS unnest))
    WHEN 'receipts'::text THEN (team_id IN ( SELECT unnest(access_calendars('finance.documents'::text, 'read'::text)) AS unnest))
    WHEN 'services'::text THEN (team_id IN ( SELECT unnest(access_calendars('calendar.services'::text, 'read'::text)) AS unnest))
    WHEN 'cities'::text THEN (team_id IN ( SELECT unnest(access_calendars('calendar.labels'::text, 'read'::text)) AS unnest))
    WHEN 'location_labels'::text THEN (team_id IN ( SELECT unnest(access_calendars('calendar.labels'::text, 'read'::text)) AS unnest))
    WHEN 'team_schedules'::text THEN (team_id IN ( SELECT unnest(access_calendars('calendar.schedule'::text, 'read'::text)) AS unnest))
    WHEN 'teams'::text THEN (team_id IN ( SELECT unnest(access_calendars('calendar.identity'::text, 'read'::text)) AS unnest))
    WHEN 'calendar_settings'::text THEN (team_id IN ( SELECT unnest(access_calendars('calendar.hours'::text, 'read'::text)) AS unnest))
    WHEN 'team_design'::text THEN (team_id IN ( SELECT unnest(access_calendars('calendar.booking_form'::text, 'read'::text)) AS unnest))
    WHEN 'personal_event_types'::text THEN (team_id IN ( SELECT unnest(access_calendars('calendar.booking_form'::text, 'read'::text)) AS unnest))
    ELSE false
END));

create policy cities_select_member on public.cities as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) IS NOT NULL)));

create policy cities_write_access on public.cities as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.labels'::text, 'write'::text)) AS unnest))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.labels'::text, 'write'::text)) AS unnest))));

create policy cities_write_operations on public.cities as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text]))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text]))));

create policy client_attachments_delete_block on public.client_attachments as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (client_id IN ( SELECT unnest(access_block_client_ids('clients.files'::text, 'write'::text)) AS unnest))));

create policy client_attachments_delete_operator on public.client_attachments as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text]))));

create policy client_attachments_delete_record on public.client_attachments as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (appointment_id IS NOT NULL) AND current_user_can_mutate_appointment_photo(appointment_id)));

create policy client_attachments_insert_block on public.client_attachments as PERMISSIVE for INSERT to authenticated
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (client_id IN ( SELECT unnest(access_block_client_ids('clients.files'::text, 'write'::text)) AS unnest)) AND ((created_by IS NULL) OR (created_by = ( SELECT auth.uid() AS uid)))));

create policy client_attachments_insert_operator on public.client_attachments as PERMISSIVE for INSERT to authenticated
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])) AND current_user_can_access_client(client_id) AND ((created_by IS NULL) OR (created_by = ( SELECT auth.uid() AS uid)))));

create policy client_attachments_insert_record on public.client_attachments as PERMISSIVE for INSERT to authenticated
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((created_by IS NULL) OR (created_by = ( SELECT auth.uid() AS uid))) AND current_user_can_add_record_attachment(id, client_id, appointment_id, storage_path)));

create policy client_attachments_select_block on public.client_attachments as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (client_id IN ( SELECT unnest(access_block_client_ids('clients.files'::text, 'read'::text)) AS unnest))));

create policy client_attachments_select_record on public.client_attachments as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (appointment_id IS NOT NULL) AND current_user_can_access_appointment(appointment_id) AND current_user_can_see_appointment_files(appointment_id)));

create policy client_attachments_select_role_scoped on public.client_attachments as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text]))));

create policy client_attachments_update_block on public.client_attachments as PERMISSIVE for UPDATE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (client_id IN ( SELECT unnest(access_block_client_ids('clients.files'::text, 'write'::text)) AS unnest))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (client_id IN ( SELECT unnest(access_block_client_ids('clients.files'::text, 'write'::text)) AS unnest))));

create policy client_attachments_update_operator on public.client_attachments as PERMISSIVE for UPDATE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text]))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])) AND current_user_can_access_client(client_id)));

create policy client_contact_alerts_select_owner on public.client_contact_alerts as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy client_contact_views_select_owner on public.client_contact_views as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy client_sources_modify_owner on public.client_sources as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy client_sources_select_access on public.client_sources as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('clients'::text, 'read'::text)) AS unnest)))));

create policy client_sources_write_settings on public.client_sources as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('clients.settings_sources'::text, 'write'::text)) AS unnest))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('clients.settings_sources'::text, 'write'::text)) AS unnest))));

create policy client_tag_assignments_modify_owner on public.client_tag_assignments as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy client_tag_assignments_select_owner on public.client_tag_assignments as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy client_tags_modify_owner on public.client_tags as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy client_tags_select_access on public.client_tags as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR ( SELECT access_company('clients'::text, 'read'::text) AS access_company))));

create policy client_tags_write_settings on public.client_tags as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('clients.settings_tags'::text, 'write'::text)) AS unnest))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('clients.settings_tags'::text, 'write'::text)) AS unnest))));

create policy clients_delete_owner on public.clients as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy clients_insert_owner on public.clients as PERMISSIVE for INSERT to authenticated
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy clients_select_owner on public.clients as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy clients_service_role_select on public.clients as PERMISSIVE for SELECT to service_role
  using (true);

create policy clients_update_owner on public.clients as PERMISSIVE for UPDATE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy day_cities_select_access on public.day_cities as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('calendar.day_labels'::text, 'read'::text)) AS unnest)))));

create policy day_cities_write_access on public.day_cities as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('calendar.day_labels'::text, 'write'::text)) AS unnest)))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('calendar.day_labels'::text, 'write'::text)) AS unnest)))));

create policy day_extras_owner_all on public.day_extras as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy day_extras_select_calendar on public.day_extras as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (((kind = 'income'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'read'::text)) AS unnest))) OR ((kind = 'expense'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'read'::text)) AS unnest))))));

create policy debts_delete on public.debts as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest)))));

create policy debts_insert on public.debts as PERMISSIVE for INSERT to authenticated
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR ((team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest)) AND ((created_by IS NULL) OR (created_by = ( SELECT auth.uid() AS uid)))))));

create policy debts_read on public.debts as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'read'::text)) AS unnest)))));

create policy debts_update on public.debts as PERMISSIVE for UPDATE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest)))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest)))));

create policy deleted_operations_delete on public.deleted_operations as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR ((team_id IN ( SELECT unnest(access_calendars('finance.settings_trash'::text, 'write'::text)) AS unnest)) AND ((operation ->> 'created_by'::text) = (( SELECT auth.uid() AS uid))::text) AND ((((operation ->> 'debt_id'::text) IS NULL) AND (type = 'income'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'read'::text)) AS unnest))) OR (((operation ->> 'debt_id'::text) IS NULL) AND (type = 'expense'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'read'::text)) AS unnest))) OR (((operation ->> 'debt_id'::text) IS NOT NULL) AND (team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'read'::text)) AS unnest))))))));

create policy deleted_operations_select on public.deleted_operations as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR ((team_id IN ( SELECT unnest(access_calendars('finance.settings_trash'::text, 'read'::text)) AS unnest)) AND ((((operation ->> 'debt_id'::text) IS NULL) AND (type = 'income'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'read'::text)) AS unnest))) OR (((operation ->> 'debt_id'::text) IS NULL) AND (type = 'expense'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'read'::text)) AS unnest))) OR (((operation ->> 'debt_id'::text) IS NOT NULL) AND (team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'read'::text)) AS unnest))))))));

create policy equipment_select_by_role on public.equipment as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])) OR ((( SELECT current_user_role() AS current_user_role) = 'master'::text) AND (assigned_team_id IN ( SELECT unnest(current_user_team_ids()) AS unnest))))));

create policy equipment_write_owner on public.equipment as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy event_templates_delete on public.event_templates as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (created_by = ( SELECT auth.uid() AS uid))));

create policy event_templates_insert on public.event_templates as PERMISSIVE for INSERT to authenticated
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((created_by IS NULL) OR (created_by = ( SELECT auth.uid() AS uid)))));

create policy event_templates_select on public.event_templates as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (created_by = ( SELECT auth.uid() AS uid))));

create policy event_templates_update on public.event_templates as PERMISSIVE for UPDATE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (created_by = ( SELECT auth.uid() AS uid))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (created_by = ( SELECT auth.uid() AS uid))));

create policy finance_categories_owner_select on public.finance_categories as PERMISSIVE for SELECT to authenticated
  using (((( SELECT current_user_role() AS current_user_role) = 'owner'::text) AND ((tenant_id IS NULL) OR (tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)))));

create policy finance_categories_owner_write on public.finance_categories as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy finance_categories_select_access on public.finance_categories as PERMISSIVE for SELECT to authenticated
  using ((((tenant_id IS NULL) AND ((( SELECT cardinality(access_calendars('finance.income'::text, 'read'::text)) AS cardinality) > 0) OR (( SELECT cardinality(access_calendars('finance.expense'::text, 'read'::text)) AS cardinality) > 0) OR (( SELECT cardinality(access_calendars('finance.debts'::text, 'read'::text)) AS cardinality) > 0) OR (( SELECT cardinality(access_calendars('calendar.day_money'::text, 'read'::text)) AS cardinality) > 0))) OR ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'read'::text)) AS unnest)) OR (team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'read'::text)) AS unnest)) OR (team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'read'::text)) AS unnest)) OR (team_id IN ( SELECT unnest(access_calendars('calendar.day_money'::text, 'read'::text)) AS unnest))))));

create policy finance_categories_select_settings on public.finance_categories as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (((type = 'income'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_income'::text, 'read'::text)) AS unnest))) OR ((type = 'expense'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_expense'::text, 'read'::text)) AS unnest))) OR ((type = 'debt'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_debts'::text, 'read'::text)) AS unnest))))));

create policy finance_categories_write_settings on public.finance_categories as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (NOT is_system) AND (((type = 'income'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_income'::text, 'write'::text)) AS unnest))) OR ((type = 'expense'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_expense'::text, 'write'::text)) AS unnest))) OR ((type = 'debt'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_debts'::text, 'write'::text)) AS unnest))))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (NOT is_system) AND (((type = 'income'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_income'::text, 'write'::text)) AS unnest))) OR ((type = 'expense'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_expense'::text, 'write'::text)) AS unnest))) OR ((type = 'debt'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_debts'::text, 'write'::text)) AS unnest))))));

create policy finance_category_hidden_owner_all on public.finance_category_hidden as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy finance_category_hidden_select_access on public.finance_category_hidden as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT cardinality(access_calendars('finance.income'::text, 'read'::text)) AS cardinality) > 0) OR (( SELECT cardinality(access_calendars('finance.expense'::text, 'read'::text)) AS cardinality) > 0) OR (( SELECT cardinality(access_calendars('finance.debts'::text, 'read'::text)) AS cardinality) > 0) OR (( SELECT cardinality(access_calendars('calendar.day_money'::text, 'read'::text)) AS cardinality) > 0))));

create policy finance_category_order_owner_all on public.finance_category_order as PERMISSIVE for ALL to public
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy finance_category_order_select_access on public.finance_category_order as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT cardinality(access_calendars('finance.income'::text, 'read'::text)) AS cardinality) > 0) OR (( SELECT cardinality(access_calendars('finance.expense'::text, 'read'::text)) AS cardinality) > 0) OR (( SELECT cardinality(access_calendars('finance.debts'::text, 'read'::text)) AS cardinality) > 0) OR (( SELECT cardinality(access_calendars('calendar.day_money'::text, 'read'::text)) AS cardinality) > 0))));

create policy finance_templates_owner_all on public.finance_templates as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy finance_templates_select_access on public.finance_templates as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((brigade_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'read'::text)) AS unnest)) OR (brigade_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'read'::text)) AS unnest)))));

create policy finance_transactions_delete_day_money on public.finance_transactions as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND from_calendar AND (type = ANY (ARRAY['income'::text, 'expense'::text])) AND (team_id IN ( SELECT unnest(access_calendars('calendar.day_money'::text, 'write'::text)) AS unnest)) AND (appointment_id IS NULL) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (debt_id IS NULL) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('calendar.day_money'::text, 'write'::text)) AS unnest)))));

create policy finance_transactions_delete_debt on public.finance_transactions as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest)) AND (type = ANY (ARRAY['income'::text, 'expense'::text])) AND (debt_id IN ( SELECT d.id
   FROM debts d
  WHERE ((d.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (d.team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest))))) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND ((type = 'expense'::text) OR (appointment_id IS NULL)) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.debts'::text, 'write'::text)) AS unnest)))));

create policy finance_transactions_delete_expense on public.finance_transactions as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (type = 'expense'::text) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (debt_id IS NULL) AND ((team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'full'::text)) AS unnest)) OR ((team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'write'::text)) AS unnest)) AND (created_by = ( SELECT auth.uid() AS uid)))) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.expense'::text, 'write'::text)) AS unnest)))));

create policy finance_transactions_delete_income on public.finance_transactions as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (type = 'income'::text) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (appointment_id IS NULL) AND (debt_id IS NULL) AND ((team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'full'::text)) AS unnest)) OR ((team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'write'::text)) AS unnest)) AND (created_by = ( SELECT auth.uid() AS uid)))) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.income'::text, 'write'::text)) AS unnest)))));

create policy finance_transactions_hidden_owner_only on public.finance_transactions as RESTRICTIVE for ALL to authenticated
  using (((account_id IS NULL) OR (( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (NOT (account_id IN ( SELECT unnest(hidden_account_ids()) AS unnest)))))
  with check (((account_id IS NULL) OR (( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (NOT (account_id IN ( SELECT unnest(hidden_account_ids()) AS unnest)))));

create policy finance_transactions_insert_day_money on public.finance_transactions as PERMISSIVE for INSERT to authenticated
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND from_calendar AND (type = ANY (ARRAY['income'::text, 'expense'::text])) AND (team_id IN ( SELECT unnest(access_calendars('calendar.day_money'::text, 'write'::text)) AS unnest)) AND (appointment_id IS NULL) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (debt_id IS NULL) AND (created_by = ( SELECT auth.uid() AS uid)) AND (occurred_on >= COALESCE(((( SELECT member_day_money_window_starts() AS member_day_money_window_starts) ->> team_id))::date, '-infinity'::date)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('calendar.day_money'::text, 'write'::text)) AS unnest)))));

create policy finance_transactions_insert_debt on public.finance_transactions as PERMISSIVE for INSERT to authenticated
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest)) AND (type = ANY (ARRAY['income'::text, 'expense'::text])) AND (debt_id IN ( SELECT d.id
   FROM debts d
  WHERE ((d.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (d.team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest))))) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND ((type = 'expense'::text) OR (appointment_id IS NULL)) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.debts'::text, 'write'::text)) AS unnest)))));

create policy finance_transactions_insert_expense on public.finance_transactions as PERMISSIVE for INSERT to authenticated
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'write'::text)) AS unnest)) AND (type = 'expense'::text) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (debt_id IS NULL) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.expense'::text, 'write'::text)) AS unnest)))));

create policy finance_transactions_insert_income on public.finance_transactions as PERMISSIVE for INSERT to authenticated
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'write'::text)) AS unnest)) AND (type = 'income'::text) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (appointment_id IS NULL) AND (debt_id IS NULL) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.income'::text, 'write'::text)) AS unnest)))));

create policy finance_transactions_owner_all on public.finance_transactions as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy finance_transactions_select_calendar on public.finance_transactions as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (((type = ANY (ARRAY['income'::text, 'refund'::text])) AND (team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'read'::text)) AS unnest))) OR ((type = 'expense'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'read'::text)) AS unnest))) OR ((type = 'transfer'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.accounts'::text, 'read'::text)) AS unnest))))));

create policy finance_transactions_select_day_money on public.finance_transactions as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (type = ANY (ARRAY['income'::text, 'refund'::text, 'expense'::text])) AND ((appointment_id IS NOT NULL) OR from_calendar) AND (team_id IN ( SELECT unnest(access_calendars('calendar.day_money'::text, 'read'::text)) AS unnest))));

create policy finance_transactions_select_debt on public.finance_transactions as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (debt_id IN ( SELECT d.id
   FROM debts d
  WHERE ((d.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (d.team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'read'::text)) AS unnest)))))));

create policy finance_transactions_update_day_money on public.finance_transactions as PERMISSIVE for UPDATE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND from_calendar AND (type = ANY (ARRAY['income'::text, 'expense'::text])) AND (team_id IN ( SELECT unnest(access_calendars('calendar.day_money'::text, 'write'::text)) AS unnest)) AND (appointment_id IS NULL) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (debt_id IS NULL) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('calendar.day_money'::text, 'write'::text)) AS unnest)))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND from_calendar AND (type = ANY (ARRAY['income'::text, 'expense'::text])) AND (team_id IN ( SELECT unnest(access_calendars('calendar.day_money'::text, 'write'::text)) AS unnest)) AND (appointment_id IS NULL) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (debt_id IS NULL) AND (created_by = ( SELECT auth.uid() AS uid)) AND (occurred_on >= COALESCE(((( SELECT member_day_money_window_starts() AS member_day_money_window_starts) ->> team_id))::date, '-infinity'::date)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('calendar.day_money'::text, 'write'::text)) AS unnest)))));

create policy finance_transactions_update_debt on public.finance_transactions as PERMISSIVE for UPDATE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest)) AND (type = ANY (ARRAY['income'::text, 'expense'::text])) AND (debt_id IN ( SELECT d.id
   FROM debts d
  WHERE ((d.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (d.team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest))))) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND ((type = 'expense'::text) OR (appointment_id IS NULL)) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.debts'::text, 'write'::text)) AS unnest)))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest)) AND (type = ANY (ARRAY['income'::text, 'expense'::text])) AND (debt_id IN ( SELECT d.id
   FROM debts d
  WHERE ((d.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (d.team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest))))) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND ((type = 'expense'::text) OR (appointment_id IS NULL)) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.debts'::text, 'write'::text)) AS unnest)))));

create policy finance_transactions_update_expense on public.finance_transactions as PERMISSIVE for UPDATE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (type = 'expense'::text) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (debt_id IS NULL) AND ((team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'full'::text)) AS unnest)) OR ((team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'write'::text)) AS unnest)) AND (created_by = ( SELECT auth.uid() AS uid)))) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.expense'::text, 'write'::text)) AS unnest)))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (type = 'expense'::text) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (debt_id IS NULL) AND ((team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'full'::text)) AS unnest)) OR ((team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'write'::text)) AS unnest)) AND (created_by = ( SELECT auth.uid() AS uid)))) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.expense'::text, 'write'::text)) AS unnest)))));

create policy finance_transactions_update_income on public.finance_transactions as PERMISSIVE for UPDATE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (type = 'income'::text) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (appointment_id IS NULL) AND (debt_id IS NULL) AND ((team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'full'::text)) AS unnest)) OR ((team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'write'::text)) AS unnest)) AND (created_by = ( SELECT auth.uid() AS uid)))) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.income'::text, 'write'::text)) AS unnest)))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (type = 'income'::text) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (appointment_id IS NULL) AND (debt_id IS NULL) AND ((team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'full'::text)) AS unnest)) OR ((team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'write'::text)) AS unnest)) AND (created_by = ( SELECT auth.uid() AS uid)))) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.income'::text, 'write'::text)) AS unnest)))));

create policy finance_transactions_window on public.finance_transactions as RESTRICTIVE for SELECT to authenticated
  using (((( SELECT current_user_role() AS current_user_role) IS DISTINCT FROM 'master'::text) OR (type <> ALL (ARRAY['income'::text, 'refund'::text, 'expense'::text])) OR (debt_id IS NOT NULL) OR ((NOT (team_id IN ( SELECT unnest(access_calendars('calendar.day_money'::text, 'read'::text)) AS unnest))) AND (occurred_on >= COALESCE(((( SELECT member_finance_window_starts() AS member_finance_window_starts) ->> team_id))::date, '-infinity'::date))) OR ((team_id IN ( SELECT unnest((access_calendars('finance.income'::text, 'read'::text) || access_calendars('finance.expense'::text, 'read'::text))) AS unnest)) AND (occurred_on >= COALESCE(((( SELECT member_finance_window_starts() AS member_finance_window_starts) ->> team_id))::date, '-infinity'::date))) OR (((appointment_id IS NOT NULL) OR from_calendar) AND (team_id IN ( SELECT unnest(access_calendars('calendar.day_money'::text, 'read'::text)) AS unnest)) AND (occurred_on >= COALESCE(((( SELECT member_day_money_window_starts() AS member_day_money_window_starts) ->> team_id))::date, '-infinity'::date)))));

create policy finance_transfer_requests_owner_select on public.finance_transfer_requests as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy finance_transfer_requests_select_calendar on public.finance_transfer_requests as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (ARRAY[from_account_id, to_account_id] <@ ( SELECT access_accounts_for('finance.accounts'::text, 'read'::text) AS access_accounts_for))));

create policy invitations_owner_delete on public.invitations as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text) AND (accepted_at IS NULL)));

create policy invitations_owner_select on public.invitations as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy invitations_partners_delete on public.invitations as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ( SELECT access_company('company.partners'::text, 'write'::text) AS access_company) AND (accepted_at IS NULL) AND (invited_by_user_id = ( SELECT auth.uid() AS uid))));

create policy invitations_partners_select on public.invitations as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ( SELECT access_company('company.partners'::text, 'read'::text) AS access_company)));

create policy invoice_lines_owner_all on public.invoice_lines as PERMISSIVE for ALL to authenticated
  using (((( SELECT current_user_role() AS current_user_role) = 'owner'::text) AND (EXISTS ( SELECT 1
   FROM invoices i
  WHERE ((i.id = invoice_lines.invoice_id) AND (i.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)))))))
  with check (((( SELECT current_user_role() AS current_user_role) = 'owner'::text) AND (EXISTS ( SELECT 1
   FROM invoices i
  WHERE ((i.id = invoice_lines.invoice_id) AND (i.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)))))));

create policy invoice_lines_select_documents on public.invoice_lines as PERMISSIVE for SELECT to authenticated
  using ((invoice_id IN ( SELECT invoice.id
   FROM invoices invoice
  WHERE ((invoice.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (invoice.brigade_id IN ( SELECT unnest(access_calendars('finance.documents'::text, 'read'::text)) AS unnest))))));

create policy invoices_owner_all on public.invoices as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy invoices_select_documents on public.invoices as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (brigade_id IN ( SELECT unnest(access_calendars('finance.documents'::text, 'read'::text)) AS unnest))));

create policy invoices_update_documents on public.invoices as PERMISSIVE for UPDATE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (brigade_id IN ( SELECT unnest(access_calendars('finance.documents'::text, 'write'::text)) AS unnest))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (brigade_id IN ( SELECT unnest(access_calendars('finance.documents'::text, 'write'::text)) AS unnest))));

create policy legal_entities_read on public.legal_entities as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text]))));

create policy legal_entities_select_settings on public.legal_entities as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ( SELECT access_company('finance.settings_requisites'::text, 'read'::text) AS access_company)));

create policy legal_entities_write_owner on public.legal_entities as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy location_labels_operational_read on public.location_labels as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text, 'master'::text]))));

create policy location_requests_delete on public.location_requests as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text]))));

create policy location_requests_read on public.location_requests as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text]))));

create policy rating_tokens_no_anon_write on public.master_rating_tokens as PERMISSIVE for INSERT to anon
  with check (false);

create policy rating_tokens_owner_insert on public.master_rating_tokens as PERMISSIVE for INSERT to authenticated
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy rating_tokens_owner_read on public.master_rating_tokens as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy master_ratings_insert_with_token on public.master_ratings as PERMISSIVE for INSERT to anon, authenticated
  with check (((token IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM master_rating_tokens t
  WHERE ((t.token = master_ratings.token) AND (t.used_at IS NULL) AND (t.expires_at > now()) AND (t.tenant_id = master_ratings.tenant_id) AND (t.master_id = master_ratings.master_id))))));

create policy master_ratings_owner_read on public.master_ratings as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy masters_select_owner on public.masters as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy masters_select_partners on public.masters as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ( SELECT access_company('company.partners'::text, 'read'::text) AS access_company)));

create policy masters_update_partners on public.masters as PERMISSIVE for UPDATE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND partners_card_manageable(id)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND partners_card_manageable(id)));

create policy masters_write_owner on public.masters as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy member_access_select_own_or_owner on public.member_access as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR (( SELECT current_user_role() AS current_user_role) = 'owner'::text))));

create policy member_calendars_select_own_or_owner on public.member_calendars as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR (( SELECT current_user_role() AS current_user_role) = 'owner'::text))));

create policy partner_files_delete on public.partner_files as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ( SELECT access_company('company.partners'::text, 'write'::text) AS access_company)));

create policy partner_files_insert on public.partner_files as PERMISSIVE for INSERT to authenticated
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ( SELECT access_company('company.partners'::text, 'write'::text) AS access_company)));

create policy partner_files_select on public.partner_files as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ( SELECT access_company('company.partners'::text, 'read'::text) AS access_company)));

create policy personal_event_types_select on public.personal_event_types as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) IS NOT NULL)));

create policy personal_event_types_write on public.personal_event_types as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text]))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text]))));

create policy personal_event_types_write_access on public.personal_event_types as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.booking_form'::text, 'write'::text)) AS unnest))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.booking_form'::text, 'write'::text)) AS unnest))));

create policy platform_admins_select_admin on public.platform_admins as PERMISSIVE for SELECT to authenticated
  using (is_platform_admin());

create policy platform_admins_service_role on public.platform_admins as PERMISSIVE for ALL to service_role
  using (true)
  with check (true);

create policy push_subscriptions_delete_own on public.push_subscriptions as PERMISSIVE for DELETE to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy push_subscriptions_select_own on public.push_subscriptions as PERMISSIVE for SELECT to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy push_subscriptions_service_role_all on public.push_subscriptions as PERMISSIVE for ALL to service_role
  using (true)
  with check (true);

create policy receipts_read on public.receipts as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text]))));

create policy receipts_read_own_money on public.receipts as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (transaction_id IN ( SELECT ft.id
   FROM finance_transactions ft
  WHERE (ft.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)))) AND ((client_id IS NULL) OR (client_id IN ( SELECT unnest(access_block_client_ids('clients.history'::text, 'read'::text)) AS unnest))) AND (team_id IN ( SELECT unnest(access_calendars('finance.documents'::text, 'read'::text)) AS unnest))));

create policy receipts_select_documents on public.receipts as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('finance.documents'::text, 'read'::text)) AS unnest))));

create policy recurring_reminders_operator_all on public.recurring_reminders as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text]))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text]))));

create policy service_categories_select_access on public.service_categories as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT COALESCE(cardinality(access_calendars('calendar.services'::text, 'read'::text)), 0) AS "coalesce") > 0)));

create policy service_categories_select_operator on public.service_categories as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text]))));

create policy service_categories_write_owner on public.service_categories as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy service_variants_select_owner on public.service_variants as PERMISSIVE for SELECT to public
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy service_variants_write_owner on public.service_variants as PERMISSIVE for ALL to public
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy services_select_access on public.services as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.services'::text, 'read'::text)) AS unnest))));

create policy services_select_owner on public.services as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy services_write_access on public.services as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.services'::text, 'write'::text)) AS unnest))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.services'::text, 'write'::text)) AS unnest))));

create policy services_write_owner on public.services as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy sms_alerts_service_role on public.sms_alerts as PERMISSIVE for ALL to service_role
  using (true)
  with check (true);

create policy sms_autotopup_service_role on public.sms_autotopup as PERMISSIVE for ALL to service_role
  using (true)
  with check (true);

create policy sms_ledger_service_role on public.sms_ledger as PERMISSIVE for ALL to service_role
  using (true)
  with check (true);

create policy sms_logs_service_role on public.sms_logs as PERMISSIVE for ALL to service_role
  using (true)
  with check (true);

create policy sms_messages_service_role_all on public.sms_messages as PERMISSIVE for ALL to service_role
  using (true)
  with check (true);

create policy sms_topups_select_owner on public.sms_topups as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy sms_topups_service_role on public.sms_topups as PERMISSIVE for ALL to service_role
  using (true)
  with check (true);

create policy team_design_select on public.team_design as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) IS NOT NULL)));

create policy team_design_write_access on public.team_design as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(((((access_calendars('calendar.booking_form'::text, 'write'::text) || access_calendars('clients.settings_card'::text, 'write'::text)) || access_calendars('clients.settings_ways'::text, 'write'::text)) || access_calendars('clients.settings_maps'::text, 'write'::text)) || access_calendars('clients.settings_objects'::text, 'write'::text))) AS unnest))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(((((access_calendars('calendar.booking_form'::text, 'write'::text) || access_calendars('clients.settings_card'::text, 'write'::text)) || access_calendars('clients.settings_ways'::text, 'write'::text)) || access_calendars('clients.settings_maps'::text, 'write'::text)) || access_calendars('clients.settings_objects'::text, 'write'::text))) AS unnest))));

create policy team_design_write_owner on public.team_design as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy team_finance_settings_owner on public.team_finance_settings as PERMISSIVE for ALL to public
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy team_finance_settings_select_access on public.team_finance_settings as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'read'::text)) AS unnest)) OR (team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'read'::text)) AS unnest)) OR (team_id IN ( SELECT unnest(access_calendars('calendar.day_money'::text, 'read'::text)) AS unnest)))));

create policy team_notification_prefs_own on public.team_notification_prefs as PERMISSIVE for ALL to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM tenant_members tm
  WHERE ((tm.tenant_id = team_notification_prefs.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)))))));

create policy team_schedules_select_access on public.team_schedules as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('calendar.schedule'::text, 'read'::text)) AS unnest)))));

create policy team_schedules_write_access on public.team_schedules as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('calendar.schedule'::text, 'write'::text)) AS unnest)))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('calendar.schedule'::text, 'write'::text)) AS unnest)))));

create policy teams_select_owner on public.teams as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy teams_write_owner on public.teams as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy tenant_loyalty_settings_select_operator on public.tenant_loyalty_settings as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text]))));

create policy tenant_loyalty_settings_write_owner on public.tenant_loyalty_settings as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy tenant_members_delete_owner on public.tenant_members as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy tenant_members_delete_partners on public.tenant_members as PERMISSIVE for DELETE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND partners_manageable(user_id)));

create policy tenant_members_select_owner_or_self on public.tenant_members as PERMISSIVE for SELECT to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))));

create policy tenant_members_select_partners on public.tenant_members as PERMISSIVE for SELECT to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ( SELECT access_company('company.partners'::text, 'read'::text) AS access_company)));

create policy tenant_members_self_leave on public.tenant_members as PERMISSIVE for DELETE to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy tenant_members_update_owner on public.tenant_members as PERMISSIVE for UPDATE to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy tenant_sms_config_service_role_all on public.tenant_sms_config as PERMISSIVE for ALL to service_role
  using (true)
  with check (true);

create policy tenant_state_owner_all on public.tenant_state as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy tenants_select_owner on public.tenants as PERMISSIVE for SELECT to authenticated
  using (((id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy tenants_service_role_select on public.tenants as PERMISSIVE for SELECT to service_role
  using (true);

create policy tenants_service_role_write on public.tenants as PERMISSIVE for UPDATE to service_role
  using (true)
  with check (true);

create policy tenants_update_owner on public.tenants as PERMISSIVE for UPDATE to authenticated
  using (((id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));

create policy user_calendar_order_delete on public.user_calendar_order as PERMISSIVE for DELETE to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy user_calendar_order_insert on public.user_calendar_order as PERMISSIVE for INSERT to authenticated
  with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy user_calendar_order_select on public.user_calendar_order as PERMISSIVE for SELECT to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy user_calendar_order_update on public.user_calendar_order as PERMISSIVE for UPDATE to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy user_hidden_calendars_delete on public.user_hidden_calendars as PERMISSIVE for DELETE to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy user_hidden_calendars_insert on public.user_hidden_calendars as PERMISSIVE for INSERT to authenticated
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM tenant_members tm
  WHERE ((tm.tenant_id = user_hidden_calendars.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)))))));

create policy user_hidden_calendars_select on public.user_hidden_calendars as PERMISSIVE for SELECT to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy webhooks_owner_all on public.webhooks as PERMISSIVE for ALL to authenticated
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)));
