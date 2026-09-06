import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createBlankAppointment,
  type Appointment,
} from "@babun/shared/local/appointments";
import {
  amountCentsFromInput,
  amountProblem,
  blockCaption,
  closesVisit,
  invoiceSubtitle,
  outstandingCents,
  paidAtLabel,
  paidTileIntent,
  paymentRows,
  recordedToast,
  visitStarted,
} from "./payment-draft";

const NOW = { ymd: "2026-09-06", hm: "11:30" };

function apt(overrides: Partial<Appointment> = {}): Appointment {
  return createBlankAppointment({
    date: "2026-09-06",
    time_start: "11:00",
    time_end: "12:00",
    total_amount: 135,
    status: "scheduled",
    payment_status: "unpaid",
    ...overrides,
  });
}

describe("visitStarted", () => {
  test("earlier day, same-day past start and exact start count as started", () => {
    assert.equal(visitStarted({ date: "2026-09-05", time_start: "18:00" }, NOW), true);
    assert.equal(visitStarted({ date: "2026-09-06", time_start: "11:00" }, NOW), true);
    assert.equal(visitStarted({ date: "2026-09-06", time_start: "11:30" }, NOW), true);
  });
  test("later today and later days are not started", () => {
    assert.equal(visitStarted({ date: "2026-09-06", time_start: "11:31" }, NOW), false);
    assert.equal(visitStarted({ date: "2026-09-07", time_start: "08:00" }, NOW), false);
  });
});

describe("outstanding and amount checks", () => {
  test("outstanding is total minus prepaid and ledger, in cents", () => {
    assert.equal(outstandingCents(apt()), 13500);
    assert.equal(
      outstandingCents(
        apt({
          prepaid_amount: 50,
          payments: [{ id: "p1", method: "cash", amount: 40, paid_at: "2026-09-06T08:00:00.000Z" }],
          payment_status: "partial",
          paid_amount: 40,
        }),
      ),
      4500,
    );
  });
  test("refunded record owes nothing", () => {
    assert.equal(outstandingCents(apt({ payment_status: "refunded" })), 0);
  });
  test("input parses to cents and empty/garbage is zero", () => {
    assert.equal(amountCentsFromInput("135"), 13500);
    assert.equal(amountCentsFromInput("12,5"), 1250);
    assert.equal(amountCentsFromInput(""), 0);
    assert.equal(amountCentsFromInput("abc"), 0);
    assert.equal(amountCentsFromInput("1.234"), 0);
  });
  test("amount must be positive and within the outstanding balance", () => {
    assert.equal(amountProblem(0, 13500), "empty");
    assert.equal(amountProblem(13501, 13500), "exceeds");
    assert.equal(amountProblem(13500, 13500), null);
    assert.equal(amountProblem(100, 13500), null);
  });
});

describe("paymentRows", () => {
  test("itemized prepayments and settlements are cancellable rows in order", () => {
    const rows = paymentRows(
      apt({
        prepaid_amount: 50,
        prepayments: [{ id: "pre1", method: "card", amount: 50, paid_at: "2026-09-05T10:00:00.000Z", account_id: "card" }],
        payments: [
          { id: "s1", method: "cash", amount: 60, paid_at: "2026-09-06T09:00:00.000Z", account_id: "cash" },
          { id: "s2", method: "card", amount: 25, paid_at: "2026-09-06T09:01:00.000Z", account_id: "card" },
        ],
        payment_status: "paid",
        paid_amount: 85,
      }),
    );
    assert.deepEqual(
      rows.map((r) => [r.id, r.kind, r.amount, r.accountId, r.cancellable]),
      [
        ["pre1", "prepayment", 50, "card", true],
        ["s1", "settlement", 60, "cash", true],
        ["s2", "settlement", 25, "card", true],
      ],
    );
  });
  test("prepayment without matching provenance collapses into one non-cancellable row", () => {
    const rows = paymentRows(
      apt({ prepaid_amount: 50, prepayments: [], payment_account_id: "card" }),
    );
    assert.deepEqual(rows, [
      { id: "prepaid-total", kind: "prepayment", amount: 50, accountId: "card", paidAt: "", cancellable: false },
    ]);
  });
  test("provenance that does not add up to prepaid_amount is treated as legacy", () => {
    const rows = paymentRows(
      apt({
        prepaid_amount: 50,
        prepayments: [{ id: "pre1", method: "card", amount: 20, paid_at: "2026-09-05T10:00:00.000Z", account_id: "card" }],
      }),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.cancellable, false);
  });
  test("web mirror money without a ledger shows as one non-cancellable settlement", () => {
    const rows = paymentRows(
      apt({
        payment: { method: "split", cashAmount: 100, cardAmount: 35, paid_at: "2026-09-06T09:00:00.000Z" },
        payment_status: "paid",
        paid_amount: 135,
        status: "completed",
      }),
    );
    assert.deepEqual(rows, [
      { id: "settled-total", kind: "settlement", amount: 135, accountId: null, paidAt: "2026-09-06T09:00:00.000Z", cancellable: false },
    ]);
  });
  test("refunded record shows no settlement rows", () => {
    const rows = paymentRows(
      apt({
        payments: [{ id: "s1", method: "cash", amount: 135, paid_at: "2026-09-06T09:00:00.000Z" }],
        payment_status: "refunded",
      }),
    );
    assert.deepEqual(rows, []);
  });
});

describe("closesVisit", () => {
  test("a settlement after the visit started closes it, prepayment never does", () => {
    assert.equal(closesVisit({ date: "2026-09-06", time_start: "11:00", status: "scheduled" }, "settlement", NOW), true);
    assert.equal(closesVisit({ date: "2026-09-06", time_start: "11:00", status: "scheduled" }, "prepayment", NOW), false);
  });
  test("a future visit or an already closed one is left alone", () => {
    assert.equal(closesVisit({ date: "2026-09-07", time_start: "11:00", status: "scheduled" }, "settlement", NOW), false);
    assert.equal(closesVisit({ date: "2026-09-06", time_start: "11:00", status: "completed" }, "settlement", NOW), false);
  });
});

describe("blockCaption", () => {
  const base = {
    hasTeam: true,
    hasAppointment: true,
    visitCompleted: false,
    outstanding: 13500,
    rowsCount: 0,
    amountMode: false,
    started: true,
    hasPending: false,
    outstandingLabel: "€135",
  };
  test("team first, then paid states win over everything", () => {
    assert.deepEqual(blockCaption({ ...base, hasTeam: false }), { text: "Выберите команду", tone: "neutral" });
    assert.deepEqual(blockCaption({ ...base, outstanding: 0, rowsCount: 2, visitCompleted: true }), { text: "Оплачено", tone: "success" });
    assert.deepEqual(blockCaption({ ...base, outstanding: 0, rowsCount: 1, started: false }), { text: "Оплачено заранее", tone: "success" });
  });
  test("amount field open needs no caption; not started, remaining, debt, pending", () => {
    assert.equal(blockCaption({ ...base, amountMode: true }), null);
    assert.equal(blockCaption({ ...base, amountMode: true, started: false }), null);
    assert.equal(blockCaption({ ...base, started: false })?.text, "До визита: предоплата или инвойс");
    assert.deepEqual(blockCaption({ ...base, rowsCount: 1, outstanding: 3500, outstandingLabel: "€35" }), { text: "Остаток €35", tone: "warning" });
    assert.deepEqual(blockCaption({ ...base, visitCompleted: true }), { text: "Долг €135", tone: "warning" });
    assert.equal(blockCaption({ ...base, hasAppointment: false, hasPending: true })?.text, "Запишется при создании");
    assert.equal(blockCaption(base), null);
  });
});

describe("paidTileIntent", () => {
  test("open amount field adds to the same account, closed one cancels", () => {
    assert.equal(paidTileIntent(true), "add");
    assert.equal(paidTileIntent(false), "cancel");
  });
});

describe("labels", () => {
  test("paidAtLabel: time only today, short day otherwise, empty on garbage", () => {
    const today = new Date(2026, 8, 6, 14, 20);
    const todayYmd = "2026-09-06";
    assert.equal(paidAtLabel(today.toISOString(), todayYmd), "14:20");
    assert.equal(paidAtLabel(new Date(2026, 8, 5, 12, 0).toISOString(), todayYmd), "5 сен, 12:00");
    assert.equal(paidAtLabel("nope", todayYmd), "");
  });
  test("recordedToast: plus wording once the account already holds money", () => {
    assert.equal(recordedToast({ kind: "settlement", amount: 50, already: 0, accountName: "Наличные" }), "Оплачено €50 · Наличные");
    assert.equal(recordedToast({ kind: "prepayment", amount: 50, already: 0, accountName: "Карта" }), "Предоплата €50 · Карта");
    assert.equal(recordedToast({ kind: "settlement", amount: 50, already: 50, accountName: "Наличные" }), "+€50 · Наличные · всего €100");
  });
  test("invoiceSubtitle", () => {
    assert.equal(invoiceSubtitle({ status: "paid", due_on: "2026-09-10", total: 135 }), "Оплачен · €135");
    assert.equal(invoiceSubtitle({ status: "issued", due_on: null, total: 135 }), "Ждёт оплаты · €135");
    assert.match(invoiceSubtitle({ status: "issued", due_on: "2026-09-10", total: 135 }), /^Ждёт оплаты до .*10 сентября · €135$/);
  });
});
