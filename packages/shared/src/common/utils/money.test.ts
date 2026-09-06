import { describe, expect, it } from "bun:test";
import {
  CURRENCIES,
  exactMoneyAmountToCents,
  formatEURExact,
  getDefaultCurrency,
  isMoneyCurrency,
  moneyName,
  setDefaultCurrency,
  formatMoneyForInput,
  formatSignedMoneyExact,
  MAX_MONEY_CENTS,
  money,
  moneySign,
  parseMoneyInputToCents,
} from "./money";

describe("exact money input", () => {
  it("accepts comma or dot cents without floating-point drift", () => {
    expect(parseMoneyInputToCents("12,34")).toBe(1234);
    expect(parseMoneyInputToCents("0.29")).toBe(29);
    expect(parseMoneyInputToCents("1 200,5")).toBe(120_050);
  });

  it("rejects coercion, excessive precision and numeric overflow", () => {
    expect(parseMoneyInputToCents("1.005")).toBeNull();
    expect(parseMoneyInputToCents("1e3")).toBeNull();
    expect(parseMoneyInputToCents("1,2.3")).toBeNull();
    expect(parseMoneyInputToCents("10000000000")).toBeNull();
    expect(parseMoneyInputToCents("0")).toBeNull();
  });

  it("supports explicit zero and negative account balances", () => {
    expect(parseMoneyInputToCents("0", { allowZero: true })).toBe(0);
    expect(
      parseMoneyInputToCents("-12,50", {
        allowNegative: true,
        allowZero: true,
      }),
    ).toBe(-1250);
  });

  // Ввод — это то, что человек скопировал с соседнего экрана: минус U+2212
  // и неразрывные пробелы туда ставит наш же форматтер.
  it("reads back everything the formatter prints", () => {
    expect(
      parseMoneyInputToCents("−12,50", { allowNegative: true }),
    ).toBe(-1250);
    expect(
      parseMoneyInputToCents("–12,50", { allowNegative: true }),
    ).toBe(-1250);
    expect(parseMoneyInputToCents("€1 200,50")).toBe(120_050);
    expect(parseMoneyInputToCents("₴1 200")).toBe(120_000);
    expect(parseMoneyInputToCents("1.234,56")).toBe(123_456);
  });

  it("validates programmatic amounts against numeric(12,2)", () => {
    expect(exactMoneyAmountToCents(10.05)).toBe(1005);
    expect(exactMoneyAmountToCents(1.005)).toBeNull();
    expect(exactMoneyAmountToCents(Number.POSITIVE_INFINITY)).toBeNull();
    expect(
      exactMoneyAmountToCents(MAX_MONEY_CENTS / 100),
    ).toBe(MAX_MONEY_CENTS);
  });
});

describe("money display", () => {
  it("renders ledger cents without rounding them to whole euros", () => {
    expect(formatEURExact(10.5)).toBe("€10,50");
    expect(formatEURExact(-1234.56)).toBe("−€1 234,56");
    expect(formatEURExact(10)).toBe("€10");
  });

  it("takes the symbol from the tenant currency", () => {
    expect(money(1234.5, "USD")).toBe("$1 234,50");
    expect(money(0, "UAH")).toBe("₴0");
    expect(money(-310, "GBP")).toBe("−£310");
    // Словарь знает злотый; многобуквенный символ отбит неразрывным пробелом.
    expect(money(1200, "PLN")).toBe("zł\u00a01\u00a0200");
    // Незнакомый код печатается кодом — чужой значок выдумывать нельзя.
    expect(money(1200, "XXX")).toBe("XXX\u00a01\u00a0200");
  });
});

describe("money sign", () => {
  // −0,004 печатается как «€0» — значит и красным он быть не может.
  it("judges by the cents that actually get printed", () => {
    expect(moneySign(-0.004)).toBe(0);
    expect(moneySign(0.004)).toBe(0);
    expect(moneySign(-0.006)).toBe(-1);
    expect(moneySign(3240)).toBe(1);
    expect(moneySign(Number.NaN)).toBe(0);
  });

  it("signs movements and leaves zero bare", () => {
    expect(formatSignedMoneyExact(3240)).toBe("+€3 240");
    expect(formatSignedMoneyExact(-310)).toBe("−€310");
    expect(formatSignedMoneyExact(0)).toBe("€0");
    expect(formatSignedMoneyExact(-0.004)).toBe("€0");
    expect(formatSignedMoneyExact(-310, "USD")).toBe("−$310");
  });
});

describe("money input value", () => {
  it("seeds a field with a plain editable number", () => {
    expect(formatMoneyForInput(1234.5)).toBe("1234,50");
    expect(formatMoneyForInput(0)).toBe("0,00");
    expect(formatMoneyForInput(-12.3)).toBe("−12,30");
  });
});

describe("валюта тенанта — реестр", () => {
  it("formatEUR* и money() без кода печатают валюту из реестра", () => {
    setDefaultCurrency("USD");
    expect(getDefaultCurrency()).toBe("USD");
    expect(money(1234.5)).toBe("$1\u00a0234,50");
    expect(formatEURExact(7)).toBe("$7");
    setDefaultCurrency("eur");
    expect(formatEURExact(7)).toBe("€7");
  });
  it("любой код словаря принимается; мусор и пустота — евро", () => {
    setDefaultCurrency("PLN");
    expect(getDefaultCurrency()).toBe("PLN");
    expect(money(5)).toBe("zł\u00a05");
    setDefaultCurrency("XXX");
    expect(getDefaultCurrency()).toBe("EUR");
    setDefaultCurrency(null);
    expect(getDefaultCurrency()).toBe("EUR");
  });
  it("словарь: ходовые пять и имена по-русски", () => {
    expect(CURRENCIES.map((c) => c.code)).toEqual(["EUR", "USD", "GBP", "UAH", "RUB"]);
    expect(isMoneyCurrency("gbp")).toBe(true);
    expect(isMoneyCurrency("pln")).toBe(true);
    expect(isMoneyCurrency("XXX")).toBe(false);
    expect(moneyName("UAH")).toBe("Гривна");
    expect(moneyName("XXX")).toBe("XXX");
  });
  it("парсер ввода выкидывает любой символ словаря, но не цифры суммы", () => {
    expect(parseMoneyInputToCents("zł 1 200,50")).toBe(120050);
    expect(parseMoneyInputToCents("₴ 99")).toBe(9900);
    expect(parseMoneyInputToCents("R$ 10")).toBe(1000);
  });
});
