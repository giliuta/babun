// Shared visual vocabulary of accounts: one icon and one label per kind,
// plus the masked-balance placeholder («глазик»). Every accounts surface
// (list, panel, sheets) imports from here — no local copies.

import {
  Banknote,
  CreditCard,
  Landmark,
  Wallet,
  type LucideIcon,
} from "lucide-react-native";
import type { AccountKind } from "@babun/shared/local/finance/account";
import type { AccountWithBalance } from "./accounts";

/** Цвет плитки по виду счёта. Цвет = смысл: наличные зелёные, карта синяя,
 *  банк индиго, прочее серое — строка узнаётся раньше, чем прочитана. */
export const KIND_TILE: Record<AccountKind, string> = {
  cash: "#1F7A44",
  card: "#2F6FD6",
  bank: "#5856D6",
  other: "#5B6678",
};

export const KIND_ICON: Record<AccountKind, LucideIcon> = {
  cash: Banknote,
  card: CreditCard,
  bank: Landmark,
  other: Wallet,
};

export const KINDS: { value: AccountKind; label: string }[] = [
  { value: "cash", label: "Наличные" },
  { value: "card", label: "Карта" },
  { value: "bank", label: "Банк" },
  { value: "other", label: "Другое" },
];

// Monospaced dots in the same tabular slot — the row must not jump when
// the balance is masked. Ink-coloured at the call site (never grey).
export const HIDDEN_BALANCE_LABEL = "••••";

// Aggregates never leak a hidden balance: Σ counts only visible accounts,
// the EyeOff marker tells the owner the number is partial.
export function visibleAccountsTotal(accounts: readonly AccountWithBalance[]): {
  total: number;
  hasHidden: boolean;
} {
  let total = 0;
  let hasHidden = false;
  for (const a of accounts) {
    if (a.balance_hidden) hasHidden = true;
    else total += a.balance;
  }
  return { total, hasHidden };
}
