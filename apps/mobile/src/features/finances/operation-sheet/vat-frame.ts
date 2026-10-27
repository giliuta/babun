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

/** Текст поля суммы, с которым открывается правка. `vatRowAllowed` — этому
 *  человеку строка VAT вообще показывается (у операции с налогом она
 *  открывается сразу); нет — в поле валовая сумма, как на счёте. */
export function hydratedAmountText(tx: TxVatSnapshot, vatRowAllowed: boolean): string {
  if (!vatRowAllowed) return String(tx.amount);
  return String(inputFromGross(tx.amount, txVatMode(tx), Number(tx.vat_rate ?? 0)));
}

/** Сумма, которую правка шлёт на счёт. Поле суммы не трогали (то же число, что
 *  при открытии) и VAT не нажимали заново — сумма остаётся ровно прежней. Путь
 *  брутто → нетто → брутто при 19 % не обратим на копейке (100,05 → 84,08 →
 *  100,06): правка одной заметки молча сдвигала деньги на цент. */
export function editedGross(input: {
  tx: TxVatSnapshot;
  vatRowAllowed: boolean;
  amountNum: number;
  vatRetouched: boolean;
  recomputed: number;
}): number {
  const untouched =
    !input.vatRetouched && input.amountNum === Number(hydratedAmountText(input.tx, input.vatRowAllowed));
  return untouched ? input.tx.amount : input.recomputed;
}

/** Режим, по которому поле превращается в сумму на счёте. Строки не видно —
 *  поле уже валовое, налог сверху не прибавляется. Режим самой операции при
 *  этом не меняется: его форма отправляет отдельно (`vatModeForDraft`). */
export function amountVatMode(mode: TxVatMode, rowOnScreen: boolean): TxVatMode {
  return rowOnScreen ? mode : "none";
}
