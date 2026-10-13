// Sprint 033 Phase I47 — Per-brigade per-master permission matrix.
//
// Each BrigadeMember carries its own copy of this structure so the
// same master can have different reach in different brigades (SaaS
// use case: «Дима — диспетчер в Y&D, но у D&K только читает»). The
// flags here narrow-scope: they apply ONLY inside a brigade's
// calendar / records. They do NOT replace master.role — the role
// still owns global-level perms (see /masters/[id]/access).

import type { BrigadeMemberPermissions } from "./brigade-permissions/types";
import { DEFAULT_BRIGADE_MEMBER_PERMISSIONS } from "./brigade-permissions/presets";

export type {
  BrigadeMemberPermissions,
  BrigadePermissionKey,
} from "./brigade-permissions/types";
export {
  DEFAULT_BRIGADE_MEMBER_PERMISSIONS,
  READ_ONLY_BRIGADE_MEMBER_PERMISSIONS,
} from "./brigade-permissions/presets";
export {
  BRIGADE_PERMISSION_GROUPS,
  type FlagGroup,
  type FlagRow,
} from "./brigade-permissions/groups";

// ─── Helpers ───────────────────────────────────────────────────────

/** Returns the resolved permissions for a member. Undefined on the
 *  record means «not yet configured» → full access (backward compat). */
export function resolveMemberPermissions(
  p: BrigadeMemberPermissions | undefined,
): BrigadeMemberPermissions {
  if (!p) return DEFAULT_BRIGADE_MEMBER_PERMISSIONS;
  // Fill in any keys missing from saved data (future field additions).
  return { ...DEFAULT_BRIGADE_MEMBER_PERMISSIONS, ...p };
}

/** Counts how many flags are enabled in a matrix — used for preview
 *  labels like «42 из 50 разрешено». */
export function countEnabled(p: BrigadeMemberPermissions): {
  on: number;
  total: number;
} {
  const values = Object.values(p);
  const on = values.filter(Boolean).length;
  return { on, total: values.length };
}
