// Role-based permission defaults, labels and the editor's groups.

import type { MasterPermissions, MasterRole } from "./types";

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
