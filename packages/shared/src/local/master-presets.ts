// Master-access preset matrix.
//
// Один набор пресетов и один round-trip detectPreset / permissionsEqual на
// весь продукт: пока матрица жила в двух местах, экран доступа и проверка
// прав расходились в правах «менеджера».

import {
  PERMISSION_GROUPS,
  defaultPermissionsForRole,
  type MasterPermissions,
} from "./masters";

export type PresetId = "manager" | "master" | "dispatcher" | "viewer" | "custom";

export interface PresetDef {
  id: Exclude<PresetId, "custom">;
  label: string;
  description: string;
  build: () => MasterPermissions;
}

/** Permission keys excluding visible_team_ids (handled separately). */
export type PermissionFlag = Exclude<keyof MasterPermissions, "visible_team_ids">;

export const ALL_PERMISSION_FLAGS: PermissionFlag[] = PERMISSION_GROUPS.flatMap(
  (g) => g.permissions,
) as PermissionFlag[];

// ─── Preset matrix ────────────────────────────────────────────────────
// Built off the role baselines so they stay in sync if the defaults
// ever evolve. "viewer" is a hand-rolled all-see / nothing-can shape.

function buildManagerPreset(): MasterPermissions {
  const base = defaultPermissionsForRole("admin");
  return { ...base, can_manage_settings: false };
}

function buildMasterPreset(): MasterPermissions {
  // Helper baseline already implies "видит только свой календарь,
  // отмечает выполненные, ничего больше".
  return defaultPermissionsForRole("helper");
}

function buildDispatcherPreset(): MasterPermissions {
  return defaultPermissionsForRole("dispatcher");
}

function buildViewerPreset(): MasterPermissions {
  const base = defaultPermissionsForRole("helper");
  // Flip every `see_*` flag on, every `can_*` flag off, full visibility.
  const next: MasterPermissions = { ...base, visible_team_ids: ["*"] };
  for (const key of ALL_PERMISSION_FLAGS) {
    if (key.startsWith("see_")) {
      (next as Record<PermissionFlag, boolean>)[key] = true;
    } else if (key.startsWith("can_")) {
      (next as Record<PermissionFlag, boolean>)[key] = false;
    }
  }
  return next;
}

export const PRESETS: PresetDef[] = [
  {
    id: "manager",
    label: "Менеджер",
    description: "Все права кроме настроек компании.",
    build: buildManagerPreset,
  },
  {
    id: "master",
    label: "Мастер",
    description: "Только свои записи, минимум прав.",
    build: buildMasterPreset,
  },
  {
    id: "dispatcher",
    label: "Диспетчер",
    description: "Записи, клиенты, чаты — без админки.",
    build: buildDispatcherPreset,
  },
  {
    id: "viewer",
    label: "Только просмотр",
    description: "Видит всё, ничего не меняет.",
    build: buildViewerPreset,
  },
];

export function permissionsEqual(
  a: MasterPermissions,
  b: MasterPermissions,
): boolean {
  for (const key of ALL_PERMISSION_FLAGS) {
    if (Boolean(a[key]) !== Boolean(b[key])) return false;
  }
  const av = (a.visible_team_ids ?? []).slice().sort();
  const bv = (b.visible_team_ids ?? []).slice().sort();
  if (av.length !== bv.length) return false;
  for (let i = 0; i < av.length; i += 1) {
    if (av[i] !== bv[i]) return false;
  }
  return true;
}

export function detectPreset(perms: MasterPermissions): PresetId {
  for (const p of PRESETS) {
    if (permissionsEqual(perms, p.build())) return p.id;
  }
  return "custom";
}

export function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е");
}
