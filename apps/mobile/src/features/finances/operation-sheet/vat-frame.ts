import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { inputFromGross, type TxVatMode } from "@babun/shared/local/finance/vat";

// ЧТО ЗНАЧИТ ЧИСЛО В ПОЛЕ СУММЫ — ЗАВИСИТ ОТ ТОГО, ВИДНА ЛИ СТРОКА VAT.
//
// Пока строка «Итого» с налогом на экране, поле — «как назначили цену»: при
// «налог сверху» это сумма без налога, а на счёт ложится она плюс налог (это
// видно в «К оплате»). Строки нет — человеку не показано, что к полю что-то
// прибавится, значит поле — ровно то, что лежит на счёте. Иначе партнёр видел
// бы при правке сумму без налога, набирал бы «настоящую», и сохранение
// прибавляло бы налог второй раз.

type TxVatSnapshot = Pick<FinanceTransaction, "amount" | "vat_mode" | "vat_amount" | "vat_rate">;

/** Режим налога строки — как его читает форма: у старых строк колонка пуста,
 *  и режим выводится из суммы налога (так же — `operationPatchBaseline`). */
export function txVatMode(tx: TxVatSnapshot): TxVatMode {
  return tx.vat_mode ?? (tx.vat_amount ? "inclusive" : "none");
}

/** Строка VAT на экране. Ставка 0 прячет клавиши у операции, где налог не
 *  открыт, — считать нечем. Открытую строку ставка не прячет: стёртое или
 *  нулевое поле ставки посреди набора убирало бы строку из-под пальца, а у
 *  старой операции с налогом есть своя ставка-снимок. */
export function vatRowVisible({
  isOwner,
  rate,
  vatShown,
}: {
  isOwner: boolean;
  rate: number;
  vatShown: boolean;
}): boolean {
  return isOwner && (rate > 0 || vatShown);
}

/** Текст поля суммы, с которым открывается правка. `vatRowAllowed` — этому
 *  человеку строка VAT вообще показывается (у операции с налогом она
 *  открывается сразу); нет — в поле валовая сумма, как на счёте. */
export function hydratedAmountText(tx: TxVatSnapshot, vatRowAllowed: boolean): string {
  if (!vatRowAllowed) return String(tx.amount);
  return String(inputFromGross(tx.amount, txVatMode(tx), Number(tx.vat_rate ?? 0)));
}

/** Режим, по которому поле превращается в сумму на счёте. Строки не видно —
 *  поле уже валовое, налог сверху не прибавляется. Режим самой операции при
 *  этом не меняется: его форма отправляет отдельно (`vatModeForDraft`). */
export function amountVatMode(mode: TxVatMode, rowOnScreen: boolean): TxVatMode {
  return rowOnScreen ? mode : "none";
}
