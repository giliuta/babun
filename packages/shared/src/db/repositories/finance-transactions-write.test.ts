// СНЯТИЕ ДЕНЕГ С ЖУРНАЛА — удаление операции и отмена перевода — не было
// покрыто ничем. Соседи по папке (счета, заявки, шаблоны,
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
  updateTransaction,
} from "./finance-transactions";

const ROW_ID = "22222222-2222-4222-8222-222222222222";

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
  calls?: Record<string, unknown>[],
  data: unknown = null,
) {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      calls?.push({ name, ...args });
      return Promise.resolve({ data, ...result });
    },
  } as never;
}

describe("удаление денежной строки подтверждается сервером", () => {
  it("удаляет операцию в «Удалённые операции» серверной функцией", async () => {
    const calls: Record<string, unknown>[] = [];
    await deleteTransaction(rpcSupabase({ error: null }, calls, ROW_ID), ROW_ID);

    expect(calls).toEqual([{ name: "delete_operation", p_id: ROW_ID }]);
  });

  it("повтор удаления после потерянного ответа: строки уже нет — это успех", async () => {
    const notFound = { code: "P0002", message: "Операция недоступна или связана с инвойсом" };
    const supabase = {
      rpc: () => Promise.resolve({ data: null, error: notFound }),
      from() {
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        };
        return builder;
      },
    } as never;
    await expect(deleteTransaction(supabase, ROW_ID)).resolves.toBeUndefined();
  });

  it("«не найдена», но строка на месте (инвойс) — отказ остаётся отказом", async () => {
    const notFound = { code: "P0002", message: "Операция недоступна или связана с инвойсом" };
    const supabase = {
      rpc: () => Promise.resolve({ data: null, error: notFound }),
      from() {
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: () => Promise.resolve({ data: { id: ROW_ID }, error: null }),
        };
        return builder;
      },
    } as never;
    await expect(deleteTransaction(supabase, ROW_ID)).rejects.toThrow(
      "Операция недоступна или связана с инвойсом",
    );
  });

  it("не считает успехом удаление без ответа сервера", async () => {
    await expect(
      deleteTransaction(rpcSupabase({ error: null }), ROW_ID),
    ).rejects.toThrow("Операция недоступна или связана с инвойсом");
    await expect(
      deleteTransaction(rpcSupabase({ error: { message: "Нет доступа" } }), ROW_ID),
    ).rejects.toThrow("Нет доступа");
  });

  it("правка строки, которой уже нет, говорит, что её удалили", async () => {
    await expect(
      updateTransaction(noRowWriteSupabase(), ROW_ID, { amount: 100 }),
    ).rejects.toThrow("Операцию уже удалили на другом устройстве");
  });

  it("не считает успехом правку, отфильтрованную RLS, если строка на месте", async () => {
    const reads = [null, { id: ROW_ID }];
    const supabase = {
      from() {
        const builder = {
          update: () => builder,
          eq: () => builder,
          in: () => builder,
          is: () => builder,
          select: () => builder,
          maybeSingle: () =>
            Promise.resolve({ data: reads.shift() ?? null, error: null }),
        };
        return builder;
      },
    } as never;
    await expect(updateTransaction(supabase, ROW_ID, { amount: 100 })).rejects.toThrow(
      "Операция недоступна или связана с инвойсом",
    );
  });

  it("не знает, есть ли строка (чтение упало), — не объявляет её удалённой", async () => {
    const answers = [
      { data: null, error: null },
      { data: null, error: { message: "Network request failed" } },
    ];
    const supabase = {
      from() {
        const builder = {
          update: () => builder,
          eq: () => builder,
          in: () => builder,
          is: () => builder,
          select: () => builder,
          maybeSingle: () => Promise.resolve(answers.shift()),
        };
        return builder;
      },
    } as never;
    await expect(updateTransaction(supabase, ROW_ID, { amount: 100 })).rejects.toThrow(
      "Операция недоступна или связана с инвойсом",
    );
  });
});

describe("отмена денег через серверные RPC", () => {
  it("отменяет перевод по группе, а не по отдельной ноге", async () => {
    const calls: Record<string, unknown>[] = [];
    await deleteTransfer(rpcSupabase({ error: null }, calls), "group-1");

    expect(calls).toEqual([
      { name: "delete_account_transfer", p_transfer_group_id: "group-1" },
    ]);
  });

  it("доносит текст отказа сервера до владельца", async () => {
    const denied = rpcSupabase({ error: { message: "Счёт закрыт" } });

    await expect(
      deleteTransfer(denied, "group-1"),
    ).rejects.toThrow("Счёт закрыт");
  });

  it("подставляет свою фразу, когда сервер отказал молча", async () => {
    const mute = rpcSupabase({ error: { message: "" } });

    await expect(
      deleteTransfer(mute, "group-1"),
    ).rejects.toThrow("Не удалось отменить перевод");
  });
});
