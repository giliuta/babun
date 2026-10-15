import type { Discount } from "@babun/shared/local/appointments";
import { applyTxVat, round2, type TxVatMode } from "@babun/shared/local/finance/vat";
import { parseMoneyInput } from "@/features/appointments/helpers";

// Money of the booking form: discount, VAT and the amount due.

// СКИДКА ЕСТЬ, ЕСЛИ ВПИСАНО ЧИСЛО (поле всегда с нулём, блока «без скидки» нет; вписали
// скидку — выбирают валюту или процент). Тип — это ЕДИНИЦА вписанного, а не признак
// существования: ноль остаётся нулём хоть в евро, хоть в процентах.
export function typedDiscount(
  discountType: Discount["type"] | null,
  discountValue: string,
  discountReason: string | null,
): Discount | null {
  const value = parseMoneyInput(discountValue);
  if (!value) return null;
  return {
    type: discountType ?? "fixed",
    value,
    reason: discountReason ?? undefined,
  };
}

export interface RecordTotalsInput {
  computedTotal: number;
  discountAmount: number;
  recordVatMode: TxVatMode;
  vatRateInUse: number;
  customTotal: boolean;
  totalDraft: string;
}

export interface RecordTotals {
  beforeVat: number;
  automaticTotal: number;
  effectiveTotal: number;
}

export function recordTotals({
  computedTotal,
  discountAmount,
  recordVatMode,
  vatRateInUse,
  customTotal,
  totalDraft,
}: RecordTotalsInput): RecordTotals {
  /** Услуги минус скидка — то, с чего считается налог. До цента: сумма
   *  float-ов (10,01 + 12,50 = 22.509999…, 16 € − 7 % = 14.879999…) уходила
   *  на сервер с хвостом, и он отказывал «Укажите не больше двух знаков после
   *  запятой». */
  const beforeVat = round2(Math.max(0, computedTotal - discountAmount));
  // «К оплате» — после налога. Ставка 0 и «без налога» — та же сумма.
  const automaticTotal =
    recordVatMode !== "none" && vatRateInUse > 0
      ? round2(applyTxVat(beforeVat, recordVatMode, vatRateInUse).gross)
      : beforeVat;
  const effectiveTotal = round2(customTotal ? parseMoneyInput(totalDraft) : automaticTotal);
  return { beforeVat, automaticTotal, effectiveTotal };
}

/** Text of the editable total while it follows the services. Копейки не
 *  отбрасываем: «49.5» в поле рядом с «€49,50» в строке услуги читались как
 *  две разные суммы за одну работу. */
export function totalDraftText(automaticTotal: number): string {
  return Number.isInteger(automaticTotal)
    ? String(automaticTotal)
    : automaticTotal.toFixed(2);
}
