import { describe, expect, it } from "bun:test";
import {
  accountKindForPaymentMethod,
  accountServesTeam,
  isPaymentAccountCompatible,
  paymentMethodForAccountKind,
  transferValidationError,
  type TransferAccountSnapshot,
} from "./integrity";
import type { AccountKind } from "./account";
import type { PaymentMethod } from "./transaction";

const account = (
  id: string,
  overrides: Partial<TransferAccountSnapshot> = {},
): TransferAccountSnapshot => ({
  id,
  scope: "team",
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

  it("rejects only a transfer into the same account", () => {
    const from = account("same");
    expect(transferValidationError(from, account("same"), 1)).toBe("Выберите разные счета");
  });

  // ЗАПРЕТ «МЕЖДУ БРИГАДАМИ ТОЛЬКО ЧЕРЕЗ ОБЩИЙ СЧЁТ» СНЯТ (владелец
  // 2026-08-15): он существовал ради общего счёта, а того в продукте нет.
  it("allows a direct transfer between two brigades", () => {
    expect(
      transferValidationError(
        account("from"),
        account("to", { brigade_id: "team-b" }),
        1,
      ),
    ).toBeNull();
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

  it("kind↔method is a bijection", () => {
    const kinds: AccountKind[] = ["cash", "card", "bank", "other"];
    for (const kind of kinds) {
      expect(accountKindForPaymentMethod(paymentMethodForAccountKind(kind))).toBe(kind);
    }
    const methods: PaymentMethod[] = ["cash", "card", "transfer", "other"];
    for (const method of methods) {
      expect(paymentMethodForAccountKind(accountKindForPaymentMethod(method))).toBe(method);
    }
  });

  it("rejects missing and stale method/account combinations", () => {
    expect(isPaymentAccountCompatible("cash", "cash")).toBe(true);
    expect(isPaymentAccountCompatible("transfer", "bank")).toBe(true);
    expect(isPaymentAccountCompatible("cash", "card")).toBe(false);
    expect(isPaymentAccountCompatible(null, "cash")).toBe(false);
    expect(isPaymentAccountCompatible("other", undefined)).toBe(false);
  });
});

describe("accountServesTeam", () => {
  it("team account serves only its own brigade", () => {
    const own = { brigade_id: "team-a" };
    expect(accountServesTeam(own, "team-a")).toBe(true);
    expect(accountServesTeam(own, "team-b")).toBe(false);
  });

  // Счёт без команды — наследие общего счёта. Ничьим он и остаётся: приписать
  // его команде значило бы отдать ей чужие деньги.
  it("an account without a brigade serves nobody", () => {
    expect(accountServesTeam({ brigade_id: null }, "team-a")).toBe(false);
  });
});
