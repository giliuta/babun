import { describe, expect, it } from "bun:test";
import {
  accountKindForPaymentMethod,
  isPaymentAccountCompatible,
  transferValidationError,
  type TransferAccountSnapshot,
} from "./integrity";

const account = (
  id: string,
  overrides: Partial<TransferAccountSnapshot> = {},
): TransferAccountSnapshot => ({
  id,
  brigade_id: "team-a",
  balance: 100,
  is_active: true,
  ...overrides,
});

describe("transferValidationError", () => {
  it("accepts the exact available balance", () => {
    expect(transferValidationError(account("from"), account("to"), 100)).toBeNull();
  });

  it("rejects overdraft and invalid amounts", () => {
    expect(transferValidationError(account("from"), account("to"), 100.01)).toBe(
      "На исходном счёте недостаточно средств",
    );
    expect(transferValidationError(account("from"), account("to"), 0)).toBe(
      "Введите сумму больше нуля",
    );
    expect(transferValidationError(account("from"), account("to"), 1.005)).toBe(
      "Введите сумму больше нуля",
    );
  });

  it("rejects same-account and cross-team transfers", () => {
    const from = account("same");
    expect(transferValidationError(from, account("same"), 1)).toBe("Выберите разные счета");
    expect(
      transferValidationError(from, account("to", { brigade_id: "team-b" }), 1),
    ).toBe("Счета должны относиться к одной команде");
  });

  it("rejects inactive and missing accounts", () => {
    expect(transferValidationError(undefined, account("to"), 1)).toBe("Выберите оба счёта");
    expect(
      transferValidationError(account("from", { is_active: false }), account("to"), 1),
    ).toBe("Перевод доступен только между активными счетами");
  });
});

describe("payment account routing", () => {
  it("maps every payment method to one exact account kind", () => {
    expect(accountKindForPaymentMethod("cash")).toBe("cash");
    expect(accountKindForPaymentMethod("card")).toBe("card");
    expect(accountKindForPaymentMethod("transfer")).toBe("bank");
    expect(accountKindForPaymentMethod("other")).toBe("other");
  });

  it("rejects missing and stale method/account combinations", () => {
    expect(isPaymentAccountCompatible("cash", "cash")).toBe(true);
    expect(isPaymentAccountCompatible("transfer", "bank")).toBe(true);
    expect(isPaymentAccountCompatible("cash", "card")).toBe(false);
    expect(isPaymentAccountCompatible(null, "cash")).toBe(false);
    expect(isPaymentAccountCompatible("other", undefined)).toBe(false);
  });
});
