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

// СКРЫТЫХ БАЛАНСОВ В ПРОДУКТЕ НЕТ. Владелец 2026-08-10: «этот перечёркнутый
// глаз на хрен не нужен, мы скрывать ничего не будем». Итог всегда полный —
// цифра, которая иногда неполная и говорит об этом значком, хуже отсутствия
// цифры: её всё равно читают как «всего».
export function accountsTotal(accounts: readonly AccountWithBalance[]): number {
  let total = 0;
  for (const a of accounts) total += a.balance;
  return total;
}
