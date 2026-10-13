import type { UserRole } from "@/features/settings/role-policy";
import {
  citiesQueryKey,
  mastersQueryKey,
  teamsQueryKey,
} from "@/lib/company-query-keys";

// Query keys of the reference books (teams, masters, labels).
//
// Full list keys that tenant prefetch warms live in `lib/company-query-keys.ts`
// and are reused here, not redefined. This module adds the PREFIX keys writes
// invalidate by and the single-row keys of the hubs. Every shape is pinned
// literally in `query-keys.test.ts`.

/** Tables the generic reference update/delete writes; the key head is the
 *  table name, so one write refreshes every read of that table. */
export type RefTable = "teams" | "masters" | "cities" | "services";

type Role = UserRole | null | undefined;

export const referenceKeys = {
  /** Every teams read, list or single row. */
  teamAll: () => ["teams"] as const,
  teams: teamsQueryKey,
  /** One team for the brigade hub; lives under the teams prefix on purpose. */
  team: (tenantId: string | null, role: Role, id: string | undefined) =>
    ["teams", tenantId, role ?? "role-pending", "one", id] as const,

  /** Every masters read, list or single row. */
  masterAll: () => ["masters"] as const,
  /** Every masters read of one company. */
  mastersOfTenant: (tenantId: string) => ["masters", tenantId] as const,
  masters: mastersQueryKey,
  /** One master for the master hub; lives under the masters prefix. */
  master: (tenantId: string | null, role: Role, id: string | undefined) =>
    ["masters", tenantId, role ?? "role-pending", "one", id] as const,

  /** Every labels read. */
  cityAll: () => ["cities"] as const,
  cities: citiesQueryKey,

  /** Every read of one reference table (generic update/delete). */
  table: <Table extends RefTable>(table: Table) => [table] as const,
};
