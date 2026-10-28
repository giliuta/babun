import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import {
  PAYMENT_METHOD_LABEL,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import {
  accountDisplayName,
  type Account,
} from "@babun/shared/local/finance/account";
import { humanDay } from "@/features/appointments/helpers";
import { payeeName } from "../category-asks";

interface TransferLegs {
  from: Account;
  to: Account;
}

/** Обе ноги перевода, когда вторая нашлась; иначе — `null`. */
export function transferLegsOf(
  tx: Pick<FinanceTransaction, "type" | "amount">,
  account: Account | undefined,
  counterpartAccount: Account | undefined,
): TransferLegs | null {
  return tx.type === "transfer" && account && counterpartAccount
    ? {
        // Своя нога подписана знаком: минус — деньги ушли отсюда.
        from: tx.amount < 0 ? account : counterpartAccount,
        to: tx.amount < 0 ? counterpartAccount : account,
      }
    : null;
}

interface MetaRowData {
  label: string;
  value: string;
}

// ФАКТЫ ОПЕРАЦИИ ОДНИМ СПИСКОМ. Собираются массивом, а не россыпью JSX,
// ровно ради одного: шов рисуется между строками, и первая обязана знать,
// что она первая, — какие именно строки существуют, зависит от операции.
export function popupMetaRows({
  tx,
  category,
  people,
  transferLegs,
  account,
  team,
  teams,
  isAppointmentLedger,
  alreadyRefunded,
  refundRemainingCents,
}: {
  tx: FinanceTransaction;
  category: { name: string } | undefined;
  people: readonly { id: string; full_name: string }[] | undefined;
  transferLegs: TransferLegs | null;
  account: Account | undefined;
  team: { name: string } | undefined;
  teams: readonly { id: string; name: string }[];
  isAppointmentLedger: boolean;
  alreadyRefunded: number;
  refundRemainingCents: number;
}): MetaRowData[] {
  // Полные имена ног перевода («Наличка · Команда 2»): команды у сторон
  // разные, и без владельца строки «Откуда/Куда» не отвечают на главный
  // вопрос перевода. Корреспондент, выпавший из справочника (закрытый счёт
  // не приехал в пропсы), честно оставляет попап на старой строке «Счёт».
  const ownerName = (a: Account): string | undefined =>
    (a.brigade_id && teams.find((x) => x.id === a.brigade_id)?.name) ||
    undefined;
  const metaRows: MetaRowData[] = [
    { label: "Дата", value: humanDay(tx.occurred_on) },
  ];
  if (category) metaRows.push({ label: "Категория", value: category.name });
  const payee = payeeName(people, tx.master_id);
  if (payee) metaRows.push({ label: "Кому", value: payee });
  // Перевод отвечает «откуда и куда ушли деньги» обеими ногами; пока вторая
  // не найдена — обычная строка «Счёт».
  if (transferLegs) {
    // ВЛАДЕЛЕЦ У ИМЕНИ — ТОЛЬКО КОГДА КОМАНДЫ СТОРОН РАЗНЫЕ:
    // «Наличные · Y&D», «Карта · Y&D» и строкой ниже «Команда
    // Y&D» — одно слово трижды. Та же мера, что в листе перевода
    // (`transferSpansTeams`).
    const acrossTeams =
      transferLegs.from.brigade_id !== transferLegs.to.brigade_id;
    const legName = (a: Account) =>
      acrossTeams ? accountDisplayName(a, ownerName(a)) : a.name;
    metaRows.push({ label: "Откуда", value: legName(transferLegs.from) });
    metaRows.push({ label: "Куда", value: legName(transferLegs.to) });
  } else if (account) {
    metaRows.push({ label: "Счёт", value: account.name });
  }
  if (team) metaRows.push({ label: "Команда", value: team.name });
  if (tx.payment_method) {
    metaRows.push({
      label: "Способ оплаты",
      value: PAYMENT_METHOD_LABEL[tx.payment_method] ?? tx.payment_method,
    });
  }
  // Снимок налога, если он есть: до этой строки ставку операции было негде
  // увидеть, кроме формы правки (а у auto-строк — нигде). Нулевой снимок — не
  // налог, а его отсутствие.
  if (tx.vat_amount != null && tx.vat_amount !== 0) {
    metaRows.push({
      label: "VAT",
      value: `в т.ч. ${formatEUR(Math.abs(tx.vat_amount))}${
        tx.vat_rate != null ? ` (${tx.vat_rate}%)` : ""
      }`,
    });
  }
  if (tx.source === "auto") {
    metaRows.push({ label: "Источник", value: "Автоматически (из записи)" });
  }
  if (isAppointmentLedger) {
    metaRows.push({ label: "Изменение", value: "Через связанную запись" });
  }
  if (Number.isFinite(alreadyRefunded) && alreadyRefunded > 0) {
    metaRows.push({
      label: "Уже возвращено",
      value:
        refundRemainingCents === 0
          ? `${formatEUR(alreadyRefunded)} · полностью`
          : formatEUR(alreadyRefunded),
    });
  }
  return metaRows;
}
