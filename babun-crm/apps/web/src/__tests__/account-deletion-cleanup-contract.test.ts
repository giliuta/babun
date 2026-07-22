import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "vitest";

const workerSource = readFileSync(
  resolve(
    process.cwd(),
    "supabase/functions/account-delete-cleanup/index.ts",
  ),
  "utf8",
);
const deletionMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260720210007_safe_account_deletion.sql",
  ),
  "utf8",
);
const dispatchMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260720210013_sms_dispatch_hardening.sql",
  ),
  "utf8",
);

describe("pending account deletion recovery", () => {
  test("leases retry rows atomically and exposes the claim only to service role", () => {
    assert.match(
      deletionMigration,
      /create or replace function public\.claim_account_deletion_cleanup/,
    );
    assert.match(deletionMigration, /for update skip locked/i);
    assert.match(deletionMigration, /lease_expires_at <= now\(\)/i);
    assert.match(
      deletionMigration,
      /grant execute on function public\.claim_account_deletion_cleanup\(integer\)\s+to service_role/i,
    );
    assert.match(
      deletionMigration,
      /revoke all on function public\.claim_account_deletion_cleanup\(integer\)\s+from public, anon, authenticated, service_role/i,
    );
  });

  test("authenticates cron with a database-held secret", () => {
    assert.match(workerSource, /headers\.get\("x-cleanup-secret"\)/);
    assert.match(workerSource, /constantTimeEqual\(supplied, data\.secret\)/);
    assert.match(workerSource, /\.eq\("name", "account-delete-cleanup"\)/);
    assert.match(dispatchMigration, /account_deletion_cleanup_retry/);
    assert.match(dispatchMigration, /'x-cleanup-secret'/);
    assert.match(
      dispatchMigration,
      /functions\/v1\/account-delete-cleanup/,
    );
  });

  test("resumes each irreversible stage idempotently and backs off failures", () => {
    const lookupAt = workerSource.indexOf(".getUserById(claim.userId)");
    const softDeleteAt = workerSource.indexOf(
      "service.auth.admin.deleteUser(claim.userId, true)",
    );
    const tenantCleanupAt = workerSource.indexOf(
      '"delete_sole_owned_tenants_for_account"',
    );
    const hardDeleteAt = workerSource.indexOf(
      "service.auth.admin.deleteUser(\n    claim.userId,\n    false",
    );
    const leaseRenewalAt = workerSource.indexOf(
      "await updateClaim(service, claim, status)",
    );
    assert.ok(leaseRenewalAt >= 0);
    assert.ok(lookupAt > leaseRenewalAt);
    assert.ok(lookupAt >= 0);
    assert.ok(softDeleteAt > lookupAt);
    assert.ok(tenantCleanupAt > softDeleteAt);
    assert.ok(hardDeleteAt > tenantCleanupAt);
    assert.match(workerSource, /typeof user\.deleted_at === "string"/);
    assert.match(workerSource, /update\.next_retry_at = retryAt\(claim\.attemptCount\)/);
    assert.match(workerSource, /\.eq\("lease_token", claim\.leaseToken\)/);
    assert.match(workerSource, /"AUTH_HARD_DELETE_FAILED"/);
  });
});
