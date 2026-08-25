import type { QueuedOp } from "@babun/shared/db/cache/sql";

/** Never expose an explicitly foreign tenant's queue metadata in the active
 * company. Legacy operations without tenant metadata stay visible so they can
 * be resolved; the replayer still relies on server RLS for those old rows. */
export function isQueuedOpVisibleForTenant(
  op: Pick<QueuedOp, "payload">,
  tenantId: string | null,
): boolean {
  if (!tenantId) return false;
  const queuedTenant = op.payload.tenant_id;
  return (
    typeof queuedTenant !== "string" ||
    queuedTenant === tenantId
  );
}
