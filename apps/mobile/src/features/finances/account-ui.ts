// Shared visual vocabulary of accounts: the fallback glyph per kind and the
// picker label. The kind itself is never shown or asked any more — it follows
// the icon (`account-kind.ts`). Every accounts surface imports from here.

import {
  Banknote,
  CreditCard,
  Landmark,
  Wallet,
  type LucideIcon,
} from "lucide-react-native";
import { iconPreset } from "@/components/ui/icon-set";
import type { Account, AccountKind } from "@babun/shared/local/finance/account";
import type { AccountWithBalance } from "./accounts";

// Глиф по ВИДУ счёта — фолбэк для тех, у кого значок не выбран.
export const KIND_ICON: Record<AccountKind, LucideIcon> = {
  cash: Banknote,
  card: CreditCard,
  bank: Landmark,
  other: Wallet,
};

/** Глиф счёта: выбранный человеком либо, если он молчит, по виду счёта.
 *
 *  Свои пятнадцать значков у счетов кончились 2026-08-17: словарь ОБЩИЙ НА
 *  ПРОДУКТ (`ICON_PRESETS`, сорок штук), и все прежние слаги (`cash`, `safe`,
 *  `handcoins`…) стоят в нём первой восьмёркой «деньги» — сохранённый выбор
 *  тенанта не поехал. Старые значения-эмодзи из веб-мастера слагами не
 *  являются и потому ведут себя как «не выбран»: выдумывать по ним значок
 *  нечестно. */
export function accountIcon(
  account: Pick<Account, "icon" | "kind">,
): LucideIcon {
  return iconPreset(account.icon) ?? KIND_ICON[account.kind];
}

/**
 * Подпись счёта в ПИКЕРЕ ОПЛАТЫ (операция, оплата инвойса) — голое имя.
 *
 * Дописка «· Юра, Аня» жила здесь, пока существовал счёт нескольких команд:
 * его надо было отличать от одноимённой кассы самой команды. Счёт принадлежит
 * одной команде (владелец 2026-08-15), а пикер и так показывает счета ТОЛЬКО
 * выбранной команды — различать не с чем.
 */
export function accountPickerLabel(
  account: Pick<AccountWithBalance, "name">,
): string {
  return account.name;
}

// СКРЫТЫХ БАЛАНСОВ В ПРОДУКТЕ НЕТ. Владелец 2026-08-10: «этот перечёркнутый
// глаз на хрен не нужен, мы скрывать ничего не будем». Итог всегда полный —
// цифра, которая иногда неполная и говорит об этом значком, хуже отсутствия
// цифры: её всё равно читают как «всего».
export function accountsTotal(accounts: readonly AccountWithBalance[]): number {
  let total = 0;
  for (const a of accounts) total += a.balance;
  return total;
}

