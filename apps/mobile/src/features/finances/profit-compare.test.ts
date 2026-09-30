import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Service } from "@/features/services/queries";
import { NO_TEAM } from "./accounts-sections";
import { changeOf, periodMaterials, periodMoney } from "./profit-compare";

// «Прибыль» к прошлому периоду: «было» обязано мериться той же линейкой, что
// плитки сейчас, — иначе стрелка врёт о росте, которого не было.

const tx = (patch: Partial<FinanceTransaction>) => patch as FinanceTransaction;

describe("деньги периода — правилом плиток", () => {
  test("доход — доходы минус возвраты, расход — расходы плюс материалы, переводы — мимо", () => {
    const money = periodMoney(
      [
        tx({ type: "income", amount: 515 }),
        tx({ type: "refund", amount: 15 }),
        tx({ type: "expense", amount: 70 }),
        tx({ type: "transfer", amount: -200 }),
        tx({ type: "transfer", amount: 200 }),
      ],
      20,
    );
    assert.deepEqual(money, { income: 500, expense: 90, profit: 410 });
  });

  test("копейки не набегают", () => {
    const money = periodMoney(
      [tx({ type: "income", amount: 0.1 }), tx({ type: "income", amount: 0.2 })],
      0,
    );
    assert.equal(money.income, 0.3);
  });
});

describe("изменение к прошлому", () => {
  test("рост дохода — хорошо, рост расхода — плохо", () => {
    assert.deepEqual(changeOf(320, 515, true), { text: "↓ 38%", good: false });
    assert.deepEqual(changeOf(90, 70, false), { text: "↑ 29%", good: false });
    assert.deepEqual(changeOf(50, 70, false), { text: "↓ 29%", good: true });
  });

  test("сравнивать не с чем — молчим", () => {
    assert.equal(changeOf(708, 0, true), null);
    assert.equal(changeOf(100, 100, true), null);
  });
});

describe("материалы периода", () => {
  const services = [{ id: "s", name: "S", cost_per_unit: 10 }] as unknown as Service[];
  const rec = (patch: Partial<Appointment>) =>
    ({
      id: patch.id ?? "a",
      status: "completed",
      date: "2026-08-10",
      team_id: "t1",
      services: [{ serviceId: "s", serviceName: "S", quantity: 1, totalPrice: 50 }],
      ...patch,
    }) as unknown as Appointment;

  test("только сделанные записи периода и команды чипа", () => {
    const list = [
      rec({ id: "in" }),
      rec({ id: "other-team", team_id: "t2" }),
      rec({ id: "cancelled", status: "cancelled" }),
      rec({ id: "september", date: "2026-09-01" }),
    ];
    const m = periodMaterials(list, services, { from: "2026-08-01", to: "2026-08-31", scope: "t1" }, true);
    assert.equal(m.amount, 10);
    assert.deepEqual(m.costly.map((a) => a.id), ["in"]);
  });

  test("без чипа — вся компания; «Без команды» — только записи без команды", () => {
    const list = [rec({ id: "a1" }), rec({ id: "a2", team_id: null })];
    const range = { from: "2026-08-01", to: "2026-08-31" };
    assert.equal(periodMaterials(list, services, { ...range, scope: null }, true).amount, 20);
    assert.equal(periodMaterials(list, services, { ...range, scope: NO_TEAM }, true).amount, 10);
  });

  test("без права видеть деньги записей — нули", () => {
    const m = periodMaterials([rec({})], services, { from: "2026-08-01", to: "2026-08-31", scope: null }, false);
    assert.deepEqual(m, { amount: 0, appointmentCount: 0, costly: [] });
  });
});
