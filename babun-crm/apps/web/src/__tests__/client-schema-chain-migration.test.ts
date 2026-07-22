import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../supabase/migrations/20260720210003_master_privacy_hardening.sql",
  ),
  "utf8",
);

describe("client schema migration-chain contract", () => {
  it("creates every post-foundation client column before SQL functions use it", () => {
    const schemaStart = sql.indexOf("alter table public.clients");
    const firstFunction = sql.indexOf(
      "create or replace function public.current_tenant_profile_safe()",
    );
    const schemaSql = sql.slice(schemaStart, firstFunction);

    expect(schemaStart).toBeGreaterThanOrEqual(0);
    expect(schemaStart).toBeLessThan(firstFunction);
    expect(schemaSql).toContain("add column if not exists phone_e164 text");
    expect(schemaSql).toContain("add column if not exists avatar_url text");
    expect(schemaSql).toContain("add column if not exists deleted_at timestamptz");
    expect(schemaSql).toContain("add column if not exists favorite_master_id text");
  });
});
