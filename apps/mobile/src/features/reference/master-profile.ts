// Selectors + writer over the `masters.profile` jsonb catch-all.
//
// The Supabase `masters` row keeps the hot, indexable fields as flat columns
// (full_name, phone, role, title, color, account_status, team_id, is_active).
// Everything else from the rich shared `Master` shape — permissions, extra
// contacts, banking, documents, HR log, work schedule, login/account meta —
// lives inside the `profile` jsonb blob. These helpers narrow that Json back
// to typed shapes and patch a subset without clobbering keys the mobile UI
// doesn't yet touch (web parity — the web editor writes the whole profile,
// mobile edits it field-by-field).

import {
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  defaultPermissionsForRole,
  mergePermissions,
  type Master as SharedMaster,
  type MasterPermissions,
  type MasterRole,
} from "@babun/shared/local/masters";
import type { Json } from "@babun/shared/db/database.types";
import { supabase } from "@/lib/supabase";
import type { Master } from "./queries";

// The rich fields that ride inside `profile`. Everything the shared Master
// carries beyond the flat `masters` columns. All optional — a legacy/blank
// profile ({} or null) is a valid MasterProfile.
export type MasterProfile = Partial<
  Omit<
    SharedMaster,
    | "id"
    | "full_name"
    | "phone"
    | "avatar_url"
    | "team_id"
    | "role"
    | "is_active"
    | "created_at"
    | "title"
  >
>;

/** Narrow `masters.profile` (Json) → MasterProfile. Safe on null / {} / [] /
 *  primitives — anything that isn't a plain object yields {}. */
export function getMasterProfile(m: Master): MasterProfile {
  const p = m.profile;
  if (p && typeof p === "object" && !Array.isArray(p)) {
    return p as MasterProfile;
  }
  return {};
}

/** The master's system role, narrowed from the flat text column. Falls back
 *  to "helper" (the least-privileged baseline) on an unknown/empty value. */
export function getMasterRole(m: Master): MasterRole {
  const r = m.role;
  if (r === "admin" || r === "dispatcher" || r === "lead" || r === "helper") {
    return r;
  }
  return "helper";
}

/** Resolved permissions. RISK-4: a legacy master whose profile has no
 *  `permissions` (or a partial set) must NOT read as "everything off" —
 *  mergePermissions layers the stored flags over the role baseline so
 *  missing keys inherit the role default. */
export function getMasterPermissions(m: Master): MasterPermissions {
  const role = getMasterRole(m);
  const stored = getMasterProfile(m).permissions;
  if (!stored) return defaultPermissionsForRole(role);
  return mergePermissions(role, stored);
}

export interface MasterContacts {
  phone: string;
  whatsapp?: string;
  telegram?: string;
  email?: string;
  address?: string;
}

/** Contact bundle for the info hub. `phone` comes off the flat column; the
 *  rest live in the profile. */
export function getMasterContacts(m: Master): MasterContacts {
  const p = getMasterProfile(m);
  return {
    phone: m.phone ?? "",
    whatsapp: p.whatsapp,
    telegram: p.telegram,
    email: p.email,
    address: p.address,
  };
}

// ─── Profile patch writer ────────────────────────────────────────────
// RISK-3 (races) + no-clobber: the generic useUpdateMaster overwrites whole
// columns, which for `profile` would drop keys the caller didn't include.
// patch_master_profile performs `profile || patch` in one PostgreSQL UPDATE,
// so parallel blur/switch saves cannot overwrite one another's keys.
// Pass a shallow patch — top-level keys replace atomically.

export function useUpdateMasterProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: MasterProfile;
    }) => {
      const { error } = await supabase.rpc("patch_master_profile", {
        p_master_id: id,
        p_patch: patch as unknown as Json,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["masters"] }),
    meta: { errorHandled: true },
  });
}
