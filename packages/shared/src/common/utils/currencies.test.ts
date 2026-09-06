import { describe, expect, it } from "bun:test";
import {
  ALL_CURRENCIES,
  currencyDef,
  currencyWheelOrder,
  searchCurrencies,
} from "./currencies";

describe("словарь валют", () => {
  it("коды уникальны, трёхбуквенные, у каждой есть имя и символ", () => {
    const codes = ALL_CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of ALL_CURRENCIES) {
      expect(c.code).toMatch(/^[A-Z]{3}$/);
      expect(c.name.length).toBeGreaterThan(1);
      expect(c.symbol.length).toBeGreaterThan(0);
    }
    expect(codes.length).toBeGreaterThan(140);
  });
  it("барабан: ходовые первыми, дальше по алфавиту", () => {
    const order = currencyWheelOrder();
    expect(order.slice(0, 3).map((c) => c.code)).toEqual(["EUR", "USD", "GBP"]);
    expect(order.length).toBe(ALL_CURRENCIES.length);
  });
  it("поиск: имя, код, символ; начало слова первым", () => {
    expect(searchCurrencies("грив")[0]?.code).toBe("UAH");
    expect(searchCurrencies("pln")[0]?.code).toBe("PLN");
    expect(searchCurrencies("₺")[0]?.code).toBe("TRY");
    expect(searchCurrencies("доллар")[0]?.name.toLowerCase().startsWith("доллар")).toBe(true);
    expect(searchCurrencies("")).toEqual([]);
    expect(currencyDef("eur")?.symbol).toBe("€");
  });
});
