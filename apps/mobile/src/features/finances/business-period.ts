import { makePeriod, type Period } from "@/lib/period";

/** Пресет («Сегодня», «Текущий месяц») — заново от `now`, часов компании:
 *  в нём лежат абсолютные даты, и после полуночи или приезда пояса они уже
 *  чужие. Ручной «Свой период» человек выбрал сам — его не трогаем. */
export function rebasePeriod(current: Period, now: Date): Period {
  return current.preset === "custom" ? current : makePeriod(current.preset, now);
}
