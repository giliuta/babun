// ЦЕНА ОДНОГО КАЛЕНДАРЯ (€9.99 в месяц, €7.99 при оплате за
// год) — лист без зависимостей: его читают страница «Тариф», предложение
// «Новый календарь» и тест, сверяющий цену с `tariff-checkout`.

export const CALENDAR_PRICE = { monthly: 9.99, yearlyMonthly: 7.99 } as const;

export const euro = (n: number) => `€${n.toFixed(2)}`;

/** Сколько в месяц за столько календарей: «€29.97». */
export function calendarsMonthly(calendars: number): string {
  return euro(CALENDAR_PRICE.monthly * Math.max(1, calendars));
}

/** Период оплаты: помесячно или на год вперёд. */
export type BillingPeriod = "month" | "year";

/** Сколько за год за столько календарей: «€287.64» (€7.99 × 12 × 3). */
export function calendarsYearly(calendars: number): string {
  return euro(Math.round(CALENDAR_PRICE.yearlyMonthly * 12 * Math.max(1, calendars) * 100) / 100);
}
