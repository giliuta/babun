import { describe, expect, mock, test } from "bun:test";

// ДВА ТАПА В ОДНОМ КАДРЕ — ОДИН ПЛАТЁЖ. `busy` в состоянии блока — значение
// последней перерисовки; второй тап до перерисовки видел «свободно» и слал
// второй платёж со своим id. Замок — ref, общий для всех тапов блока.

// Нативные модули под раннером не поднимаются: выбор и вибрация — заглушки.
mock.module("@/lib/choose", () => ({ chooseOption: async () => null }));
mock.module("@/lib/haptics", () => ({
  haptics: { success() {}, error() {}, warning() {}, tap() {} },
}));

const { paymentActions } = await import("./payment-actions");

type Actions = ReturnType<typeof paymentActions>;
type State = Parameters<typeof paymentActions>[0];
type Props = Parameters<typeof paymentActions>[1];

function block(lock: () => { current: boolean }) {
  const calls: string[] = [];
  let settle: () => void = () => {};
  const pending = new Promise<null>((resolve) => {
    settle = () => resolve(null);
  });
  const state = {
    router: { push() {} },
    toast() {},
    businessNow: () => ({ ymd: "2026-10-27", hm: "15:00" }),
    record: {
      mutateAsync: (input: { requestId: string }) => {
        calls.push(input.requestId);
        return pending;
      },
    },
    cancel: { mutateAsync: async () => null },
    receiptState: { latest: null, invoiceNext: null },
    setPartText() {},
    canTakeMoney: true,
    receiptNext: null,
    bookingInPlan: true,
    tariffNudge() {},
    invoice: null,
    invoicePay: { open: false, busy: false, loading: false, number: "", pay: async () => null },
    outstanding: 100,
    billUnsaved: false,
    rowsByAccount: new Map(),
    busy: false,
    get tileLock() {
      return lock();
    },
    amountMode: true,
    amountCents: 2000,
    problem: null,
    clientUnsaved: false,
    slotChange: null,
    visitCancelled: false,
    moneyRight: true,
  } as unknown as State;
  const appointment = {
    id: "apt-1",
    status: "scheduled",
    date: "2026-10-28",
    time_start: "10:00",
    total_amount: 100,
    payments: [],
    prepayments: [],
  };
  const props = {
    appointment,
    visit: { date: "2026-10-28", timeStart: "10:00", status: "scheduled" },
    pending: null,
    onPendingChange() {},
    onAppointmentChanged() {},
  } as unknown as Props;
  const account = { id: "acc-cash", name: "Cash", kind: "cash" };
  const actions: Actions = paymentActions(state, props);
  return { calls, settle, pending, tap: () => actions.handleTileTap(account as never) };
}

describe("плитка счёта: двойной тап", () => {
  test("два тапа до перерисовки — один платёж; после ответа плитка снова свободна", async () => {
    const ref = { current: false };
    const b = block(() => ref);
    b.tap();
    b.tap();
    expect(b.calls.length).toBe(1);
    expect(ref.current).toBe(true);
    b.settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ref.current).toBe(false);
  });

  test("без общего замка (как было) — два платежа с разными id", () => {
    // Замок, который ничего не помнит, — это прежний `busy` из рендера.
    const forgetful = {
      get current() {
        return false;
      },
      set current(_value: boolean) {},
    };
    const b = block(() => forgetful);
    b.tap();
    b.tap();
    expect(b.calls.length).toBe(2);
    expect(new Set(b.calls).size).toBe(2);
  });
});
