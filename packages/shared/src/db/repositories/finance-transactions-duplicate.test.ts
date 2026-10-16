// Повтор вставки с тем же request_id: тот же замысел — успех, другой — честная
// ошибка, а не тост «добавлена» про сумму, которой в базе нет.
import { describe, expect, it } from "bun:test";
import { insertTransaction } from "./finance-transactions";
import { REQUEST_ID_REUSED, sameLedgerContent } from "./finance-transactions/duplicate";

const ID = "55555555-5555-4555-8555-555555555555";

const stored = {
  id: ID,
  tenant_id: "t",
  type: "income",
  amount: 100,
  currency: "EUR",
  category_id: "c1",
  account_id: "a1",
  occurred_on: "2026-10-16",
  notes: null,
};

/** Вставка падает на дубле, чтение по id отдаёт уже записанную строку. */
function duplicateSupabase(row: Record<string, unknown>) {
  const answers = [
    { data: null, error: { code: "23505", message: "duplicate key" } },
    { data: row, error: null },
  ];
  return {
    from() {
      const builder = {
        insert: () => builder,
        select: () => builder,
        eq: () => builder,
        single: () => Promise.resolve(answers.shift()),
      };
      return builder;
    },
  } as never;
}

const draft = {
  type: "income" as const,
  amount: 100,
  category_id: "c1",
  account_id: "a1",
  occurred_on: "2026-10-16",
  business_today: "2026-10-16",
  request_id: ID,
};

describe("дубль request_id при вставке операции", () => {
  it("то же содержимое — успех, возвращается записанная строка", async () => {
    const tx = await insertTransaction(duplicateSupabase(stored), "t", draft);
    expect(tx.amount).toBe(100);
  });

  it("100 в базе, 120 в повторе — ошибка, а не молчаливый успех", async () => {
    await expect(
      insertTransaction(duplicateSupabase(stored), "t", { ...draft, amount: 120 }),
    ).rejects.toThrow(REQUEST_ID_REUSED);
  });
});

describe("сходство записанной строки с замыслом", () => {
  const tx = { ...stored, type: "income" as const };
  it("сверяются тип, сумма, счёт, категория, день и заметка", () => {
    expect(sameLedgerContent(tx, draft)).toBe(true);
    expect(sameLedgerContent(tx, { ...draft, account_id: "a2" })).toBe(false);
    expect(sameLedgerContent(tx, { ...draft, category_id: "c2" })).toBe(false);
    expect(sameLedgerContent(tx, { ...draft, occurred_on: "2026-10-15" })).toBe(false);
    expect(sameLedgerContent(tx, { ...draft, notes: "иначе" })).toBe(false);
    expect(sameLedgerContent(tx, { ...draft, type: "expense" })).toBe(false);
  });

  it("возврат хранится отрицательным и сравнивается по модулю, день не сверяется", () => {
    const refund = { ...stored, type: "refund" as const, amount: -40 };
    const d = { ...draft, type: "refund" as const, amount: -40, occurred_on: "2026-10-17" };
    expect(sameLedgerContent(refund, d)).toBe(true);
    expect(sameLedgerContent(refund, { ...d, amount: -50 })).toBe(false);
  });

  it("пробелы вокруг заметки — не отличие", () => {
    expect(sameLedgerContent({ ...tx, notes: " а " }, { ...draft, notes: "а" })).toBe(true);
  });
});
