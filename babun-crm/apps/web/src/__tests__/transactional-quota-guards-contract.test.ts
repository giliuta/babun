import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260720212500_transactional_quota_guards.sql",
  ),
  "utf8",
);

describe("transactional server quota guards", () => {
  test("uses one serialized database guard on every billable insert path", () => {
    assert.match(
      migration,
      /create or replace function public\.enforce_tenant_insert_quota\(\)/i,
    );
    assert.match(migration, /security definer/i);
    assert.match(migration, /pg_advisory_xact_lock/);
    for (const table of [
      "clients",
      "invitations",
      "tenant_members",
    ]) {
      assert.match(
        migration,
        new RegExp(`before insert on public\\.${table}`, "i"),
      );
    }
    assert.match(
      migration,
      /before insert or update of created_at on public\.appointments/i,
    );
    assert.match(
      migration,
      /revoke all on function public\.enforce_tenant_insert_quota\(\)\s+from public, anon, authenticated, service_role/i,
    );
  });

  test("counts clients and UTC-month appointment creation against SQL tiers", () => {
    assert.match(migration, /tenant_quota_clients\(new\.tenant_id\)/);
    assert.match(
      migration,
      /tenant_quota_appointments_month\(new\.tenant_id\)/,
    );
    assert.match(migration, /new\.created_at := statement_timestamp\(\)/);
    assert.match(
      migration,
      /new\.created_at is distinct from old\.created_at/,
    );
    assert.doesNotMatch(
      migration,
      /new\.created_at < v_month_start[\s\S]*return new/,
    );
    assert.match(
      migration,
      /appointment\.created_at >= v_month_start[\s\S]*appointment\.created_at < v_month_start \+ interval '1 month'/,
    );
    assert.match(migration, /detail = 'quota_exceeded:clients'/);
    assert.match(
      migration,
      /detail = 'quota_exceeded:appointments_month'/,
    );
  });

  test("shares a team lock and converts a pending invitation into membership", () => {
    const teamLockMatches = migration.match(
      /tenant-quota:team-members:/g,
    );
    assert.equal(teamLockMatches?.length, 2);
    assert.match(migration, /tenant_quota_team_members\(new\.tenant_id\)/);
    assert.match(migration, /invitation\.accepted_at is null/);
    assert.match(migration, /invitation\.expires_at > statement_timestamp\(\)/);
    assert.match(
      migration,
      /case when v_has_reserved_invitation then 0 else 1 end/,
    );
    assert.match(
      migration,
      /invitation\.master_id is not distinct from new\.master_id/,
    );
    assert.match(migration, /detail = 'quota_exceeded:team_members'/);
  });
});
