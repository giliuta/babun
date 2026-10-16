import { describe, expect, it } from "bun:test";
import { setInvoiceLanguage } from "./invoices";

// ЯЗЫК БУМАГИ ЗАПИСАН, ТОЛЬКО ЕСЛИ СТРОКА ВЕРНУЛАСЬ С НИМ: политика строк на
// недоступный документ отвечает «0 обновлено» без ошибки.

function clientReturning(result: { data: unknown; error: { message: string } | null }) {
  const calls: { update?: unknown; selected?: string } = {};
  const builder = {
    update: (value: unknown) => {
      calls.update = value;
      return builder;
    },
    eq: () => builder,
    select: async (columns: string) => {
      calls.selected = columns;
      return result;
    },
  };
  return { supabase: { from: () => builder } as never, calls };
}

describe("setInvoiceLanguage", () => {
  it("читает строку после записи и принимает совпавший язык", async () => {
    const { supabase, calls } = clientReturning({ data: [{ id: "i-1", language: "en" }], error: null });
    await setInvoiceLanguage(supabase, "i-1", "en");
    expect(calls.update).toEqual({ language: "en" });
    expect(calls.selected).toContain("language");
  });

  it("ноль обновлённых строк — отказ, а не молчаливый успех", async () => {
    const { supabase } = clientReturning({ data: [], error: null });
    await expect(setInvoiceLanguage(supabase, "i-1", "en")).rejects.toThrow(/not writable/);
  });

  it("вернулся другой язык — отказ", async () => {
    const { supabase } = clientReturning({ data: [{ id: "i-1", language: "ru" }], error: null });
    await expect(setInvoiceLanguage(supabase, "i-1", "en")).rejects.toThrow(/not saved/);
  });

  it("ошибка базы пробрасывается", async () => {
    const { supabase } = clientReturning({ data: null, error: { message: "boom" } });
    await expect(setInvoiceLanguage(supabase, "i-1", "en")).rejects.toThrow(/boom/);
  });
});
