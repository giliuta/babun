// СНЯТИЕ ДЕНЕГ С ЖУРНАЛА — удаление операции, отмена оплаты записи, отмена
// перевода — не было покрыто ничем. Соседи по папке (счета, заявки, шаблоны,
// категории) стерегутся в write-confirmation.test.ts, а деньги — нет.
//
// Проверяется ровно то, что НЕ продублировано на сервере:
//   • отфильтрованный RLS DELETE/UPDATE возвращает ноль строк БЕЗ ошибки —
//     без проверки `!data` клиент отрапортует успех, а строка останется;
//   • текст отказа сервера у RPC-обёрток доходит до владельца, а не глотается
//     и не подменяется общей фразой.
import { describe, expect, it } from "bun:test";
import {
  deleteTransaction,
  deleteTransfer,
  resetAppointmentPayment,
  setAppointmentPrepayment,
  undoAppointmentPayment,
  updateTransaction,
} from "./finance-transactions";

const ROW_ID = "22222222-2222-4222-8222-222222222222";
const APPOINTMENT_ID = "44444444-4444-4444-8444-444444444444";

/** Запись прошла, но не задела ни одной строки: так выглядит отказ RLS. */
function noRowWriteSupabase() {
  return {
    from() {
      const builder = {
        update: () => builder,
        delete: () => builder,
        eq: () => builder,
        neq: () => builder,
        in: () => builder,
        is: () => builder,
        select: () => builder,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      return builder;
    },
  } as never;
}

function rpcSupabase(
  result: { error: { message: string } | null },
  calls?: Array<Record<string, unknown>>,
) {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      calls?.push({ name, ...args });
      return Promise.resolve({ data: null, ...result });
    },
  } as never;
}

describe("удаление денежной строки подтверждается сервером", () => {
  it("не считает успехом удаление, отфильтрованное RLS", async () => {
    await expect(
      deleteTransaction(noRowWriteSupabase(), ROW_ID),
    ).rejects.toThrow("Операция недоступна или связана с инвойсом");
  });

  it("не считает успехом правку, отфильтрованную RLS", async () => {
    await expect(
      updateTransaction(noRowWriteSupabase(), ROW_ID, { amount: 100 }),
    ).rejects.toThrow("Операция недоступна или связана с инвойсом");
  });
});

describe("отмена денег через серверные RPC", () => {
  it("отменяет оплату записи по её id", async () => {
    const calls: Array<Record<string, unknown>> = [];
    await undoAppointmentPayment(rpcSupabase({ error: null }, calls), APPOINTMENT_ID);

    expect(calls).toEqual([
      { name: "undo_appointment_payment", p_appointment_id: APPOINTMENT_ID },
    ]);
  });

  it("сбрасывает все чеки записи по её id", async () => {
    const calls: Array<Record<string, unknown>> = [];
    await resetAppointmentPayment(rpcSupabase({ error: null }, calls), APPOINTMENT_ID);

    expect(calls).toEqual([
      { name: "reset_appointment_payment", p_appointment_id: APPOINTMENT_ID },
    ]);
  });

  it("передаёт предоплату суммой и способом оплаты", async () => {
    const calls: Array<Record<string, unknown>> = [];
    await setAppointmentPrepayment(
      rpcSupabase({ error: null }, calls),
      APPOINTMENT_ID,
      50,
      "card",
    );

    expect(calls).toEqual([
      {
        name: "set_appointment_prepayment",
        p_appointment_id: APPOINTMENT_ID,
        p_amount: 50,
        p_payment_method: "card",
      },
    ]);
  });

  it("отменяет перевод по группе, а не по отдельной ноге", async () => {
    const calls: Array<Record<string, unknown>> = [];
    await deleteTransfer(rpcSupabase({ error: null }, calls), "group-1");

    expect(calls).toEqual([
      { name: "delete_account_transfer", p_transfer_group_id: "group-1" },
    ]);
  });

  it("доносит текст отказа сервера до владельца", async () => {
    const denied = rpcSupabase({ error: { message: "Счёт закрыт" } });

    await expect(
      undoAppointmentPayment(denied, APPOINTMENT_ID),
    ).rejects.toThrow("Счёт закрыт");
    await expect(
      resetAppointmentPayment(denied, APPOINTMENT_ID),
    ).rejects.toThrow("Счёт закрыт");
    await expect(
      setAppointmentPrepayment(denied, APPOINTMENT_ID, 50, null),
    ).rejects.toThrow("Счёт закрыт");
    await expect(
      deleteTransfer(denied, "group-1"),
    ).rejects.toThrow("Счёт закрыт");
  });

  it("подставляет свою фразу, когда сервер отказал молча", async () => {
    const mute = rpcSupabase({ error: { message: "" } });

    await expect(
      undoAppointmentPayment(mute, APPOINTMENT_ID),
    ).rejects.toThrow("Не удалось отменить оплату");
    await expect(
      setAppointmentPrepayment(mute, APPOINTMENT_ID, 50, null),
    ).rejects.toThrow("Не удалось изменить предоплату");
    await expect(
      deleteTransfer(mute, "group-1"),
    ).rejects.toThrow("Не удалось отменить перевод");
  });
});
