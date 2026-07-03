// Master-access preset matrix + group expand-state helpers.
//
// Extracted from apps/web/.../masters/[id]/access/presets.ts into shared so
// the mobile access hub can reuse the exact same preset definitions and the
// detectPreset / permissionsEqual round-trip (web parity). The web file now
// re-exports from here; nothing about the presets should live in two places.
//
// The group-open persistence helpers guard `typeof window` and degrade to
// defaults on React Native (no localStorage), so they are safe to import from
// either platform even though only the web UI actually persists the state.

import {
  PERMISSION_GROUPS,
  defaultPermissionsForRole,
  type MasterPermissions,
  type PermissionGroupKey,
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

/** localStorage key for the per-user expanded-state of permission groups. */
export const GROUPS_OPEN_KEY = "babun2:settings:perm-groups-open";

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

// ─── Group expand-state persistence ───────────────────────────────────

export type GroupsOpenState = Record<PermissionGroupKey, boolean>;

export function defaultGroupsOpen(): GroupsOpenState {
  const out = {} as GroupsOpenState;
  PERMISSION_GROUPS.forEach((g, i) => {
    out[g.key] = i === 0;
  });
  return out;
}

export function loadGroupsOpen(): GroupsOpenState {
  if (typeof window === "undefined") return defaultGroupsOpen();
  try {
    const raw = window.localStorage.getItem(GROUPS_OPEN_KEY);
    if (!raw) return defaultGroupsOpen();
    const parsed = JSON.parse(raw) as Partial<Record<PermissionGroupKey, boolean>>;
    const fallback = defaultGroupsOpen();
    const merged = { ...fallback };
    for (const g of PERMISSION_GROUPS) {
      if (typeof parsed[g.key] === "boolean") merged[g.key] = parsed[g.key]!;
    }
    return merged;
  } catch {
    return defaultGroupsOpen();
  }
}

export function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е");
}
