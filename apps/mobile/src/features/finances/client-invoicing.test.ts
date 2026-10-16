import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import { appointmentDebt, buildStats } from "@babun/shared/local/selectors/client-stats";
import { clientInvoicing } from "./client-invoicing-rule";

// ДОЛГ КЛИЕНТА — ПРАВИЛОМ «ФИНАНСОВ». Запись €300 под инвойсом €300,
// оплачено 300, частичная нота на 100 вернула 100: инвойс закрыт, а у записи
// оплачено 200 из 300 — «долг €100» навсегда на карточке и в «Аналитике».

const appt = (over: Partial<Appointment>): Appointment =>
  ({
    id: "a1",
    client_id: "c1",
    date: "2026-10-01",
    time_start: "10:00",
    status: "completed",
    kind: "work",
    total_amount: 300,
    payments: [{ amount: 200 }],
    payment_status: "partial",
    ...over,
  }) as Appointment;

const invoice = (over: Record<string, unknown>) =>
  ({
    id: "inv1",
    kind: "invoice",
    status: "paid",
    total: 300,
    credited_amount: 100,
    client_id: "c1",
    appointment_id: "a1",
    brigade_id: "t1",
    ...over,
  }) as never;

describe("работа под инвойсом", () => {
  test("оплаченный инвойс с нотой — у записи долга нет", () => {
    const inv = clientInvoicing([invoice({})], {
      inv1: [
        { id: "p", type: "income", amount: 300 } as never,
        { id: "r", type: "refund", amount: -100 } as never,
      ],
    });
    assert.equal(appointmentDebt(appt({}), "2026-10-16", inv), 0);
  });

  test("неоплаченный инвойс с нотой — долг = остаток инвойса, а не сумма записи", () => {
    const inv = clientInvoicing([invoice({ status: "issued" })], {});
    assert.equal(appointmentDebt(appt({ payments: [], payment_status: "unpaid" } as never), "2026-10-16", inv), 200);
  });

  test("инвойс без записи — долгом клиента, и только у своей команды под чипом", () => {
    const loose = invoice({ id: "inv2", appointment_id: null, status: "issued", credited_amount: 0, total: 50 });
    const all = clientInvoicing([loose], {});
    const stats = buildStats(
      { id: "c1", full_name: "Пётр", created_at: "2026-01-01T00:00:00Z", birthday: null } as never,
      [],
      all,
    );
    assert.equal(stats.debt, 50);
    assert.equal(clientInvoicing([loose], {}, "other-team").unlinkedByClient.get("c1"), undefined);
  });

  test("аннулированный инвойс и кредит-нота работу из долга не убирают", () => {
    const inv = clientInvoicing(
      [invoice({ status: "void" }), invoice({ id: "cn", kind: "credit_note", status: "issued" })],
      {},
    );
    assert.equal(appointmentDebt(appt({}), "2026-10-16", inv), appointmentDebt(appt({}), "2026-10-16"));
  });
});
