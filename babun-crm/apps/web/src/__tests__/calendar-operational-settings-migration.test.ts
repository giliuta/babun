import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../supabase/migrations/20260720210011_operational_calendar_settings.sql",
  ),
  "utf8",
);

const functionSql = sql.match(
  /create or replace function public\.read_operational_calendar_settings_safe\(\)[\s\S]*?\n\$\$;/i,
)?.[0];

describe("operational calendar settings migration", () => {
  it("pins a parameterless projection to authenticated tenant membership", () => {
    expect(functionSql).toBeTruthy();
    expect(functionSql).toContain("security definer");
    expect(functionSql).toContain("v_tenant_id uuid := public.current_tenant_id()");
    expect(functionSql).toContain("v_role text := public.current_user_role()");
    expect(functionSql).toContain("v_role not in ('owner', 'dispatcher', 'master')");
    expect(functionSql).toContain("where cs.tenant_id = v_tenant_id");
    expect(functionSql).not.toContain("p_tenant_id");
  });

  it("returns only calendar fields required by operational views", () => {
    for (const field of [
      "start_hour",
      "end_hour",
      "grid_step",
      "week_start",
      "timezone",
      "buffer_minutes",
      "hide_cancelled",
      "allow_overtime",
      "work_start_hour",
      "work_end_hour",
      "scroll_open_hour",
    ]) {
      expect(functionSql).toContain(field);
    }
    expect(functionSql).not.toMatch(/personal_labels|personal_default_label|days_off/);
  });

  it("grants execution only to authenticated callers", () => {
    expect(sql).toContain(
      "revoke all on function public.read_operational_calendar_settings_safe()\n  from public, anon, authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.read_operational_calendar_settings_safe()\n  to authenticated",
    );
    expect(sql).not.toMatch(/grant execute[\s\S]*?\bto anon\b/i);
  });
});
