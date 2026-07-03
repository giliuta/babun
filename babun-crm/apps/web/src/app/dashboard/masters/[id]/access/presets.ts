// Preset matrix + group expand-state helpers for the master access page.
//
// The logic moved to @babun/shared/local/master-presets so the mobile access
// hub reuses the exact same preset definitions and detectPreset/permissionsEqual
// round-trip (web parity). This file is now a thin re-export so existing web
// imports (`./presets`) keep working unchanged.

export {
  ALL_PERMISSION_FLAGS,
  GROUPS_OPEN_KEY,
  PRESETS,
  defaultGroupsOpen,
  detectPreset,
  loadGroupsOpen,
  normalizeLabel,
  permissionsEqual,
} from "@babun/shared/local/master-presets";

export type {
  GroupsOpenState,
  PermissionFlag,
  PresetDef,
  PresetId,
} from "@babun/shared/local/master-presets";
