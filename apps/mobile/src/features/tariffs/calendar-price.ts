// ЦЕНА ОДНОГО КАЛЕНДАРЯ (владелец 12.10: €9.99 в месяц, €7.99 при оплате за
// год) — лист без зависимостей: его читают страница «Тариф», предложение
// «Новый календарь» и тест, сверяющий цену с `tariff-checkout`.

export const CALENDAR_PRICE = { monthly: 9.99, yearlyMonthly: 7.99 } as const;

export const euro = (n: number) => `€${n.toFixed(2)}`;

/** Сколько в месяц за столько календарей: «€29.97». */
export function calendarsMonthly(calendars: number): string {
  return euro(CALENDAR_PRICE.monthly * Math.max(1, calendars));
}
