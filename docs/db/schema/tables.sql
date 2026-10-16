-- Snapshot of the live `public` schema: tables, columns, constraints, RLS switches.
-- Taken 2026-10-13 from production with read-only catalog queries
-- (see docs/db/README.md). Reference only — never apply this file;
-- the history that built it is supabase/migrations/.

create table public._calendar_delete_context (
  transaction_id bigint not null,
  tenant_id uuid not null,
  team_id text not null,
  started_at timestamp with time zone not null default now(),
  constraint _calendar_delete_context_pkey PRIMARY KEY (transaction_id)
);
alter table public._calendar_delete_context enable row level security;
comment on table public._calendar_delete_context is 'Пропуск сторожам на время удаления календаря. Строку кладёт только delete_calendar, живёт она внутри своей транзакции.';

create table public._finance_write_context (
  transaction_id bigint not null,
  kind text not null,
  entity_id uuid not null,
  tenant_id uuid not null,
  occurred_on date,
  payment_id text,
  constraint _finance_write_context_kind_check CHECK ((kind = ANY (ARRAY['appointment_auto'::text, 'appointment_undo'::text, 'appointment_prepayment'::text, 'appointment_payment_reset'::text, 'transfer_write'::text, 'invoice_payment'::text, 'appointment_payment_meta'::text, 'appointment_payment_cancel'::text]))),
  constraint _finance_write_context_pkey PRIMARY KEY (transaction_id, kind, entity_id)
);
alter table public._finance_write_context enable row level security;

create table public.access_blocks (
  key text not null,
  area text not null,
  scope text not null,
  levels text[] not null,
  title_ru text not null,
  owner_only boolean not null default false,
  live boolean not null default false,
  enforced_by text[] not null default '{}'::text[],
  position integer not null,
  constraint access_blocks_area_check CHECK ((area = ANY (ARRAY['calendar'::text, 'finance'::text, 'clients'::text, 'company'::text, 'owner'::text]))),
  constraint access_blocks_levels_check CHECK ((cardinality(levels) >= 1)),
  constraint access_blocks_scope_check CHECK ((scope = ANY (ARRAY['calendar'::text, 'company'::text]))),
  constraint access_blocks_pkey PRIMARY KEY (key)
);
alter table public.access_blocks enable row level security;
comment on table public.access_blocks is 'Реестр блоков прав. Первое значение levels — умолчание (нет строки в member_access). live = сервер уже проверяет блок; только такие видны в картах прав и на экране владельца.';

create table public.access_templates (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  levels jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint access_templates_levels_check CHECK ((jsonb_typeof(levels) = 'object'::text)),
  constraint access_templates_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 60))),
  constraint access_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint access_templates_pkey PRIMARY KEY (id)
);
alter table public.access_templates enable row level security;

create table public.account_deletion_cleanup (
  user_id uuid not null,
  status text not null,
  deleted_tenant_count integer not null default 0,
  last_error_code text,
  attempt_count integer not null default 0,
  next_retry_at timestamp with time zone not null default (now() + '00:05:00'::interval),
  lease_token uuid,
  lease_expires_at timestamp with time zone,
  requested_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint account_deletion_cleanup_attempt_count_check CHECK ((attempt_count >= 0)),
  constraint account_deletion_cleanup_deleted_tenant_count_check CHECK ((deleted_tenant_count >= 0)),
  constraint account_deletion_cleanup_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'soft_delete_failed'::text, 'soft_deleted'::text, 'tenant_cleanup_failed'::text, 'tenant_data_deleted'::text, 'pending_auth_delete'::text]))),
  constraint account_deletion_cleanup_pkey PRIMARY KEY (user_id)
);
alter table public.account_deletion_cleanup enable row level security;

create table public.account_teams (
  account_id uuid not null,
  tenant_id uuid not null,
  team_id text not null,
  created_at timestamp with time zone not null default now(),
  constraint account_teams_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  constraint account_teams_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint account_teams_pkey PRIMARY KEY (account_id, team_id)
);
alter table public.account_teams enable row level security;
comment on table public.account_teams is 'Историческая таблица подключений общего счёта к бригадам. Живой продукт её не пишет и не читает: у счёта один владелец — accounts.brigade_id.';

create table public.accounts (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  brigade_id text not null,
  name text not null,
  kind text not null,
  owner_master_id text,
  opening_balance numeric(12,2) not null default 0,
  icon text,
  color text,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  created_by uuid,
  scope text not null default 'team'::text,
  balance_hidden boolean not null default false,
  vat_mode text,
  is_primary boolean not null default false,
  show_in_payments boolean not null default true,
  note text,
  deleted_at timestamp with time zone,
  purge_at timestamp with time zone,
  is_hidden boolean not null default false,
  constraint accounts_deleted_is_closed CHECK (((deleted_at IS NULL) OR (is_active = false))),
  constraint accounts_hidden_not_in_payments CHECK ((NOT (is_hidden AND show_in_payments))),
  constraint accounts_kind_check CHECK ((kind = ANY (ARRAY['cash'::text, 'card'::text, 'bank'::text, 'other'::text]))),
  constraint accounts_note_length CHECK (((note IS NULL) OR (char_length(note) <= 500))),
  constraint accounts_opening_balance_finite CHECK ((opening_balance <> 'NaN'::numeric)),
  constraint accounts_purge_needs_deleted CHECK (((purge_at IS NULL) OR (deleted_at IS NOT NULL))),
  constraint accounts_scope_check CHECK ((scope = 'team'::text)),
  constraint accounts_vat_mode_check CHECK (((vat_mode IS NULL) OR (vat_mode = ANY (ARRAY['off'::text, 'inclusive'::text, 'exclusive'::text, 'on'::text])))),
  constraint accounts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id),
  constraint accounts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint accounts_pkey PRIMARY KEY (id)
);
alter table public.accounts enable row level security;

create table public.app_release (
  platform text not null,
  latest_version text not null,
  min_version text not null default '0.0.0'::text,
  store_url text not null,
  updated_at timestamp with time zone not null default now(),
  constraint app_release_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text]))),
  constraint app_release_pkey PRIMARY KEY (platform)
);
alter table public.app_release enable row level security;

create table public.app_settings (
  key text not null,
  value text not null,
  updated_at timestamp with time zone not null default now(),
  constraint app_settings_pkey PRIMARY KEY (key)
);
alter table public.app_settings enable row level security;
comment on table public.app_settings is 'Generic key-value store for global feature flags / settings that change infrequently (master switches, kill flips). Reads happen through security-definer helpers; never expose to authenticated.';

create table public.appointment_links (
  appointment_id uuid not null,
  tenant_id uuid not null,
  token text not null,
  created_at timestamp with time zone not null default now(),
  answer text,
  answered_at timestamp with time zone,
  constraint appointment_links_answer_check CHECK (((answer IS NULL) OR (answer = ANY (ARRAY['confirmed'::text, 'cancelled'::text])))),
  constraint appointment_links_token_len CHECK (((length(token) >= 10) AND (length(token) <= 64))),
  constraint appointment_links_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  constraint appointment_links_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint appointment_links_pkey PRIMARY KEY (appointment_id),
  constraint appointment_links_token_key UNIQUE (token)
);
alter table public.appointment_links enable row level security;
comment on table public.appointment_links is 'Ссылка «Подтвердить / Отменить» записи для SMS и ответ клиента (STORY-089). Только через функции.';

create table public.appointment_photos (
  id uuid not null default gen_random_uuid(),
  appointment_id uuid not null,
  tenant_id uuid not null,
  storage_path text not null,
  kind text not null default 'other'::text,
  caption text not null default ''::text,
  location_id text,
  taken_at timestamp with time zone,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint appointment_photos_kind_check CHECK ((kind = ANY (ARRAY['before'::text, 'after'::text, 'other'::text]))),
  constraint appointment_photos_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  constraint appointment_photos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint appointment_photos_pkey PRIMARY KEY (id)
);
alter table public.appointment_photos enable row level security;

create table public.appointments (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  client_id uuid,
  team_id text,
  master_id text,
  location_id text,
  date text not null,
  time_start text not null,
  time_end text not null,
  kind text not null default 'work'::text,
  status text not null default 'scheduled'::text,
  total_amount numeric not null default 0,
  custom_total boolean not null default false,
  discount_amount numeric not null default 0,
  prepaid_amount numeric not null default 0,
  comment text not null default ''::text,
  address text not null default ''::text,
  address_note text not null default ''::text,
  address_lat double precision,
  address_lng double precision,
  cancel_reason text,
  source text,
  is_online_booking boolean not null default false,
  consent_given boolean not null default true,
  color_override text,
  reminder_enabled boolean not null default false,
  reminder_offsets jsonb not null default '[]'::jsonb,
  reminder_template text not null default ''::text,
  service_ids jsonb not null default '[]'::jsonb,
  services jsonb not null default '[]'::jsonb,
  service_price_overrides jsonb not null default '{}'::jsonb,
  expenses jsonb not null default '[]'::jsonb,
  payments jsonb not null default '[]'::jsonb,
  payment jsonb,
  global_discount jsonb,
  total_duration integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  created_by uuid,
  payment_status text not null default 'unpaid'::text,
  payment_method text,
  paid_amount numeric not null default 0,
  event_all_day boolean not null default false,
  event_notes text not null default ''::text,
  event_url text not null default ''::text,
  event_push_enabled boolean not null default false,
  event_push_offsets jsonb not null default '[]'::jsonb,
  event_push_at timestamp with time zone,
  event_repeat jsonb not null default '{"kind": "none"}'::jsonb,
  payment_account_id uuid,
  city text,
  prepayments jsonb not null default '[]'::jsonb,
  vat_mode text,
  vat_rate numeric(5,2),
  material_lines jsonb,
  constraint appointments_kind_check CHECK ((kind = ANY (ARRAY['work'::text, 'event'::text, 'personal'::text]))),
  constraint appointments_payment_method_check CHECK (((payment_method IS NULL) OR (payment_method = ANY (ARRAY['cash'::text, 'card'::text, 'transfer'::text, 'other'::text])))),
  constraint appointments_payment_status_check CHECK ((payment_status = ANY (ARRAY['unpaid'::text, 'partial'::text, 'paid'::text, 'refunded'::text]))),
  constraint appointments_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text]))),
  constraint appointments_vat_mode_check CHECK (((vat_mode IS NULL) OR (vat_mode = ANY (ARRAY['on'::text, 'off'::text, 'none'::text, 'inclusive'::text, 'exclusive'::text])))),
  constraint appointments_vat_rate_range CHECK (((vat_rate IS NULL) OR ((vat_rate >= (0)::numeric) AND (vat_rate < (100)::numeric)))),
  constraint appointments_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  constraint appointments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id),
  constraint appointments_payment_account_id_fkey FOREIGN KEY (payment_account_id) REFERENCES accounts(id) ON DELETE SET NULL,
  constraint appointments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint appointments_pkey PRIMARY KEY (id)
);
alter table public.appointments enable row level security;

create table public.billing_events (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid,
  stripe_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamp with time zone not null default now(),
  constraint billing_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint billing_events_pkey PRIMARY KEY (id),
  constraint billing_events_stripe_event_id_key UNIQUE (stripe_event_id)
);
alter table public.billing_events enable row level security;

create table public.calendar_members (
  tenant_id uuid not null,
  team_id text not null,
  user_id uuid not null,
  master_id text,
  grants text[] not null default '{}'::text[],
  created_at timestamp with time zone not null default now(),
  created_by uuid,
  constraint calendar_members_grants_known CHECK ((grants <@ ARRAY['view'::text, 'book'::text, 'edit_all'::text, 'clients'::text, 'phones'::text, 'finance'::text, 'settings'::text])),
  constraint calendar_members_member_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_members(tenant_id, user_id) ON DELETE CASCADE,
  constraint calendar_members_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint calendar_members_tenant_id_team_id_fkey FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id) ON DELETE CASCADE,
  constraint calendar_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint calendar_members_pkey PRIMARY KEY (tenant_id, team_id, user_id)
);
alter table public.calendar_members enable row level security;
comment on table public.calendar_members is 'Права человека в КОНКРЕТНОМ календаре. Заменяет роль на всю компанию как источник прав; tenant_members.role остаётся смыслом компанейским (подписка, профиль компании, выдача прав).';

create table public.calendar_settings (
  tenant_id uuid not null,
  start_hour integer not null default 0,
  end_hour integer not null default 24,
  grid_step integer not null default 30,
  week_start text not null default 'monday'::text,
  timezone text not null default 'Europe/Nicosia'::text,
  buffer_minutes integer not null default 0,
  hide_cancelled boolean not null default false,
  allow_overtime boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  personal_labels jsonb,
  personal_default_label text,
  work_start_hour integer default 6,
  work_end_hour integer default 20,
  scroll_open_hour integer,
  days_off jsonb not null default '[0]'::jsonb,
  start_minute integer not null default 0,
  end_minute integer not null default 0,
  show_day_finance boolean not null default true,
  timezone_auto boolean not null default true,
  record_color_rule text not null default 'team'::text,
  record_color_palette jsonb,
  record_color_fallback text,
  disabled_features text[] not null default '{}'::text[],
  booking_block_order text[],
  constraint calendar_settings_booking_block_order_known CHECK (((booking_block_order IS NULL) OR (booking_block_order <@ ARRAY['team'::text, 'label'::text, 'when'::text, 'client'::text, 'object'::text, 'services'::text, 'payment'::text, 'note'::text, 'files'::text]))),
  constraint calendar_settings_buffer_minutes_check CHECK ((buffer_minutes >= 0)),
  constraint calendar_settings_disabled_features_known CHECK ((disabled_features <@ ARRAY['objects'::text, 'day_labels'::text, 'record_label'::text, 'events'::text, 'record_payment'::text, 'record_files'::text, 'record_note'::text, 'debts'::text, 'accounts'::text, 'documents'::text, 'client_people'::text, 'client_requisites'::text, 'client_files'::text])),
  constraint calendar_settings_end_hour_check CHECK (((end_hour >= 1) AND (end_hour <= 24))),
  constraint calendar_settings_grid_step_check CHECK ((grid_step = ANY (ARRAY[15, 30, 60]))),
  constraint calendar_settings_record_color_rule_check CHECK ((record_color_rule = ANY (ARRAY['team'::text, 'label'::text, 'service'::text]))),
  constraint calendar_settings_start_hour_check CHECK (((start_hour >= 0) AND (start_hour <= 23))),
  constraint calendar_settings_week_start_check CHECK ((week_start = ANY (ARRAY['monday'::text, 'sunday'::text]))),
  constraint calendar_settings_window_minutes_check CHECK (((start_minute >= 0) AND (start_minute <= 59) AND ((start_minute % 5) = 0) AND (end_minute >= 0) AND (end_minute <= 59) AND ((end_minute % 5) = 0) AND ((end_hour <> 24) OR (end_minute = 0)))),
  constraint calendar_settings_window_order_check CHECK ((((end_hour * 60) + end_minute) > ((start_hour * 60) + start_minute))),
  constraint calendar_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint calendar_settings_pkey PRIMARY KEY (tenant_id)
);
alter table public.calendar_settings enable row level security;

create table public.change_log (
  id bigint not null,
  tenant_id uuid not null,
  team_id text,
  actor_id uuid,
  actor_name text,
  entity text not null,
  entity_id text,
  action text not null,
  label text,
  meta jsonb,
  changes jsonb,
  created_at timestamp with time zone not null default now(),
  constraint change_log_action_check CHECK ((action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text, 'restore'::text]))),
  constraint change_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint change_log_pkey PRIMARY KEY (id)
);
alter table public.change_log enable row level security;

create table public.cities (
  id text not null,
  tenant_id uuid not null,
  name text not null,
  country text not null default ''::text,
  color text,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  weekdays smallint[] not null default '{}'::smallint[],
  deleted_at timestamp with time zone,
  team_id text not null,
  tint_day boolean not null default true,
  constraint cities_weekdays_range CHECK ((weekdays <@ ARRAY[(1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint, (7)::smallint])),
  constraint cities_team_fk FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id) ON DELETE CASCADE,
  constraint cities_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint cities_pkey PRIMARY KEY (tenant_id, id)
);
alter table public.cities enable row level security;

create table public.client_attachments (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  client_id uuid not null,
  storage_path text not null,
  filename text not null default ''::text,
  mime_type text not null default ''::text,
  size_bytes bigint not null default 0,
  created_at timestamp with time zone not null default now(),
  created_by uuid,
  appointment_id uuid,
  constraint client_attachments_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
  constraint client_attachments_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  constraint client_attachments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint client_attachments_pkey PRIMARY KEY (id)
);
alter table public.client_attachments enable row level security;
comment on table public.client_attachments is 'Metadata for files in storage bucket client-attachments. Tenant-scoped via RLS.';

create table public.client_contact_alerts (
  id bigint not null,
  tenant_id uuid not null,
  user_id uuid not null,
  kind text not null,
  clients_count integer not null,
  created_at timestamp with time zone not null default now(),
  seen_at timestamp with time zone,
  constraint client_contact_alerts_kind_check CHECK ((kind = ANY (ARRAY['spike'::text, 'limit'::text]))),
  constraint client_contact_alerts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint client_contact_alerts_pkey PRIMARY KEY (id)
);
alter table public.client_contact_alerts enable row level security;

create table public.client_contact_views (
  id bigint not null,
  tenant_id uuid not null,
  user_id uuid not null,
  client_id uuid not null,
  outcome text not null,
  counted boolean not null default false,
  opened_at timestamp with time zone not null default now(),
  constraint client_contact_views_outcome_check CHECK ((outcome = ANY (ARRAY['open'::text, 'day'::text, 'right'::text, 'limit'::text]))),
  constraint client_contact_views_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint client_contact_views_pkey PRIMARY KEY (id)
);
alter table public.client_contact_views enable row level security;

create table public.client_sources (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  team_id text not null,
  name text not null,
  position integer not null default 0,
  created_at timestamp with time zone not null default now(),
  key text,
  constraint client_sources_key_known CHECK (((key IS NULL) OR (key = ANY (ARRAY['referral'::text, 'instagram'::text, 'whatsapp'::text, 'google_maps'::text, 'website'::text, 'repeat'::text, 'walk_in'::text, 'other'::text])))),
  constraint client_sources_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 60))),
  constraint client_sources_team_fk FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id) ON DELETE CASCADE,
  constraint client_sources_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint client_sources_pkey PRIMARY KEY (id)
);
alter table public.client_sources enable row level security;

create table public.client_tag_assignments (
  client_id uuid not null,
  tag_id uuid not null,
  tenant_id uuid not null,
  constraint client_tag_assignments_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  constraint client_tag_assignments_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES client_tags(id) ON DELETE CASCADE,
  constraint client_tag_assignments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint client_tag_assignments_pkey PRIMARY KEY (client_id, tag_id)
);
alter table public.client_tag_assignments enable row level security;

create table public.client_tags (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  color text not null,
  icon text,
  position integer not null default 0,
  hidden boolean not null default false,
  team_id text not null,
  constraint client_tags_team_fk FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id) ON DELETE CASCADE,
  constraint client_tags_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint client_tags_pkey PRIMARY KEY (id)
);
alter table public.client_tags enable row level security;

create table public.clients (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  full_name text not null,
  phone text not null default ''::text,
  whatsapp_phone text not null default ''::text,
  email text not null default ''::text,
  sms_name text not null default ''::text,
  telegram_username text not null default ''::text,
  instagram_username text not null default ''::text,
  balance numeric(12,2) not null default 0,
  discount integer not null default 0,
  comment text not null default ''::text,
  acquisition_source text not null default 'unknown'::text,
  referred_by_client_id uuid,
  first_contact_date date,
  address text not null default ''::text,
  city text not null default ''::text,
  property_type text not null default ''::text,
  language text,
  birthday text not null default ''::text,
  blacklisted boolean not null default false,
  pinned_at timestamp with time zone,
  reminder_at timestamp with time zone,
  phones jsonb not null default '[]'::jsonb,
  locations jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  equipment jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  phone_e164 text,
  avatar_url text,
  deleted_at timestamp with time zone,
  favorite_master_id text,
  city_manual boolean not null default false,
  purge_at timestamp with time zone,
  created_by uuid default auth.uid(),
  legal_name text,
  vat_number text,
  reg_number text,
  billing_address text,
  memberships jsonb not null default '[]'::jsonb,
  requisites jsonb not null default '[]'::jsonb,
  sms_opt_out boolean not null default false,
  team_id text,
  constraint clients_discount_check CHECK (((discount >= 0) AND (discount <= 100))),
  constraint clients_memberships_is_array CHECK ((jsonb_typeof(memberships) = 'array'::text)),
  constraint clients_requisites_is_array CHECK ((jsonb_typeof(requisites) = 'array'::text)),
  constraint clients_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint clients_referred_by_client_id_fkey FOREIGN KEY (referred_by_client_id) REFERENCES clients(id) ON DELETE SET NULL,
  constraint clients_team_fk FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id) ON DELETE SET NULL (team_id),
  constraint clients_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint clients_pkey PRIMARY KEY (id)
);
alter table public.clients enable row level security;

create table public.day_cities (
  tenant_id uuid not null,
  team_id text not null,
  date text not null,
  city text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint day_cities_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint day_cities_pkey PRIMARY KEY (tenant_id, team_id, date)
);
alter table public.day_cities enable row level security;

create table public.day_extras (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  team_id text not null,
  date text not null,
  name text not null,
  amount numeric not null,
  kind text not null,
  category text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  payment_method text,
  receipt_url text,
  constraint day_extras_amount_check CHECK ((amount >= (0)::numeric)),
  constraint day_extras_category_check CHECK ((category = ANY (ARRAY['fuel'::text, 'food'::text, 'supplies'::text, 'other'::text]))),
  constraint day_extras_kind_check CHECK ((kind = ANY (ARRAY['income'::text, 'expense'::text]))),
  constraint day_extras_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint day_extras_pkey PRIMARY KEY (id)
);
alter table public.day_extras enable row level security;

create table public.debts (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  direction text not null,
  client_id uuid,
  counterparty text not null,
  amount numeric not null,
  currency text not null default 'EUR'::text,
  category_id uuid,
  note text,
  occurred_on date not null,
  team_id text not null,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  occurred_time time without time zone,
  receipt_url text,
  constraint debts_amount_check CHECK ((amount > (0)::numeric)),
  constraint debts_counterparty_check CHECK ((length(btrim(counterparty)) > 0)),
  constraint debts_direction_check CHECK ((direction = ANY (ARRAY['incoming'::text, 'outgoing'::text]))),
  constraint debts_category_id_fkey FOREIGN KEY (category_id) REFERENCES finance_categories(id) ON DELETE SET NULL,
  constraint debts_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  constraint debts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint debts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint debts_pkey PRIMARY KEY (id)
);
alter table public.debts enable row level security;
comment on table public.debts is 'Долг с направлением: incoming — должны нам, outgoing — должны мы. Не деньги: в прибыль входит платёж по нему (finance_transactions.debt_id), а не сам долг.';

create table public.deleted_operations (
  id uuid not null,
  tenant_id uuid not null,
  team_id text not null,
  type text not null,
  operation jsonb not null,
  deleted_by uuid,
  deleted_at timestamp with time zone not null default now(),
  purge_at timestamp with time zone not null,
  constraint deleted_operations_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint deleted_operations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint deleted_operations_pkey PRIMARY KEY (id)
);
alter table public.deleted_operations enable row level security;
comment on table public.deleted_operations is '«Удалённые операции»: снимок удалённой ручной операции (to_jsonb строки finance_transactions), 30 дней до стирания.';

create table public.document_sequences (
  tenant_id uuid not null,
  legal_entity_id uuid not null,
  doc_type text not null,
  year integer not null,
  last_number integer not null default 0,
  updated_at timestamp with time zone not null default now(),
  constraint document_sequences_doc_type_check CHECK ((doc_type = ANY (ARRAY['invoice'::text, 'receipt'::text, 'credit_note'::text]))),
  constraint document_sequences_last_number_check CHECK (((last_number >= 0) AND (last_number <= 99999999))),
  constraint document_sequences_year_check CHECK (((year >= 2000) AND (year <= 2999))),
  constraint document_sequences_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint document_sequences_tenant_id_legal_entity_id_fkey FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id) ON DELETE CASCADE,
  constraint document_sequences_pkey PRIMARY KEY (tenant_id, legal_entity_id, doc_type, year)
);
alter table public.document_sequences enable row level security;
comment on table public.document_sequences is 'Счётчики серий документов: последний выданный номер (компания, юрлицо, тип, год). Пишет только next_document_number и set_document_series_start.';

create table public.edge_cron_secrets (
  name text not null,
  secret text not null,
  created_at timestamp with time zone not null default now(),
  rotated_at timestamp with time zone,
  constraint edge_cron_secrets_secret_check CHECK ((char_length(secret) >= 64)),
  constraint edge_cron_secrets_pkey PRIMARY KEY (name)
);
alter table public.edge_cron_secrets enable row level security;

create table public.equipment (
  id text not null,
  tenant_id uuid not null,
  name text not null,
  category text,
  serial text,
  assigned_team_id text,
  notes text,
  color text,
  installed_at date,
  last_service_at date,
  service_interval_months integer,
  next_service_at date,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint equipment_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint equipment_pkey PRIMARY KEY (tenant_id, id)
);
alter table public.equipment enable row level security;

create table public.event_templates (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  emoji text,
  color text not null,
  duration_min integer not null,
  push_offset_min integer,
  sort_order integer not null default 0,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint event_templates_duration_min_check CHECK (((duration_min >= 5) AND (duration_min <= 1440))),
  constraint event_templates_emoji_check CHECK (((emoji IS NULL) OR (length(emoji) <= 8))),
  constraint event_templates_name_check CHECK (((length(name) >= 1) AND (length(name) <= 80))),
  constraint event_templates_push_offset_min_check CHECK (((push_offset_min IS NULL) OR ((push_offset_min >= 0) AND (push_offset_min <= 1440)))),
  constraint event_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id),
  constraint event_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint event_templates_pkey PRIMARY KEY (id)
);
alter table public.event_templates enable row level security;

create table public.finance_categories (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid,
  slug text not null,
  name text not null,
  type text not null,
  icon text,
  color text,
  created_at timestamp with time zone not null default now(),
  is_system boolean not null default false,
  retired boolean not null default false,
  ask_employee boolean not null default false,
  ask_client boolean not null default false,
  require_receipt boolean not null default false,
  monthly_budget numeric(12,2),
  team_id text,
  hidden boolean not null default false,
  position integer not null default 0,
  constraint finance_categories_monthly_budget_positive CHECK (((monthly_budget IS NULL) OR (monthly_budget > (0)::numeric))),
  constraint finance_categories_team_required CHECK (((tenant_id IS NULL) OR (team_id IS NOT NULL))),
  constraint finance_categories_type_check CHECK ((type = ANY (ARRAY['income'::text, 'expense'::text, 'debt'::text]))),
  constraint finance_categories_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint finance_categories_pkey PRIMARY KEY (id),
  constraint finance_categories_tenant_id_slug_key UNIQUE (tenant_id, slug)
);
alter table public.finance_categories enable row level security;

create table public.finance_category_hidden (
  tenant_id uuid not null,
  category_id uuid not null,
  created_at timestamp with time zone not null default now(),
  constraint finance_category_hidden_category_id_fkey FOREIGN KEY (category_id) REFERENCES finance_categories(id) ON DELETE CASCADE,
  constraint finance_category_hidden_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint finance_category_hidden_pkey PRIMARY KEY (tenant_id, category_id)
);
alter table public.finance_category_hidden enable row level security;
comment on table public.finance_category_hidden is 'Скрытые для тенанта категории. Строка есть = категория не предлагается в выборе.';

create table public.finance_category_order (
  tenant_id uuid not null,
  category_id uuid not null,
  position integer not null default 0,
  updated_at timestamp with time zone not null default now(),
  constraint finance_category_order_category_id_fkey FOREIGN KEY (category_id) REFERENCES finance_categories(id) ON DELETE CASCADE,
  constraint finance_category_order_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint finance_category_order_pkey PRIMARY KEY (tenant_id, category_id)
);
alter table public.finance_category_order enable row level security;
comment on table public.finance_category_order is 'Порядок категорий в справочнике — ПО ТЕНАНТАМ. Сами категории глобальные (tenant_id null), поэтому колонка position в них меняла бы порядок сразу у всех компаний; здесь у каждой свой. Скрытие устроено так же (finance_category_hidden).';

create table public.finance_templates (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  kind text not null,
  amount numeric(12,2) not null,
  account_id uuid,
  category_id uuid,
  brigade_id text not null,
  master_id text,
  payment_method text,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint finance_templates_kind_check CHECK ((kind = ANY (ARRAY['income'::text, 'expense'::text]))),
  constraint finance_templates_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
  constraint finance_templates_category_id_fkey FOREIGN KEY (category_id) REFERENCES finance_categories(id) ON DELETE SET NULL,
  constraint finance_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint finance_templates_pkey PRIMARY KEY (id)
);
alter table public.finance_templates enable row level security;

create table public.finance_transactions (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  type text not null,
  amount numeric not null,
  currency text not null default 'EUR'::text,
  category_id uuid,
  appointment_id uuid,
  client_id uuid,
  team_id text not null,
  master_id text,
  payment_method text,
  notes text,
  created_at timestamp with time zone not null default now(),
  account_id uuid,
  occurred_on date not null default CURRENT_DATE,
  receipt_url text,
  transfer_group_id uuid,
  invoice_id uuid,
  refund_of_id uuid,
  created_by uuid,
  updated_at timestamp with time zone not null default now(),
  source text not null default 'manual'::text,
  appointment_payment_kind text,
  vat_rate numeric,
  vat_amount numeric,
  vat_mode text,
  appointment_payment_id text,
  reversal_kind text,
  occurred_time time without time zone,
  debt_id uuid,
  from_calendar boolean not null default false,
  constraint finance_transactions_amount_finite CHECK ((amount <> 'NaN'::numeric)),
  constraint finance_transactions_appointment_payment_kind_check CHECK (((appointment_payment_kind IS NULL) OR (appointment_payment_kind = ANY (ARRAY['prepayment'::text, 'settlement'::text])))),
  constraint finance_transactions_payment_method_check CHECK (((payment_method IS NULL) OR (payment_method = ANY (ARRAY['cash'::text, 'card'::text, 'transfer'::text, 'other'::text])))),
  constraint finance_transactions_reversal_kind_check CHECK (((reversal_kind IS NULL) OR (reversal_kind = ANY (ARRAY['not_received'::text, 'client_refund'::text])))),
  constraint finance_transactions_source_check CHECK ((source = ANY (ARRAY['auto'::text, 'manual'::text]))),
  constraint finance_transactions_type_check CHECK ((type = ANY (ARRAY['income'::text, 'expense'::text, 'transfer'::text, 'refund'::text]))),
  constraint finance_transactions_vat_mode_check CHECK (((vat_mode IS NULL) OR (vat_mode = ANY (ARRAY['none'::text, 'inclusive'::text, 'exclusive'::text])))),
  constraint finance_transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
  constraint finance_transactions_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
  constraint finance_transactions_category_id_fkey FOREIGN KEY (category_id) REFERENCES finance_categories(id) ON DELETE SET NULL,
  constraint finance_transactions_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  constraint finance_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id),
  constraint finance_transactions_debt_id_fkey FOREIGN KEY (debt_id) REFERENCES debts(id) ON DELETE SET NULL,
  constraint finance_transactions_refund_of_id_fkey FOREIGN KEY (refund_of_id) REFERENCES finance_transactions(id) ON DELETE SET NULL,
  constraint finance_transactions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint finance_tx_invoice_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
  constraint finance_transactions_pkey PRIMARY KEY (id)
);
alter table public.finance_transactions enable row level security;

create table public.finance_transfer_requests (
  id uuid not null,
  tenant_id uuid not null,
  from_account_id uuid not null,
  to_account_id uuid not null,
  team_id text not null,
  amount numeric(12,2) not null,
  occurred_on date not null,
  notes text,
  status text not null default 'active'::text,
  created_at timestamp with time zone not null default now(),
  created_by uuid,
  deleted_at timestamp with time zone,
  deleted_by uuid,
  constraint finance_transfer_requests_amount_check CHECK (((amount > (0)::numeric) AND (amount <> 'NaN'::numeric))),
  constraint finance_transfer_requests_check CHECK ((from_account_id <> to_account_id)),
  constraint finance_transfer_requests_status_check CHECK ((status = ANY (ARRAY['active'::text, 'deleted'::text]))),
  constraint finance_transfer_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint finance_transfer_requests_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint finance_transfer_requests_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint finance_transfer_requests_pkey PRIMARY KEY (id)
);
alter table public.finance_transfer_requests enable row level security;

create table public.invitations (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  email text not null,
  role text not null,
  invited_by_user_id uuid,
  token text not null,
  expires_at timestamp with time zone not null default (now() + '7 days'::interval),
  accepted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  accepted_by_user_id uuid,
  master_id text,
  team_id text,
  full_name text,
  phone text,
  team_ids text[],
  master_title text,
  master_color text,
  access_changes jsonb not null default '[]'::jsonb,
  email_sent_at timestamp with time zone,
  constraint invitations_access_changes_array CHECK ((jsonb_typeof(access_changes) = 'array'::text)),
  constraint invitations_card_fields_only_without_card CHECK (((master_id IS NULL) OR ((master_title IS NULL) AND (master_color IS NULL)))),
  constraint invitations_full_name_length CHECK (((full_name IS NULL) OR ((char_length(full_name) >= 1) AND (char_length(full_name) <= 120)))),
  constraint invitations_master_color_hex CHECK (((master_color IS NULL) OR (master_color ~ '^#[0-9A-Fa-f]{6}$'::text))),
  constraint invitations_master_title_length CHECK (((master_title IS NULL) OR ((char_length(master_title) >= 1) AND (char_length(master_title) <= 120)))),
  constraint invitations_phone_e164 CHECK (((phone IS NULL) OR (phone ~ '^\+[1-9][0-9]{6,14}$'::text))),
  constraint invitations_role_check CHECK ((role = 'master'::text)),
  constraint invitations_team_ids_home_first CHECK (((team_ids IS NULL) OR ((cardinality(team_ids) >= 1) AND (array_position(team_ids, NULL::text) IS NULL) AND COALESCE((team_ids[1] = team_id), false)))),
  constraint invitations_accepted_by_user_id_fkey FOREIGN KEY (accepted_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint invitations_invited_by_user_id_fkey FOREIGN KEY (invited_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint invitations_master_fkey FOREIGN KEY (tenant_id, master_id) REFERENCES masters(tenant_id, id),
  constraint invitations_team_fkey FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id) ON DELETE CASCADE,
  constraint invitations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint invitations_pkey PRIMARY KEY (id),
  constraint invitations_token_key UNIQUE (token)
);
alter table public.invitations enable row level security;

create table public.invoice_lines (
  id uuid not null default gen_random_uuid(),
  invoice_id uuid not null,
  position integer not null default 0,
  title text not null,
  qty numeric(10,3) not null default 1,
  unit_price numeric(12,2) not null,
  total numeric(12,2) not null,
  description text,
  unit text,
  constraint invoice_lines_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  constraint invoice_lines_pkey PRIMARY KEY (id)
);
alter table public.invoice_lines enable row level security;

create table public.invoices (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  number text not null,
  year integer not null,
  seq integer not null,
  issued_on date not null default CURRENT_DATE,
  due_on date,
  client_id uuid,
  appointment_id uuid,
  brigade_id text not null,
  subtotal_net numeric(12,2) not null,
  vat_percent numeric(5,2) not null default 19,
  vat_amount numeric(12,2) not null,
  total numeric(12,2) not null,
  currency text not null default 'EUR'::text,
  status text not null default 'issued'::text,
  pdf_url text,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  created_by uuid,
  seller_snapshot jsonb not null,
  client_snapshot jsonb,
  kind text not null default 'invoice'::text,
  credit_note_of_id uuid,
  language text not null default 'ru'::text,
  vat_mode text,
  payment_id text,
  company_id uuid not null,
  account_id uuid,
  location_id text,
  client_requisites_id text,
  credit_note_of_receipt_id uuid,
  credited_amount numeric(12,2) not null default 0,
  credit_partial boolean not null default false,
  constraint invoices_client_snapshot_object CHECK (((client_snapshot IS NULL) OR (jsonb_typeof(client_snapshot) = 'object'::text))),
  constraint invoices_kind_check CHECK ((kind = ANY (ARRAY['invoice'::text, 'credit_note'::text]))),
  constraint invoices_language_check CHECK ((language = ANY (ARRAY['ru'::text, 'en'::text, 'bg'::text, 'el'::text, 'uk'::text, 'de'::text, 'es'::text]))),
  constraint invoices_receipt_note_is_credit_note CHECK (((credit_note_of_receipt_id IS NULL) OR ((kind = 'credit_note'::text) AND (credit_note_of_id IS NULL)))),
  constraint invoices_seller_snapshot_object CHECK ((jsonb_typeof(seller_snapshot) = 'object'::text)),
  constraint invoices_status_check CHECK ((status = ANY (ARRAY['issued'::text, 'paid'::text, 'void'::text, 'cancelled'::text]))),
  constraint invoices_vat_mode_check CHECK ((vat_mode = ANY (ARRAY['off'::text, 'inclusive'::text, 'exclusive'::text]))),
  constraint invoices_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
  constraint invoices_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
  constraint invoices_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  constraint invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id),
  constraint invoices_credit_note_of_id_fkey FOREIGN KEY (credit_note_of_id) REFERENCES invoices(id) ON DELETE RESTRICT,
  constraint invoices_credit_note_of_receipt_id_fkey FOREIGN KEY (credit_note_of_receipt_id) REFERENCES receipts(id) ON DELETE RESTRICT,
  constraint invoices_legal_entity_fkey FOREIGN KEY (tenant_id, company_id) REFERENCES legal_entities(tenant_id, id),
  constraint invoices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint invoices_pkey PRIMARY KEY (id)
);
alter table public.invoices enable row level security;

create table public.legal_entities (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  legal_name text,
  business_address text,
  vat_number text,
  reg_number text,
  iban text,
  bank_name text,
  contact_phone text,
  contact_email text,
  position integer not null default 0,
  is_default boolean not null default false,
  archived_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  logo_url text,
  color text,
  icon text,
  invoice_prefix text not null default 'INV'::text,
  receipt_prefix text not null default 'REC'::text,
  credit_note_prefix text not null default 'CN'::text,
  number_padding integer not null default 4,
  constraint legal_entities_color_format CHECK (((color IS NULL) OR (color ~ '^#[0-9A-Fa-f]{6}$'::text))),
  constraint legal_entities_icon_format CHECK (((icon IS NULL) OR (icon ~ '^[a-z0-9-]{1,40}$'::text))),
  constraint legal_entities_number_padding_range CHECK (((number_padding >= 3) AND (number_padding <= 8))),
  constraint legal_entities_prefix_format CHECK (((invoice_prefix ~ '^[A-Z0-9]{1,10}$'::text) AND (receipt_prefix ~ '^[A-Z0-9]{1,10}$'::text) AND (credit_note_prefix ~ '^[A-Z0-9]{1,10}$'::text))),
  constraint legal_entities_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint legal_entities_pkey PRIMARY KEY (id),
  constraint legal_entities_tenant_id_id_key UNIQUE (tenant_id, id)
);
alter table public.legal_entities enable row level security;
comment on table public.legal_entities is 'Юрлица компании-арендатора: от кого выписан чек или инвойс (владелец 2026-09-20). Справочник, как услуги: порядок, архив вместо удаления, одна строка по умолчанию (см. частичный уникальный индекс companies_one_default).';

create table public.location_labels (
  tenant_id uuid not null,
  id text not null,
  name text not null,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  created_by uuid,
  color text,
  icon text,
  team_id text not null,
  constraint location_labels_id_valid CHECK (((char_length(btrim(id)) >= 1) AND (char_length(btrim(id)) <= 160))),
  constraint location_labels_name_valid CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 80))),
  constraint location_labels_position_nonnegative CHECK (("position" >= 0)),
  constraint location_labels_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint location_labels_team_fk FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id) ON DELETE CASCADE,
  constraint location_labels_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint location_labels_pkey PRIMARY KEY (tenant_id, id)
);
alter table public.location_labels enable row level security;
comment on table public.location_labels is 'Tenant-scoped client object type labels; explicit removals are soft-archived.';

create table public.location_requests (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  client_id uuid not null,
  token text not null,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null default (now() + '7 days'::interval),
  used_at timestamp with time zone,
  location_id uuid,
  constraint location_requests_token_len CHECK (((length(token) >= 32) AND (length(token) <= 128))),
  constraint location_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  constraint location_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint location_requests_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint location_requests_pkey PRIMARY KEY (id),
  constraint location_requests_token_key UNIQUE (token)
);
alter table public.location_requests enable row level security;

create table public.master_rating_tokens (
  token text not null,
  tenant_id uuid not null,
  appointment_id uuid,
  master_id text not null,
  created_at timestamp with time zone not null default now(),
  used_at timestamp with time zone,
  expires_at timestamp with time zone not null default (now() + '60 days'::interval),
  constraint master_rating_tokens_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  constraint master_rating_tokens_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint master_rating_tokens_pkey PRIMARY KEY (token)
);
alter table public.master_rating_tokens enable row level security;

create table public.master_ratings (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  master_id text not null,
  appointment_id uuid,
  client_id uuid,
  stars integer not null,
  comment text,
  created_at timestamp with time zone not null default now(),
  token text,
  constraint master_ratings_stars_check CHECK (((stars >= 1) AND (stars <= 5))),
  constraint master_ratings_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
  constraint master_ratings_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  constraint master_ratings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint master_ratings_token_fkey FOREIGN KEY (token) REFERENCES master_rating_tokens(token) ON DELETE SET NULL,
  constraint master_ratings_pkey PRIMARY KEY (id)
);
alter table public.master_ratings enable row level security;

create table public.masters (
  id text not null,
  tenant_id uuid not null,
  full_name text not null,
  phone text,
  team_id text,
  role text not null default 'helper'::text,
  title text,
  avatar_url text,
  color text,
  account_status text,
  position integer not null default 0,
  is_active boolean not null default true,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  created_by uuid,
  user_id uuid,
  constraint masters_account_status_check CHECK ((account_status = ANY (ARRAY['invited'::text, 'active'::text, 'paused'::text, 'terminated'::text]))),
  constraint masters_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'dispatcher'::text, 'lead'::text, 'helper'::text]))),
  constraint masters_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id),
  constraint masters_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint masters_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint masters_pkey PRIMARY KEY (tenant_id, id)
);
alter table public.masters enable row level security;

create table public.member_access (
  tenant_id uuid not null,
  user_id uuid not null,
  block text not null,
  team_id text,
  level text not null,
  set_by uuid,
  set_at timestamp with time zone not null default now(),
  constraint member_access_block_fkey FOREIGN KEY (block) REFERENCES access_blocks(key) ON UPDATE CASCADE,
  constraint member_access_calendar_fkey FOREIGN KEY (tenant_id, user_id, team_id) REFERENCES member_calendars(tenant_id, user_id, team_id) ON DELETE CASCADE,
  constraint member_access_member_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_members(tenant_id, user_id) ON DELETE CASCADE
);
alter table public.member_access enable row level security;
comment on table public.member_access is 'Уровни блоков у человека в компании. Нет строки = первое значение access_blocks.levels. Пишет только set_member_access (и миграции). Увольнение и открепление стирают строки каскадом.';

create table public.member_calendars (
  tenant_id uuid not null,
  user_id uuid not null,
  team_id text not null,
  attached_by uuid,
  attached_at timestamp with time zone not null default now(),
  constraint member_calendars_member_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_members(tenant_id, user_id) ON DELETE CASCADE,
  constraint member_calendars_team_fkey FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id) ON DELETE CASCADE,
  constraint member_calendars_pkey PRIMARY KEY (tenant_id, user_id, team_id)
);
alter table public.member_calendars enable row level security;
comment on table public.member_calendars is 'Человек прикреплён к календарю — без прав. Прикреплённый с уровнями off виден владельцу в людях календаря, но сам ничего не видит. Пишет только set_member_calendars (и миграции).';

create table public.partner_files (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  master_id text not null,
  storage_path text not null,
  filename text not null,
  mime_type text not null,
  size_bytes integer not null,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  constraint partner_files_check CHECK (((split_part(storage_path, '/'::text, 1) = (tenant_id)::text) AND (split_part(storage_path, '/'::text, 2) = master_id))),
  constraint partner_files_filename_check CHECK (((length(btrim(filename)) >= 1) AND (length(btrim(filename)) <= 255))),
  constraint partner_files_mime_type_check CHECK ((mime_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text, 'application/pdf'::text, 'text/plain'::text]))),
  constraint partner_files_size_bytes_check CHECK (((size_bytes >= 1) AND (size_bytes <= 10485760))),
  constraint partner_files_tenant_id_master_id_fkey FOREIGN KEY (tenant_id, master_id) REFERENCES masters(tenant_id, id) ON DELETE CASCADE,
  constraint partner_files_pkey PRIMARY KEY (id),
  constraint partner_files_storage_path_key UNIQUE (storage_path)
);
alter table public.partner_files enable row level security;

create table public.personal_event_types (
  id text not null,
  tenant_id uuid not null,
  label text not null,
  icon text not null default 'tag'::text,
  color text not null default '#007AFF'::text,
  default_duration integer not null default 60,
  all_day boolean not null default false,
  position integer not null default 0,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone,
  team_id text not null,
  constraint personal_event_types_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id),
  constraint personal_event_types_team_fk FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id) ON DELETE CASCADE,
  constraint personal_event_types_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint personal_event_types_pkey PRIMARY KEY (tenant_id, id)
);
alter table public.personal_event_types enable row level security;

create table public.platform_admins (
  user_id uuid not null,
  granted_at timestamp with time zone not null default now(),
  granted_by uuid,
  notes text,
  constraint platform_admins_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint platform_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint platform_admins_pkey PRIMARY KEY (user_id)
);
alter table public.platform_admins enable row level security;
comment on table public.platform_admins is 'STORY-070 — platform-level admin grants. Distinct from tenant_members.role (which is tenant-scoped). Members of this table can read/write any tenant via service-role bypass policies invoked from /admin server actions.';

create table public.push_subscriptions (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  endpoint text not null,
  keys jsonb not null,
  device_label text,
  created_at timestamp with time zone not null default now(),
  constraint push_subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint push_subscriptions_pkey PRIMARY KEY (id),
  constraint push_subscriptions_user_id_endpoint_key UNIQUE (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
comment on table public.push_subscriptions is 'STORY-053b — Web Push endpoints, one row per (user, device).';

create table public.receipts (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  number text not null,
  year integer not null,
  seq integer not null,
  issued_on date not null,
  amount numeric not null,
  currency text not null default 'EUR'::text,
  vat_rate numeric,
  vat_amount numeric,
  client_id uuid,
  appointment_id uuid,
  invoice_id uuid,
  transaction_id uuid,
  account_id uuid,
  payment_method text,
  status text not null default 'issued'::text,
  seller_snapshot jsonb not null default '{}'::jsonb,
  client_snapshot jsonb,
  created_at timestamp with time zone not null default now(),
  lines jsonb,
  company_id uuid not null,
  team_id text not null,
  location_id text,
  client_requisites_id text,
  constraint receipts_amount_check CHECK ((amount > (0)::numeric)),
  constraint receipts_status_check CHECK ((status = ANY (ARRAY['issued'::text, 'void'::text]))),
  constraint receipts_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
  constraint receipts_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
  constraint receipts_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  constraint receipts_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
  constraint receipts_legal_entity_fkey FOREIGN KEY (tenant_id, company_id) REFERENCES legal_entities(tenant_id, id),
  constraint receipts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint receipts_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES finance_transactions(id) ON DELETE SET NULL,
  constraint receipts_pkey PRIMARY KEY (id)
);
alter table public.receipts enable row level security;

create table public.recurring_reminders (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  client_id uuid,
  client_name text not null,
  phone text not null default ''::text,
  team_id text,
  service_ids jsonb not null default '[]'::jsonb,
  service_summary text not null default ''::text,
  last_date text not null,
  next_due_date text not null,
  interval_months integer not null,
  status text not null default 'pending'::text,
  note text not null default ''::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  type text not null default 'service'::text,
  manual boolean not null default false,
  notify_channel text not null default 'push'::text,
  constraint recurring_reminders_notify_channel_check CHECK ((notify_channel = ANY (ARRAY['push'::text, 'sms'::text, 'email'::text]))),
  constraint recurring_reminders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'booked'::text, 'dismissed'::text]))),
  constraint recurring_reminders_type_check CHECK ((type = ANY (ARRAY['call'::text, 'visit'::text, 'sms'::text, 'service'::text, 'custom'::text]))),
  constraint recurring_reminders_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  constraint recurring_reminders_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint recurring_reminders_pkey PRIMARY KEY (id)
);
alter table public.recurring_reminders enable row level security;

create table public.service_categories (
  id text not null,
  tenant_id uuid not null,
  name text not null,
  color text,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint service_categories_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint service_categories_pkey PRIMARY KEY (tenant_id, id)
);
alter table public.service_categories enable row level security;

create table public.service_variants (
  id text not null,
  tenant_id uuid not null,
  service_id text not null,
  name text not null,
  price numeric not null default 0,
  duration_min integer not null default 60,
  cost numeric not null default 0,
  position integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint service_variants_service_fk FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id) ON DELETE CASCADE,
  constraint service_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint service_variants_pkey PRIMARY KEY (id)
);
alter table public.service_variants enable row level security;

create table public.services (
  id text not null,
  tenant_id uuid not null,
  category_id text,
  name text not null,
  price numeric(12,2) not null default 0,
  duration_minutes integer not null default 60,
  color text not null default '#3b82f6'::text,
  available_weekdays jsonb not null default '[]'::jsonb,
  online_enabled boolean not null default false,
  material_costs jsonb not null default '[]'::jsonb,
  bulk_threshold integer not null default 0,
  bulk_price numeric(12,2) not null default 0,
  cost_per_unit numeric(12,2) not null default 0,
  brigade_ids jsonb not null default '[]'::jsonb,
  price_tiers jsonb,
  duration_tiers jsonb,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  team_id text not null,
  description text,
  cost_tiers jsonb not null default '[]'::jsonb,
  unit text,
  price_entry text not null default 'total'::text,
  service_type text not null default 'quantity'::text,
  buffer_before_min integer not null default 0,
  buffer_after_min integer not null default 0,
  required_staff integer not null default 1,
  overflow_price numeric,
  overflow_duration_min integer,
  min_qty numeric not null default 1,
  max_qty numeric,
  copied_from_service_id text,
  icon text,
  constraint services_price_entry_check CHECK ((price_entry = ANY (ARRAY['total'::text, 'unit'::text]))),
  constraint services_service_type_check CHECK ((service_type = ANY (ARRAY['quantity'::text, 'variant'::text]))),
  constraint services_copied_from_fk FOREIGN KEY (tenant_id, copied_from_service_id) REFERENCES services(tenant_id, id) ON DELETE SET NULL,
  constraint services_team_fk FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id) ON DELETE RESTRICT,
  constraint services_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint services_pkey PRIMARY KEY (tenant_id, id)
);
alter table public.services enable row level security;

create table public.sms_alerts (
  id bigint not null,
  tenant_id uuid,
  kind text not null,
  message text not null,
  created_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone,
  constraint sms_alerts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint sms_alerts_pkey PRIMARY KEY (id)
);
alter table public.sms_alerts enable row level security;

create table public.sms_autotopup (
  tenant_id uuid not null,
  enabled boolean not null default false,
  threshold_cents integer not null default 500,
  amount_cents integer not null default 2500,
  stripe_customer text,
  payment_method text,
  card_label text,
  pending_key text,
  pending_since timestamp with time zone,
  last_success_at timestamp with time zone,
  day date,
  day_count integer not null default 0,
  last_error text,
  last_error_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  card_session text,
  pending_amount integer,
  constraint sms_autotopup_amount_cents_check CHECK ((amount_cents = ANY (ARRAY[1000, 2500, 5000, 10000]))),
  constraint sms_autotopup_card_needed CHECK (((NOT enabled) OR ((payment_method IS NOT NULL) AND (stripe_customer IS NOT NULL)))),
  constraint sms_autotopup_threshold_cents_check CHECK ((threshold_cents = ANY (ARRAY[500, 1000, 2500]))),
  constraint sms_autotopup_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint sms_autotopup_pkey PRIMARY KEY (tenant_id)
);
alter table public.sms_autotopup enable row level security;

create table public.sms_ledger (
  id bigint not null,
  tenant_id uuid not null,
  kind text not null,
  amount_cents integer not null,
  balance_after integer not null,
  ref text,
  note text,
  created_at timestamp with time zone not null default now(),
  constraint sms_ledger_amount_cents_check CHECK ((amount_cents <> 0)),
  constraint sms_ledger_kind_check CHECK ((kind = ANY (ARRAY['opening'::text, 'topup'::text, 'send'::text, 'send_refund'::text, 'stripe_refund'::text, 'dispute'::text, 'dispute_won'::text, 'adjust'::text]))),
  constraint sms_ledger_sign CHECK ((((kind = ANY (ARRAY['topup'::text, 'send_refund'::text, 'dispute_won'::text])) AND (amount_cents > 0)) OR ((kind = ANY (ARRAY['send'::text, 'stripe_refund'::text, 'dispute'::text])) AND (amount_cents < 0)) OR (kind = ANY (ARRAY['opening'::text, 'adjust'::text])))),
  constraint sms_ledger_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint sms_ledger_pkey PRIMARY KEY (id)
);
alter table public.sms_ledger enable row level security;
comment on table public.sms_ledger is 'Движение денег SMS каждой компании (STORY-089, волна 13). Только дописывается; баланс меняет sms_ledger_post.';

create table public.sms_logs (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  to_phone text not null,
  body text not null,
  sender_name_used text not null,
  cost_cents integer not null default 0,
  was_free boolean not null default false,
  twilio_message_sid text,
  twilio_status text,
  error_code text,
  error_message text,
  appointment_id uuid,
  created_at timestamp with time zone not null default now(),
  delivered_at timestamp with time zone,
  constraint sms_logs_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
  constraint sms_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint sms_logs_pkey PRIMARY KEY (id)
);
alter table public.sms_logs enable row level security;

create table public.sms_messages (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  appointment_id uuid,
  client_id uuid,
  to_phone text not null,
  message_body text,
  twilio_sid text,
  status text not null,
  error_code text,
  error_message text,
  trigger_type text not null,
  mode text not null,
  created_at timestamp with time zone not null default now(),
  delivered_at timestamp with time zone,
  segments integer,
  cost_cents integer not null default 0,
  was_free boolean not null default false,
  template_id text,
  team_id text,
  sent_by uuid,
  template_body text,
  for_start timestamp with time zone,
  send_after timestamp with time zone,
  claimed_at timestamp with time zone,
  constraint sms_messages_mode_check CHECK ((mode = ANY (ARRAY['platform'::text, 'byok'::text]))),
  constraint sms_messages_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text, 'delivered'::text, 'failed'::text, 'undelivered'::text, 'blocked'::text]))),
  constraint sms_messages_trigger_type_check CHECK ((trigger_type = ANY (ARRAY['reminder_24h'::text, 'reminder_2h'::text, 'manual'::text, 'test'::text, 'new_appointment'::text, 'reminder'::text, 'reminder_2'::text, 'reschedule'::text, 'cancellation'::text, 'thank_you'::text, 'repeat'::text, 'bulk'::text]))),
  constraint sms_messages_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
  constraint sms_messages_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  constraint sms_messages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint sms_messages_pkey PRIMARY KEY (id),
  constraint sms_messages_twilio_sid_key UNIQUE (twilio_sid)
);
alter table public.sms_messages enable row level security;
comment on table public.sms_messages is 'STORY-047 — append-only SMS history, one row per attempted send. Tenant-scoped reads; service-role-only writes from send_sms Edge Function and the Twilio status webhook.';

create table public.sms_team_senders (
  tenant_id uuid not null,
  team_id text not null,
  sender_name text not null,
  updated_at timestamp with time zone not null default now(),
  constraint sms_team_senders_name_check CHECK (((sender_name ~ '^[A-Za-z0-9 ]{1,11}$'::text) AND (sender_name ~ '[A-Za-z]'::text) AND (sender_name = TRIM(BOTH FROM sender_name)))),
  constraint sms_team_senders_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint sms_team_senders_pkey PRIMARY KEY (tenant_id, team_id)
);
alter table public.sms_team_senders enable row level security;
comment on table public.sms_team_senders is 'Имя отправителя SMS команды (STORY-089, 29.09). Только через RPC.';

create table public.sms_team_templates (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  team_id text not null,
  name text not null,
  body text not null,
  trigger text not null default 'manual'::text,
  hours integer,
  at_time text,
  months integer,
  send_from smallint not null default 8,
  send_to smallint not null default 21,
  enabled boolean not null default true,
  position integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  color text,
  icon text,
  constraint sms_team_templates_body_check CHECK (((length(TRIM(BOTH FROM body)) >= 1) AND (length(TRIM(BOTH FROM body)) <= 1000))),
  constraint sms_team_templates_color_check CHECK (((color IS NULL) OR (color ~ '^#[0-9A-Fa-f]{6}$'::text))),
  constraint sms_team_templates_icon_check CHECK (((icon IS NULL) OR ((length(icon) >= 1) AND (length(icon) <= 40)))),
  constraint sms_team_templates_name_check CHECK (((length(TRIM(BOTH FROM name)) >= 1) AND (length(TRIM(BOTH FROM name)) <= 60))),
  constraint sms_team_templates_timing_check CHECK (COALESCE(
CASE trigger
    WHEN 'before'::text THEN (((hours >= 1) AND (hours <= 168)) AND (at_time IS NULL) AND (months IS NULL))
    WHEN 'after'::text THEN (((hours >= 1) AND (hours <= 72)) AND (at_time IS NULL) AND (months IS NULL))
    WHEN 'day_before'::text THEN ((at_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'::text) AND (hours IS NULL) AND (months IS NULL))
    WHEN 'repeat'::text THEN (((months >= 1) AND (months <= 24)) AND (hours IS NULL) AND (at_time IS NULL))
    ELSE ((hours IS NULL) AND (at_time IS NULL) AND (months IS NULL))
END, false)),
  constraint sms_team_templates_trigger_check CHECK ((trigger = ANY (ARRAY['manual'::text, 'created'::text, 'before'::text, 'day_before'::text, 'rescheduled'::text, 'cancelled'::text, 'after'::text, 'repeat'::text]))),
  constraint sms_team_templates_window_check CHECK ((((send_from >= 0) AND (send_from <= 23)) AND ((send_to >= 1) AND (send_to <= 24)) AND (send_from < send_to))),
  constraint sms_team_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint sms_team_templates_pkey PRIMARY KEY (id)
);
alter table public.sms_team_templates enable row level security;
comment on table public.sms_team_templates is 'Шаблоны SMS команды: текст и «когда отправлять» (STORY-089, 29.09). Только через RPC.';

create table public.sms_topups (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  amount_cents integer not null,
  credits_added integer not null,
  pack_label text not null,
  stripe_session_id text,
  stripe_payment_intent_id text,
  status text not null default 'pending'::text,
  created_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  constraint sms_topups_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text, 'refunded'::text]))),
  constraint sms_topups_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint sms_topups_pkey PRIMARY KEY (id),
  constraint sms_topups_stripe_payment_intent_id_key UNIQUE (stripe_payment_intent_id)
);
alter table public.sms_topups enable row level security;

create table public.team_design (
  tenant_id uuid not null,
  team_id text not null,
  record_color_rule text not null default 'team'::text,
  record_color_palette jsonb,
  record_color_fallback text,
  disabled_blocks text[] not null default '{}'::text[],
  updated_at timestamp with time zone not null default now(),
  client_list_off text[],
  contact_ways jsonb,
  map_services jsonb,
  service_every_months integer,
  record_order text[],
  event_order text[],
  constraint team_design_blocks_known CHECK ((disabled_blocks <@ ARRAY['record_label'::text, 'record_object'::text, 'record_payment'::text, 'record_note'::text, 'record_files'::text, 'event_label'::text, 'event_type'::text, 'event_client'::text, 'event_object'::text, 'event_note'::text, 'event_files'::text, 'client_people'::text, 'client_requisites'::text, 'client_files'::text, 'client_note'::text, 'client_objects'::text, 'client_labels'::text, 'client_personal'::text, 'client_tags'::text])),
  constraint team_design_client_list_known CHECK (((client_list_off IS NULL) OR (client_list_off <@ ARRAY['phone'::text, 'exp'::text, 'inc'::text, 'debt'::text, 'last'::text, 'meta'::text]))),
  constraint team_design_ordered_sets_shape CHECK ((((contact_ways IS NULL) OR ((jsonb_typeof(contact_ways) = 'object'::text) AND (jsonb_typeof((contact_ways -> 'enabled'::text)) = 'array'::text) AND (jsonb_typeof((contact_ways -> 'order'::text)) = 'array'::text))) AND ((map_services IS NULL) OR ((jsonb_typeof(map_services) = 'object'::text) AND (jsonb_typeof((map_services -> 'enabled'::text)) = 'array'::text) AND (jsonb_typeof((map_services -> 'order'::text)) = 'array'::text))))),
  constraint team_design_rule_check CHECK ((record_color_rule = ANY (ARRAY['team'::text, 'label'::text, 'service'::text]))),
  constraint team_design_service_months_range CHECK (((service_every_months IS NULL) OR ((service_every_months >= 1) AND (service_every_months <= 60)))),
  constraint team_design_team_fk FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id) ON DELETE CASCADE,
  constraint team_design_pkey PRIMARY KEY (tenant_id, team_id)
);
alter table public.team_design enable row level security;

create table public.team_finance_settings (
  tenant_id uuid not null,
  team_id text not null,
  vat_mode text,
  vat_rate numeric,
  vat_exemption_note text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint team_vat_mode_check CHECK (((vat_mode IS NULL) OR (vat_mode = ANY (ARRAY['off'::text, 'inclusive'::text, 'exclusive'::text])))),
  constraint team_vat_rate_check CHECK (((vat_rate IS NULL) OR ((vat_rate >= (0)::numeric) AND (vat_rate < (100)::numeric)))),
  constraint team_finance_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint team_finance_settings_pkey PRIMARY KEY (tenant_id, team_id)
);
alter table public.team_finance_settings enable row level security;

create table public.team_notification_prefs (
  user_id uuid not null default auth.uid(),
  tenant_id uuid not null,
  team_id text not null,
  record_reminder jsonb,
  client_reminder_time text default '09:00'::text,
  notify_new boolean not null default true,
  notify_change boolean not null default true,
  notify_cancel boolean not null default true,
  notify_payment boolean not null default false,
  budget boolean not null default true,
  updated_at timestamp with time zone not null default now(),
  constraint team_notification_prefs_client_reminder_time_check CHECK (((client_reminder_time IS NULL) OR (client_reminder_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'::text))),
  constraint team_notification_prefs_team_fk FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id) ON DELETE CASCADE,
  constraint team_notification_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint team_notification_prefs_pkey PRIMARY KEY (user_id, tenant_id, team_id)
);
alter table public.team_notification_prefs enable row level security;

create table public.team_schedules (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  team_id text not null,
  schedule jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint team_schedules_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint team_schedules_pkey PRIMARY KEY (id)
);
alter table public.team_schedules enable row level security;

create table public.teams (
  id text not null,
  tenant_id uuid not null,
  name text not null,
  region text,
  color text,
  default_city text,
  lead_id text,
  lead_ids jsonb not null default '[]'::jsonb,
  helper_ids jsonb not null default '[]'::jsonb,
  roles jsonb not null default '[]'::jsonb,
  members jsonb not null default '[]'::jsonb,
  cities jsonb not null default '[]'::jsonb,
  payout_percentage numeric(5,2) not null default 0,
  default_scroll_time text,
  calendar_window_start text,
  calendar_window_end text,
  default_slot_minutes integer,
  buffer_minutes integer,
  hide_cancelled boolean,
  allow_overtime boolean,
  timezone text,
  tint_days_by_label boolean,
  appointment_blocks jsonb,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  icon text,
  legal_entity_id uuid,
  constraint teams_legal_entity_fkey FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id) ON DELETE SET NULL (legal_entity_id),
  constraint teams_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint teams_pkey PRIMARY KEY (tenant_id, id)
);
alter table public.teams enable row level security;

create table public.tenant_loyalty_settings (
  tenant_id uuid not null,
  enabled boolean not null default false,
  tiers jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint tenant_loyalty_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint tenant_loyalty_settings_pkey PRIMARY KEY (tenant_id)
);
alter table public.tenant_loyalty_settings enable row level security;

create table public.tenant_members (
  tenant_id uuid not null,
  user_id uuid not null,
  role text not null,
  invited_by_user_id uuid,
  joined_at timestamp with time zone not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  master_id text,
  access_version bigint not null default 0,
  constraint tenant_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'master'::text]))),
  constraint tenant_members_invited_by_user_id_fkey FOREIGN KEY (invited_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint tenant_members_master_fkey FOREIGN KEY (tenant_id, master_id) REFERENCES masters(tenant_id, id),
  constraint tenant_members_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint tenant_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint tenant_members_pkey PRIMARY KEY (tenant_id, user_id)
);
alter table public.tenant_members enable row level security;

create table public.tenant_sms_config (
  tenant_id uuid not null,
  mode text not null default 'platform'::text,
  enabled boolean not null default false,
  remind_24h_before boolean not null default true,
  remind_2h_before boolean not null default false,
  template_24h text not null default 'Здравствуйте, {client_name}! Напоминаем что у Вас завтра в {time} назначен визит. Если что-то изменилось — позвоните нам.'::text,
  template_2h text not null default 'Здравствуйте, {client_name}! Через 2 часа у Вас назначен визит на {time}.'::text,
  twilio_account_sid text,
  twilio_auth_token text,
  twilio_phone_number text,
  sent_this_month integer not null default 0,
  free_quota_per_month integer,
  quota_period_start timestamp with time zone not null default date_trunc('month'::text, now()),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  sender_name text,
  sender_status text,
  sender_requested_at timestamp with time zone,
  sender_approved_at timestamp with time zone,
  sender_rejection_reason text,
  balance_cents integer not null default 0,
  free_sms_remaining integer not null default 0,
  total_sent_count integer not null default 0,
  team_ids text[] not null default '{}'::text[],
  quiet_from integer not null default 21,
  quiet_to integer not null default 8,
  frozen_at timestamp with time zone,
  frozen_reason text,
  constraint tenant_sms_config_byok_complete CHECK (((mode = 'platform'::text) OR ((twilio_account_sid IS NOT NULL) AND (twilio_account_sid <> ''::text) AND (twilio_auth_token IS NOT NULL) AND (twilio_auth_token <> ''::text) AND (twilio_phone_number IS NOT NULL) AND (twilio_phone_number <> ''::text)))),
  constraint tenant_sms_config_mode_check CHECK ((mode = ANY (ARRAY['platform'::text, 'byok'::text]))),
  constraint tenant_sms_config_no_free CHECK ((free_sms_remaining = 0)),
  constraint tenant_sms_config_quiet_check CHECK ((((quiet_from >= 0) AND (quiet_from <= 23)) AND ((quiet_to >= 0) AND (quiet_to <= 23)))),
  constraint tenant_sms_config_sender_status_check CHECK (((sender_status IS NULL) OR (sender_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))),
  constraint tenant_sms_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint tenant_sms_config_pkey PRIMARY KEY (tenant_id)
);
alter table public.tenant_sms_config enable row level security;
comment on table public.tenant_sms_config is 'STORY-047 — per-tenant SMS configuration. Owner-only writes via RLS, owner reads via read_tenant_sms_config_safe() RPC (token shielded). Service-role bypass for the send_sms Edge Function.';

create table public.tenant_state (
  tenant_id uuid not null,
  prototype_state jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone not null default now(),
  constraint tenant_state_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint tenant_state_pkey PRIMARY KEY (tenant_id)
);
alter table public.tenant_state enable row level security;

create table public.tenants (
  id uuid not null default gen_random_uuid(),
  name text not null,
  vertical text,
  created_at timestamp with time zone not null default now(),
  city text,
  onboarded_at timestamp with time zone,
  plan text not null default 'free'::text,
  plan_override text,
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text,
  trial_ends_at timestamp with time zone,
  current_period_end timestamp with time zone,
  personal_calendar_enabled boolean not null default false,
  country text not null default 'CY'::text,
  currency text not null default 'EUR'::text,
  booking_slug text,
  logo_url text,
  business_address text,
  contact_phone text,
  contact_email text,
  contact_whatsapp text,
  contact_telegram text,
  contact_instagram text,
  legal_name text,
  vat_number text,
  address text,
  iban text,
  bank_name text,
  invoice_prefix text not null default 'INV'::text,
  track_units boolean not null default true,
  vat_mode text not null default 'off'::text,
  vat_rate numeric not null default 0,
  vat_exemption_note text,
  document_language text not null default 'en'::text,
  invoice_number_padding integer not null default 3,
  invoice_number_yearly_reset boolean not null default true,
  invoice_next_number integer,
  invoice_due_days integer not null default 7,
  invoice_line_source text not null default 'services'::text,
  invoice_default_line_title text not null default 'Услуги'::text,
  invoice_footer_note text,
  trial_tier text,
  trial_started_at timestamp with time zone,
  working_team_ids text[],
  kind text not null default 'company'::text,
  personal_of uuid,
  created_by uuid,
  paid_calendars integer,
  constraint tenants_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
  constraint tenants_invoice_default_line_title_check CHECK ((btrim(invoice_default_line_title) <> ''::text)),
  constraint tenants_invoice_due_days_check CHECK (((invoice_due_days >= 0) AND (invoice_due_days <= 365))),
  constraint tenants_invoice_line_source_check CHECK ((invoice_line_source = ANY (ARRAY['services'::text, 'total'::text]))),
  constraint tenants_invoice_next_number_check CHECK (((invoice_next_number IS NULL) OR ((invoice_next_number >= 1) AND (invoice_next_number <= 1000000000)))),
  constraint tenants_invoice_number_padding_check CHECK (((invoice_number_padding >= 1) AND (invoice_number_padding <= 8))),
  constraint tenants_kind_check CHECK ((kind = ANY (ARRAY['personal'::text, 'company'::text]))),
  constraint tenants_paid_calendars_check CHECK (((paid_calendars IS NULL) OR (paid_calendars >= 0))),
  constraint tenants_personal_of_matches_kind CHECK (((kind = 'personal'::text) = (personal_of IS NOT NULL))),
  constraint tenants_plan_check CHECK ((plan = ANY (ARRAY['free'::text, 'solo'::text, 'pro'::text, 'max'::text]))),
  constraint tenants_plan_override_check CHECK (((plan_override IS NULL) OR (plan_override = ANY (ARRAY['lifetime'::text, 'beta_unlimited'::text])))),
  constraint tenants_subscription_status_check CHECK (((subscription_status IS NULL) OR (subscription_status = ANY (ARRAY['active'::text, 'trialing'::text, 'past_due'::text, 'canceled'::text, 'incomplete'::text])))),
  constraint tenants_trial_tier_check CHECK (((trial_tier IS NULL) OR (trial_tier = ANY (ARRAY['solo'::text, 'pro'::text, 'max'::text])))),
  constraint tenants_vat_mode_check CHECK ((vat_mode = ANY (ARRAY['off'::text, 'inclusive'::text, 'exclusive'::text]))),
  constraint tenants_vat_rate_check CHECK (((vat_rate >= (0)::numeric) AND (vat_rate < (100)::numeric))),
  constraint tenants_vertical_check CHECK ((vertical = ANY (ARRAY['hvac'::text, 'beauty'::text, 'auto'::text, 'cleaning'::text, 'other'::text]))),
  constraint tenants_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint tenants_personal_of_fkey FOREIGN KEY (personal_of) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint tenants_pkey PRIMARY KEY (id),
  constraint tenants_stripe_customer_id_key UNIQUE (stripe_customer_id),
  constraint tenants_stripe_subscription_id_key UNIQUE (stripe_subscription_id)
);
alter table public.tenants enable row level security;

create table public.user_calendar_order (
  user_id uuid not null default auth.uid(),
  calendars text[] not null default '{}'::text[],
  updated_at timestamp with time zone not null default now(),
  constraint user_calendar_order_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint user_calendar_order_pkey PRIMARY KEY (user_id)
);
alter table public.user_calendar_order enable row level security;

create table public.user_hidden_calendars (
  user_id uuid not null default auth.uid(),
  tenant_id uuid not null,
  team_id text not null,
  created_at timestamp with time zone not null default now(),
  constraint user_hidden_calendars_tenant_id_team_id_fkey FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id) ON DELETE CASCADE,
  constraint user_hidden_calendars_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint user_hidden_calendars_pkey PRIMARY KEY (user_id, tenant_id, team_id)
);
alter table public.user_hidden_calendars enable row level security;

create table public.webhooks (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  label text not null,
  url text not null,
  secret text not null default replace((gen_random_uuid())::text, '-'::text, ''::text),
  events jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  last_fired_at timestamp with time zone,
  last_status integer,
  failure_count integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint webhooks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint webhooks_pkey PRIMARY KEY (id)
);
alter table public.webhooks enable row level security;
