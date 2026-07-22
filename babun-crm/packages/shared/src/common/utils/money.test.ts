import { describe, expect, it } from "bun:test";
import {
  exactMoneyAmountToCents,
  formatEURExact,
  MAX_MONEY_CENTS,
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

  it("validates programmatic amounts against numeric(12,2)", () => {
    expect(exactMoneyAmountToCents(10.05)).toBe(1005);
    expect(exactMoneyAmountToCents(1.005)).toBeNull();
    expect(exactMoneyAmountToCents(Number.POSITIVE_INFINITY)).toBeNull();
    expect(
      exactMoneyAmountToCents(MAX_MONEY_CENTS / 100),
    ).toBe(MAX_MONEY_CENTS);
  });

  it("renders ledger cents without rounding them to whole euros", () => {
    expect(formatEURExact(10.5)).toBe("€10,50");
    expect(formatEURExact(-1234.56)).toBe("−€1\u00a0234,56");
    expect(formatEURExact(10)).toBe("€10");
  });
});
