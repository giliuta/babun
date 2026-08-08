import { describe, expect, test } from "bun:test";
import type { FinanceTransaction } from "./transaction";
import {
  grossForPrice,
  grossFromNet,
  netFromGross,
  summarizeVat,
  vatFromGross,
  type VatSettings,
} from "./vat";

// НДС считается один раз и не должен «плавать». Ошибка здесь — это либо
// завышенная прибыль (налог посчитан заработком), либо неверная сумма к
// уплате в декларации.

const CY: VatSettings = { mode: "exclusive", rate: 19, exemptionNote: null };

let seq = 0;
function tx(partial: Partial<FinanceTransaction>): FinanceTransaction {
  seq += 1;
  return {
    id: `tx-${seq}`,
    tenant_id: "t",
    type: "income",
    amount: 0,
    currency: "EUR",
    vat_rate: null,
    vat_amount: null,
    category_id: null,
    account_id: "acc",
    appointment_id: null,
    appointment_payment_kind: null,
    client_id: null,
    team_id: null,
    master_id: null,
    payment_method: null,
    notes: null,
    occurred_on: "2026-08-09",
    receipt_url: null,
    transfer_group_id: null,
    invoice_id: null,
    refund_of_id: null,
    source: "manual",
    created_at: "2026-08-09T00:00:00Z",
    updated_at: "2026-08-09T00:00:00Z",
    created_by: null,
    ...partial,
  };
}

describe("извлечение налога", () => {
  test("пример владельца: 400 плюс 20% = 480, налог 80", () => {
    const gross = grossFromNet(400, 20);
    expect(gross).toBe(480);
    expect(vatFromGross(gross, 20)).toBe(80);
    expect(netFromGross(gross, 20)).toBe(400);
  });

  test("кипрские 19% округляются до копейки и сходятся обратно", () => {
    const gross = grossFromNet(100, 19); // 119
    const vat = vatFromGross(gross, 19);
    expect(vat).toBe(19);
    expect(netFromGross(gross, 19)).toBe(100);
  });

  test("ставка 0 и выключенный налог ничего не отщипывают", () => {
    expect(vatFromGross(480, 0)).toBe(0);
    expect(grossFromNet(400, 0)).toBe(400);
  });

  test("«включён» не добавляет сверху, «плюс НДС» добавляет", () => {
    expect(grossForPrice(400, { ...CY, mode: "inclusive" })).toBe(400);
    expect(grossForPrice(400, { ...CY, mode: "exclusive", rate: 20 })).toBe(480);
    expect(grossForPrice(400, { ...CY, mode: "off" })).toBe(400);
  });
});

describe("сводка к уплате", () => {
  test("собрал минус уплатил", () => {
    const s = summarizeVat([
      tx({ type: "income", amount: 480, vat_amount: 80, vat_rate: 20 }),
      tx({ type: "expense", amount: 120, vat_amount: 20, vat_rate: 20 }),
    ]);
    expect(s.collected).toBe(80);
    expect(s.paid).toBe(20);
    expect(s.due).toBe(60);
    // Заработано ровно 400, а не 480: 80 — чужие деньги.
    expect(s.netIncome).toBe(400);
  });

  test("возврат уносит и налог", () => {
    const s = summarizeVat([
      tx({ type: "income", amount: 480, vat_amount: 80, vat_rate: 20 }),
      tx({ type: "refund", amount: -480, vat_amount: -80, vat_rate: 20 }),
    ]);
    expect(s.collected).toBe(0);
    expect(s.netIncome).toBe(0);
    expect(s.due).toBe(0);
  });

  test("переводы между своими счетами налога не несут", () => {
    const s = summarizeVat([
      tx({ type: "transfer", amount: -500, vat_amount: 90 }),
      tx({ type: "transfer", amount: 500, vat_amount: 90 }),
    ]);
    expect(s.collected).toBe(0);
    expect(s.paid).toBe(0);
    expect(s.due).toBe(0);
  });

  test("операции без НДС не ломают сводку", () => {
    const s = summarizeVat([
      tx({ type: "income", amount: 100 }),
      tx({ type: "expense", amount: 40 }),
    ]);
    expect(s.due).toBe(0);
    expect(s.netIncome).toBe(100);
  });

  test("зачёт больше собранного — государство должно нам", () => {
    const s = summarizeVat([
      tx({ type: "income", amount: 119, vat_amount: 19, vat_rate: 19 }),
      tx({ type: "expense", amount: 595, vat_amount: 95, vat_rate: 19 }),
    ]);
    expect(s.due).toBe(-76);
  });
});
