// deno-lint-ignore no-import-prefix -- Supabase Edge Functions resolve this URL import at deploy time.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

type CleanupStatus =
  | "requested"
  | "soft_delete_failed"
  | "soft_deleted"
  | "tenant_cleanup_failed"
  | "tenant_data_deleted"
  | "pending_auth_delete";

interface CleanupClaim {
  userId: string;
  status: CleanupStatus;
  deletedTenantCount: number;
  attemptCount: number;
  leaseToken: string;
}

type ProcessResult = "completed" | "pending" | "lease_lost";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  const legacyServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let serviceKey: string | undefined;

  if (secretKeysJson) {
    try {
      const keys = JSON.parse(secretKeysJson) as Record<string, unknown>;
      if (typeof keys.default === "string") serviceKey = keys.default;
      if (!serviceKey) {
        serviceKey = Object.values(keys).find(
          (value): value is string =>
            typeof value === "string" && value.startsWith("sb_secret_"),
        );
      }
    } catch {
      // Fall through to the legacy service-role JWT.
    }
  }

  if (!serviceKey) serviceKey = legacyServiceKey || undefined;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type ServiceClient = NonNullable<ReturnType<typeof serviceClient>>;

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function authorizeWorker(
  service: ServiceClient,
  request: Request,
): Promise<boolean> {
  const supplied = request.headers.get("x-cleanup-secret") ?? "";
  if (!supplied) return false;
  const { data, error } = await service
    .from("edge_cron_secrets")
    .select("secret")
    .eq("name", "account-delete-cleanup")
    .single();
  return (
    !error &&
    typeof data?.secret === "string" &&
    constantTimeEqual(supplied, data.secret)
  );
}

const CLEANUP_STATUSES = new Set<CleanupStatus>([
  "requested",
  "soft_delete_failed",
  "soft_deleted",
  "tenant_cleanup_failed",
  "tenant_data_deleted",
  "pending_auth_delete",
]);

function parseClaims(value: unknown): CleanupClaim[] | null {
  if (!Array.isArray(value)) return null;
  const claims: CleanupClaim[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") return null;
    const record = row as Record<string, unknown>;
    const status = record.status;
    if (
      typeof record.user_id !== "string" ||
      typeof status !== "string" ||
      !CLEANUP_STATUSES.has(status as CleanupStatus) ||
      typeof record.deleted_tenant_count !== "number" ||
      typeof record.attempt_count !== "number" ||
      typeof record.lease_token !== "string"
    ) {
      return null;
    }
    claims.push({
      userId: record.user_id,
      status: status as CleanupStatus,
      deletedTenantCount: Math.max(0, record.deleted_tenant_count),
      attemptCount: Math.max(1, record.attempt_count),
      leaseToken: record.lease_token,
    });
  }
  return claims;
}

function retryAt(attemptCount: number): string {
  const minutes = Math.min(
    24 * 60,
    Math.max(5, 2 ** Math.min(Math.max(attemptCount, 1), 10)),
  );
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function updateClaim(
  service: ServiceClient,
  claim: CleanupClaim,
  status: CleanupStatus,
  options: {
    deletedTenantCount?: number;
    errorCode?: string | null;
    release?: boolean;
  } = {},
): Promise<boolean> {
  const release = options.release ?? false;
  const now = new Date();
  const update: Record<string, unknown> = {
    status,
    deleted_tenant_count: Math.max(
      0,
      options.deletedTenantCount ?? claim.deletedTenantCount,
    ),
    last_error_code: options.errorCode ?? null,
    updated_at: now.toISOString(),
    lease_expires_at: release
      ? null
      : new Date(now.getTime() + 5 * 60_000).toISOString(),
  };
  if (release) {
    update.lease_token = null;
    update.next_retry_at = retryAt(claim.attemptCount);
  }

  const { data, error } = await service
    .from("account_deletion_cleanup")
    .update(update)
    .eq("user_id", claim.userId)
    .eq("lease_token", claim.leaseToken)
    .select("user_id");
  return !error && Array.isArray(data) && data.length === 1;
}

async function deleteClaim(
  service: ServiceClient,
  claim: CleanupClaim,
): Promise<boolean> {
  const { data, error } = await service
    .from("account_deletion_cleanup")
    .delete()
    .eq("user_id", claim.userId)
    .eq("lease_token", claim.leaseToken)
    .select("user_id");
  return !error && Array.isArray(data) && data.length === 1;
}

async function releaseFailure(
  service: ServiceClient,
  claim: CleanupClaim,
  status: CleanupStatus,
  errorCode: string,
): Promise<ProcessResult> {
  return (await updateClaim(service, claim, status, {
      errorCode,
      release: true,
    }))
    ? "pending"
    : "lease_lost";
}

async function processClaim(
  service: ServiceClient,
  claim: CleanupClaim,
): Promise<ProcessResult> {
  let status = claim.status;
  let deletedTenantCount = claim.deletedTenantCount;

  // A batch is claimed at once but processed sequentially. Renew and verify
  // this row's lease immediately before touching Auth so a later row whose
  // original lease expired can never race a subsequent cron invocation.
  if (!(await updateClaim(service, claim, status))) return "lease_lost";

  const { data: authData, error: lookupError } = await service.auth.admin
    .getUserById(claim.userId);
  const user = authData.user;
  if (lookupError || !user) {
    // A previous hard-delete can succeed while the worker dies before removing
    // its ledger row. Only statuses proving tenant cleanup was committed may
    // treat a missing Auth row as completed.
    if (
      status === "tenant_data_deleted" ||
      status === "pending_auth_delete"
    ) {
      return (await deleteClaim(service, claim)) ? "completed" : "lease_lost";
    }
    return releaseFailure(
      service,
      claim,
      "tenant_cleanup_failed",
      "AUTH_USER_LOOKUP_FAILED",
    );
  }

  const isSoftDeleted = typeof user.deleted_at === "string" &&
    user.deleted_at.length > 0;
  if (!isSoftDeleted) {
    if (status !== "requested" && status !== "soft_delete_failed") {
      return releaseFailure(
        service,
        claim,
        "soft_delete_failed",
        "AUTH_ACCOUNT_NOT_SOFT_DELETED",
      );
    }
    const { error } = await service.auth.admin.deleteUser(claim.userId, true);
    if (error) {
      return releaseFailure(
        service,
        claim,
        "soft_delete_failed",
        "AUTH_SOFT_DELETE_FAILED",
      );
    }
  }

  if (status !== "tenant_data_deleted" && status !== "pending_auth_delete") {
    if (!(await updateClaim(service, claim, "soft_deleted"))) {
      return "lease_lost";
    }
    status = "soft_deleted";

    const { data, error } = await service.rpc(
      "delete_sole_owned_tenants_for_account",
      { p_user_id: claim.userId },
    );
    if (error) {
      return releaseFailure(
        service,
        claim,
        "tenant_cleanup_failed",
        "TENANT_TRANSACTION_FAILED",
      );
    }
    deletedTenantCount = typeof data === "number" ? Math.max(0, data) : 0;
    if (
      !(await updateClaim(service, claim, "tenant_data_deleted", {
        deletedTenantCount,
      }))
    ) {
      return "lease_lost";
    }
    status = "tenant_data_deleted";
  }

  const { error: hardDeleteError } = await service.auth.admin.deleteUser(
    claim.userId,
    false,
  );
  if (hardDeleteError) {
    return releaseFailure(
      service,
      claim,
      "pending_auth_delete",
      "AUTH_HARD_DELETE_FAILED",
    );
  }

  return (await deleteClaim(service, claim)) ? "completed" : "lease_lost";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const service = serviceClient();
  if (!service) return json(503, { error: "Cleanup worker unavailable" });
  if (!(await authorizeWorker(service, request))) {
    return json(401, { error: "Cleanup authorization required" });
  }

  let body: { mode?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }
  if (body.mode !== "retry") return json(400, { error: "Invalid mode" });

  const { data, error } = await service.rpc(
    "claim_account_deletion_cleanup",
    { p_limit: 20 },
  );
  if (error) return json(503, { error: "Cleanup claim unavailable" });
  const claims = parseClaims(data);
  if (!claims) return json(500, { error: "Invalid cleanup claim response" });

  let completed = 0;
  let pending = 0;
  let leaseLost = 0;
  for (const claim of claims) {
    const result = await processClaim(service, claim);
    if (result === "completed") completed += 1;
    else if (result === "pending") pending += 1;
    else leaseLost += 1;
  }

  return json(200, {
    ok: true,
    claimed: claims.length,
    completed,
    pending,
    lease_lost: leaseLost,
  });
});
