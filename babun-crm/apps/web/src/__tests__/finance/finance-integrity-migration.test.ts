import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../supabase/migrations/20260720210006_finance_integrity.sql",
  ),
  "utf8",
);
const compact = sql.replace(/\s+/g, " ").trim();

describe("finance integrity migration contract", () => {
  it("routes all four payment methods to one exact active account kind", () => {
    expect(compact).toContain("when 'cash' then 'cash'");
    expect(compact).toContain("when 'card' then 'card'");
    expect(compact).toContain("when 'transfer' then 'bank'");
    expect(compact).toContain("when 'other' then 'other'");
    expect(compact).toContain("and kind = required_kind and is_active = true");
    expect(sql).not.toContain("case when kind = 'other' then 0 else 1 end");
  });

  it("uses an event ledger instead of the legacy one-row appointment index", () => {
    expect(sql).toContain("add column if not exists appointment_payment_kind text");
    expect(sql).toContain("drop index if exists public.ux_finance_tx_auto_appointment");
    expect(sql).toContain("drop index if exists public.ux_finance_tx_appointment_type");
    expect(sql).toContain("('prepayment'::text, prepayment_delta)");
    expect(sql).toContain("('settlement'::text, settlement_delta)");
    expect(sql).toContain("where amount <> 0");
    expect(sql).not.toMatch(/on conflict\s*\(\s*appointment_id\s*,\s*type\s*\)/i);
  });

  it("records a scheduled full prepayment once and completion creates no settlement", () => {
    expect(compact).toContain(
      "when normalized_amount > 0 and normalized_amount >= total_amount and total_amount > 0 then 'paid'",
    );
    expect(compact).toContain(
      "when 'paid' then greatest( appointment_row.total_amount - appointment_row.prepaid_amount, 0 )",
    );
    expect(compact).toContain(
      "when 'paid' then greatest( coalesce(p_old_total, 0) - coalesce(p_old_prepaid, 0), 0 )",
    );
    expect(compact).toContain(
      "if prepayment_delta = 0 and settlement_delta = 0 and total_delta = 0 then return",
    );
  });

  it("reopens debt when a full-prepayment booking total grows without touching its ledger", () => {
    expect(compact).toContain(
      "if not has_settlement and new.status <> 'cancelled' and new.payment_status <> 'refunded' and new.prepaid_amount > 0 and new.paid_amount = 0 and new.total_amount is distinct from old.total_amount then",
    );
    expect(compact).toContain(
      "when new.total_amount > 0 and new.prepaid_amount >= new.total_amount then 'paid' else 'unpaid'",
    );
    expect(sql).toContain("if new.prepaid_amount > new.total_amount then");
  });

  it("accepts the remainder using a different tender and supports multiple settlement receipts", () => {
    expect(compact).toContain(
      "settlement_growth := old.status <> 'cancelled' and old.payment_status <> 'refunded' and new_settlement_target > old_settlement_target",
    );
    expect(compact).not.toContain("settlement_growth := not has_settlement");
    expect(compact).toContain(
      "new.payment_method is distinct from old.payment_method and not settlement_growth",
    );
    expect(compact).toContain(
      "new.status is distinct from old.status and new.status is distinct from 'completed'",
    );
    expect(compact).toContain("if settlement_growth then");
    expect(compact).toContain(
      "settlement_delta := new_settlement_target - old_settlement_target",
    );
  });

  it("refunds every outstanding event on cancellation and fails atomically on a gap", () => {
    expect(sql).toContain("new.payment_status := 'refunded'");
    expect(compact).toContain(
      "adjustment.payment_kind = 'all' or coalesce(income.appointment_payment_kind, 'settlement') = adjustment.payment_kind",
    );
    expect(sql).toContain("for update of income");
    expect(sql).toContain("if remaining_refund > 0 then");
    expect(sql).toContain("Не удалось вернуть всю сумму");
    expect(sql).toContain("income_candidate.invoice_id");
    expect(sql).toContain(
      "refund_of_id, invoice_id, appointment_payment_kind, notes",
    );
  });

  it("blocks orphan manual refunds of appointment receipts", () => {
    expect(compact).toContain(
      "if original_income.source = 'auto' and new.source <> 'auto' then",
    );
    expect(sql).toContain(
      "Возврат автоматической оплаты оформляется в связанной заявке",
    );
    expect(compact).toContain("new.invoice_id := original_income.invoice_id");
    expect(compact).toContain(
      "already_refunded + abs(new.amount) > greatest(original_income.amount, 0)",
    );
  });

  it("adjusts prepayment atomically and reclassifies a tender through refund plus receipt", () => {
    expect(sql).toContain("create or replace function public.set_appointment_prepayment");
    expect(sql).toContain("'appointment_prepayment'");
    expect(compact).toContain(
      "appointment_row.payment_method is distinct from p_payment_method then update public.appointments set prepaid_amount = 0",
    );
    expect(sql).toContain("grant execute on function public.set_appointment_prepayment");
    expect(sql).toContain("После оплаты остатка предоплату отдельно менять нельзя");
    expect(sql).toContain("После выполнения отмените оплату целиком");
  });

  it("undoes settlement through linked refunds while retaining prepayment", () => {
    expect(compact).toContain(
      "coalesce(income.appointment_payment_kind, 'settlement') = 'settlement' order by income.id for update",
    );
    expect(compact).not.toContain(
      "delete from public.finance_transactions where appointment_id = p_appointment_id",
    );
    expect(compact).toContain(
      "when prepaid_amount > 0 and total_amount > 0 and prepaid_amount >= total_amount then 'paid' else 'unpaid'",
    );
    expect(sql).toContain("writes one linked refund per outstanding settlement piece");
    expect(sql).toContain(
      "Оплата состоит только из предоплаты; оформите её возврат",
    );
  });

  it("permanently resets every outstanding receipt without deleting history", () => {
    expect(sql).toContain("create or replace function public.reset_appointment_payment");
    expect(sql).toContain("'appointment_payment_reset'");
    expect(compact).toContain(
      "set prepaid_amount = 0, paid_amount = 0, payment_status = 'unpaid', payment_method = null, payment = null, payments = '[]'::jsonb",
    );
    expect(compact).toContain(
      "round(outstanding_amount, 2) is distinct from round(expected_receipts, 2)",
    );
    expect(sql).toContain("Previous short-lived settlement undo may already have refunded");
    expect(sql).toContain(
      "grant execute on function public.reset_appointment_payment(uuid)",
    );
  });

  it("enforces tenant, category, master, account and history relationships", () => {
    expect(sql).toContain("Способ оплаты не соответствует выбранному счёту");
    expect(compact).toContain(
      "when new.type in ('income', 'refund') then 'income'",
    );
    expect(sql).toContain("Исполнитель не входит в команду финансовой операции");
    expect(sql).toContain("Тип счёта с операциями нельзя изменить");
    expect(sql).toContain("guard_appointment_history_delete");
    expect(sql).toContain("guard_client_history_delete");
    expect(sql).toContain("guard_finance_category_history_delete");
    expect(compact).toContain(
      "exists (select 1 from public.finance_templates where category_id = old.id)",
    );
  });

  it("uses tenant-local business dates and rejects future transfers", () => {
    expect(sql).toContain("create or replace function public.tenant_business_date");
    expect(sql).toContain("current_timestamp at time zone tenant_timezone");
    expect(sql).toContain("appointment_row.payment_method,\n        business_today");
    expect(sql).toContain("income_candidate.payment_method,\n          business_today");
    expect(compact).toContain(
      "transfer_date := coalesce( p_occurred_on, public.tenant_business_date(tenant_uuid) )",
    );
    expect(compact).toContain(
      "if transfer_date > public.tenant_business_date(tenant_uuid) then",
    );
  });

  it("keeps write capabilities closed and transfer retries durable", () => {
    expect(sql).toContain("revoke all on table public._finance_write_context");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("status = 'deleted'");
    expect(sql).toContain("На исходном счёте недостаточно средств");
    expect(sql).toContain("to_regclass('public.ux_finance_tx_appointment_type')");
  });
});
