export interface ClosureRolloutSnapshot {
  isClosed: boolean;
  revision: number;
  actualCashCents: number | null;
}

/** Import only a real pre-server close with a known counted cash amount. */
export function shouldImportLegacyDayClosure(
  server: ClosureRolloutSnapshot,
  legacy: ClosureRolloutSnapshot,
  alreadyServerSynced: boolean,
): boolean {
  return (
    !alreadyServerSynced &&
    !server.isClosed &&
    server.revision === 0 &&
    legacy.isClosed &&
    legacy.actualCashCents != null
  );
}
