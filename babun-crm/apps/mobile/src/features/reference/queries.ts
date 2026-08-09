import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Database, Json } from "@babun/shared/db/database.types";
import {
  generateId,
  isLeadRole,
  LEGACY_LEAD_ROLE_ID,
  type BrigadeMember,
  type BrigadeRole,
  type MasterRole,
} from "@babun/shared/local/masters";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useCurrentRole } from "@/features/settings/tenant";
import {
  operationalMasterJsonToMaster,
  operationalTeamJsonToTeam,
} from "@/features/settings/master-reference";

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
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  const includeInactive = !!opts?.includeInactive;
  return useQuery({
    queryKey: includeInactive
      ? ["teams", tenantId, role ?? "role-pending", "all"]
      : ["teams", tenantId, role ?? "role-pending"],
    enabled: !!tenantId && roleQuery.isSuccess && role != null,
    queryFn: async () => {
      if (role === "dispatcher" || role === "master") {
        const { data, error } = await supabase.rpc(
          "list_operational_teams_safe",
        );
        if (error) throw new Error(error.message);
        const rows = (data ?? []).map(operationalTeamJsonToTeam);
        return includeInactive ? rows : rows.filter((row) => row.is_active);
      }
      if (role !== "owner") throw new Error("Нет доступа к календарям");
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
  const roleQuery = useCurrentRole();
  return useQuery({
    queryKey: ["teams", tenantId, roleQuery.data ?? "role-pending", "one", id],
    enabled: !!tenantId && !!id && roleQuery.isSuccess && roleQuery.data === "owner",
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
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      region?: string;
      color?: string;
    }) => {
      if (role !== "owner") {
        throw new Error("Создавать календари может только владелец.");
      }
      const { data, error } = await supabase
        .from("teams")
        .insert({
          id: generateId("team"),
          tenant_id: tenantId as string,
          name: input.name,
          region: input.region || null,
          color: input.color || null,
          // Календарные колонки НЕ засеваются: null = «как везде». Раньше
          // здесь прописывались окно 00:00–23:00, скролл 10:00 и строка
          // расписания 10:00–20:00 — а поскольку читатели резолвят как
          // `команда ?? общее` ((dashboard)/index.tsx), команды без override
          // просто не существовало, и ВСЕ общие часы были мертвы у каждого
          // тенанта. Выходных посев тоже не нёс: он писал только start/end,
          // без overrides, так что все семь дней и там были рабочими.
          payout_percentage: 30,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teams"] });
    },
    meta: { errorHandled: true }, // RefListScreen call sites alert themselves
  });
}

// ─── Masters ─────────────────────────────────────────────────────────
// `includeInactive` — список мастеров показывает архив (иначе «Вернуть из
// архива» в хабе недостижим); пикеры зовут без опции (паттерн useTeams).
export function useMasters(opts?: { includeInactive?: boolean }) {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  const includeInactive = !!opts?.includeInactive;
  return useQuery({
    queryKey: includeInactive
      ? ["masters", tenantId, role ?? "role-pending", "all"]
      : ["masters", tenantId, role ?? "role-pending"],
    enabled: !!tenantId && roleQuery.isSuccess && role != null,
    queryFn: async () => {
      if (role === "dispatcher" || role === "master") {
        const { data, error } = await supabase.rpc(
          "list_operational_masters_safe",
        );
        if (error) throw new Error(error.message);
        const rows = (data ?? []).map(operationalMasterJsonToMaster);
        return includeInactive ? rows : rows.filter((row) => row.is_active);
      }
      if (role !== "owner") throw new Error("Нет доступа к сотрудникам");
      let q = supabase
        .from("masters")
        .select("*")
        .eq("tenant_id", tenantId as string);
      if (!includeInactive) q = q.eq("is_active", true);
      const { data, error } = await q.order("position");
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

// Single-master read for the master hub. See useTeam for the by-id rationale.
export function useMaster(id: string | undefined) {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  return useQuery({
    queryKey: ["masters", tenantId, roleQuery.data ?? "role-pending", "one", id],
    enabled: !!tenantId && !!id && roleQuery.isSuccess && roleQuery.data === "owner",
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
  const role = useCurrentRole().data;
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
      if (role !== "owner") {
        throw new Error("Добавлять сотрудников может только владелец.");
      }
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
// `includeInactive` — экран «Города» показывает и выключенные (тумблер
// активности + реактивация); пикеры/метки зовут без опции и видят
// только активные (паттерн useTeams).
export function useCities(opts?: { includeInactive?: boolean }) {
  const tenantId = useTenantId();
  const includeInactive = !!opts?.includeInactive;
  return useQuery({
    queryKey: includeInactive
      ? ["cities", tenantId, "all"]
      : ["cities", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = supabase
        .from("cities")
        .select("*")
        .eq("tenant_id", tenantId as string);
      if (!includeInactive) q = q.eq("is_active", true);
      const { data, error } = await q.order("position");
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useCreateCity() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation({
    // `color` — v492 labels: custom tags («Германия», «День ног») get a
    // per-city accent colour that tints the calendar day chip (web parity).
    mutationFn: async (input: { name: string; country?: string; color?: string }) => {
      if (role !== "owner" && role !== "dispatcher") {
        throw new Error("Добавлять города может владелец или диспетчер.");
      }
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
type RefUpdate<Table extends RefTable> = Tables[Table]["Update"];

function assertCanWriteReference(
  table: RefTable,
  role: ReturnType<typeof useCurrentRole>["data"],
): void {
  if (table === "cities") {
    if (role === "owner" || role === "dispatcher") return;
    throw new Error("Изменять города может владелец или диспетчер.");
  }
  if (role !== "owner") {
    throw new Error("Изменять этот справочник может только владелец.");
  }
}

async function updateRefRow<Table extends RefTable>(args: {
  table: Table;
  tenantId: string;
  id: string;
  patch: RefUpdate<Table>;
}): Promise<void> {
  const confirm = (
    data: { id: string } | null,
    error: { message: string } | null,
  ) => {
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Запись не найдена или недоступна.");
  };
  // supabase-js cannot preserve a correlated generic table/update type
  // through `from(table)`, so keep the public hook generic and narrow the
  // four concrete builders here instead of escaping through `any`.
  switch (args.table) {
    case "teams": {
      const { data, error } = await supabase
        .from("teams")
        .update(args.patch as Tables["teams"]["Update"])
        .eq("tenant_id", args.tenantId)
        .eq("id", args.id)
        .select("id")
        .maybeSingle();
      confirm(data, error);
      return;
    }
    case "masters": {
      const { data, error } = await supabase
        .from("masters")
        .update(args.patch as Tables["masters"]["Update"])
        .eq("tenant_id", args.tenantId)
        .eq("id", args.id)
        .select("id")
        .maybeSingle();
      confirm(data, error);
      return;
    }
    case "cities": {
      const { data, error } = await supabase
        .from("cities")
        .update(args.patch as Tables["cities"]["Update"])
        .eq("tenant_id", args.tenantId)
        .eq("id", args.id)
        .select("id")
        .maybeSingle();
      confirm(data, error);
      return;
    }
    case "services": {
      const { data, error } = await supabase
        .from("services")
        .update(args.patch as Tables["services"]["Update"])
        .eq("tenant_id", args.tenantId)
        .eq("id", args.id)
        .select("id")
        .maybeSingle();
      confirm(data, error);
    }
  }
}

function useRefUpdate<Table extends RefTable>(table: Table) {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: RefUpdate<Table>;
    }) => {
      if (!tenantId) throw new Error("Нет активного аккаунта.");
      assertCanWriteReference(table, role);
      await updateRefRow({ table, tenantId, id, patch });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [table] }),
    meta: { errorHandled: true }, // RefListScreen call sites alert themselves
  });
}

function useRefDelete(table: RefTable) {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!tenantId) throw new Error("Нет активного аккаунта.");
      assertCanWriteReference(table, role);
      await updateRefRow({
        table,
        tenantId,
        id,
        patch: { is_active: false } as RefUpdate<typeof table>,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [table] }),
    meta: { errorHandled: true }, // RefListScreen call sites alert themselves
  });
}

export const useUpdateTeam = () => useRefUpdate("teams");
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
// The editor still submits the complete roles/members snapshot because the
// legacy lead/helper arrays must be derived in the same write. `updated_at`
// is therefore an optimistic concurrency token: two devices (or two rapid
// taps) cannot silently overwrite each other; the stale write returns zero
// rows and the UI asks the user to refresh and retry.

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

export function useUpdateTeamMembers() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
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
          roles: roles as unknown as Json,
          members: members as unknown as Json,
          lead_ids: lead_ids as unknown as Json,
          helper_ids: helper_ids as unknown as Json,
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
  const role = useCurrentRole().data;
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
            roles: roles as unknown as Json,
            members: nextMembers as unknown as Json,
            lead_ids: lead_ids as unknown as Json,
            helper_ids: helper_ids as unknown as Json,
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
            `Команда «${team.name}» уже изменилась. Повторите удаление сотрудника.`,
          );
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
