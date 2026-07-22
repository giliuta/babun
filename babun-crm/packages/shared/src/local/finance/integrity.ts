import type { AccountKind } from "./account";
import type { PaymentMethod } from "./transaction";
import { exactMoneyAmountToCents } from "../../common/utils/money";

const ACCOUNT_KIND_BY_PAYMENT_METHOD: Record<PaymentMethod, AccountKind> = {
  cash: "cash",
  card: "card",
  transfer: "bank",
  other: "other",
};

/** Canonical routing shared by finance forms and the database trigger. */
export function accountKindForPaymentMethod(method: PaymentMethod): AccountKind {
  return ACCOUNT_KIND_BY_PAYMENT_METHOD[method];
}

export function isPaymentAccountCompatible(
  method: PaymentMethod | null | undefined,
  kind: AccountKind | null | undefined,
): boolean {
  return !!method && !!kind && accountKindForPaymentMethod(method) === kind;
}

export interface TransferAccountSnapshot {
  id: string;
  brigade_id: string;
  balance: number;
  is_active: boolean;
}

/**
 * Client-side mirror of the RPC's user-facing transfer checks. The database
 * remains authoritative; this only keeps an invalid form from being sent.
 */
export function transferValidationError(
  from: TransferAccountSnapshot | null | undefined,
  to: TransferAccountSnapshot | null | undefined,
  amount: number,
): string | null {
  if (!from || !to) return "Выберите оба счёта";
  if (!from.is_active || !to.is_active) return "Перевод доступен только между активными счетами";
  if (from.id === to.id) return "Выберите разные счета";
  if (from.brigade_id !== to.brigade_id) {
    return "Счета должны относиться к одной команде";
  }
  if (exactMoneyAmountToCents(amount) == null) return "Введите сумму больше нуля";
  if (amount > from.balance + 0.000001) return "На исходном счёте недостаточно средств";
  return null;
}
