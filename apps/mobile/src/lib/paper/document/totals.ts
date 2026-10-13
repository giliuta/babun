// The totals block: subtotal, discount, VAT and the grand total.

import type { InvoiceDictionary } from "../dictionary";
import { formatPercent, paperMoney } from "./paper-text";
import type { DocumentTotal } from "./types";

/** Сумма услуг и скидка документа: скидка — строки с минусом. */
export function splitDiscount(lineTotals: readonly number[]): { services: number; amount: number } | null {
  const discount = lineTotals.filter((total) => total < 0).reduce((sum, total) => sum - total, 0);
  if (discount <= 0) return null;
  const services = lineTotals.filter((total) => total >= 0).reduce((sum, total) => sum + total, 0);
  return { services: Math.round(services * 100) / 100, amount: Math.round(discount * 100) / 100 };
}

export function totalRows(input: {
  dict: InvoiceDictionary;
  currency: string;
  subtotalNet: number;
  vatAmount: number;
  vatPercent: number;
  vatMode: "off" | "inclusive" | "exclusive";
  total: number;
  discount?: { services: number; amount: number } | null;
}): DocumentTotal[] {
  // СО СКИДКОЙ: «Subtotal» — сумма услуг, «Discount» — минусом, дальше
  // налог и итог, как в «Итого» записи (скидка, потом VAT). Четыре строки,
  // не пять: база налога «сверху» — в строке налога («VAT 19% on €110.00»),
  // владелец 2026-09-22: «очень много разных сумм, человек запутается».
  if (input.discount) {
    const { dict, discount } = input;
    const money = (value: number) => paperMoney(value, input.currency, dict.locale);
    const hasVat = input.vatMode !== "off" && input.vatAmount !== 0;
    const vatLabel =
      input.vatMode === "inclusive" ? dict.vatInclusive : dict.vatExclusive;
    return [
      { label: dict.subtotal, value: money(discount.services) },
      { label: dict.discount, value: money(-discount.amount) },
      ...(hasVat
        ? [
            {
              label:
                `${vatLabel} ${formatPercent(input.vatPercent, dict.locale)}` +
                (input.vatMode === "exclusive"
                  ? ` ${dict.vatOn(money(input.subtotalNet))}`
                  : ""),
              value: money(input.vatAmount),
            },
          ]
        : []),
      { label: dict.grandTotal, value: money(input.total), grand: true },
    ];
  }
  // Документ БЕЗ НАЛОГА не должен говорить о налоге дважды («Без НДС» и снова
  // «Без НДС · €0») — это выглядело как ошибка счёта. Строка налога появляется
  // только там, где налог есть.
  // НАЛОГ С МИНУСОМ — ТОЖЕ НАЛОГ: у кредит-ноты он отрицательный, и проверка
  // «≤ 0» прятала строку VAT, оставляя «Subtotal −€84.03 / Total −€100.00».
  if (input.vatMode === "off" || input.vatAmount === 0) {
    const { dict } = input;
    return [
      {
        label: dict.subtotal,
        value: paperMoney(input.subtotalNet, input.currency, dict.locale),
      },
      {
        label: dict.grandTotal,
        value: paperMoney(input.total, input.currency, dict.locale),
        grand: true,
      },
    ];
  }
  const { dict } = input;
  const vatLabel =
    input.vatMode === "inclusive" ? dict.vatInclusive : dict.vatExclusive;
  return [
    {
      label: dict.netAmount,
      value: paperMoney(input.subtotalNet, input.currency, dict.locale),
    },
    {
      label: `${vatLabel} ${formatPercent(input.vatPercent, dict.locale)}`,
      value: paperMoney(input.vatAmount, input.currency, dict.locale),
    },
    {
      label: dict.grandTotal,
      value: paperMoney(input.total, input.currency, dict.locale),
      grand: true,
    },
  ];
}
