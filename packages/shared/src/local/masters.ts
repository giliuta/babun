// Masters & Teams data layer.
//
// Форма людей и бригад плюс правила прав. Хранит их Supabase
// (tenant_state через features/reference), здесь хранилища нет.

import type { AccountStatus, Team } from "./masters/types";

export type {
  AccountStatus,
  BrigadeMember,
  BrigadeRole,
  Master,
  MasterExtraContacts,
  MasterPermissions,
  MasterPhoneEntry,
  MasterRole,
  Team,
} from "./masters/types";
export {
  defaultPermissionsForRole,
  mergePermissions,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  ROLE_LABELS,
  type PermissionGroupKey,
} from "./masters/permissions";

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  invited: "Приглашён",
  active: "Активен",
  paused: "На паузе",
  terminated: "Уволен",
};

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
