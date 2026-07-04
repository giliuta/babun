import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Database } from "@babun/shared/db/database.types";
import {
  generateId,
  isLeadRole,
  LEGACY_LEAD_ROLE_ID,
  type BrigadeMember,
  type BrigadeRole,
  type MasterRole,
} from "@babun/shared/local/masters";
import { upsertScheduleEntry } from "@babun/shared/db/repositories/schedule";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

type Tables = Database["public"]["Tables"];
export type Team = Tables["teams"]["Row"];
export type Master = Tables["masters"]["Row"];
export type City = Tables["cities"]["Row"];

// ─── jsonb → typed casts (safe on []/null/{}) ────────────────────────
// teams.roles / teams.members / teams.cities round-trip through Postgres
// jsonb, so Supabase types them as `Json`. These narrow them back to the
// shared domain shapes without ever throwing on empty/null/garbage — a
// legacy team with `'[]'::jsonb` (or a NULL that slipped through) yields
// an empty array, never a crash (RISK-1).

export function teamRoles(t: Team): BrigadeRole[] {
  return Array.isArray(t.roles) ? (t.roles as unknown as BrigadeRole[]) : [];
}

export function teamMembers(t: Team): BrigadeMember[] {
  return Array.isArray(t.members)
    ? (t.members as unknown as BrigadeMember[])
    : [];
}

export function teamCities(t: Team): string[] {
  return Array.isArray(t.cities)
    ? (t.cities as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
}

// ─── Teams ───────────────────────────────────────────────────────────
// `includeInactive` — для резолва имён по историческим ссылкам
// (accounts.brigade_id может указывать на soft-deleted команду; список
// счетов обязан показать её имя, а не прочерк). Пикеры/фильтры зовут
// без опции и видят только активные.
export function useTeams(opts?: { includeInactive?: boolean }) {
  const tenantId = useTenantId();
  const includeInactive = !!opts?.includeInactive;
  return useQuery({
    queryKey: includeInactive
      ? ["teams", tenantId, "all"]
      : ["teams", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = supabase
        .from("teams")
        .select("*")
        .eq("tenant_id", tenantId as string);
      if (!includeInactive) q = q.eq("is_active", true);
      const { data, error } = await q.order("position");
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

// Single-team read for the brigade hub. Dedicated by-id fetch (not a select
// off the list cache) so it resolves even for a soft-deleted team the active
// list filters out, and so the hub always sees the freshest jsonb after an
// edit. Keyed by id → its own cache entry, invalidated by the ["teams"] wipe.
export function useTeam(id: string | undefined) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["teams", tenantId, "one", id],
    enabled: !!tenantId && !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .eq("id", id as string)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useCreateTeam() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      region?: string;
      color?: string;
    }) => {
      const { data, error } = await supabase
        .from("teams")
        .insert({
          id: generateId("team"),
          tenant_id: tenantId as string,
          name: input.name,
          region: input.region || null,
          color: input.color || null,
          // web parity (teams/page.tsx openNew): creation defaults so a
          // fresh team behaves the same on both platforms — visible window
          // 00:00–23:00, auto-scroll to 10:00, payout 30%.
          calendar_window_start: "00:00",
          calendar_window_end: "23:00",
          default_scroll_time: "10:00",
          payout_percentage: 30,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      // web parity: openNew also seeds working hours 10:00–20:00. Best
      // effort — the team is already created, and a failed seed just leaves
      // the DEFAULT_SCHEDULE fallback (08:00–22:00) until the hub edits it.
      try {
        await upsertScheduleEntry(supabase, tenantId as string, data.id, {
          start: "10:00",
          end: "20:00",
          breaks: [],
        });
      } catch {
        // DEFAULT_SCHEDULE fallback covers a failed seed.
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["team-schedules"] });
    },
    meta: { errorHandled: true }, // RefListScreen call sites alert themselves
  });
}

// ─── Masters ─────────────────────────────────────────────────────────
export function useMasters() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["masters", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("masters")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .eq("is_active", true)
        .order("position");
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

// Single-master read for the master hub. See useTeam for the by-id rationale.
export function useMaster(id: string | undefined) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["masters", tenantId, "one", id],
    enabled: !!tenantId && !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("masters")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .eq("id", id as string)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useCreateMaster() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      full_name: string;
      phone?: string;
      // v-hubs: the create sheet can seed the display fields the hub reads
      // directly off the row (not the profile jsonb). All optional so the
      // RefListScreen quick-add call (name only) keeps working.
      role?: MasterRole;
      title?: string;
      color?: string;
      team_id?: string | null;
      account_status?: string;
    }) => {
      const { data, error } = await supabase
        .from("masters")
        .insert({
          id: generateId("master"),
          tenant_id: tenantId as string,
          full_name: input.full_name,
          phone: input.phone || null,
          role: input.role ?? undefined,
          title: input.title || null,
          color: input.color || null,
          team_id: input.team_id ?? null,
          account_status: input.account_status ?? undefined,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["masters"] }),
    meta: { errorHandled: true }, // RefListScreen call sites alert themselves
  });
}

// ─── Cities ──────────────────────────────────────────────────────────
export function useCities() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["cities", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cities")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .eq("is_active", true)
        .order("position");
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useCreateCity() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    // `color` — v492 labels: custom tags («Германия», «День ног») get a
    // per-city accent colour that tints the calendar day chip (web parity).
    mutationFn: async (input: { name: string; country?: string; color?: string }) => {
      const { data, error } = await supabase
        .from("cities")
        .insert({
          id: generateId("city"),
          tenant_id: tenantId as string,
          name: input.name,
          country: input.country || "",
          color: input.color || null,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cities"] }),
    meta: { errorHandled: true }, // RefListScreen call sites alert themselves
  });
}

// ─── Update / delete (generic) ───────────────────────────────────────
// Delete is a soft-delete (is_active=false): keeps FK integrity for
// appointments that reference team_id / master_id, and the list filter
// (is_active=true) hides them.
type RefTable = "teams" | "masters" | "cities" | "services";

function useRefUpdate(table: RefTable) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Record<string, unknown>;
    }) => {
      const { error } = await (supabase.from(table) as any)
        .update(patch)
        .eq("tenant_id", tenantId as string)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [table] }),
    meta: { errorHandled: true }, // RefListScreen call sites alert themselves
  });
}

function useRefDelete(table: RefTable) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from(table) as any)
        .update({ is_active: false })
        .eq("tenant_id", tenantId as string)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [table] }),
    meta: { errorHandled: true }, // RefListScreen call sites alert themselves
  });
}

export const useUpdateTeam = () => useRefUpdate("teams");
export const useDeleteTeam = () => useRefDelete("teams");
export const useUpdateMaster = () => useRefUpdate("masters");
export const useDeleteMaster = () => useRefDelete("masters");
export const useUpdateCity = () => useRefUpdate("cities");
export const useDeleteCity = () => useRefDelete("cities");
export const useUpdateService = () => useRefUpdate("services");
export const useDeleteService = () => useRefDelete("services");

// ─── Brigade membership write (roles/members ↔ lead_ids/helper_ids) ───
// RISK-2 parity: the web finances / schedule readers still consume the
// legacy lead_ids / helper_ids arrays, so any write to `members` MUST
// re-derive and persist those alongside `roles`/`members` in one update —
// otherwise the two sources of truth drift. A member counts as a lead when
// their role_id maps to a role whose name is «бригадир» (isLeadRole);
// everyone else (including role-less members) is a helper. lead_id keeps
// the first lead for the oldest legacy readers.
//
// RISK-3: this overwrites the whole roles/members snapshot taken at render,
// with no read-before-write or optimistic layer (unlike useUpdateMasterProfile).
// Two actions fired before the invalidate+refetch settle build off the same
// stale snapshot and the second wins (lost update). Matches web (parity, not a
// regression) and every action is gated behind a modal, so the window is small.
// For slice 3 (per-member permission matrix, higher write frequency) close it
// with a read-before-write of fresh roles/members or an optimistic useTeam cache.

/** Split members into lead/helper id arrays using the role taxonomy. */
export function deriveLeadHelperIds(
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

// ─── Team deletion side-effects (web parity, handleDelete) ───────────
// The web soft-delete also detaches every master and appointment that
// points at the team (team_id → null) so nothing keeps a dangling ref to
// a hidden brigade (masters would silently rejoin if the «активна» toggle
// is flipped back; appointments/finances keep reading the archived team).
// We reset at the source (WHERE team_id = <id>), which also covers archived
// masters the active-only `useMasters` list never loads. Bulk-keyed, one
// round-trip per table; the delete flow is already an online direct write.
export function useDetachTeamReferences() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (teamId: string) => {
      const { error: mErr } = await (supabase.from("masters") as any)
        .update({ team_id: null })
        .eq("tenant_id", tenantId as string)
        .eq("team_id", teamId);
      if (mErr) throw new Error(mErr.message);
      const { error: aErr } = await (supabase.from("appointments") as any)
        .update({ team_id: null })
        .eq("tenant_id", tenantId as string)
        .eq("team_id", teamId);
      if (aErr) throw new Error(aErr.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["masters"] });
      qc.invalidateQueries({ queryKey: ["appointments"] });
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useUpdateTeamMembers() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      teamId,
      roles,
      members,
    }: {
      teamId: string;
      roles: BrigadeRole[];
      members: BrigadeMember[];
    }) => {
      const { lead_ids, helper_ids, lead_id } = deriveLeadHelperIds(
        roles,
        members,
      );
      const { error } = await (supabase.from("teams") as any)
        .update({
          roles,
          members,
          lead_ids,
          helper_ids,
          lead_id,
        })
        .eq("tenant_id", tenantId as string)
        .eq("id", teamId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams"] }),
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      masterId,
      teams,
    }: {
      masterId: string;
      teams: Team[];
    }) => {
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
        const { error } = await (supabase.from("teams") as any)
          .update({
            roles,
            members: nextMembers,
            lead_ids,
            helper_ids,
            lead_id,
          })
          .eq("tenant_id", tenantId as string)
          .eq("id", team.id);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
