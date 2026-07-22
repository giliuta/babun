import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../supabase/migrations/20260720210012_atomic_client_tags.sql",
  ),
  "utf8",
);

describe("atomic client and tag migration contract", () => {
  it("authorizes only owner/dispatcher in the caller's active tenant", () => {
    expect(sql.match(/active_role not in \('owner', 'dispatcher'\)/g)?.length)
      .toBe(2);
    expect(sql.match(/p_tenant_id is distinct from active_tenant_id/g)?.length)
      .toBe(2);
    expect(sql.match(/auth\.uid\(\) is null/g)?.length).toBe(2);
  });

  it("rejects mass assignment of identity and timestamp fields", () => {
    const createWhitelist = sql.slice(
      sql.indexOf("from jsonb_object_keys(p_client)"),
      sql.indexOf("client payload contains a protected or unknown field"),
    );
    const updateWhitelist = sql.slice(
      sql.indexOf("from jsonb_object_keys(p_patch)"),
      sql.indexOf("client patch contains a protected or unknown field"),
    );

    expect(sql).toContain("client payload contains a protected or unknown field");
    expect(sql).toContain("client patch contains a protected or unknown field");
    expect(createWhitelist).not.toContain("'id'");
    expect(createWhitelist).not.toContain("'tenant_id'");
    expect(createWhitelist).not.toContain("'updated_at'");
    expect(updateWhitelist).not.toContain("'id'");
    expect(updateWhitelist).not.toContain("'tenant_id'");
    expect(updateWhitelist).not.toContain("'updated_at'");
    expect(updateWhitelist).not.toContain("'created_at'");
    expect(sql).toContain("p_client_id uuid,\n  p_client jsonb");
  });

  it("validates tag, referrer and favorite-master tenant ownership", () => {
    expect(sql).toMatch(/from public\.client_tags tag[\s\S]*?tag\.tenant_id = p_tenant_id/);
    expect(sql).toContain("client tag does not belong to the active tenant");
    expect(sql.match(/referrer\.tenant_id = active_tenant_id/g)?.length).toBe(2);
    expect(sql.match(/master\.tenant_id = active_tenant_id/g)?.length).toBe(2);
    expect(sql.match(/client cannot refer itself/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("also protects stale direct writers from cross-tenant references", () => {
    expect(sql).toContain("create or replace function public.enforce_client_reference_tenant()");
    expect(sql).toContain("clients_enforce_reference_tenant");
    expect(sql).toMatch(/referrer\.tenant_id = new\.tenant_id[\s\S]*?referrer\.id = new\.referred_by_client_id/);
    expect(sql).toMatch(/master\.tenant_id = new\.tenant_id[\s\S]*?master\.id = new\.favorite_master_id/);
    expect(sql).toContain("create or replace function public.enforce_client_tag_assignment_tenant()");
    expect(sql).toContain("client_tag_assignments_enforce_tenant");
    expect(sql).toMatch(/client\.tenant_id = new\.tenant_id[\s\S]*?client\.id = new\.client_id/);
    expect(sql).toMatch(/tag\.tenant_id = new\.tenant_id[\s\S]*?tag\.id = new\.tag_id/);
    expect(sql).toContain("cross-tenant client reference exists");
    expect(sql).toContain("cross-tenant tag assignment exists");
  });

  it("creates the client and assignments in one PostgreSQL function", () => {
    const start = sql.indexOf(
      "create or replace function public.create_client_with_tags(",
    );
    const end = sql.indexOf(
      "revoke all on function public.create_client_with_tags",
      start,
    );
    const createSql = sql.slice(start, end);

    expect(createSql).toContain("insert into public.clients (");
    expect(createSql).toContain("returning * into saved_row");
    expect(createSql).toContain("insert into public.client_tag_assignments (");
    expect(createSql.indexOf("insert into public.clients (")).toBeLessThan(
      createSql.indexOf("insert into public.client_tag_assignments ("),
    );
    expect(createSql).not.toContain("exception when");
  });

  it("serializes update/tag replacement and returns canonical assignments", () => {
    const start = sql.indexOf(
      "create or replace function public.update_client_with_tags(",
    );
    const end = sql.indexOf(
      "revoke all on function public.update_client_with_tags",
      start,
    );
    const updateSql = sql.slice(start, end);

    expect(updateSql).toContain("for update;");
    expect(updateSql).toContain("next_row := jsonb_populate_record(current_row, p_patch)");
    expect(updateSql).toContain("delete from public.client_tag_assignments assignment");
    expect(updateSql).toContain("insert into public.client_tag_assignments (");
    expect(updateSql).toContain("array_agg(assignment.tag_id order by assignment.tag_id)");
    expect(updateSql).not.toContain("exception when");
  });

  it("keeps both security-definer RPCs hidden from anonymous callers", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain(
      "revoke all on function public.create_client_with_tags(uuid, uuid, jsonb, uuid[])",
    );
    expect(sql).toContain(
      "revoke all on function public.update_client_with_tags(uuid, uuid, jsonb, uuid[])",
    );
    expect(sql).toContain("atomic client writes: unsafe RPC grants");
  });
});
