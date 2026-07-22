import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../supabase/migrations/20260720210009_server_day_closures.sql",
  ),
  "utf8",
);

describe("server day closure and object-label migration contract", () => {
  it("stores close snapshots in integer cents and gates every RPC to owner", () => {
    expect(sql).toContain("expected_cash_cents bigint not null");
    expect(sql).toContain("actual_cash_cents   bigint not null");
    expect(sql).toContain("delta_cash_cents = actual_cash_cents - expected_cash_cents");
    expect(sql.match(/current_user_role\(\) is distinct from 'owner'/g)?.length)
      .toBeGreaterThanOrEqual(3);
  });

  it("derives physical cash from cash-account opening balances and signed ledger rows", () => {
    expect(sql).toContain("sum(round(a.opening_balance * 100)::bigint)");
    expect(sql).toContain("a.kind = 'cash'");
    expect(sql).toContain("(a.created_at at time zone tenant_timezone)::date <= p_as_of_date");
    expect(sql).toContain("select cs.timezone into tenant_timezone");
    expect(sql).toContain("exception when invalid_parameter_value");
    expect(sql).toContain("when tx.type = 'expense' then -abs(tx.amount)");
    expect(sql).toContain("when tx.type = 'refund' then -abs(tx.amount)");
    expect(sql).toContain("tx.occurred_on <= p_as_of_date");
    expect(sql).not.toContain("from public.appointments");
  });

  it("serializes close/reopen with writes and protects closed history", () => {
    expect(
      sql.match(/:day-closure-ledger/g)?.length,
    ).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("finance_transactions_closed_day_guard");
    expect(sql).toContain("accounts_closed_day_guard");
    expect(sql).toContain("tg_op = 'INSERT'");
    expect(sql).toContain("new.kind = 'cash' and new.opening_balance <> 0");
    expect(sql).toContain("tg_op = 'UPDATE'");
    expect(sql).toContain("new.opening_balance is distinct from old.opening_balance");
    expect(sql).toContain("new.kind is distinct from old.kind");
    expect(sql).toContain("new.brigade_id is distinct from old.brigade_id");
    expect(sql).toContain("new.created_at at time zone tenant_timezone");
    expect(sql).toContain("old.created_at at time zone tenant_timezone");
    expect(sql).toContain("rewrites_cash_history := old.kind = 'cash'");
    expect(sql).toContain("old_date <= c.business_date");
    expect(sql).toContain("new_date <= c.business_date");
    expect(sql).toContain("new_date > business_today");
    expect(sql).toContain("tenant_business_date(tenant_uuid)");
    expect(sql).toContain("if not exists (select 1 from public.tenants");
  });

  it("keeps object labels tenant-scoped and soft-archives omitted rows", () => {
    expect(sql).toContain("create table if not exists public.location_labels");
    expect(sql).toContain("tenant_id = public.current_tenant_id()");
    expect(sql).toContain("public.current_user_role() in ('owner', 'dispatcher', 'master')");
    expect(sql).toContain("set is_active = false");
    expect(sql).toContain("apply_location_label_changes(");
    expect(sql).toContain("from jsonb_array_elements(p_remove_ids) item");
    expect(sql).toContain("Rows omitted from p_labels");
    expect(sql).not.toContain("and not exists (\n       select 1\n         from jsonb_array_elements(p_labels)");
    expect(sql).toContain("revoke insert, update, delete");
  });

  it("handles included-name swaps atomically and rejects duplicate names", () => {
    expect(sql).toContain("ux_location_labels_active_name");
    expect(sql).toContain("count(distinct lower(btrim(item ->> 'name')))");
    expect(sql).toContain("Temporarily retire only rows included in this write");
    expect(sql).toContain("(item.value ->> 'position')::integer");
    expect(sql).toContain("on conflict (tenant_id, id) do update");
    expect(sql.indexOf("Temporarily retire only rows included in this write"))
      .toBeLessThan(sql.indexOf("on conflict (tenant_id, id) do update"));
  });
});
