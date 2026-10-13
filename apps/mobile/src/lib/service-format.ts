import { formatEURExact } from "@babun/shared/common/utils/money";

/** Длительность по-человечески: «45 мин», «1 ч», «1 ч 30 мин».
 *
 *  Услуга печатает длительность на четырёх поверхностях (справочник, пикер
 *  услуг, сводка записи, страница записи), и до 2026-08-17 каждая считала её
 *  сама: справочник печатал сырые «90 мин», а выбор услуги рядом — «1 ч 30
 *  мин». Одна услуга звучала двумя способами в двух тапах друг от друга. */
export function durationLabel(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} мин`;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

/** Цена от количества ФРАЗОЙ, которой человек это и говорит вслух: «от трёх —
 *  сто евро за полтора часа». Слов «ступень» и «порог» в продукте нет — они
 *  существуют только внутри кода.
 *
 *  СУММА ЗДЕСЬ — ЗА ВСЮ СТРОКУ (владелец 2026-08-21). Раньше фраза говорила
 *  «по €45», и «по» означало «за штуку»; теперь человек вписывает сумму за всё
 *  количество, поэтому предлог убран — «€135» без «по» читается как итог. */
export function tierSentence(tier: {
  minQuantity: string;
  rowPrice: string;
  totalDuration: string;
}): string {
  const from = tier.minQuantity.trim() || "…";
  const head = `от ${from}`;
  const parts: string[] = [];
  const price = Number(tier.rowPrice.trim().replace(",", "."));
  if (tier.rowPrice.trim() && Number.isFinite(price)) {
    parts.push(formatEURExact(price));
  }
  const minutes = Number(tier.totalDuration.trim());
  if (tier.totalDuration.trim() && Number.isFinite(minutes)) {
    parts.push(`${durationLabel(minutes)} на всё`);
  }
  return parts.length > 0 ? `${head} — ${parts.join(" · ")}` : head;
}

/** Потолок барабана: часы кольцом 0–23, минуты по 5. Больше суток услуга не
 *  длится, а ветка «конец суток» у примитива при 23 не срабатывает никогда. */
export const MAX_DURATION = 23 * 60 + 55;

/** Минуты — к шагу барабана. Барабан крутит пятиминутками, и значение,
 *  пришедшее из базы не кратным (наследие ручного ввода), обязано лечь на
 *  ближайшую метку: иначе оно молча округлится при первом же повороте. */
export function roundToStep(minutes: number): number {
  return Math.min(MAX_DURATION, Math.max(0, Math.round(minutes / 5) * 5));
}
