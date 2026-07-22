import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const MOBILE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function source(relative: string): string {
  return readFileSync(path.join(MOBILE_ROOT, relative), "utf8");
}

function ordered(sourceText: string, first: string, second: string): void {
  const firstAt = sourceText.indexOf(first);
  const secondAt = sourceText.indexOf(second);
  assert.ok(firstAt >= 0, `missing ${first}`);
  assert.ok(secondAt > firstAt, `${second} must follow ${first}`);
}

describe("mobile create quota integration", () => {
  test("client and appointment hooks preflight before the cached create", () => {
    const clients = source("src/features/clients/queries.ts");
    const appointments = source("src/features/calendar/mutations.ts");

    ordered(clients, "await preflightQuotaForCreate", "return createClientCached");
    assert.match(clients, /online:\s*isOnline\(\)/);
    assert.match(clients, /isConfirmedNetworkUnavailable/);

    ordered(appointments, "await preflightQuotaForCreate", "return createAppointment");
    assert.match(appointments, /online:\s*isOnline\(\)/);
    assert.match(appointments, /isConfirmedNetworkUnavailable/);
  });

  test("sync runtime and tenant-switch lifetime are tenant-scoped", () => {
    const runtime = source("src/lib/sync-runtime.ts");
    const providers = source("src/providers/AppProviders.tsx");
    const invitations = source("src/features/settings/invitations.ts");

    assert.match(runtime, /startSyncRuntime\(tenantId:\s*string\)/);
    assert.match(runtime, /tenantId:\s*opts\.tenantId/);
    assert.match(providers, /startSyncRuntime\(tenantId\)/);
    assert.match(providers, /\[role, tenantId\]/);
    assert.match(invitations, /if \(!switched\) \{\s*resumeRuntime\(\)/);
  });
});
