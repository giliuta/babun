export const COLD_OFFLINE_CACHE_MISS = "COLD_OFFLINE_CACHE_MISS" as const;

export type ColdOfflineResource = "appointments" | "clients";

/**
 * The device is offline and has never stored an authoritative snapshot for
 * this resource. This is an unknown state, not an authoritative empty list.
 */
export class ColdOfflineCacheMissError extends Error {
  readonly code = COLD_OFFLINE_CACHE_MISS;

  constructor(readonly resource: ColdOfflineResource) {
    super(`Нет сохранённой офлайн-копии: ${resource}`);
    this.name = "ColdOfflineCacheMissError";
  }
}

export function isColdOfflineCacheMissError(
  error: unknown,
): error is ColdOfflineCacheMissError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === COLD_OFFLINE_CACHE_MISS
  );
}
