import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../supabase/migrations/20260720210010_team_event_visibility.sql",
  ),
  "utf8",
);

describe("team event visibility migration contract", () => {
  it("defines personal versus team scope by nullable team_id", () => {
    expect(sql).toContain("team_id IS NULL     -> private creator event");
    expect(sql).toContain("team_id IS NOT NULL -> shared team event");
    expect(sql).toContain("team_id is not null or created_by = auth.uid()");
    expect(sql).toContain("and (team_id is not null or created_by = auth.uid())");
  });

  it("keeps operator writes creator-scoped and blocks scope bypasses", () => {
    expect(sql.match(/kind in \('event', 'personal'\) and created_by = auth\.uid\(\)/g)?.length)
      .toBeGreaterThanOrEqual(3);
    expect(sql).toContain("event creator is immutable");
    expect(sql).toContain("appointment kind cannot cross the work/event boundary");
    expect(sql).toContain("event creator must match the authenticated user");
  });

  it("validates every appointment reference inside its own tenant", () => {
    expect(sql).toContain("security definer");
    expect(sql).toMatch(/from public\.teams t[\s\S]*?t\.tenant_id = new\.tenant_id[\s\S]*?t\.id = new\.team_id/);
    expect(sql).toMatch(/from public\.clients c[\s\S]*?c\.tenant_id = new\.tenant_id[\s\S]*?c\.id = new\.client_id/);
    expect(sql).toMatch(/from public\.masters m[\s\S]*?m\.tenant_id = new\.tenant_id[\s\S]*?m\.id = new\.master_id/);
    expect(sql).toContain("appointment client belongs to another tenant or is missing");
    expect(sql).toContain("appointment team belongs to another tenant or is missing");
    expect(sql).toContain("appointment master belongs to another tenant or is missing");
    expect(sql).toContain("using errcode = '23503'");
    expect(sql).toContain("trg_appointments_zz_enforce_event_scope");
  });

  it("projects assigned team events to masters without exposing finance", () => {
    const listStart = sql.indexOf(
      "create or replace function public.list_master_appointments_safe(",
    );
    const listEnd = sql.indexOf(
      "revoke all on function public.list_master_appointments_safe",
      listStart,
    );
    const listSql = sql.slice(listStart, listEnd);

    expect(listStart).toBeGreaterThanOrEqual(0);
    expect(listSql).toContain("a.kind in ('event', 'personal')");
    expect(listSql).toContain("and a.team_id is not null");
    expect(listSql).toContain("and a.team_id = any(public.current_user_team_ids())");
    expect(listSql).not.toContain("a.created_by = auth.uid()");
    expect(listSql).toContain("'total_amount', 0");
    expect(listSql).toContain("'payments', '[]'::jsonb");
    expect(listSql).toContain("'service_price_overrides', '{}'::jsonb");
  });

  it("keeps the master mutation RPC restricted to assigned work", () => {
    const updateStart = sql.indexOf(
      "create or replace function public.update_master_appointment_safe(",
    );
    const updateEnd = sql.indexOf(
      "revoke all on function public.update_master_appointment_safe",
      updateStart,
    );
    const updateSql = sql.slice(updateStart, updateEnd);

    expect(updateStart).toBeGreaterThanOrEqual(0);
    expect(updateSql).toContain("and a.kind = 'work'");
    expect(updateSql).not.toContain("a.kind in ('event', 'personal')");
    expect(updateSql).toContain("or a.team_id = any(public.current_user_team_ids())");
  });

  it("separates shared photo reads from creator and assigned-work writes", () => {
    const mutateStart = sql.indexOf(
      "create or replace function public.current_user_can_mutate_appointment_photo(",
    );
    const mutateEnd = sql.indexOf(
      "revoke all on function public.current_user_can_mutate_appointment_photo",
      mutateStart,
    );
    const mutateSql = sql.slice(mutateStart, mutateEnd);

    expect(mutateStart).toBeGreaterThanOrEqual(0);
    expect(mutateSql).toContain("a.kind in ('event', 'personal')");
    expect(mutateSql).toContain("and a.created_by = auth.uid()");
    expect(mutateSql).toContain("public.current_user_role() = 'master'");
    expect(mutateSql).toContain("and a.kind = 'work'");
    expect(mutateSql).not.toMatch(/current_user_role\(\) = 'master'[\s\S]*?a\.kind in \('event'/);

    expect(sql.match(/public\.current_user_can_access_appointment\(appointment_id\)/g)?.length)
      .toBeGreaterThanOrEqual(1);
    expect(sql.match(/public\.current_user_can_mutate_appointment_photo\(appointment_id\)/g)?.length)
      .toBeGreaterThanOrEqual(4);
    expect(sql).toContain("appointment_photos_update_operator");
    expect(sql).toContain("appointment_photos_delete_operator");
    expect(sql).toContain("public.current_user_role() in ('owner', 'dispatcher')");
  });

  it("applies the same read/write split to private Storage objects", () => {
    const storageStart = sql.indexOf(
      "create policy storage_appointment_photos_select",
    );
    const storageEnd = sql.indexOf(
      "-- Finance-safe calendar projection",
      storageStart,
    );
    const storageSql = sql.slice(storageStart, storageEnd);

    expect(storageStart).toBeGreaterThanOrEqual(0);
    expect(storageSql).toContain("public.current_user_can_access_appointment(");
    expect(storageSql.match(/public\.current_user_can_mutate_appointment_photo\(/g)?.length)
      .toBeGreaterThanOrEqual(2);
    expect(storageSql).toContain("storage_appointment_photos_insert");
    expect(storageSql).toContain("storage_appointment_photos_delete");
  });

  it("is rerunnable and fails closed if another appointment policy survives", () => {
    expect(sql).toContain("create or replace function public.enforce_appointment_event_scope()");
    expect(sql).toContain("drop trigger if exists trg_appointments_zz_enforce_event_scope");
    expect(sql.match(/drop policy if exists appointments_/g)?.length)
      .toBeGreaterThanOrEqual(9);
    expect(sql).toContain("drop policy if exists %I on public.appointments");
    expect(sql).toContain("drop policy if exists %I on public.appointment_photos");
    expect(sql).toContain("policyname not in (");
    expect(sql).toContain("permissive appointment policy remains");
    expect(sql).toContain("exact photo policy set is missing");
    expect(sql).toContain("permissive photo policy remains");
    expect(sql).toContain("operational function is callable by anon");
  });
});
