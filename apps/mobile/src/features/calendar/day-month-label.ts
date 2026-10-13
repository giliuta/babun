// «13 октября» ДЛЯ ПОДПИСЕЙ ЯЧЕЕК — ОДИН ФОРМАТТЕР НА ВСЁ (аудит Android
// 13.10). `toLocaleDateString` в каждой ячейке строил новый
// Intl-форматтер: на Android Hermes ходит за ним через JNI в ICU, и свайп
// месяца платил за 126 таких построек (42 ячейки × 3 страницы), неделя — за
// 21 при каждой перерисовке шапки. Форматтер строится один раз; вывод тот
// же, что был.
const DAY_MONTH = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });

/** «13 октября» — для подписей VoiceOver/TalkBack у ячеек дней. */
export function dayMonthLabel(d: Date): string {
  return DAY_MONTH.format(d);
}
