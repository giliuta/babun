import { describe, expect, test } from "bun:test";
import { insertAccount, softCloseAccount, updateAccount } from "./accounts";
import { deleteAppointment } from "./appointments";
import { deletePhoto } from "./appointment-photos";
import {
  deleteFinanceTemplate,
  insertFinanceTemplate,
  updateFinanceTemplate,
} from "./finance-templates";
import {
  deleteFinanceCategory,
  updateFinanceCategory,
} from "./finance-categories";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ROW_ID = "22222222-2222-4222-8222-222222222222";

function noRowWriteSupabase() {
  return {
    from() {
      const builder = {
        update() {
          return builder;
        },
        delete() {
          return builder;
        },
        eq() {
          return builder;
        },
        select() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
}

describe("repository write confirmation", () => {
  test("account updates reject an RLS-filtered zero-row write", async () => {
    const supabase = noRowWriteSupabase();
    await expect(
      updateAccount(supabase as never, ROW_ID, { name: "Касса" }),
    ).rejects.toThrow("не найден или недоступен");
    await expect(
      softCloseAccount(supabase as never, ROW_ID),
    ).rejects.toThrow("не найден или недоступен");
  });

  test("appointment deletion rejects an RLS-filtered zero-row write", async () => {
    await expect(
      deleteAppointment(noRowWriteSupabase() as never, ROW_ID, TENANT),
    ).rejects.toThrow("заявка не найдена или недоступна");
  });

  test("template writes reject an RLS-filtered zero-row success", async () => {
    const supabase = noRowWriteSupabase();
    await expect(
      updateFinanceTemplate(supabase as never, ROW_ID, { name: "Аренда" }),
    ).rejects.toThrow("не найден или недоступен");
    await expect(
      deleteFinanceTemplate(supabase as never, ROW_ID),
    ).rejects.toThrow("не найден или недоступен");
  });

  test("category writes reject an RLS-filtered zero-row success", async () => {
    const supabase = noRowWriteSupabase();
    await expect(
      updateFinanceCategory(supabase as never, ROW_ID, { name: "Бензин" }),
    ).rejects.toThrow("не найдена или недоступна");
    await expect(
      deleteFinanceCategory(supabase as never, ROW_ID),
    ).rejects.toThrow("не найдена или недоступна");
  });

  test("money repositories reject silent three-decimal rounding", async () => {
    const noDatabase = {
      from() {
        throw new Error("database should not be called");
      },
    };
    await expect(
      insertAccount(noDatabase as never, TENANT, {
        brigade_id: "team-1",
        name: "Касса",
        kind: "cash",
        opening_balance: 1.005,
      }),
    ).rejects.toThrow("двух знаков");
    await expect(
      insertFinanceTemplate(noDatabase as never, TENANT, {
        name: "Аренда",
        kind: "expense",
        amount: 1.005,
      }),
    ).rejects.toThrow("двух знаков");
  });

  test("photo deletion removes only the storage path returned by DELETE", async () => {
    const removed: string[][] = [];
    const builder = {
      delete() {
        return builder;
      },
      eq() {
        return builder;
      },
      select() {
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({
          data: { id: ROW_ID, storage_path: `${TENANT}/appointment/canonical.jpg` },
          error: null,
        });
      },
    };
    const supabase = {
      from() {
        return builder;
      },
      storage: {
        from() {
          return {
            remove(paths: string[]) {
              removed.push(paths);
              return Promise.resolve({ data: [], error: null });
            },
          };
        },
      },
    };

    await deletePhoto(supabase as never, {
      id: ROW_ID,
      storage_path: `${TENANT}/appointment/stale-or-wrong.jpg`,
    });

    expect(removed).toEqual([[`${TENANT}/appointment/canonical.jpg`]]);
  });
});
