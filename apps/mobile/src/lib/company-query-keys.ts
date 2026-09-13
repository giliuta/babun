import type { UserRole } from "@/features/settings/role-policy";

// КЛЮЧИ ЗАПРОСОВ КОМПАНИИ — ОДНО ТЕЛО НА ПРОДУКТ.
//
// Прогрев чужой компании кладёт данные в react-query ПОД ТЕМИ ЖЕ КЛЮЧАМИ, под
// которыми их потом спросит экран. Разойдись ключ хоть на элемент — порядок,
// `role-pending`, суффикс `"all"` — прогрев будет греть то, что никто не
// спросит, а экран снова пойдёт в сеть; и заметить это глазами нельзя, кэш
// молча становится холодным. Поэтому ключи живут здесь, хуки их только зовут,
// а тест сверяет форму каждого со строкой.
//
// Лист без зависимостей (тип роли стирается при компиляции): под раннером
// поднимается, значит проверяем поведение, а не текст.

type Role = UserRole | null | undefined;
const rolePart = (role: Role): string => role ?? "role-pending";

export const currentRoleQueryKey = (tenantId: string | null) =>
  ["current-role", tenantId] as const;

export const appointmentsQueryKey = (tenantId: string | null, role: Role) =>
  ["appointments", tenantId, rolePart(role)] as const;

export const clientsQueryKey = (tenantId: string | null, role: Role) =>
  ["clients", tenantId, rolePart(role)] as const;

export const clientTagsQueryKey = (tenantId: string | null, role: Role) =>
  ["client-tags", tenantId, rolePart(role)] as const;

export const teamsQueryKey = (
  tenantId: string | null,
  role: Role,
  includeInactive: boolean,
) =>
  includeInactive
    ? (["teams", tenantId, rolePart(role), "all"] as const)
    : (["teams", tenantId, rolePart(role)] as const);

export const citiesQueryKey = (
  tenantId: string | null,
  includeInactive: boolean,
  teamId: string | null,
) => ["cities", tenantId, includeInactive ? "all" : "live", teamId] as const;

export const servicesQueryKey = (tenantId: string | null, role: Role) =>
  ["services", tenantId, rolePart(role)] as const;

export const allServicesQueryKey = (tenantId: string | null, role: Role) =>
  ["services", "with-archived", tenantId, rolePart(role)] as const;

export const calendarSettingsQueryKey = (tenantId: string | null, role: Role) =>
  ["calendar-settings", tenantId, rolePart(role)] as const;

export const dayCitiesQueryKey = (tenantId: string | null, role: Role) =>
  ["day-cities", tenantId, rolePart(role)] as const;

export const dayExtrasQueryKey = (tenantId: string | null, role: Role) =>
  ["day-extras", tenantId, rolePart(role)] as const;

export const teamScheduleQueryKey = (
  tenantId: string | null,
  role: Role,
  teamId: string | undefined,
) => ["team-schedules", tenantId, rolePart(role), teamId] as const;

export const allTeamSchedulesQueryKey = (tenantId: string | null, role: Role) =>
  ["team-schedules", tenantId, rolePart(role), "all"] as const;

export const tenantQueryKey = (tenantId: string | null, role: Role) =>
  ["tenant", tenantId, rolePart(role)] as const;
