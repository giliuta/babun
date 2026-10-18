// TRANSPORT FAILURE vs SERVER REJECTION — the one boundary the offline layer
// relies on.
//
// A transport failure (no network, timeout, abort, gateway 5xx while the
// project restarts) is retried: the write waits in the queue and the
// optimistic UI stays. Anything else is the server's answer — RLS, a
// constraint, a business rule, a 4xx — which a retry cannot fix; such a write
// must surface to the user and must never enter the replay queue.
//
// supabase-js reports a dropped connection as «TypeError: Failed to fetch»
// (Chrome), «Load failed» (Safari/WebKit) or «Network request failed»
// (React Native fetch). PostgrestError does not always carry a numeric
// status, so both the status and the gateway wording are checked.

const TRANSIENT_MESSAGE =
  /failed to fetch|load failed|network request failed|network error|fetch failed|timed? ?out|socket|econn|abort|bad gateway|service unavailable|gateway time|\b50[234]\b/i;

export function isTransientNetworkError(err: unknown): boolean {
  const withStatus = err as { status?: unknown; statusCode?: unknown };
  const httpStatus =
    typeof withStatus?.status === "number"
      ? withStatus.status
      : typeof withStatus?.statusCode === "number"
        ? withStatus.statusCode
        : 0;
  if (httpStatus >= 500) return true;
  const message =
    err instanceof Error
      ? err.message
      : typeof (err as { message?: unknown })?.message === "string"
        ? (err as { message: string }).message
        : String(err);
  return TRANSIENT_MESSAGE.test(message);
}
