import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { buildRefundDraft } from "./refund";

// Возврат обязан унести НДС-СНИМОК исходного дохода, а не сегодняшние
// настройки счёта: доход «без НДС» без явного vat_mode получал бы от
// триггера налог из настроек, и summarizeVat занижал бы собранное.

const income = (patch: Partial<FinanceTransaction>): FinanceTransaction =>
  ({
    id: "tx-1",
    type: "income",
    amount: 100,
    account_id: "acc-1",
    team_id: "team-1",
    category_id: "cat-1",
    payment_method: "cash",
    invoice_id: null,
    occurred_on: "2026-06-10",
    source: "manual",
    vat_mode: null,
    vat_rate: null,
    vat_amount: null,
    ...patch,
  }) as FinanceTransaction;

describe("buildRefundDraft", () => {
  test("наследует поля исходника и датируется бизнес-днём", () => {
    const draft = buildRefundDraft(income({}), 40, "2026-08-16");
    assert.equal(draft.type, "refund");
    assert.equal(draft.amount, -40);
    assert.equal(draft.account_id, "acc-1");
    assert.equal(draft.team_id, "team-1");
    assert.equal(draft.category_id, "cat-1");
    assert.equal(draft.payment_method, "cash");
    assert.equal(draft.refund_of_id, "tx-1");
    assert.equal(draft.occurred_on, "2026-08-16");
    assert.equal(draft.business_today, "2026-08-16");
    assert.equal(draft.notes, "Возврат по операции от 2026-06-10");
  });

  test("сумма всегда уходит минусом, даже если передали минус", () => {
    assert.equal(buildRefundDraft(income({}), -25, "2026-08-16").amount, -25);
  });

  test("vat_mode — снимок исходника, «без НДС» не подменяется настройками", () => {
    assert.equal(
      buildRefundDraft(income({ vat_mode: "none" }), 10, "2026-08-16").vat_mode,
      "none",
    );
    assert.equal(
      buildRefundDraft(income({ vat_mode: "exclusive" }), 10, "2026-08-16")
        .vat_mode,
      "exclusive",
    );
  });

  test("старая строка без vat_mode: налог был → inclusive, не было → none", () => {
    assert.equal(
      buildRefundDraft(
        income({ vat_mode: null, vat_amount: 19 }),
        10,
        "2026-08-16",
      ).vat_mode,
      "inclusive",
    );
    assert.equal(
      buildRefundDraft(
        income({ vat_mode: null, vat_amount: null }),
        10,
        "2026-08-16",
      ).vat_mode,
      "none",
    );
  });

  test("request_id уникален на каждое намерение — ретрай не задваивает", () => {
    const a = buildRefundDraft(income({}), 10, "2026-08-16");
    const b = buildRefundDraft(income({}), 10, "2026-08-16");
    assert.ok(a.request_id);
    assert.notEqual(a.request_id, b.request_id);
  });
});
