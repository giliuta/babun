// Masters & Teams data layer.
//
// Форма людей и бригад плюс правила прав. Хранит их Supabase
// (tenant_state через features/reference), здесь хранилища нет.

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

// ─── Seed data ─────────────────────────────────────────────────────────
// STORY-053a — здесь лежала настоящая команда AirFix (Артём, Дима, Юра…)
// и доставалась каждому новому тенанту при регистрации. Сид снесён и
// заводить его заново нельзя: Babun продаётся многим компаниям
// (.claude/agents/security-auditor.md, ADR-001 §5).

// ─── Helpers ───────────────────────────────────────────────────────────

export function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Canonical list of lead ids for the team. Prefers the Sprint 033
 *  `lead_ids` array if set, falls back to the single legacy `lead_id`.
 *  Deduped, empty-string filtered. Always safe to call. */
export function getTeamLeadIds(team: Team): string[] {
  const fromArr = Array.isArray(team.lead_ids) ? team.lead_ids.filter(Boolean) : [];
  if (fromArr.length > 0) return Array.from(new Set(fromArr));
  return team.lead_id ? [team.lead_id] : [];
}

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
