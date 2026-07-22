// Masters & Teams data layer.
//
// Single source of truth for the people and brigades that work in the field.
// Persisted in localStorage now, will move to Supabase later.

export type MasterRole = "admin" | "dispatcher" | "lead" | "helper";

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

// Sprint 026-cleanup: Master is now the employee record — it carries
// salary terms, personal contacts, documents, and notes alongside the
// original team/role/permissions. All new fields are optional so the
// existing seeded / previously-persisted masters keep working without
// a migration script.
//
// Sprint 027: expanded into a full SaaS employee profile — login
// credentials, account lifecycle status, work schedule, contract
// type, richer salary model (period + method + fixed_bonus +
// deduction), and the ~25-flag permissions matrix above.
export type SalaryModel =
  | "percent_of_team" // legacy behaviour: paid via team.payout_percentage
  | "percent_of_own" // % of revenue from their own visits
  | "per_visit" // flat fee per completed visit
  | "monthly" // fixed monthly salary
  | "hourly" // hourly rate
  | "hybrid" // base salary + % of own work
  | "none"; // e.g. owner/admin paid from outside the system

export type SalaryPeriod = "weekly" | "biweekly" | "monthly";
export type PaymentMethod = "cash" | "card" | "bank_transfer" | "other";

export interface MasterSalary {
  model: SalaryModel;
  /** Meaning depends on `model`:
   *  percent_of_team → 0 (team handles it)
   *  percent_of_own  → 0–100
   *  per_visit       → euros per visit
   *  monthly         → euros per month
   *  hourly          → euros per hour
   *  hybrid          → monthly base in euros (hybrid_percent holds the %)
   *  none            → 0
   */
  value: number;
  /** Only used when model = "hybrid": % of own work on top of base. */
  hybrid_percent?: number;
  /** Fixed monthly bonus if KPIs are met (optional, free-form). */
  fixed_bonus?: number;
  /** Fixed monthly deduction (advance, materials, etc). */
  deduction?: number;
  /** When payout happens. Defaults to `monthly` if not set. */
  period?: SalaryPeriod;
  /** How the payout happens. Defaults to `cash` if not set. */
  method?: PaymentMethod;
  /** Optional free-text clause shown on payroll review ("авансы по
   *  средам", "минус наличные"). */
  note?: string;
  // ── Sprint 033 Phase I33 — banking details for direct-deposit
  //    payouts. All optional; empty = pay in cash as per `method`.
  iban?: string;
  bank_name?: string;
  /** Local tax number (TIN / АФМ / ИНН). */
  tax_number?: string;
  /** Cyprus-resident flag — used to decide if VAT 19% applies on
   *  invoices emitted to this master's payroll entries. */
  tax_resident?: boolean;
}

// ─── SalaryRule (v306, replaces flat MasterSalary) ────────────────────
//
// A SalaryRule describes how one employee is paid for work done inside
// one specific brigade. A master in N brigades can have up to N rules
// (one per brigade). Rules are additive — base + percent + per-visit +
// hourly all stack onto one payout. Legacy MasterSalary is migrated
// into a single-rule array on load; old readers still compile via the
// deprecated `Master.salary` field.

/** % of WHAT revenue stream the percent_rate applies to. */
export type PercentSource = "team" | "own";

/** WHICH figure counts as revenue. Gross = sum of completed
 *  appointment total_amount. Net = gross minus
 *  sum(appointment.expenses[].amount) (materials, fuel, etc). */
export type RevenueBasis = "gross" | "net";

export interface SalaryRule {
  id: string;
  /** Brigade this rule applies to. null = tenant-wide fallback
   *  (admins / universal roles without brigade attachment). */
  brigade_id: string | null;
  /** Fixed base paid every period (€), regardless of workload. */
  base_amount: number;
  /** Percent of revenue (0–100). Applied on top of base. */
  percent_rate: number;
  /** Whose revenue fuels the percent — team turnover or master's own
   *  closed appointments. Defaults to "team" when percent_rate > 0. */
  percent_source: PercentSource;
  /** Gross revenue or net-of-expenses. Defaults to "gross". */
  percent_of: RevenueBasis;
  /** Flat € per completed visit (the master's own visit). */
  per_visit: number;
  /** € per hour worked. Not tracked automatically yet — future use. */
  hourly_rate: number;
  /** Fixed monthly bonus (KPI / seniority top-up, free-form). */
  fixed_bonus?: number;
  /** Fixed monthly deduction (advance, tool rental, etc). */
  deduction?: number;
  /** Payout cadence. Default "monthly". */
  period?: SalaryPeriod;
  /** Payout channel. Default "cash". */
  method?: PaymentMethod;
  /** Free-text note shown on payroll review. */
  note?: string;
}

export const PERCENT_SOURCE_LABELS: Record<PercentSource, string> = {
  team: "от оборота команды",
  own: "от своих визитов",
};

export const REVENUE_BASIS_LABELS: Record<RevenueBasis, string> = {
  gross: "валовый оборот",
  net: "чистая прибыль",
};

// ─── Incidents (v307 — structured replacement for freeform notes) ───
//
// A dated log entry per HR-relevant event: late start, customer
// complaint, formal warning, kudos. Stored on Master.incidents[] so
// history survives the person's whole tenure in the company.

export type IncidentCategory =
  | "late" // опоздание
  | "complaint" // жалоба клиента
  | "warning" // предупреждение
  | "kudos" // благодарность
  | "other";

export const INCIDENT_LABELS: Record<IncidentCategory, string> = {
  late: "Опоздание",
  complaint: "Жалоба клиента",
  warning: "Предупреждение",
  kudos: "Благодарность",
  other: "Заметка",
};

export const INCIDENT_TONE: Record<IncidentCategory, string> = {
  late: "bg-[rgba(255,149,0,0.1)] text-[var(--system-orange)]",
  complaint: "bg-[rgba(255,59,48,0.1)] text-[var(--system-red)]",
  warning: "bg-[rgba(255,59,48,0.1)] text-[var(--system-red)]",
  kudos: "bg-[rgba(52,199,89,0.1)] text-[var(--system-green)]",
  other: "bg-[var(--fill-tertiary)] text-[var(--label-secondary)]",
};

export interface MasterIncident {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  category: IncidentCategory;
  text: string;
  /** ISO timestamp when the entry was recorded. Not editable. */
  created_at: string;
}

export interface MasterDocument {
  id: string;
  /** "Паспорт", "Водительские права", "ИНН" */
  kind: string;
  /** Номер / серия / expiry in one free-text line for v1. */
  value: string;
  /** Expiry date (YYYY-MM-DD). Used to badge "скоро истекает". */
  expires_at?: string;
  /** Scan attachment. Phase 1 stores just filename + size for UX
   *  completeness; real bytes land in Supabase Storage later. */
  file_name?: string;
  file_size?: number;
  note?: string;
}

// ─── Skills & certifications (Sprint 033 Phase I33) ──────────────────

/** Canonical certification kinds that SaaS targets across service
 *  businesses. `other` lets the tenant type anything. */
export type CertificationKind =
  | "fgas"
  | "electrical"
  | "driving"
  | "medical"
  | "work_permit"
  | "language"
  | "other";

export const CERTIFICATION_LABELS: Record<CertificationKind, string> = {
  fgas: "F-Gas / фреон",
  electrical: "Электрика",
  driving: "Водительские права",
  medical: "Мед. книжка",
  work_permit: "Разрешение на работу",
  language: "Языковой сертификат",
  other: "Другое",
};

export interface Certification {
  id: string;
  kind: CertificationKind;
  /** Freeform label; used for kind === "other" primarily. */
  label?: string;
  number?: string;
  issued_at?: string; // YYYY-MM-DD
  expires_at?: string; // YYYY-MM-DD
  file_name?: string;
  file_size?: number;
  note?: string;
}

// ─── Leaves / отпуск (Sprint 033 Phase I33) ─────────────────────────

export type LeaveKind = "vacation" | "sick" | "personal" | "unpaid";

export const LEAVE_LABELS: Record<LeaveKind, string> = {
  vacation: "Отпуск",
  sick: "Больничный",
  personal: "По личным",
  unpaid: "Без содержания",
};

export interface MasterLeave {
  id: string;
  /** Inclusive YYYY-MM-DD. */
  start: string;
  end: string;
  kind: LeaveKind;
  /** If false, this period is excluded from payroll calculations
   *  (ЗП не начисляется). UI toggles per-leave. */
  paid: boolean;
  /** Optional replacement master id — works in this master's
   *  brigades while they are out. Any active master can stand in,
   *  not restricted to the same brigade. */
  substitute_master_id?: string | null;
  note?: string;
}

// ─── Login history & audit (Sprint 033 Phase I33) ───────────────────

export interface LoginEvent {
  timestamp: string;
  user_agent?: string;
  ip?: string;
}

export type AuditAction =
  | "created"
  | "role_changed"
  | "title_changed"
  | "salary_changed"
  | "credentials_issued"
  | "credentials_reset"
  | "credentials_revoked"
  | "archived"
  | "unarchived"
  | "team_changed"
  | "leave_added"
  | "leave_removed"
  | "certification_changed"
  | "other";

export interface AuditEvent {
  id: string;
  timestamp: string;
  action: AuditAction;
  /** Human-readable one-liner shown in the /info audit log. */
  summary: string;
  /** Optional actor id — we don't have auth context yet, so most
   *  events record just "ты сам это сделал". */
  actor_id?: string;
}

export type ContractType = "full_time" | "part_time" | "contractor" | "trial";

export const CONTRACT_LABELS: Record<ContractType, string> = {
  full_time: "Полная занятость",
  part_time: "Частичная занятость",
  contractor: "Подрядчик",
  trial: "Испытательный срок",
};

export type AccountStatus =
  | "invited" // CEO created creds, user hasn't logged in yet
  | "active" // logged in at least once
  | "paused" // temporarily disabled (отпуск, больничный)
  | "terminated"; // уволен

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  invited: "Приглашён",
  active: "Активен",
  paused: "На паузе",
  terminated: "Уволен",
};

export const ACCOUNT_STATUS_TONE: Record<AccountStatus, string> = {
  invited: "bg-[rgba(62,136,247,0.08)] text-[var(--system-blue)] border-[rgba(62,136,247,0.25)]",
  active: "bg-[rgba(52,199,89,0.08)] text-[var(--system-green)] border-[rgba(52,199,89,0.25)]",
  paused: "bg-[rgba(255,149,0,0.08)] text-[var(--system-orange)] border-[rgba(255,149,0,0.25)]",
  terminated: "bg-[rgba(255,59,48,0.08)] text-[var(--system-red)] border-[rgba(255,59,48,0.25)]",
};

export interface NotificationPrefs {
  push_new_appointment: boolean;
  push_reschedule: boolean;
  push_cancellation: boolean;
  push_daily_summary: boolean;
  push_chat_message: boolean;
  /** Channel(s) the user prefers for company-wide SMS / email blasts. */
  channels: Array<"push" | "email" | "sms">;
}

export interface WorkSchedule {
  /** Mon–Sun bitmask, 0 = Monday: [true,true,true,true,true,false,false] */
  days: [boolean, boolean, boolean, boolean, boolean, boolean, boolean];
  /** HH:MM */
  start_time: string;
  /** HH:MM */
  end_time: string;
}

export const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

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

  // Employment.
  /** YYYY-MM-DD */
  hire_date?: string;
  emergency_contact?: string;
  contract_type?: ContractType;
  work_schedule?: WorkSchedule;

  // Compensation.
  /** DEPRECATED — kept for legacy records until the next clean-up
   *  pass. New code reads `salary_rules`. loadMasters() migrates
   *  this into a single-rule array on first load. */
  salary?: MasterSalary;
  /** v306 — per-brigade payment rules. A master in several brigades
   *  has one rule per brigade (additive base + percent + per-visit +
   *  hourly inside each rule). */
  salary_rules?: SalaryRule[];

  // Banking details (moved from salary to master in v306 — one set
  // per employee, not per rule).
  iban?: string;
  bank_name?: string;
  /** Local tax number (TIN / АФМ / ИНН). */
  tax_number?: string;
  /** Cyprus-resident flag — drives VAT 19% on payroll entries. */
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

  // Notification preferences — v1 supports push-only opt-outs.
  notifications?: NotificationPrefs;

  // Misc.
  documents?: MasterDocument[];
  notes?: string;
  /** v307 — structured incident log (late / complaint / warning /
   *  kudos / other). Replaces the freeform `notes` field for
   *  dated HR-relevant events. */
  incidents?: MasterIncident[];

  // ── Sprint 033 Phase I33 — SaaS-completeness additions ──────────
  /** Free-text skills / expertise ("Установка", "F-gas", "Чиллеры"). */
  skills?: string[];
  /** Certifications with optional expiry and attached scan. */
  certifications?: Certification[];
  /** Personal cities — overrides the brigade defaults for this
   *  master when computing "кого отправить в этот район". */
  cities?: string[];
  /** Holiday / sick / personal leave periods with paid flag and
   *  optional substitute. Not yet integrated into payroll. */
  leaves?: MasterLeave[];
  /** Last N login events. Populated by the Supabase Auth hook once
   *  we wire it; empty in the localStorage build. */
  login_history?: LoginEvent[];
  /** Trailing audit trail (capped at 100). Admin reads this to see
   *  who changed what. */
  audit?: AuditEvent[];

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
   *  to global calendarSettings.gridStep. */
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

  // ── Sprint 033 Phase I42 — per-brigade AppointmentSheet layout ──
  /** Which optional blocks show up in the create/edit sheet when the
   *  user is working in this brigade's calendar. Client + services
   *  sections are mandatory — their flags aren't here. Undefined =
   *  inherit from the tenant-wide FormFieldVisibility. */
  appointment_blocks?: BrigadeAppointmentBlocks;

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
  permissions?: import("./brigade-permissions").BrigadeMemberPermissions;
}

// NOTE: no default roles are auto-created for a fresh brigade — the
// tenant authors them explicitly. Legacy migration (see the masters
// page) is the only place these IDs still appear, and only for
// buckets that actually have members.
export const LEGACY_LEAD_ROLE_ID = "role-lead";
export const LEGACY_HELPER_ROLE_ID = "role-helper";

// STORY audit: до этой константы три разных места жёстко проверяли
// `role.name.trim().toLowerCase() === "бригадир"`. Это хрупкая логика
// — если диспетчер создал роль с именем «Старший» или «Руководитель»,
// она не считалась лидерской. Сейчас сводим в одну точку, чтобы
// позже можно было заменить на явный `is_lead: boolean` флаг на
// уровне BrigadeRole без правок call-sites.
export const LEAD_ROLE_NAME = "бригадир";

export function isLeadRole(role: { name: string }): boolean {
  return role.name.trim().toLowerCase() === LEAD_ROLE_NAME;
}

// ─── Brigade appointment-sheet visibility (Sprint 033 Phase I42) ─

/** Optional blocks the dispatcher can toggle per brigade. Mandatory
 *  blocks (client, services) are hard-coded as always-visible.
 *  Sprint 033 Phase I46 — `order` lets the tenant drag-to-reorder the
 *  optional blocks; when undefined the default declaration order is
 *  used. Entries must be keys of this interface minus the order
 *  field itself. */
export interface BrigadeAppointmentBlocks {
  show_address?: boolean;
  show_address_note?: boolean;
  show_comment?: boolean;
  show_photos?: boolean;
  show_prepaid?: boolean;
  show_payment?: boolean;
  show_expenses?: boolean;
  show_reminder?: boolean;
  show_source?: boolean;
  /** Ordered list of optional-block keys. Unknown or missing entries
   *  fall back to the declaration order. */
  order?: string[];
}

// ─── Default permissions per role ──────────────────────────────────────
//
// The role → permission mapping is deliberately conservative: if a
// flag makes the CEO think twice, default it OFF. The form then lets
// them flip individual toggles for edge cases without touching the
// defaults.

export function defaultPermissionsForRole(role: MasterRole): MasterPermissions {
  const base = {
    // Legacy flags
    see_prices: false,
    see_finances: false,
    see_clients_phone: true,
    see_clients_address: true,
    see_clients_balance: false,
    can_create_appointments: false,
    can_edit_appointments: false,
    can_delete_appointments: false,
    can_complete_appointments: true,
    visible_team_ids: [] as string[],

    // Sprint 027 extended flags — defaulted off; role branches flip on.
    can_reschedule_appointments: false,
    can_edit_all_appointments: false,
    can_see_all_teams_calendar: false,

    see_clients_list: false,
    see_clients_financial_history: false,
    can_create_clients: false,
    can_edit_clients: false,
    can_delete_clients: false,

    see_own_salary: true,
    see_own_brigade_revenue: false,
    see_own_brigade_expenses: false,
    see_all_company_finances: false,
    can_add_expenses: false,
    can_record_payments: false,
    can_apply_discounts: false,

    see_brigade_chats: false,
    see_all_chats: false,
    can_reply_chats: false,

    can_manage_masters: false,
    can_manage_teams: false,
    can_manage_services: false,
    can_manage_settings: false,
  };

  switch (role) {
    case "admin":
      return {
        ...base,
        see_prices: true,
        see_finances: true,
        see_clients_balance: true,
        can_create_appointments: true,
        can_edit_appointments: true,
        can_delete_appointments: true,
        can_complete_appointments: true,
        visible_team_ids: ["*"],
        can_reschedule_appointments: true,
        can_edit_all_appointments: true,
        can_see_all_teams_calendar: true,
        see_clients_list: true,
        see_clients_financial_history: true,
        can_create_clients: true,
        can_edit_clients: true,
        can_delete_clients: true,
        see_own_brigade_revenue: true,
        see_own_brigade_expenses: true,
        see_all_company_finances: true,
        can_add_expenses: true,
        can_record_payments: true,
        can_apply_discounts: true,
        see_brigade_chats: true,
        see_all_chats: true,
        can_reply_chats: true,
        can_manage_masters: true,
        can_manage_teams: true,
        can_manage_services: true,
        can_manage_settings: true,
      };
    case "dispatcher":
      return {
        ...base,
        see_prices: true,
        see_finances: true,
        see_clients_balance: true,
        can_create_appointments: true,
        can_edit_appointments: true,
        can_delete_appointments: true,
        can_complete_appointments: true,
        visible_team_ids: ["*"],
        can_reschedule_appointments: true,
        can_edit_all_appointments: true,
        can_see_all_teams_calendar: true,
        see_clients_list: true,
        see_clients_financial_history: true,
        can_create_clients: true,
        can_edit_clients: true,
        see_own_brigade_revenue: true,
        see_own_brigade_expenses: true,
        see_all_company_finances: true,
        can_add_expenses: true,
        can_record_payments: true,
        can_apply_discounts: true,
        see_brigade_chats: true,
        see_all_chats: true,
        can_reply_chats: true,
      };
    case "lead":
      // Brigade lead: manages own brigade, earns % of brigade, does
      // not see other brigades or company finances by default.
      return {
        ...base,
        see_prices: true,
        see_clients_balance: true,
        can_edit_appointments: true,
        can_complete_appointments: true,
        visible_team_ids: [], // own team only
        can_reschedule_appointments: true,
        see_clients_list: true,
        can_edit_clients: true,
        see_own_brigade_revenue: true,
        see_own_brigade_expenses: true,
        can_add_expenses: true,
        can_record_payments: true,
        see_brigade_chats: true,
        can_reply_chats: true,
      };
    case "helper":
    default:
      // Helper: sees only their own brigade's calendar, minimal writes.
      return {
        ...base,
        can_complete_appointments: true,
        visible_team_ids: [], // own team only
      };
  }
}

export const ROLE_LABELS: Record<MasterRole, string> = {
  admin: "Администратор",
  dispatcher: "Диспетчер",
  lead: "Старший",
  helper: "Помощник",
};

export const SALARY_MODEL_LABELS: Record<SalaryModel, string> = {
  percent_of_team: "% от чистой прибыли команды",
  percent_of_own: "% от своих работ",
  per_visit: "Фиксировано за визит",
  monthly: "Оклад в месяц",
  hourly: "Почасовая",
  hybrid: "Оклад и % от своих работ",
  none: "Не учитывается",
};

export const SALARY_MODEL_HINTS: Record<SalaryModel, string> = {
  percent_of_team:
    "ЗП считается из payout_percentage команды. Самый частый вариант для лида.",
  percent_of_own:
    "Процент считается только с визитов, которые закрыл этот сотрудник.",
  per_visit: "Фиксированная ставка за каждый выполненный визит.",
  monthly: "Один и тот же оклад каждый месяц, независимо от объёма работ.",
  hourly: "Ставка умножается на фактически отработанные часы.",
  hybrid: "Оклад каждый месяц и дополнительный процент с собственных визитов.",
  none: "ЗП рассчитывается вне Babun — admin/owner на контракте.",
};

export const SALARY_UNIT: Record<SalaryModel, string> = {
  percent_of_team: "%",
  percent_of_own: "%",
  per_visit: "€",
  monthly: "€",
  hourly: "€/ч",
  hybrid: "€/мес",
  none: "",
};

export const SALARY_PERIOD_LABELS: Record<SalaryPeriod, string> = {
  weekly: "Каждую неделю",
  biweekly: "Раз в две недели",
  monthly: "Раз в месяц",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Наличные",
  card: "Карта",
  bank_transfer: "Банковский перевод",
  other: "Другое",
};

type PermissionKey = keyof Omit<MasterPermissions, "visible_team_ids">;

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  // Календарь
  can_create_appointments: "Создавать записи",
  can_edit_appointments: "Редактировать свои записи",
  can_edit_all_appointments: "Редактировать чужие записи",
  can_delete_appointments: "Удалять записи",
  can_complete_appointments: "Отмечать выполненные",
  can_reschedule_appointments: "Переносить записи",
  can_see_all_teams_calendar: "Видеть календарь всех команд",
  see_prices: "Видеть цены услуг",

  // Клиенты
  see_clients_list: "Открывать список клиентов",
  see_clients_phone: "Видеть телефон клиента",
  see_clients_address: "Видеть адрес клиента",
  see_clients_balance: "Видеть баланс клиента",
  see_clients_financial_history: "Видеть историю оплат клиента",
  can_create_clients: "Создавать клиентов",
  can_edit_clients: "Редактировать клиентов",
  can_delete_clients: "Удалять клиентов",

  // Финансы
  see_finances: "Видеть общие доходы и расходы",
  see_own_salary: "Видеть свою ЗП",
  see_own_brigade_revenue: "Видеть доходы команды",
  see_own_brigade_expenses: "Видеть расходы команды",
  see_all_company_finances: "Видеть финансы всей компании",
  can_add_expenses: "Добавлять расходы",
  can_record_payments: "Отмечать оплату визита",
  can_apply_discounts: "Применять скидки",

  // Чаты
  see_brigade_chats: "Видеть чаты своей команды",
  see_all_chats: "Видеть все чаты компании",
  can_reply_chats: "Отвечать в чатах",

  // Админ
  can_manage_masters: "Управление мастерами",
  can_manage_teams: "Управление командами",
  can_manage_services: "Управление услугами",
  can_manage_settings: "Настройки компании",
};

/** Permission groups matching Bumpix "Права доступа" categories. */
export type PermissionGroupKey =
  | "calendar"
  | "clients"
  | "finance"
  | "chats"
  | "admin";

export const PERMISSION_GROUPS: {
  key: PermissionGroupKey;
  title: string;
  description: string;
  permissions: PermissionKey[];
}[] = [
  {
    key: "calendar",
    title: "Календарь",
    description: "Просмотр и изменение записей",
    permissions: [
      "can_see_all_teams_calendar",
      "see_prices",
      "can_create_appointments",
      "can_edit_appointments",
      "can_edit_all_appointments",
      "can_complete_appointments",
      "can_reschedule_appointments",
      "can_delete_appointments",
    ],
  },
  {
    key: "clients",
    title: "Клиенты",
    description: "Что видно в карточке клиента",
    permissions: [
      "see_clients_list",
      "see_clients_phone",
      "see_clients_address",
      "see_clients_balance",
      "see_clients_financial_history",
      "can_create_clients",
      "can_edit_clients",
      "can_delete_clients",
    ],
  },
  {
    key: "finance",
    title: "Финансы",
    description: "Деньги, ЗП, кто что получает",
    permissions: [
      "see_own_salary",
      "see_own_brigade_revenue",
      "see_own_brigade_expenses",
      "see_finances",
      "see_all_company_finances",
      "can_add_expenses",
      "can_record_payments",
      "can_apply_discounts",
    ],
  },
  {
    key: "chats",
    title: "Чаты",
    description: "Переписка с клиентами",
    permissions: ["see_brigade_chats", "see_all_chats", "can_reply_chats"],
  },
  {
    key: "admin",
    title: "Администрирование",
    description: "Только для владельца и диспетчера",
    permissions: [
      "can_manage_masters",
      "can_manage_teams",
      "can_manage_services",
      "can_manage_settings",
    ],
  },
];

/** Backwards-compatible default for records saved before Sprint 027.
 *  Merges legacy permissions on top of the role-based default so the
 *  form never shows a half-empty matrix. */
export function mergePermissions(
  role: MasterRole,
  stored: MasterPermissions
): MasterPermissions {
  return { ...defaultPermissionsForRole(role), ...stored };
}

export function defaultNotificationPrefs(): NotificationPrefs {
  return {
    push_new_appointment: true,
    push_reschedule: true,
    push_cancellation: true,
    push_daily_summary: false,
    push_chat_message: true,
    channels: ["push"],
  };
}

export function defaultWorkSchedule(): WorkSchedule {
  return {
    days: [true, true, true, true, true, false, false],
    start_time: "09:00",
    end_time: "18:00",
  };
}

// ─── Salary rule helpers (v306) ─────────────────────────────────────

export interface RuleEstimateContext {
  /** Current-month gross revenue of this master's own closed visits
   *  in the rule's brigade. */
  ownGross: number;
  /** Current-month gross revenue of the whole brigade. */
  teamGross: number;
  /** Sum of expenses on this master's closed visits in the brigade. */
  ownExpenses: number;
  /** Sum of expenses across the whole brigade's closed visits. */
  teamExpenses: number;
  /** How many visits this master closed in the brigade this month. */
  visitsThisMonth: number;
}

/** Compute a rough monthly payout for a single rule given current-month
 *  revenue snapshots. Does not include hourly (no hours tracking) or
 *  future-period scaling. */
export function estimateRuleMonthly(
  rule: SalaryRule,
  ctx: RuleEstimateContext,
): number {
  let total = rule.base_amount || 0;
  if (rule.percent_rate > 0) {
    const src =
      rule.percent_source === "team"
        ? rule.percent_of === "net"
          ? Math.max(0, ctx.teamGross - ctx.teamExpenses)
          : ctx.teamGross
        : rule.percent_of === "net"
          ? Math.max(0, ctx.ownGross - ctx.ownExpenses)
          : ctx.ownGross;
    total += src * (rule.percent_rate / 100);
  }
  if (rule.per_visit > 0) {
    total += rule.per_visit * ctx.visitsThisMonth;
  }
  total += rule.fixed_bonus ?? 0;
  total -= rule.deduction ?? 0;
  return Math.max(0, Math.round(total));
}

/** One-liner plain-Russian summary of a rule for a card / list view. */
export function describeRule(rule: SalaryRule): string {
  const parts: string[] = [];
  if (rule.base_amount > 0) {
    parts.push(`${Math.round(rule.base_amount)}€/мес`);
  }
  if (rule.percent_rate > 0) {
    const src = PERCENT_SOURCE_LABELS[rule.percent_source];
    const basis = rule.percent_of === "net" ? " (чистая)" : "";
    parts.push(`${rule.percent_rate}% ${src}${basis}`);
  }
  if (rule.per_visit > 0) {
    parts.push(`${Math.round(rule.per_visit)}€/визит`);
  }
  if (rule.hourly_rate > 0) {
    parts.push(`${Math.round(rule.hourly_rate)}€/час`);
  }
  if (parts.length === 0) return "не настроено";
  return parts.join(" · ");
}

/** True when at least one pay component is set. */
export function isRuleConfigured(rule: SalaryRule): boolean {
  return (
    rule.base_amount > 0 ||
    rule.percent_rate > 0 ||
    rule.per_visit > 0 ||
    rule.hourly_rate > 0
  );
}

/** Factory for a fresh rule attached to a brigade. */
export function blankSalaryRule(
  brigadeId: string | null,
): SalaryRule {
  return {
    id: `salrule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    brigade_id: brigadeId,
    base_amount: 0,
    percent_rate: 0,
    percent_source: "team",
    percent_of: "gross",
    per_visit: 0,
    hourly_rate: 0,
    period: "monthly",
    method: "cash",
  };
}

/** Generates a readable 12-character password (4-letter blocks + digit
 *  so the CEO can dictate it over the phone without "a-or-e" confusion.
 *  Ambiguous letters (0 / O / l / 1) are stripped. */
export function generatePassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 12; i++) {
    const idx = Math.floor(Math.random() * alphabet.length);
    out += alphabet[idx];
    if (i === 3 || i === 7) out += "-";
  }
  return out;
}

// ─── Color palette for teams ───────────────────────────────────────────
// Sprint 033 Phase I20 — aliased to the unified PRESET_COLORS so
// brigade, city, group and service pickers all share one palette.

import { PRESET_COLORS as UNIFIED_TEAM_COLORS } from "@babun/shared/common/utils/colors";
export const TEAM_COLORS = UNIFIED_TEAM_COLORS;

// ─── Seed data ─────────────────────────────────────────────────────────
// STORY-053a — empty arrays. Previously these contained AirFix's real
// team (Артём, Дима, Юра…) which leaked into every fresh tenant on
// first signup. New tenants now start blank and are guided by the
// existing /dashboard/masters + /dashboard/teams empty-state CTAs to
// add their own. The constants stay exported so any external import
// keeps compiling; the values are just empty.

export const DEFAULT_MASTERS: Master[] = [];
export const DEFAULT_TEAMS: Team[] = [];

// ─── Storage ───────────────────────────────────────────────────────────

const MASTERS_KEY = "babun-masters";
const TEAMS_KEY = "babun-teams";

export function loadMasters(): Master[] {
  // STORY-072 leak fix — DEFAULT_MASTERS contains AirFix employee names.
  // New tenants get an empty list; explicit demo load happens via
  // Settings → Account → "Загрузить демо-данные".
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MASTERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    return (parsed as Master[]).map(migrateMasterSalaryShape);
  } catch {
    return [];
  }
}

/** v306 — convert legacy `Master.salary` (single flat object) into
 *  `Master.salary_rules[]`. Idempotent: if salary_rules already
 *  exists it is returned as-is. Legacy banking fields on salary are
 *  lifted to the master level. */
export function migrateMasterSalaryShape(m: Master): Master {
  if (m.salary_rules && m.salary_rules.length > 0) {
    return m;
  }
  const legacy = m.salary;
  if (!legacy || legacy.model === "none") {
    return m;
  }
  const rule: SalaryRule = {
    id: `salrule_${m.id}_init`,
    brigade_id: m.team_id ?? null,
    base_amount:
      legacy.model === "monthly" || legacy.model === "hybrid"
        ? legacy.value
        : 0,
    percent_rate:
      legacy.model === "percent_of_team" || legacy.model === "percent_of_own"
        ? legacy.value
        : legacy.model === "hybrid"
          ? legacy.hybrid_percent ?? 0
          : 0,
    percent_source:
      legacy.model === "percent_of_team"
        ? "team"
        : legacy.model === "percent_of_own"
          ? "own"
          : legacy.model === "hybrid"
            ? "own"
            : "team",
    percent_of: "gross",
    per_visit: legacy.model === "per_visit" ? legacy.value : 0,
    hourly_rate: legacy.model === "hourly" ? legacy.value : 0,
    fixed_bonus: legacy.fixed_bonus,
    deduction: legacy.deduction,
    period: legacy.period,
    method: legacy.method,
    note: legacy.note,
  };
  return {
    ...m,
    salary_rules: [rule],
    // Lift banking details up to the master.
    iban: m.iban ?? legacy.iban,
    bank_name: m.bank_name ?? legacy.bank_name,
    tax_number: m.tax_number ?? legacy.tax_number,
    tax_resident: m.tax_resident ?? legacy.tax_resident,
  };
}

export function saveMasters(masters: Master[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MASTERS_KEY, JSON.stringify(masters));
  } catch {
    // ignore
  }
}

export function loadTeams(): Team[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TEAMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    // Migrate records written before default_city was added: fall back to
    // the first token of the region string.
    return parsed.map((t: Partial<Team>) => ({
      ...t,
      default_city:
        t.default_city ??
        (t.region ? t.region.split(/[,/]/)[0].trim() : ""),
      payout_percentage: t.payout_percentage ?? 30,
    })) as Team[];
  } catch {
    return [];
  }
}

export function saveTeams(teams: Team[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TEAMS_KEY, JSON.stringify(teams));
  } catch {
    // ignore
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

export function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function getMasterTeamName(master: Master, teams: Team[]): string {
  if (!master.team_id) return "—";
  return teams.find((t) => t.id === master.team_id)?.name ?? "—";
}

// Cookie-name brigade labels ("Y&D", "D&K") are memorable to the
// dispatcher but opaque to anyone else. `getTeamDisplayName` composes
// "Юра + Даня · Пафос" from the lead + first helper + default city.
// Falls back to `team.name` when masters aren't available (shared
// read paths that don't pass the masters array).
/** Canonical list of lead ids for the team. Prefers the Sprint 033
 *  `lead_ids` array if set, falls back to the single legacy `lead_id`.
 *  Deduped, empty-string filtered. Always safe to call. */
export function getTeamLeadIds(team: Team): string[] {
  const fromArr = Array.isArray(team.lead_ids) ? team.lead_ids.filter(Boolean) : [];
  if (fromArr.length > 0) return Array.from(new Set(fromArr));
  return team.lead_id ? [team.lead_id] : [];
}

export function getTeamDisplayName(team: Team, masters: Master[]): string {
  // Sprint 033 E2 (user report): if the user has named the brigade
  // explicitly (поле «Название»), respect that name — don't silently
  // overwrite it with an auto-composed "Юра + Даня · Пафос". The
  // earlier behaviour hid the user's chosen "Y&D" behind a generated
  // label that drifted every time a lead was reassigned.
  //
  // Order:
  //   1. team.name if the user set one
  //   2. composed from lead + helper (legacy auto-label)
  //   3. fallback to the raw record name
  const trimmedName = team.name?.trim();
  if (trimmedName) return trimmedName;

  const firstName = (full: string) => full.trim().split(/\s+/)[0].replace(/[()]/g, "");
  const leadIds = getTeamLeadIds(team);
  const leads = leadIds
    .map((id) => masters.find((m) => m.id === id))
    .filter((m): m is Master => Boolean(m));
  const helpers = team.helper_ids
    .map((id) => masters.find((m) => m.id === id))
    .filter((m): m is Master => Boolean(m));
  const picked: Master[] = [];
  if (leads[0]) picked.push(leads[0]);
  if (helpers[0]) picked.push(helpers[0]);
  else if (leads[1]) picked.push(leads[1]);
  const people = picked.map((m) => firstName(m.full_name));
  const city = team.default_city?.trim() || team.region?.split(/[,/]/)[0].trim() || "";
  if (people.length === 0) return team.name;
  const joined = people.join(" и ");
  return city ? `${joined} · ${city}` : joined;
}

export function getTeamMembers(team: Team, masters: Master[]): {
  lead: Master | null;
  leads: Master[];
  helpers: Master[];
} {
  const leadIds = getTeamLeadIds(team);
  const leads = leadIds
    .map((id) => masters.find((m) => m.id === id))
    .filter((m): m is Master => Boolean(m));
  const helpers = team.helper_ids
    .map((id) => masters.find((m) => m.id === id))
    .filter((m): m is Master => Boolean(m));
  return { lead: leads[0] ?? null, leads, helpers };
}

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Audit log helper ──────────────────────────────────────────────

const AUDIT_CAP = 100;

/** Returns a copy of `master` with one new audit entry appended and
 *  the trailing log trimmed to the cap. Use before calling
 *  `upsertMaster` when the change is significant enough to log
 *  (role / salary / credentials / archive / leave). */
export function appendAudit(
  master: Master,
  ev: Omit<AuditEvent, "id" | "timestamp">,
): Master {
  const entry: AuditEvent = {
    ...ev,
    id: generateId("aud"),
    timestamp: new Date().toISOString(),
  };
  const next = [...(master.audit ?? []), entry];
  const capped = next.length > AUDIT_CAP ? next.slice(-AUDIT_CAP) : next;
  return { ...master, audit: capped };
}

/** Appends a fake login event. Used in dev to exercise the UI before
 *  Supabase Auth is wired. In production the login hook will do this. */
export function appendLoginEvent(master: Master, ev: LoginEvent): Master {
  const next = [...(master.login_history ?? []), ev];
  const capped = next.length > AUDIT_CAP ? next.slice(-AUDIT_CAP) : next;
  return { ...master, login_history: capped, last_login_at: ev.timestamp };
}
