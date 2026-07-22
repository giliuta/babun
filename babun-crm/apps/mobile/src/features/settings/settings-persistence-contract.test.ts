import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) =>
  readFileSync(resolve(here, relative), "utf8");

function section(source: string, start: string, end?: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

describe("native settings persistence contract", () => {
  test("SMS cache never hides authorization errors or precedes server writes", () => {
    const source = read("sms-templates.ts");
    const query = section(source, "export function useSmsTemplates()", "export function useSaveSmsTemplates()");
    assert.match(query, /isConfirmedNetworkUnavailable\(error\)/);
    assert.match(query, /isMissingSmsTemplatesContract\(error\)/);
    assert.match(query, /throw caught/);

    const save = section(source, "export function useSaveSmsTemplates()", "// C1");
    const rpcAt = save.indexOf('supabase.rpc("write_sms_templates_safe"');
    const cacheAt = save.indexOf("saveCache(tenantId, list)");
    assert.ok(rpcAt >= 0 && cacheAt > rpcAt, "cache must follow the server RPC");
  });

  test("reference updates confirm a returned row and team snapshots use CAS", () => {
    const source = read("../reference/queries.ts");
    assert.doesNotMatch(source, /\bas any\b/);
    assert.match(source, /\.select\("id"\)[\s\S]*\.maybeSingle\(\)/);
    assert.match(source, /expectedUpdatedAt: string/);
    assert.match(source, /\.eq\("updated_at", expectedUpdatedAt\)/);
  });

  test("global sign-out and account deletion await tenant-data erasure", () => {
    const source = read("../../../app/(dashboard)/cabinet/account.tsx");
    const authClear = read("../../lib/auth-clear.ts");
    assert.doesNotMatch(source, /\bwipeLocalData\b/);
    assert.match(source, /await signOutScopeAndWipe\("global"\)/);
    assert.match(source, /await wipeTenantScopedData\(\)/);
    assert.match(authClear, /event === "SIGNED_OUT"/);
    assert.match(authClear, /await waitForIntentionalSignOutWipe\(\)/);
  });

  test("inventory is read-only outside owner and master cache is visibility-scoped", () => {
    const screen = read("../../../app/(dashboard)/cabinet/inventory.tsx");
    const query = read("../inventory/queries.ts");
    const cache = read("../../../../../packages/shared/src/local/equipment.ts");
    assert.match(screen, /const owner = role === "owner"/);
    assert.match(screen, /Только просмотр\. Изменять склад может владелец/);
    assert.match(query, /role !== "owner"/);
    assert.match(query, /queryKey: \["equipment", tenantId, role \?\? "role-pending"\]/);
    assert.match(query, /role === "master" \? "master" : undefined/);
    assert.match(cache, /visibilityScope/);
    assert.match(cache, /if \(visibilityScope\) return \[\]/);
  });
});
