import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260720210005_invoice_partial_payments.sql",
  ),
  "utf8",
);

describe("invoice SQL integrity contracts", () => {
  test("defaults receipt dates in the tenant business timezone", () => {
    assert.match(sql, /p_occurred_on date default null/);
    assert.match(
      sql,
      /payment_date := coalesce\(\s*p_occurred_on,\s*public\.tenant_business_date\(tenant_uuid\)/,
    );
    assert.match(
      sql,
      /payment_date > public\.tenant_business_date\(tenant_uuid\)/,
    );
    assert.doesNotMatch(sql, /coalesce\(p_occurred_on, current_date\)/);
  });

  test("rejects silently rounded invoice quantities, prices, and VAT", () => {
    const exactLineChecks = sql.match(
      /round\(qty_value, 3\) is distinct from qty_value/g,
    );
    const exactPriceChecks = sql.match(
      /round\(unit_price_value, 2\) is distinct from unit_price_value/g,
    );
    const exactVatChecks = sql.match(
      /round\(p_vat_percent, 2\) is distinct from p_vat_percent/g,
    );
    assert.equal(exactLineChecks?.length, 2);
    assert.equal(exactPriceChecks?.length, 2);
    assert.equal(exactVatChecks?.length, 2);
  });
});
