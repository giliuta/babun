import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "vitest";

const edgeSource = readFileSync(
  resolve(process.cwd(), "supabase/functions/send_push/index.ts"),
  "utf8",
);
const migrationSource = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260720210015_push_dispatch_hardening.sql",
  ),
  "utf8",
);

describe("send_push internal dispatch contract", () => {
  test("rejects requests without the database-held dispatch secret", () => {
    assert.match(edgeSource, /authorizeDispatch/);
    assert.match(edgeSource, /headers\.get\("x-dispatch-secret"\)/);
    assert.match(edgeSource, /\.from\("edge_cron_secrets"\)/);
    assert.match(edgeSource, /dispatch_authorization_required/);
    assert.match(edgeSource, /user_ids\.length > 500/);
  });

  test("revokes the SECURITY DEFINER helper from API roles", () => {
    assert.match(
      migrationSource,
      /revoke all on function public\._dispatch_push\(text, jsonb, uuid\[\]\)\s+from public, anon, authenticated/i,
    );
    assert.match(migrationSource, /'x-dispatch-secret'/);
    assert.match(migrationSource, /perform net\.http_post/);
    assert.match(migrationSource, /set search_path = pg_catalog/);
  });
});
