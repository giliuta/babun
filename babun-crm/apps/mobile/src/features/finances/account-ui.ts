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
import { iconPreset } from "@/components/ui/icon-set";
import type { Account, AccountKind } from "@babun/shared/local/finance/account";
import { brigadeTitle } from "./accounts-sections";
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

export const KINDS: { value: AccountKind; label: string }[] = [
  { value: "cash", label: "Наличные" },
  { value: "card", label: "Карта" },
  { value: "bank", label: "Банк" },
  { value: "other", label: "Другое" },
];

/**
 * Подпись счёта одной строкой: «Наличные · Команда Юра». Ею подписан герой
 * карточки и лист пересчёта — счёт обязан называться одинаково там, где на
 * него смотрят, и там, где его пересчитывают.
 *
 * `teamName` отдаёт голое имя команды по её id либо `null`, если такой строки
 * в справочнике нет вовсе; «Команду» приписывает сама подпись — одним общим
 * `brigadeTitle`.
 */
export function accountSubtitle(
  account: Pick<AccountWithBalance, "kind" | "brigade_id">,
  teamName: (teamId: string) => string | null,
): string {
  const kind = KINDS.find((k) => k.value === account.kind)?.label ?? "";
  const own = account.brigade_id ? teamName(account.brigade_id) : null;
  // Команды нет вовсе — счёт остался от старой схемы «общего счёта». Молчать
  // об этом нельзя: деньги на нём настоящие, а хозяина у них нет.
  const owner = account.brigade_id
    ? own
      ? brigadeTitle(own)
      : "Команда удалена"
    : "Без команды";
  return `${kind} · ${owner}`;
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

