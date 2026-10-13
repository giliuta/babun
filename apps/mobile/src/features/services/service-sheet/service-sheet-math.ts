// Pure rules of the price-list service form: ladder numbers, weekdays and
// the first error under the table.

import type { PriceEntryMode, ServiceEconomicsErrors } from "../economics";

// ЧТО ЛЕЖИТ В ЧЕРНОВИКЕ И ЧТО ВИДИТ ЧЕЛОВЕК — РАЗНЫЕ ЧИСЛА, и направление
// пересчёта у цены и расхода ПРОТИВОПОЛОЖНОЕ:
//   цена   хранится ЗА ВСЮ строку  → в режиме «за единицу» делим на кол-во;
//   расход хранится ЗА ЕДИНИЦУ     → в режиме «за всё» умножаем на кол-во.
// Перепутать их местами — значит показать человеку число в десять раз
// больше или меньше, и он не заметит, пока не выставит счёт.
export const qtyOf = (raw: string) => {
  const n = Number(String(raw).trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 1;
};

/** Stored per-unit cost → the number shown in the given entry mode. */
export const showCost = (raw: string, qty: number, costEntry: PriceEntryMode) => {
  if (costEntry === "unit" || raw.trim() === "" || qty <= 1) return raw;
  const n = Number(raw.trim().replace(",", "."));
  return Number.isFinite(n) ? String(Math.round(n * qty * 100) / 100) : raw;
};

/** Typed cost in the given entry mode → the per-unit number to store. */
export const storeCost = (typed: string, qty: number, costEntry: PriceEntryMode) => {
  if (costEntry === "unit" || typed.trim() === "" || qty <= 1) return typed;
  const n = Number(typed.trim().replace(",", "."));
  return Number.isFinite(n) ? String(Math.round((n / qty) * 100) / 100) : typed;
};

/** ISO weekdays 1..7 of a stored `available_weekdays` value; junk dropped. */
export function seedWeekdays(raw: unknown): number[] {
  return Array.isArray(raw)
    ? (raw as unknown[]).filter(
        (day): day is number =>
          typeof day === "number" && day >= 1 && day <= 7,
      )
    : [];
}

/** Next weekday set after a tap on `day`; empty means «any day». */
export function toggleWeekday(weekdays: readonly number[], day: number): number[] {
  // Гашение первого дня разворачивает «пусто = все» в явный
  // список: иначе снять один день было бы нечем.
  const current =
    weekdays.length === 0 ? [1, 2, 3, 4, 5, 6, 7] : weekdays;
  const next = current.includes(day)
    ? current.filter((x) => x !== day)
    : [...current, day].sort((a, b) => a - b);
  return next.length === 7 ? [] : next;
}

export type ServiceBaseErrors = { price?: string; duration?: string };

/** Errors of the base row (price and time) of the form. */
export function baseFieldErrors(price: string, duration: string): ServiceBaseErrors {
  const parsedPrice = Number(price.trim().replace(",", "."));
  const parsedDuration = Number(duration.trim());
  const nextBaseErrors: ServiceBaseErrors = {};
  // ПУСТАЯ ЦЕНА = БЕСПЛАТНО, И ЭТО ЗАКОННО (владелец 2026-08-29: «цену
  // необязательно вписывать — услуга может быть полностью бесплатной, её
  // сделали, но денег не берём»).
  //
  // Запрет ставился против молчаливого нуля: `Number("")` даёт 0, и услуга
  // уезжала в прайс бесплатной незаметно для человека. Довод отпал, когда
  // ячейка цены стала показывать «0 €» подсказкой: пустое поле теперь
  // ЧИТАЕТСЯ нулём, а не выглядит незаполненным. Молчания больше нет —
  // значит нет и повода запрещать.
  //
  // Гарантийный выезд, переделка, бонус постоянному клиенту — работа
  // сделана, денег нет. Заставлять писать «0» ради проформы незачем.
  if (price.trim() !== "" && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
    nextBaseErrors.price = "Цена от 0";
  }
  // НУЛЕВОЕ ВРЕМЯ РАЗРЕШЕНО (владелец 2026-08-29: «гарантия или диагностика
  // — добавляю её в запись, и структура времени не должна ломаться; ноль
  // евро, ноль по времени, а в счёт она попадёт»).
  //
  // Запрет стоял со словами «услуга нулевой длины ломает календарь молча».
  // Проверено — не ломает: конец записи только РАСТЁТ. В `AppointmentSheet`
  // пересчёт выходит раньше на `computedDuration <= 0` и время не сжимает,
  // а высоту блока в сетке задают `time_start`/`time_end` записи, а не
  // сумма длительностей услуг. Нулевая услуга просто ничего не прибавляет.
  //
  // Отрицательное и дробное по-прежнему недопустимы: это не «строка в
  // счёт», а испорченное число.
  if (!Number.isSafeInteger(parsedDuration) || parsedDuration < 0) {
    nextBaseErrors.duration = "Поставьте время";
  }
  return nextBaseErrors;
}

// Одна красная строка ПОД таблицей: три подписи под тремя колонками сломали
// бы выравнивание, ради которого таблица и затевалась.
export function firstServiceError(
  baseErrors: ServiceBaseErrors,
  economicsErrors: ServiceEconomicsErrors | undefined,
): string | undefined {
  return (
    baseErrors.price ??
    baseErrors.duration ??
    Object.values(economicsErrors?.tiers ?? {})
      .flatMap((tier) => [
        tier.minQuantity,
        tier.rowPrice,
        tier.rowCost,
        tier.totalDuration,
        // `row` — ошибка не КЛЕТКИ, а всей строки («впишите цену или время»).
        // Её забыли внести в цепочку, и она была недостижима: строка без цены
        // и без времени не сохранялась, а человек не получал ни слова —
        // «Сохранить» просто ничего не делала. Молчащая кнопка хуже отказа.
        tier.row,
      ])
      .find(Boolean)
  );
}
