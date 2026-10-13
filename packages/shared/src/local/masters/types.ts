// Shapes of people and teams. Permission rules live in ./permissions.ts.

export type MasterRole = "admin" | "dispatcher" | "lead" | "helper";

/** Extra phone row — structurally the client's `PhoneEntry` (kept local:
 *  `clients.ts` imports this module, a back-import would be a cycle). */
export interface MasterPhoneEntry {
  id: string;
  number: string;
  label: string;
  name?: string;
}

export interface MasterExtraContacts {
  phones?: MasterPhoneEntry[];
  whatsapp_phone?: string;
  telegram_username?: string;
  instagram_username?: string;
  email?: string;
}

// Sprint 027 — the permission surface grew from 9 to ~25 flags to
// support a real SaaS onboarding (lead working only in their brigade
// must not see finances or other brigades). Grouped into five
// semantic clusters: calendar / clients / finance / chats / admin.
// The legacy 9-field shape is preserved so records persisted before
// this sprint keep parsing.
export interface MasterPermissions {
  // ── Legacy / calendar-related ──────────────────────────────────
  /** Видеть цены услуг в каталоге и в записи. */
  see_prices: boolean;
  /** Видеть доходы / расходы / прибыль (общий тумблер финансов). */
  see_finances: boolean;
  see_clients_phone: boolean;
  see_clients_address: boolean;
  see_clients_balance: boolean;

  can_create_appointments: boolean;
  can_edit_appointments: boolean;
  can_delete_appointments: boolean;
  can_complete_appointments: boolean;

  /** Which teams' calendars are visible.
   *  Empty array = only own team. `['*']` = all teams. */
  visible_team_ids: string[];

  // ── Новые флаги Sprint 027 (все optional — legacy-записи не ломаются) ──
  // Календарь
  can_reschedule_appointments?: boolean;
  can_edit_all_appointments?: boolean; // иначе только свои
  can_see_all_teams_calendar?: boolean; // синоним `visible_team_ids = ['*']`, но явный флаг для UX

  // Клиенты
  see_clients_list?: boolean; // если false — мастер видит клиента только внутри своей записи
  see_clients_financial_history?: boolean;
  can_create_clients?: boolean;
  can_edit_clients?: boolean;
  can_delete_clients?: boolean;

  // Финансы
  see_own_salary?: boolean;
  see_own_brigade_revenue?: boolean;
  see_own_brigade_expenses?: boolean;
  see_all_company_finances?: boolean; // только admin/dispatcher
  can_add_expenses?: boolean;
  can_record_payments?: boolean;
  can_apply_discounts?: boolean;

  // Чаты
  see_brigade_chats?: boolean;
  see_all_chats?: boolean;
  can_reply_chats?: boolean;

  // Администрирование
  can_manage_masters?: boolean;
  can_manage_teams?: boolean;
  can_manage_services?: boolean;
  can_manage_settings?: boolean;
}

export type AccountStatus =
  | "invited" // CEO created creds, user hasn't logged in yet
  | "active" // logged in at least once
  | "paused" // temporarily disabled (отпуск, больничный)
  | "terminated"; // уволен

export interface Master {
  id: string;
  full_name: string;
  phone: string;
  avatar_url?: string | null;
  team_id: string | null; // primary team (null = no team, e.g. admin or universal substitute)
  role: MasterRole;
  is_active: boolean;
  permissions: MasterPermissions;
  created_at: string; // ISO date

  /** Custom job title the tenant writes themselves ("Старший техник",
   *  "Инженер-холодильщик", "Менеджер по городу"). Free text, no
   *  taxonomy — the system role (admin/dispatcher/lead/helper) owns
   *  permissions; this is pure display. Shown in the master card and
   *  optionally on client-facing blocks. */
  title?: string;

  // Contact & personal (all optional — legacy records stay valid).
  email?: string;
  whatsapp?: string;
  telegram?: string;
  /** YYYY-MM-DD */
  birthday?: string;
  /** Free-text ("Пафос, ул. Posidonos 12"). No structure needed yet. */
  address?: string;

  /** Extra contacts under the main phone — the same shape the client card
   *  keeps (second numbers, messengers, a personal email), so the employee
   *  page reuses the client's contact rows and «Добавить контакт» sheet. */
  contacts?: MasterExtraContacts;
  /** «Заметка сотрудника» — one free-text note, written by the owner. */
  note?: string;

  // Employment.
  /** YYYY-MM-DD */
  hire_date?: string;

  // Реквизиты сотрудника — одни на человека. Нужны бухгалтеру при
  // выплате, поэтому пережили снос кадрово-зарплатной подсистемы.
  iban?: string;
  bank_name?: string;
  /** Local tax number (TIN / АФМ / ИНН). */
  tax_number?: string;
  /** Cyprus-resident flag — учитывается при расчёте налогов. */
  tax_resident?: boolean;

  // ── Sprint 027: Babun account (login credentials) ─────────────
  /** Login email. Same as `email` by default but kept separate so
   *  personal email ≠ company login is expressible. */
  login_email?: string;
  /** True once the CEO has configured login credentials for this
   *  employee. The actual password is never persisted client-side —
   *  it is handed to the user out-of-band and from Sprint 028 lands
   *  in `auth.users` via Supabase admin API. */
  credentials_set?: boolean;
  /** When the credentials were first set (or re-issued). */
  invite_sent_at?: string;
  /** Last time the employee actually logged in. Updated by the auth
   *  layer when Supabase is wired; unused in the localStorage build. */
  last_login_at?: string;
  account_status?: AccountStatus;
  /** YYYY-MM-DD if account_status === 'terminated'. */
  terminated_at?: string;

  /** Personal cities — overrides the brigade defaults for this
   *  master when computing "кого отправить в этот район". */
  cities?: string[];

  // ── Sprint 033 Phase I37 — Personal calendar ────────────────────
  /** Display name of the master's personal calendar (shown on the
   *  brigade-tabs as a chip and in the /settings/calendar page).
   *  If empty — falls back to «Мой календарь». */
  personal_calendar_name?: string;
  /** Tint of the personal calendar in the tab / event block. Hex. */
  personal_calendar_color?: string;
}

export interface Team {
  id: string;
  name: string;
  region: string;
  color: string; // hex
  default_city: string; // Базовый город команды — используется как дефолт для дней
  /** Primary lead id. Kept for backwards compat with records saved
   *  before Sprint 033 and still read by a few non-editor views
   *  (schedule picker, finances summary). New code should prefer
   *  `getTeamLeadIds(team)` which handles multi-lead teams. */
  lead_id: string | null;
  /** Sprint 033: multiple leads. When defined, this wins over
   *  `lead_id` everywhere. The editor writes both fields — `lead_id`
   *  = first of `lead_ids` — so legacy readers keep working. */
  lead_ids?: string[];
  helper_ids: string[];
  /** Зарплата команды = этот процент от чистого дохода команды
   *  (доходы минус расходы) за период. 0 = не считается. */
  payout_percentage: number;
  active: boolean;
  created_at: string;
  // ── Sprint 033 — brigade-as-hub extensions. All optional so records
  //    saved before this sprint keep parsing; empty array / undefined
  //    means "no preference" and the calendar falls back to global
  //    defaults, as before.
  /** Cities this brigade works in (besides default_city). If set,
   *  CityPickerModal bubbles these to the top. */
  cities?: string[];
  // Services this brigade does are NOT stored here — the inverse
  // relation lives on `Service.brigade_ids`. This avoids two sources
  // of truth that could drift out of sync. The brigade editor toggles
  // `brigade_ids` directly.
  /** Time the calendar scrolls to when the user switches to this
   *  brigade ("14:00"). Undefined = no auto-scroll. */
  default_scroll_time?: string;
  /** Calendar grid start ("06:00"). Undefined = 00:00. */
  calendar_window_start?: string;
  /** Calendar grid end ("23:30"). Undefined = 24:00. */
  calendar_window_end?: string;
  /** Sprint 033 Phase I25 — explicit display order on the brigades
   *  list AND on the calendar-tabs header. Records without a value
   *  sort after those that have one (treated as Infinity). Reordered
   *  via drag-and-drop on /dashboard/teams. */
  sort_order?: number;
  /** Sprint 033 Phase I28 — default duration (minutes) when the
   *  dispatcher taps an empty calendar slot on this brigade's
   *  column to create a blank appointment. Undefined = fall back
   *  to 30 minutes — шаг сетки в продукте один и не настраивается
   *  (владелец 2026-09-10). */
  default_slot_minutes?: number;
  /** Sprint 033 Phase I39 — per-brigade overrides of the global
   *  «Поведение календаря». Undefined = inherit from global
   *  `CalendarSettings`. Mirror the three fields on the global type
   *  so brigade preview is just a swap of the resolved value. */
  buffer_minutes?: number;
  hide_cancelled?: boolean;
  allow_overtime?: boolean;
  /** Per-brigade timezone for the calendar. Undefined = inherit the
   *  global default (Europe/Nicosia). */
  timezone?: string;
  /** Tint each day-column with the city/label colour. Undefined = true
   *  (current behaviour); false leaves columns plain white. Toggled from
   *  the brigade «Метки» settings. */
  tint_days_by_label?: boolean;

  // ── Sprint 033 Phase I43 — custom roles + explicit membership ──
  /** Tenant-authored role taxonomy for THIS brigade. Each member
   *  below holds one of these. Defaults to [Старший, Помощник]
   *  on first write from a legacy lead_ids/helper_ids brigade. */
  roles?: BrigadeRole[];
  /** Who's in this brigade and with what role. When defined this
   *  supersedes lead_ids/helper_ids as the source of truth; legacy
   *  fields are still written for downstream readers that haven't
   *  been ported. */
  members?: BrigadeMember[];
}

// ─── Brigade custom roles & members (Sprint 033 Phase I43) ──────

/** A brigade can define its own role taxonomy — «Старший»,
 *  «Установщик», «Электрик», whatever the tenant thinks in. Unlike
 *  the system-level MasterRole (admin/dispatcher/lead/helper) these
 *  are display-only labels without permission semantics. */
export interface BrigadeRole {
  id: string;
  name: string;
  color?: string;
}

/** Master ↔ brigade membership with the role the master holds in
 *  this particular brigade. One master can sit in multiple brigades
 *  with different roles. */
export interface BrigadeMember {
  master_id: string;
  role_id: string | null; // null = без роли
  /** Sprint 033 Phase I47 — granular per-brigade permissions. Undef
   *  = full access (backward compat). See lib/brigade-permissions.ts
   *  for the type (avoids a circular import). */
  permissions?: import("../brigade-permissions").BrigadeMemberPermissions;
}
