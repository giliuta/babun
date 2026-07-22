import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../supabase/migrations/20260720210008_invoice_document_hardening.sql",
  ),
  "utf8",
);

describe("invoice document hardening migration contract", () => {
  it("captures server-derived seller and client snapshots", () => {
    expect(sql).toContain("build_invoice_seller_snapshot");
    expect(sql).toContain("build_invoice_client_snapshot");
    expect(sql).toContain("trg_capture_invoice_document_snapshots");
    expect(sql).toContain("Ignore any JSON supplied by the client");
    expect(sql).toContain("new.seller_snapshot := public.build_invoice_seller_snapshot");
    expect(sql).toContain("new.client_snapshot := case");
    expect(sql).toContain("select 1 from public.tenants tenant where tenant.id = old.tenant_id");
    expect(sql).toContain("trg_refresh_invoice_snapshots_from_lines");
    expect(sql).toContain("set seller_snapshot = '{}'::jsonb");
  });

  it("makes snapshots immutable forever after the first ledger row", () => {
    expect(sql).toContain("tx.invoice_id = old.id");
    expect(sql).toContain("original.invoice_id = old.id");
    expect(sql).toContain("if old.status <> 'issued' or has_ledger then");
    expect(sql).toContain("Снимки сторон инвойса неизменяемы после первого платежа");
  });

  it("lets a paid invoice and its client snapshot leave only with a deleted tenant", () => {
    const guardStart = sql.indexOf(
      "create or replace function public.prevent_settled_invoice_rewrite()",
    );
    const tenantBypass = sql.indexOf(
      "select 1 from public.tenants tenant where tenant.id = old.tenant_id",
      guardStart,
    );
    const paidFreeze = sql.indexOf(
      "Инвойс с платежами нельзя редактировать",
      guardStart,
    );
    expect(guardStart).toBeGreaterThanOrEqual(0);
    expect(tenantBypass).toBeGreaterThan(guardStart);
    expect(paidFreeze).toBeGreaterThan(tenantBypass);
    expect(sql.slice(guardStart, tenantBypass)).toContain(
      "auth.role() = 'service_role'",
    );
    expect(sql).toContain("new.seller_snapshot := old.seller_snapshot");
    expect(sql).toContain("new.client_snapshot := old.client_snapshot");
  });

  it("serializes a concrete income refund and rejects over-refunds", () => {
    expect(sql).toMatch(/tx\.id = p_payment_id[\s\S]*?for update;/);
    expect(sql).toMatch(/invoice\.id = original_row\.invoice_id[\s\S]*?for update;/);
    expect(sql).toContain("refund.refund_of_id = original_row.id");
    expect(sql).toContain("if amount_value > refundable_total then");
    expect(sql).toContain("refund_row.account_id is distinct from original_row.account_id");
    expect(sql).toContain("refund_row.payment_method is distinct from original_row.payment_method");
  });

  it("fails closed on idempotency payload mismatch and appointment-owned income", () => {
    expect(sql.match(/Идентификатор возврата уже использован с другими данными/g)?.length)
      .toBeGreaterThanOrEqual(2);
    expect(sql.match(/refund_row\.source <> 'manual'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("refund_row.refund_of_id is distinct from p_payment_id");
    expect(sql).toContain("original_row.source = 'auto'");
    expect(sql).toContain("Платёж заявки возвращается из карточки заявки");
  });

  it("enforces refund chronology and retains the other payment route", () => {
    expect(sql).toContain("current_timestamp at time zone tenant_timezone");
    expect(sql).toContain("occurred_value > business_date");
    expect(sql).toContain("occurred_value < original_row.occurred_on");
    expect(sql).toContain("('cash', 'card', 'transfer', 'other')");
    expect(sql).toContain("original_row.payment_method");
  });

  it("keeps the refund RPC owner-only and hidden from anonymous users", () => {
    expect(sql).toContain("public.current_user_role() is distinct from 'owner'");
    expect(sql).toContain("revoke all on function public.refund_invoice_payment");
    expect(sql).toContain("grant execute on function public.refund_invoice_payment");
    expect(sql).toContain("has_function_privilege(\n       'anon'");
  });
});
