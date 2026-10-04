-- «ИСТОРИЯ ИЗМЕНЕНИЙ» ДЛЯ ПАРТНЁРА — ПРАВО РАЗДЕЛА «КАБИНЕТ» (владелец 04.10:
-- «также ещё можно добавить историю изменений»).
--
-- Рядом с тарифом, оплатами, SMS и реквизитами: `cabinet.history` — Скрыта ·
-- Видит. «Видит» ставит в Кабинете партнёра, в блоке вашего аккаунта, строку
-- «История изменений»: кто что менял в КОМАНДАХ, где он работает, и только в
-- тех разделах, которые ему открыты правами этой команды — запись видна по
-- «Записям клиентов», операция — по «Доходам» или «Расходам», инвойс — по
-- «Документам» и так далее. Права и состав людей (member_access,
-- member_calendars, tenant_members, masters, invitations), реквизиты аккаунта
-- и шаблоны SMS — только владельцу: их в журнале партнёра нет.
--
-- Та же таблица соответствий живёт в приложении (`history-access.ts`, режет
-- журнал в «Посмотреть его глазами»); сверку держит
-- `history-access.test.ts`.

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values (
  'cabinet.history', 'company', 'company', array['off', 'read'],
  'История изменений', false, true,
  array['policy:public.change_log.change_log_select_partner'],
  374
)
on conflict (key) do update
  set area = excluded.area, scope = excluded.scope, levels = excluded.levels,
      title_ru = excluded.title_ru, owner_only = excluded.owner_only,
      live = excluded.live, enforced_by = excluded.enforced_by,
      position = excluded.position;

drop policy if exists change_log_select_partner on public.change_log;
create policy change_log_select_partner on public.change_log
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.access_company('cabinet.history', 'read'))
    and team_id is not null
    and case entity
      when 'appointments' then team_id in (select unnest(public.access_calendars('calendar.records', 'read')))
      when 'appointment_photos' then team_id in (select unnest(public.access_calendars('record.files', 'read')))
      when 'day_cities' then team_id in (select unnest(public.access_calendars('calendar.day_labels', 'read')))
      when 'clients' then team_id in (select unnest(public.access_calendars('clients', 'read')))
      when 'client_attachments' then team_id in (select unnest(public.access_calendars('clients.files', 'read')))
      when 'client_tag_assignments' then team_id in (select unnest(public.access_calendars('clients.tags', 'read')))
      when 'client_tags' then team_id in (select unnest(public.access_calendars('clients.settings_tags', 'read')))
      when 'client_sources' then team_id in (select unnest(public.access_calendars('clients.settings_sources', 'read')))
      when 'finance_transactions' then team_id in (select unnest(public.access_calendars('finance.income', 'read') || public.access_calendars('finance.expense', 'read')))
      when 'finance_categories' then team_id in (select unnest(public.access_calendars('finance.settings_categories_income', 'read') || public.access_calendars('finance.settings_categories_expense', 'read') || public.access_calendars('finance.settings_categories_debts', 'read')))
      when 'debts' then team_id in (select unnest(public.access_calendars('finance.debts', 'read')))
      when 'accounts' then team_id in (select unnest(public.access_calendars('finance.accounts', 'read')))
      when 'invoices' then team_id in (select unnest(public.access_calendars('finance.documents', 'read')))
      when 'receipts' then team_id in (select unnest(public.access_calendars('finance.documents', 'read')))
      when 'services' then team_id in (select unnest(public.access_calendars('calendar.services', 'read')))
      when 'cities' then team_id in (select unnest(public.access_calendars('calendar.labels', 'read')))
      when 'location_labels' then team_id in (select unnest(public.access_calendars('calendar.labels', 'read')))
      when 'team_schedules' then team_id in (select unnest(public.access_calendars('calendar.schedule', 'read')))
      when 'teams' then team_id in (select unnest(public.access_calendars('calendar.identity', 'read')))
      when 'calendar_settings' then team_id in (select unnest(public.access_calendars('calendar.hours', 'read')))
      when 'team_design' then team_id in (select unnest(public.access_calendars('calendar.booking_form', 'read')))
      when 'personal_event_types' then team_id in (select unnest(public.access_calendars('calendar.booking_form', 'read')))
      else false
    end
  );
