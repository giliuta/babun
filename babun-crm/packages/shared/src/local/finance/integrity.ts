import type { AccountKind, AccountScope } from "./account";
import type { PaymentMethod } from "./transaction";
import { exactMoneyAmountToCents } from "../../common/utils/money";

const ACCOUNT_KIND_BY_PAYMENT_METHOD: Record<PaymentMethod, AccountKind> = {
  cash: "cash",
  card: "card",
  transfer: "bank",
  other: "other",
};

const PAYMENT_METHOD_BY_ACCOUNT_KIND: Record<AccountKind, PaymentMethod> = {
  cash: "cash",
  card: "card",
  bank: "transfer",
  other: "other",
};

/** Canonical routing shared by finance forms and the database trigger. */
export function accountKindForPaymentMethod(method: PaymentMethod): AccountKind {
  return ACCOUNT_KIND_BY_PAYMENT_METHOD[method];
}

/** Inverse of {@link accountKindForPaymentMethod}: tap an account → method. */
export function paymentMethodForAccountKind(kind: AccountKind): PaymentMethod {
  return PAYMENT_METHOD_BY_ACCOUNT_KIND[kind];
}

export function isPaymentAccountCompatible(
  method: PaymentMethod | null | undefined,
  kind: AccountKind | null | undefined,
): boolean {
  return !!method && !!kind && accountKindForPaymentMethod(method) === kind;
}

/** Client-side mirror of the server's `account_serves_team()`. */
export function accountServesTeam(
  account: Pick<
    { scope: AccountScope; brigade_id: string | null; team_ids: string[] },
    "scope" | "brigade_id" | "team_ids"
  >,
  teamId: string,
): boolean {
  if (account.scope === "team") return account.brigade_id === teamId;
  return account.team_ids.includes(teamId);
}

export interface TransferAccountSnapshot {
  id: string;
  scope: AccountScope;
  brigade_id: string | null;
  balance: number;
  is_active: boolean;
}

/**
 * Client-side mirror of the RPC's user-facing transfer checks. The database
 * remains authoritative; this only keeps an invalid form from being sent.
 * team↔company and company↔company are legal; a direct team-A↔team-B
 * transfer must route through a company account so per-team attribution
 * stays honest.
 */
export function transferValidationError(
  from: TransferAccountSnapshot | null | undefined,
  to: TransferAccountSnapshot | null | undefined,
  amount: number,
): string | null {
  if (!from || !to) return "Выберите оба счёта";
  if (!from.is_active || !to.is_active) return "Перевод доступен только между активными счетами";
  if (from.id === to.id) return "Выберите разные счета";
  if (
    from.scope === "team"
    && to.scope === "team"
    && from.brigade_id !== to.brigade_id
  ) {
    return "Перевод между командами идёт через счёт компании";
  }
  if (exactMoneyAmountToCents(amount) == null) return "Введите сумму больше нуля";
  if (amount > from.balance + 0.000001) return "На исходном счёте недостаточно средств";
  return null;
}
