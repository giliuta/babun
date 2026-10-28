-- ОДНА РАЗРЕШАЮЩАЯ ПОЛИТИКА НА ДЕЙСТВИЕ (аудит 035, №49 / B-08).
--
-- У 35 таблиц на одно действие (чтение, вставка, правка, удаление) стояло по
-- две–пять разрешающих политик: «владелец — всё» рядом с «партнёр — по праву
-- блока». Postgres проверяет каждую из них на каждой строке, а советчик
-- Supabase держал 73 такие строки, и новая важная находка тонула среди них.
--
-- Здесь разрешающие политики каждой из этих таблиц собраны в одну на
-- действие. Условие новой — OR условий прежних, тексты взяты из живой базы
-- (`pg_policies`) дословно, одинаковые слиты в одно. Это та же формула
-- доступа: разрешающие политики одного действия Postgres и так складывает
-- через OR. Политика «на всё» разложена на четыре действия; где у неё не было
-- WITH CHECK, новую строку проверяет её USING — так делает и сам Postgres.
-- Политика одного действия без соседей оставлена как есть. Ограничивающие
-- политики (`*_hidden_owner_only`, `finance_transactions_window`) не тронуты.
--
-- У `finance_category_order`, `service_variants`, `team_finance_settings`
-- политики владельца были «для всех ролей», новые — для `authenticated`:
-- условие требует роли владельца из членства, у anon её нет, и по этим
-- политикам он не получал ни строки и раньше.
--
-- Старые политики снимаются без `if exists`: если живая база разошлась с
-- этим файлом, накат падает, а не собирает формулу из устаревших частей.

-- account_teams
drop policy account_teams_owner_all on public.account_teams;
drop policy account_teams_select_calendar on public.account_teams;

create policy account_teams_select on public.account_teams
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'read'::text)) AS unnest)) OR (team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'read'::text)) AS unnest)) OR (team_id IN ( SELECT unnest(access_calendars('finance.accounts'::text, 'read'::text)) AS unnest)) OR (team_id IN ( SELECT unnest(access_calendars('calendar.day_money'::text, 'read'::text)) AS unnest))))
  );

create policy account_teams_insert on public.account_teams
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy account_teams_update on public.account_teams
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy account_teams_delete on public.account_teams
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- accounts
drop policy accounts_insert_calendar on public.accounts;
drop policy accounts_owner_all on public.accounts;
drop policy accounts_select on public.accounts;
drop policy accounts_select_settings on public.accounts;
drop policy accounts_update_calendar on public.accounts;

create policy accounts_select on public.accounts
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (brigade_id IN ( SELECT unnest(access_calendars('finance.accounts'::text, 'read'::text)) AS unnest)) OR (id IN ( SELECT unnest(access_accounts_for('finance.income'::text, 'read'::text)) AS unnest)) OR (id IN ( SELECT unnest(access_accounts_for('finance.expense'::text, 'read'::text)) AS unnest)) OR (id IN ( SELECT unnest(access_accounts_for('finance.accounts'::text, 'read'::text)) AS unnest)) OR (id IN ( SELECT unnest(access_accounts_for('calendar.day_money'::text, 'read'::text)) AS unnest))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (brigade_id IN ( SELECT unnest(access_calendars('finance.settings_accounts'::text, 'read'::text)) AS unnest)))
  );

create policy accounts_insert on public.accounts
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (brigade_id IN ( SELECT unnest(access_calendars('finance.settings_accounts'::text, 'write'::text)) AS unnest)) AND ((created_by IS NULL) OR (created_by = ( SELECT auth.uid() AS uid))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy accounts_update on public.accounts
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (brigade_id IN ( SELECT unnest(access_calendars('finance.settings_accounts'::text, 'write'::text)) AS unnest)))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (brigade_id IN ( SELECT unnest(access_calendars('finance.settings_accounts'::text, 'write'::text)) AS unnest)))
  );

create policy accounts_delete on public.accounts
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- appointment_photos
drop policy appointment_photos_delete_files_right on public.appointment_photos;
drop policy appointment_photos_delete_operator on public.appointment_photos;

create policy appointment_photos_delete on public.appointment_photos
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND current_user_can_mutate_appointment_photo(appointment_id))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])) AND current_user_can_mutate_appointment_photo(appointment_id))
  );

-- calendar_members
drop policy calendar_members_select on public.calendar_members;
drop policy calendar_members_write_owner on public.calendar_members;

create policy calendar_members_select on public.calendar_members
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy calendar_members_insert on public.calendar_members
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy calendar_members_update on public.calendar_members
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy calendar_members_delete on public.calendar_members
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- calendar_settings
drop policy calendar_settings_select_operator on public.calendar_settings;
drop policy calendar_settings_write_owner on public.calendar_settings;

create policy calendar_settings_select on public.calendar_settings
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy calendar_settings_insert on public.calendar_settings
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy calendar_settings_update on public.calendar_settings
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy calendar_settings_delete on public.calendar_settings
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- cities
drop policy cities_select_member on public.cities;
drop policy cities_write_access on public.cities;
drop policy cities_write_operations on public.cities;

create policy cities_select on public.cities
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) IS NOT NULL) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IS NULL) OR (team_id IN ( SELECT mc.team_id
   FROM member_calendars mc
  WHERE ((mc.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (mc.user_id = ( SELECT auth.uid() AS uid)))))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.labels'::text, 'write'::text)) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])))
  );

create policy cities_insert on public.cities
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.labels'::text, 'write'::text)) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])))
  );

create policy cities_update on public.cities
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.labels'::text, 'write'::text)) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.labels'::text, 'write'::text)) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])))
  );

create policy cities_delete on public.cities
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.labels'::text, 'write'::text)) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])))
  );

-- client_attachments
drop policy client_attachments_delete_block on public.client_attachments;
drop policy client_attachments_delete_operator on public.client_attachments;
drop policy client_attachments_delete_record on public.client_attachments;
drop policy client_attachments_insert_block on public.client_attachments;
drop policy client_attachments_insert_operator on public.client_attachments;
drop policy client_attachments_insert_record on public.client_attachments;
drop policy client_attachments_select_block on public.client_attachments;
drop policy client_attachments_select_record on public.client_attachments;
drop policy client_attachments_select_role_scoped on public.client_attachments;
drop policy client_attachments_update_block on public.client_attachments;
drop policy client_attachments_update_operator on public.client_attachments;

create policy client_attachments_select on public.client_attachments
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (client_id IN ( SELECT unnest(access_block_client_ids('clients.files'::text, 'read'::text)) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (appointment_id IS NOT NULL) AND current_user_can_access_appointment(appointment_id) AND current_user_can_see_appointment_files(appointment_id))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])))
  );

create policy client_attachments_insert on public.client_attachments
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (client_id IN ( SELECT unnest(access_block_client_ids('clients.files'::text, 'write'::text)) AS unnest)) AND ((created_by IS NULL) OR (created_by = ( SELECT auth.uid() AS uid))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])) AND current_user_can_access_client(client_id) AND ((created_by IS NULL) OR (created_by = ( SELECT auth.uid() AS uid))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((created_by IS NULL) OR (created_by = ( SELECT auth.uid() AS uid))) AND current_user_can_add_record_attachment(id, client_id, appointment_id, storage_path))
  );

create policy client_attachments_update on public.client_attachments
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (client_id IN ( SELECT unnest(access_block_client_ids('clients.files'::text, 'write'::text)) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (client_id IN ( SELECT unnest(access_block_client_ids('clients.files'::text, 'write'::text)) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])) AND current_user_can_access_client(client_id))
  );

create policy client_attachments_delete on public.client_attachments
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (client_id IN ( SELECT unnest(access_block_client_ids('clients.files'::text, 'write'::text)) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (appointment_id IS NOT NULL) AND current_user_can_mutate_appointment_photo(appointment_id))
  );

-- client_sources
drop policy client_sources_modify_owner on public.client_sources;
drop policy client_sources_select_access on public.client_sources;
drop policy client_sources_write_settings on public.client_sources;

create policy client_sources_select on public.client_sources
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('clients'::text, 'read'::text)) AS unnest))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('clients.settings_sources'::text, 'write'::text)) AS unnest)))
  );

create policy client_sources_insert on public.client_sources
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('clients.settings_sources'::text, 'write'::text)) AS unnest)))
  );

create policy client_sources_update on public.client_sources
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('clients.settings_sources'::text, 'write'::text)) AS unnest)))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('clients.settings_sources'::text, 'write'::text)) AS unnest)))
  );

create policy client_sources_delete on public.client_sources
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('clients.settings_sources'::text, 'write'::text)) AS unnest)))
  );

-- client_tag_assignments
drop policy client_tag_assignments_modify_owner on public.client_tag_assignments;
drop policy client_tag_assignments_select_owner on public.client_tag_assignments;

create policy client_tag_assignments_select on public.client_tag_assignments
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy client_tag_assignments_insert on public.client_tag_assignments
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy client_tag_assignments_update on public.client_tag_assignments
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy client_tag_assignments_delete on public.client_tag_assignments
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- client_tags
drop policy client_tags_modify_owner on public.client_tags;
drop policy client_tags_select_access on public.client_tags;
drop policy client_tags_write_settings on public.client_tags;

create policy client_tags_select on public.client_tags
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR ( SELECT access_company('clients'::text, 'read'::text) AS access_company)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('clients.settings_tags'::text, 'write'::text)) AS unnest)))
  );

create policy client_tags_insert on public.client_tags
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('clients.settings_tags'::text, 'write'::text)) AS unnest)))
  );

create policy client_tags_update on public.client_tags
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('clients.settings_tags'::text, 'write'::text)) AS unnest)))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('clients.settings_tags'::text, 'write'::text)) AS unnest)))
  );

create policy client_tags_delete on public.client_tags
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('clients.settings_tags'::text, 'write'::text)) AS unnest)))
  );

-- day_cities
drop policy day_cities_select_access on public.day_cities;
drop policy day_cities_write_access on public.day_cities;

create policy day_cities_select on public.day_cities
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('calendar.day_labels'::text, 'read'::text)) AS unnest))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('calendar.day_labels'::text, 'write'::text)) AS unnest))))
  );

create policy day_cities_insert on public.day_cities
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('calendar.day_labels'::text, 'write'::text)) AS unnest))))
  );

create policy day_cities_update on public.day_cities
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('calendar.day_labels'::text, 'write'::text)) AS unnest))))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('calendar.day_labels'::text, 'write'::text)) AS unnest))))
  );

create policy day_cities_delete on public.day_cities
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('calendar.day_labels'::text, 'write'::text)) AS unnest))))
  );

-- day_extras
drop policy day_extras_owner_all on public.day_extras;
drop policy day_extras_select_calendar on public.day_extras;

create policy day_extras_select on public.day_extras
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (((kind = 'income'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'read'::text)) AS unnest))) OR ((kind = 'expense'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'read'::text)) AS unnest)))))
  );

create policy day_extras_insert on public.day_extras
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy day_extras_update on public.day_extras
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy day_extras_delete on public.day_extras
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- equipment
drop policy equipment_select_by_role on public.equipment;
drop policy equipment_write_owner on public.equipment;

create policy equipment_select on public.equipment
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])) OR ((( SELECT current_user_role() AS current_user_role) = 'master'::text) AND (assigned_team_id IN ( SELECT unnest(current_user_team_ids()) AS unnest)))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy equipment_insert on public.equipment
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy equipment_update on public.equipment
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy equipment_delete on public.equipment
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- finance_categories
drop policy finance_categories_owner_select on public.finance_categories;
drop policy finance_categories_owner_write on public.finance_categories;
drop policy finance_categories_select_access on public.finance_categories;
drop policy finance_categories_select_settings on public.finance_categories;
drop policy finance_categories_write_settings on public.finance_categories;

create policy finance_categories_select on public.finance_categories
  as permissive for select to authenticated
  using (
    ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) AND ((tenant_id IS NULL) OR (tenant_id = ( SELECT current_tenant_id() AS current_tenant_id))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or (((tenant_id IS NULL) AND ((( SELECT cardinality(access_calendars('finance.income'::text, 'read'::text)) AS cardinality) > 0) OR (( SELECT cardinality(access_calendars('finance.expense'::text, 'read'::text)) AS cardinality) > 0) OR (( SELECT cardinality(access_calendars('finance.debts'::text, 'read'::text)) AS cardinality) > 0) OR (( SELECT cardinality(access_calendars('calendar.day_money'::text, 'read'::text)) AS cardinality) > 0))) OR ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'read'::text)) AS unnest)) OR (team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'read'::text)) AS unnest)) OR (team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'read'::text)) AS unnest)) OR (team_id IN ( SELECT unnest(access_calendars('calendar.day_money'::text, 'read'::text)) AS unnest)))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (((type = 'income'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_income'::text, 'read'::text)) AS unnest))) OR ((type = 'expense'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_expense'::text, 'read'::text)) AS unnest))) OR ((type = 'debt'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_debts'::text, 'read'::text)) AS unnest)))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (NOT is_system) AND (((type = 'income'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_income'::text, 'write'::text)) AS unnest))) OR ((type = 'expense'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_expense'::text, 'write'::text)) AS unnest))) OR ((type = 'debt'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_debts'::text, 'write'::text)) AS unnest)))))
  );

create policy finance_categories_insert on public.finance_categories
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (NOT is_system) AND (((type = 'income'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_income'::text, 'write'::text)) AS unnest))) OR ((type = 'expense'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_expense'::text, 'write'::text)) AS unnest))) OR ((type = 'debt'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_debts'::text, 'write'::text)) AS unnest)))))
  );

create policy finance_categories_update on public.finance_categories
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (NOT is_system) AND (((type = 'income'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_income'::text, 'write'::text)) AS unnest))) OR ((type = 'expense'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_expense'::text, 'write'::text)) AS unnest))) OR ((type = 'debt'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_debts'::text, 'write'::text)) AS unnest)))))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (NOT is_system) AND (((type = 'income'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_income'::text, 'write'::text)) AS unnest))) OR ((type = 'expense'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_expense'::text, 'write'::text)) AS unnest))) OR ((type = 'debt'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_debts'::text, 'write'::text)) AS unnest)))))
  );

create policy finance_categories_delete on public.finance_categories
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (NOT is_system) AND (((type = 'income'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_income'::text, 'write'::text)) AS unnest))) OR ((type = 'expense'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_expense'::text, 'write'::text)) AS unnest))) OR ((type = 'debt'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.settings_categories_debts'::text, 'write'::text)) AS unnest)))))
  );

-- finance_category_hidden
drop policy finance_category_hidden_owner_all on public.finance_category_hidden;
drop policy finance_category_hidden_select_access on public.finance_category_hidden;

create policy finance_category_hidden_select on public.finance_category_hidden
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT cardinality(access_calendars('finance.income'::text, 'read'::text)) AS cardinality) > 0) OR (( SELECT cardinality(access_calendars('finance.expense'::text, 'read'::text)) AS cardinality) > 0) OR (( SELECT cardinality(access_calendars('finance.debts'::text, 'read'::text)) AS cardinality) > 0) OR (( SELECT cardinality(access_calendars('calendar.day_money'::text, 'read'::text)) AS cardinality) > 0)))
  );

create policy finance_category_hidden_insert on public.finance_category_hidden
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy finance_category_hidden_update on public.finance_category_hidden
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy finance_category_hidden_delete on public.finance_category_hidden
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- finance_category_order
drop policy finance_category_order_owner_all on public.finance_category_order;
drop policy finance_category_order_select_access on public.finance_category_order;

create policy finance_category_order_select on public.finance_category_order
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT cardinality(access_calendars('finance.income'::text, 'read'::text)) AS cardinality) > 0) OR (( SELECT cardinality(access_calendars('finance.expense'::text, 'read'::text)) AS cardinality) > 0) OR (( SELECT cardinality(access_calendars('finance.debts'::text, 'read'::text)) AS cardinality) > 0) OR (( SELECT cardinality(access_calendars('calendar.day_money'::text, 'read'::text)) AS cardinality) > 0)))
  );

create policy finance_category_order_insert on public.finance_category_order
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy finance_category_order_update on public.finance_category_order
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy finance_category_order_delete on public.finance_category_order
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- finance_templates
drop policy finance_templates_owner_all on public.finance_templates;
drop policy finance_templates_select_access on public.finance_templates;

create policy finance_templates_select on public.finance_templates
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((brigade_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'read'::text)) AS unnest)) OR (brigade_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'read'::text)) AS unnest))))
  );

create policy finance_templates_insert on public.finance_templates
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy finance_templates_update on public.finance_templates
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy finance_templates_delete on public.finance_templates
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- finance_transactions
drop policy finance_transactions_delete_day_money on public.finance_transactions;
drop policy finance_transactions_delete_debt on public.finance_transactions;
drop policy finance_transactions_delete_expense on public.finance_transactions;
drop policy finance_transactions_delete_income on public.finance_transactions;
drop policy finance_transactions_insert_day_money on public.finance_transactions;
drop policy finance_transactions_insert_debt on public.finance_transactions;
drop policy finance_transactions_insert_expense on public.finance_transactions;
drop policy finance_transactions_insert_income on public.finance_transactions;
drop policy finance_transactions_owner_all on public.finance_transactions;
drop policy finance_transactions_select_calendar on public.finance_transactions;
drop policy finance_transactions_select_day_money on public.finance_transactions;
drop policy finance_transactions_select_debt on public.finance_transactions;
drop policy finance_transactions_update_day_money on public.finance_transactions;
drop policy finance_transactions_update_debt on public.finance_transactions;
drop policy finance_transactions_update_expense on public.finance_transactions;
drop policy finance_transactions_update_income on public.finance_transactions;

create policy finance_transactions_select on public.finance_transactions
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (((type = ANY (ARRAY['income'::text, 'refund'::text])) AND (team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'read'::text)) AS unnest))) OR ((type = 'expense'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'read'::text)) AS unnest))) OR ((type = 'transfer'::text) AND (team_id IN ( SELECT unnest(access_calendars('finance.accounts'::text, 'read'::text)) AS unnest)))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (type = ANY (ARRAY['income'::text, 'refund'::text, 'expense'::text])) AND ((appointment_id IS NOT NULL) OR from_calendar) AND (team_id IN ( SELECT unnest(access_calendars('calendar.day_money'::text, 'read'::text)) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (debt_id IN ( SELECT d.id
   FROM debts d
  WHERE ((d.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (d.team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'read'::text)) AS unnest))))))
  );

create policy finance_transactions_insert on public.finance_transactions
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND from_calendar AND (type = ANY (ARRAY['income'::text, 'expense'::text])) AND (team_id IN ( SELECT unnest(access_calendars('calendar.day_money'::text, 'write'::text)) AS unnest)) AND (appointment_id IS NULL) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (debt_id IS NULL) AND (created_by = ( SELECT auth.uid() AS uid)) AND (occurred_on >= COALESCE(((( SELECT member_day_money_window_starts() AS member_day_money_window_starts) ->> team_id))::date, '-infinity'::date)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('calendar.day_money'::text, 'write'::text)) AS unnest))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest)) AND (type = ANY (ARRAY['income'::text, 'expense'::text])) AND (debt_id IN ( SELECT d.id
   FROM debts d
  WHERE ((d.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (d.team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest))))) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND ((type = 'expense'::text) OR (appointment_id IS NULL)) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.debts'::text, 'write'::text)) AS unnest))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'write'::text)) AS unnest)) AND (type = 'expense'::text) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (debt_id IS NULL) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.expense'::text, 'write'::text)) AS unnest))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'write'::text)) AS unnest)) AND (type = 'income'::text) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (appointment_id IS NULL) AND (debt_id IS NULL) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.income'::text, 'write'::text)) AS unnest))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy finance_transactions_update on public.finance_transactions
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND from_calendar AND (type = ANY (ARRAY['income'::text, 'expense'::text])) AND (team_id IN ( SELECT unnest(access_calendars('calendar.day_money'::text, 'write'::text)) AS unnest)) AND (appointment_id IS NULL) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (debt_id IS NULL) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('calendar.day_money'::text, 'write'::text)) AS unnest))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest)) AND (type = ANY (ARRAY['income'::text, 'expense'::text])) AND (debt_id IN ( SELECT d.id
   FROM debts d
  WHERE ((d.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (d.team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest))))) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND ((type = 'expense'::text) OR (appointment_id IS NULL)) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.debts'::text, 'write'::text)) AS unnest))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (type = 'expense'::text) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (debt_id IS NULL) AND ((team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'full'::text)) AS unnest)) OR ((team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'write'::text)) AS unnest)) AND (created_by = ( SELECT auth.uid() AS uid)))) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.expense'::text, 'write'::text)) AS unnest))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (type = 'income'::text) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (appointment_id IS NULL) AND (debt_id IS NULL) AND ((team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'full'::text)) AS unnest)) OR ((team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'write'::text)) AS unnest)) AND (created_by = ( SELECT auth.uid() AS uid)))) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.income'::text, 'write'::text)) AS unnest))))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND from_calendar AND (type = ANY (ARRAY['income'::text, 'expense'::text])) AND (team_id IN ( SELECT unnest(access_calendars('calendar.day_money'::text, 'write'::text)) AS unnest)) AND (appointment_id IS NULL) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (debt_id IS NULL) AND (created_by = ( SELECT auth.uid() AS uid)) AND (occurred_on >= COALESCE(((( SELECT member_day_money_window_starts() AS member_day_money_window_starts) ->> team_id))::date, '-infinity'::date)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('calendar.day_money'::text, 'write'::text)) AS unnest))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest)) AND (type = ANY (ARRAY['income'::text, 'expense'::text])) AND (debt_id IN ( SELECT d.id
   FROM debts d
  WHERE ((d.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (d.team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest))))) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND ((type = 'expense'::text) OR (appointment_id IS NULL)) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.debts'::text, 'write'::text)) AS unnest))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (type = 'expense'::text) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (debt_id IS NULL) AND ((team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'full'::text)) AS unnest)) OR ((team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'write'::text)) AS unnest)) AND (created_by = ( SELECT auth.uid() AS uid)))) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.expense'::text, 'write'::text)) AS unnest))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (type = 'income'::text) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (appointment_id IS NULL) AND (debt_id IS NULL) AND ((team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'full'::text)) AS unnest)) OR ((team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'write'::text)) AS unnest)) AND (created_by = ( SELECT auth.uid() AS uid)))) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.income'::text, 'write'::text)) AS unnest))))
  );

create policy finance_transactions_delete on public.finance_transactions
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND from_calendar AND (type = ANY (ARRAY['income'::text, 'expense'::text])) AND (team_id IN ( SELECT unnest(access_calendars('calendar.day_money'::text, 'write'::text)) AS unnest)) AND (appointment_id IS NULL) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (debt_id IS NULL) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('calendar.day_money'::text, 'write'::text)) AS unnest))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest)) AND (type = ANY (ARRAY['income'::text, 'expense'::text])) AND (debt_id IN ( SELECT d.id
   FROM debts d
  WHERE ((d.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (d.team_id IN ( SELECT unnest(access_calendars('finance.debts'::text, 'write'::text)) AS unnest))))) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND ((type = 'expense'::text) OR (appointment_id IS NULL)) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.debts'::text, 'write'::text)) AS unnest))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (type = 'expense'::text) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (debt_id IS NULL) AND ((team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'full'::text)) AS unnest)) OR ((team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'write'::text)) AS unnest)) AND (created_by = ( SELECT auth.uid() AS uid)))) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.expense'::text, 'write'::text)) AS unnest))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (type = 'income'::text) AND (invoice_id IS NULL) AND (refund_of_id IS NULL) AND (appointment_id IS NULL) AND (debt_id IS NULL) AND ((team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'full'::text)) AS unnest)) OR ((team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'write'::text)) AS unnest)) AND (created_by = ( SELECT auth.uid() AS uid)))) AND ((account_id IS NULL) OR (account_id IN ( SELECT unnest(access_accounts_for('finance.income'::text, 'write'::text)) AS unnest))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- finance_transfer_requests
drop policy finance_transfer_requests_owner_select on public.finance_transfer_requests;
drop policy finance_transfer_requests_select_calendar on public.finance_transfer_requests;

create policy finance_transfer_requests_select on public.finance_transfer_requests
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (ARRAY[from_account_id, to_account_id] <@ ( SELECT access_accounts_for('finance.accounts'::text, 'read'::text) AS access_accounts_for)))
  );

-- invitations
drop policy invitations_owner_delete on public.invitations;
drop policy invitations_owner_select on public.invitations;
drop policy invitations_partners_delete on public.invitations;
drop policy invitations_partners_select on public.invitations;

create policy invitations_select on public.invitations
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ( SELECT access_company('company.partners'::text, 'read'::text) AS access_company))
  );

create policy invitations_delete on public.invitations
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text) AND (accepted_at IS NULL))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ( SELECT access_company('company.partners'::text, 'write'::text) AS access_company) AND (accepted_at IS NULL) AND (invited_by_user_id = ( SELECT auth.uid() AS uid)))
  );

-- invoice_lines
drop policy invoice_lines_owner_all on public.invoice_lines;
drop policy invoice_lines_select_documents on public.invoice_lines;

create policy invoice_lines_select on public.invoice_lines
  as permissive for select to authenticated
  using (
    ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) AND (EXISTS ( SELECT 1
   FROM invoices i
  WHERE ((i.id = invoice_lines.invoice_id) AND (i.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id))))))
    or (invoice_id IN ( SELECT invoice.id
   FROM invoices invoice
  WHERE ((invoice.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (invoice.brigade_id IN ( SELECT unnest(access_calendars('finance.documents'::text, 'read'::text)) AS unnest)))))
  );

create policy invoice_lines_insert on public.invoice_lines
  as permissive for insert to authenticated
  with check (
    ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) AND (EXISTS ( SELECT 1
   FROM invoices i
  WHERE ((i.id = invoice_lines.invoice_id) AND (i.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id))))))
  );

create policy invoice_lines_update on public.invoice_lines
  as permissive for update to authenticated
  using (
    ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) AND (EXISTS ( SELECT 1
   FROM invoices i
  WHERE ((i.id = invoice_lines.invoice_id) AND (i.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id))))))
  )
  with check (
    ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) AND (EXISTS ( SELECT 1
   FROM invoices i
  WHERE ((i.id = invoice_lines.invoice_id) AND (i.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id))))))
  );

create policy invoice_lines_delete on public.invoice_lines
  as permissive for delete to authenticated
  using (
    ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) AND (EXISTS ( SELECT 1
   FROM invoices i
  WHERE ((i.id = invoice_lines.invoice_id) AND (i.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id))))))
  );

-- invoices
drop policy invoices_owner_all on public.invoices;
drop policy invoices_select_documents on public.invoices;
drop policy invoices_update_documents on public.invoices;

create policy invoices_select on public.invoices
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (brigade_id IN ( SELECT unnest(access_calendars('finance.documents'::text, 'read'::text)) AS unnest)))
  );

create policy invoices_insert on public.invoices
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy invoices_update on public.invoices
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (brigade_id IN ( SELECT unnest(access_calendars('finance.documents'::text, 'write'::text)) AS unnest)))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (brigade_id IN ( SELECT unnest(access_calendars('finance.documents'::text, 'write'::text)) AS unnest)))
  );

create policy invoices_delete on public.invoices
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- legal_entities
drop policy legal_entities_read on public.legal_entities;
drop policy legal_entities_select_settings on public.legal_entities;
drop policy legal_entities_write_owner on public.legal_entities;

create policy legal_entities_select on public.legal_entities
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ( SELECT access_company('finance.settings_requisites'::text, 'read'::text) AS access_company))
  );

create policy legal_entities_insert on public.legal_entities
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy legal_entities_update on public.legal_entities
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy legal_entities_delete on public.legal_entities
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- masters
drop policy masters_select_owner on public.masters;
drop policy masters_select_partners on public.masters;
drop policy masters_update_partners on public.masters;
drop policy masters_write_owner on public.masters;

create policy masters_select on public.masters
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ( SELECT access_company('company.partners'::text, 'read'::text) AS access_company))
  );

create policy masters_insert on public.masters
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy masters_update on public.masters
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND partners_card_manageable(id))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND partners_card_manageable(id))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy masters_delete on public.masters
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- personal_event_types
drop policy personal_event_types_select on public.personal_event_types;
drop policy personal_event_types_write on public.personal_event_types;
drop policy personal_event_types_write_access on public.personal_event_types;

create policy personal_event_types_select on public.personal_event_types
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) IS NOT NULL) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IS NULL) OR (team_id IN ( SELECT mc.team_id
   FROM member_calendars mc
  WHERE ((mc.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (mc.user_id = ( SELECT auth.uid() AS uid)))))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.booking_form'::text, 'write'::text)) AS unnest)))
  );

create policy personal_event_types_insert on public.personal_event_types
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.booking_form'::text, 'write'::text)) AS unnest)))
  );

create policy personal_event_types_update on public.personal_event_types
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.booking_form'::text, 'write'::text)) AS unnest)))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.booking_form'::text, 'write'::text)) AS unnest)))
  );

create policy personal_event_types_delete on public.personal_event_types
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.booking_form'::text, 'write'::text)) AS unnest)))
  );

-- receipts
drop policy receipts_read on public.receipts;
drop policy receipts_read_own_money on public.receipts;
drop policy receipts_select_documents on public.receipts;

create policy receipts_select on public.receipts
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (transaction_id IN ( SELECT ft.id
   FROM finance_transactions ft
  WHERE (ft.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)))) AND ((client_id IS NULL) OR (client_id IN ( SELECT unnest(access_block_client_ids('clients.history'::text, 'read'::text)) AS unnest))) AND (team_id IN ( SELECT unnest(access_calendars('finance.documents'::text, 'read'::text)) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('finance.documents'::text, 'read'::text)) AS unnest)))
  );

-- service_categories
drop policy service_categories_select_access on public.service_categories;
drop policy service_categories_select_operator on public.service_categories;
drop policy service_categories_write_owner on public.service_categories;

create policy service_categories_select on public.service_categories
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT COALESCE(cardinality(access_calendars('calendar.services'::text, 'read'::text)), 0) AS "coalesce") > 0))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy service_categories_insert on public.service_categories
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy service_categories_update on public.service_categories
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy service_categories_delete on public.service_categories
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- service_variants
drop policy service_variants_select_owner on public.service_variants;
drop policy service_variants_write_owner on public.service_variants;

create policy service_variants_select on public.service_variants
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy service_variants_insert on public.service_variants
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy service_variants_update on public.service_variants
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy service_variants_delete on public.service_variants
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- services
drop policy services_select_access on public.services;
drop policy services_select_owner on public.services;
drop policy services_write_access on public.services;
drop policy services_write_owner on public.services;

create policy services_select on public.services
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.services'::text, 'read'::text)) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.services'::text, 'write'::text)) AS unnest)))
  );

create policy services_insert on public.services
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.services'::text, 'write'::text)) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy services_update on public.services
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.services'::text, 'write'::text)) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.services'::text, 'write'::text)) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy services_delete on public.services
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(access_calendars('calendar.services'::text, 'write'::text)) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- team_design
drop policy team_design_select on public.team_design;
drop policy team_design_write_access on public.team_design;
drop policy team_design_write_owner on public.team_design;

create policy team_design_select on public.team_design
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT mc.team_id
   FROM member_calendars mc
  WHERE ((mc.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (mc.user_id = ( SELECT auth.uid() AS uid)))))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(((((access_calendars('calendar.booking_form'::text, 'write'::text) || access_calendars('clients.settings_card'::text, 'write'::text)) || access_calendars('clients.settings_ways'::text, 'write'::text)) || access_calendars('clients.settings_maps'::text, 'write'::text)) || access_calendars('clients.settings_objects'::text, 'write'::text))) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy team_design_insert on public.team_design
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(((((access_calendars('calendar.booking_form'::text, 'write'::text) || access_calendars('clients.settings_card'::text, 'write'::text)) || access_calendars('clients.settings_ways'::text, 'write'::text)) || access_calendars('clients.settings_maps'::text, 'write'::text)) || access_calendars('clients.settings_objects'::text, 'write'::text))) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy team_design_update on public.team_design
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(((((access_calendars('calendar.booking_form'::text, 'write'::text) || access_calendars('clients.settings_card'::text, 'write'::text)) || access_calendars('clients.settings_ways'::text, 'write'::text)) || access_calendars('clients.settings_maps'::text, 'write'::text)) || access_calendars('clients.settings_objects'::text, 'write'::text))) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(((((access_calendars('calendar.booking_form'::text, 'write'::text) || access_calendars('clients.settings_card'::text, 'write'::text)) || access_calendars('clients.settings_ways'::text, 'write'::text)) || access_calendars('clients.settings_maps'::text, 'write'::text)) || access_calendars('clients.settings_objects'::text, 'write'::text))) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy team_design_delete on public.team_design
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (team_id IN ( SELECT unnest(((((access_calendars('calendar.booking_form'::text, 'write'::text) || access_calendars('clients.settings_card'::text, 'write'::text)) || access_calendars('clients.settings_ways'::text, 'write'::text)) || access_calendars('clients.settings_maps'::text, 'write'::text)) || access_calendars('clients.settings_objects'::text, 'write'::text))) AS unnest)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- team_finance_settings
drop policy team_finance_settings_owner on public.team_finance_settings;
drop policy team_finance_settings_select_access on public.team_finance_settings;

create policy team_finance_settings_select on public.team_finance_settings
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((team_id IN ( SELECT unnest(access_calendars('finance.income'::text, 'read'::text)) AS unnest)) OR (team_id IN ( SELECT unnest(access_calendars('finance.expense'::text, 'read'::text)) AS unnest)) OR (team_id IN ( SELECT unnest(access_calendars('calendar.day_money'::text, 'read'::text)) AS unnest))))
  );

create policy team_finance_settings_insert on public.team_finance_settings
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy team_finance_settings_update on public.team_finance_settings
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy team_finance_settings_delete on public.team_finance_settings
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- team_schedules
drop policy team_schedules_select_access on public.team_schedules;
drop policy team_schedules_write_access on public.team_schedules;

create policy team_schedules_select on public.team_schedules
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('calendar.schedule'::text, 'read'::text)) AS unnest))))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('calendar.schedule'::text, 'write'::text)) AS unnest))))
  );

create policy team_schedules_insert on public.team_schedules
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('calendar.schedule'::text, 'write'::text)) AS unnest))))
  );

create policy team_schedules_update on public.team_schedules
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('calendar.schedule'::text, 'write'::text)) AS unnest))))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('calendar.schedule'::text, 'write'::text)) AS unnest))))
  );

create policy team_schedules_delete on public.team_schedules
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((( SELECT current_user_role() AS current_user_role) = 'owner'::text) OR (team_id IN ( SELECT unnest(access_calendars('calendar.schedule'::text, 'write'::text)) AS unnest))))
  );

-- teams
drop policy teams_select_owner on public.teams;
drop policy teams_write_owner on public.teams;

create policy teams_select on public.teams
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy teams_insert on public.teams
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy teams_update on public.teams
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy teams_delete on public.teams
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- tenant_loyalty_settings
drop policy tenant_loyalty_settings_select_operator on public.tenant_loyalty_settings;
drop policy tenant_loyalty_settings_write_owner on public.tenant_loyalty_settings;

create policy tenant_loyalty_settings_select on public.tenant_loyalty_settings
  as permissive for select to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['owner'::text, 'dispatcher'::text])))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy tenant_loyalty_settings_insert on public.tenant_loyalty_settings
  as permissive for insert to authenticated
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy tenant_loyalty_settings_update on public.tenant_loyalty_settings
  as permissive for update to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  )
  with check (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

create policy tenant_loyalty_settings_delete on public.tenant_loyalty_settings
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
  );

-- tenant_members
drop policy tenant_members_delete_owner on public.tenant_members;
drop policy tenant_members_delete_partners on public.tenant_members;
drop policy tenant_members_select_owner_or_self on public.tenant_members;
drop policy tenant_members_select_partners on public.tenant_members;
drop policy tenant_members_self_leave on public.tenant_members;

create policy tenant_members_select on public.tenant_members
  as permissive for select to authenticated
  using (
    ((user_id = ( SELECT auth.uid() AS uid)) OR ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text)))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ( SELECT access_company('company.partners'::text, 'read'::text) AS access_company))
  );

create policy tenant_members_delete on public.tenant_members
  as permissive for delete to authenticated
  using (
    ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (( SELECT current_user_role() AS current_user_role) = 'owner'::text))
    or ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND partners_removable(user_id))
    or (user_id = ( SELECT auth.uid() AS uid))
  );

do $guard$
declare
  doubles text;
begin
  -- Ни у одной таблицы схемы — двух разрешающих политик на одно действие.
  select string_agg(format('%s/%s', t.tablename, c.cmd), ', ' order by t.tablename, c.cmd) into doubles
    from (select distinct tablename from pg_policies where schemaname = 'public') t
   cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) c(cmd)
   where (
     select count(*)
       from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = t.tablename
        and p.permissive = 'PERMISSIVE'
        and p.cmd in (c.cmd, 'ALL')
        and p.roles && array['authenticated', 'public']::name[]
   ) > 1;
  if doubles is not null then
    raise exception 'остались двойные разрешающие политики: %', doubles;
  end if;
  -- У каждой тронутой таблицы RLS включён, и чтение кому-то разрешено.
  select string_agg(t, ', ') into doubles
    from unnest(array[
      'account_teams',
      'accounts',
      'appointment_photos',
      'calendar_members',
      'calendar_settings',
      'cities',
      'client_attachments',
      'client_sources',
      'client_tag_assignments',
      'client_tags',
      'day_cities',
      'day_extras',
      'equipment',
      'finance_categories',
      'finance_category_hidden',
      'finance_category_order',
      'finance_templates',
      'finance_transactions',
      'finance_transfer_requests',
      'invitations',
      'invoice_lines',
      'invoices',
      'legal_entities',
      'masters',
      'personal_event_types',
      'receipts',
      'service_categories',
      'service_variants',
      'services',
      'team_design',
      'team_finance_settings',
      'team_schedules',
      'teams',
      'tenant_loyalty_settings',
      'tenant_members'
    ]::text[]) t
   where not exists (
     select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = t and p.cmd = 'SELECT' and p.permissive = 'PERMISSIVE'
   )
      or not (select c.relrowsecurity from pg_class c where c.oid = format('public.%I', t)::regclass);
  if doubles is not null then
    raise exception 'без политики чтения или без RLS: %', doubles;
  end if;
end;
$guard$;
