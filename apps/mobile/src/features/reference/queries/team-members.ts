import {
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  isLeadRole,
  LEGACY_LEAD_ROLE_ID,
  type BrigadeMember,
  type BrigadeRole,
} from "@babun/shared/local/masters";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useDataRole } from "@/features/settings/tenant";
import { referenceKeys } from "../query-keys";
import { teamMembers, teamRoles, type Team } from "./types";
import { toJson } from "@babun/shared/db/json";

// ─── Brigade membership write (roles/members ↔ lead_ids/helper_ids) ───
// RISK-2 parity: the web finances / schedule readers still consume the
// legacy lead_ids / helper_ids arrays, so any write to `members` MUST
// re-derive and persist those alongside `roles`/`members` in one update —
// otherwise the two sources of truth drift. A member counts as a lead when
// their role_id maps to a role whose name is «бригадир» (isLeadRole);
// everyone else (including role-less members) is a helper. lead_id keeps
// the first lead for the oldest legacy readers.
//
// The editor still submits the complete roles/members snapshot because the
// legacy lead/helper arrays must be derived in the same write. `updated_at`
// is therefore an optimistic concurrency token: two devices (or two rapid
// taps) cannot silently overwrite each other; the stale write returns zero
// rows and the UI asks the user to refresh and retry.

/** Split members into lead/helper id arrays using the role taxonomy. */
function deriveLeadHelperIds(
  roles: BrigadeRole[],
  members: BrigadeMember[],
): { lead_ids: string[]; helper_ids: string[]; lead_id: string | null } {
  // LEGACY_LEAD_ROLE_ID counts as lead regardless of display name: the lazy
  // migration (teams/[id]/masters) names that role «Старший», which isLeadRole
  // («бригадир») would not match — without this guard the migration write
  // itself re-derives lead_ids=[] and silently demotes the lead (web parity:
  // the web migration preserves the legacy arrays).
  const leadRoleIds = new Set(
    roles
      .filter((r) => r.id === LEGACY_LEAD_ROLE_ID || isLeadRole(r))
      .map((r) => r.id),
  );
  const lead_ids: string[] = [];
  const helper_ids: string[] = [];
  for (const m of members) {
    if (m.role_id && leadRoleIds.has(m.role_id)) lead_ids.push(m.master_id);
    else helper_ids.push(m.master_id);
  }
  return { lead_ids, helper_ids, lead_id: lead_ids[0] ?? null };
}

export function useUpdateTeamMembers() {
  const tenantId = useTenantId();
  const role = useDataRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      teamId,
      expectedUpdatedAt,
      roles,
      members,
    }: {
      teamId: string;
      expectedUpdatedAt: string;
      roles: BrigadeRole[];
      members: BrigadeMember[];
    }) => {
      const { lead_ids, helper_ids, lead_id } = deriveLeadHelperIds(
        roles,
        members,
      );
      if (!tenantId) throw new Error("Нет активного аккаунта.");
      if (role !== "owner") {
        throw new Error("Изменять состав команды может только владелец.");
      }
      const { data, error } = await supabase
        .from("teams")
        .update({
          // Domain interfaces carry no index signature, so they are not Json.
          roles: toJson(roles),
          members: toJson(members),
          lead_ids,
          helper_ids,
          lead_id,
        })
        .eq("tenant_id", tenantId)
        .eq("id", teamId)
        .eq("updated_at", expectedUpdatedAt)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        throw new Error(
          "Состав команды уже изменился. Обновите экран и повторите действие.",
        );
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: referenceKeys.teamAll() }),
    meta: { errorHandled: true },
  });
}

// ─── Master deletion side-effects (web parity, handleDelete) ─────────
// After a master is soft-deleted the web sweeps every team and strips the
// master.id out of lead_id / helper_ids. On mobile the source of truth is
// the richer members/roles jsonb, so we drop the master from `members`
// (and, for legacy teams still array-only, from the legacy arrays) and
// re-persist through the same lead_ids/helper_ids re-derivation the editor
// uses (RISK-2). Without this a deleted master lingers in members/helper_ids
// and the web finances/schedule keep pointing at a ghost. Runs once over
// all tenant teams, in-loop per affected team (rare, gated behind delete).
export function useRemoveMasterFromTeams() {
  const tenantId = useTenantId();
  const role = useDataRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      masterId,
      teams,
    }: {
      masterId: string;
      teams: Team[];
    }) => {
      if (!tenantId) throw new Error("Нет активного аккаунта.");
      if (role !== "owner") {
        throw new Error("Изменять состав команды может только владелец.");
      }
      for (const team of teams) {
        const members = teamMembers(team);
        const roles = teamRoles(team);
        const legacyLead = Array.isArray(team.lead_ids)
          ? (team.lead_ids as unknown[]).filter(
              (x): x is string => typeof x === "string",
            )
          : [];
        const legacyHelper = Array.isArray(team.helper_ids)
          ? (team.helper_ids as unknown[]).filter(
              (x): x is string => typeof x === "string",
            )
          : [];

        const inMembers = members.some((m) => m.master_id === masterId);
        const inLegacy =
          legacyLead.includes(masterId) ||
          legacyHelper.includes(masterId) ||
          team.lead_id === masterId;
        if (!inMembers && !inLegacy) continue;

        // Base the surviving membership on `members` when present; for a
        // legacy array-only team, rebuild it from the arrays first so the
        // re-derivation clears the stale lead_ids/helper_ids too.
        const baseMembers: BrigadeMember[] =
          members.length > 0
            ? members
            : [
                ...legacyLead.map((mid) => ({
                  master_id: mid,
                  role_id: null as string | null,
                })),
                ...legacyHelper
                  .filter((mid) => !legacyLead.includes(mid))
                  .map((mid) => ({
                    master_id: mid,
                    role_id: null as string | null,
                  })),
              ];
        const nextMembers = baseMembers.filter(
          (m) => m.master_id !== masterId,
        );
        const { lead_ids, helper_ids, lead_id } = deriveLeadHelperIds(
          roles,
          nextMembers,
        );
        const { data, error } = await supabase
          .from("teams")
          .update({
            // Domain interfaces carry no index signature, so they are not Json.
            roles: toJson(roles),
            members: toJson(nextMembers),
            lead_ids,
            helper_ids,
            lead_id,
          })
          .eq("tenant_id", tenantId)
          .eq("id", team.id)
          .eq("updated_at", team.updated_at)
          .select("id")
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) {
          throw new Error(
            `Команда «${team.name}» уже изменилась. Повторите удаление партнёра.`,
          );
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: referenceKeys.teamAll() }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
