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

/** СВЁРНУТАЯ СТУПЕНЬ ПЕЧАТАЕТ ВСЕ СВОИ ЧИСЛА (редизайн 2026-08-22). Лестница
 *  обязана читаться сверху вниз как прайс, без единого тапа: «от 1 · €50 ·
 *  30 мин» / «от 3 · €135 · 1 ч 30 мин». Отличается от `tierSentence` тем, что
 *  НЕ повторяет количество — оно уже стоит слева в своей колонке строки. */
export function tierSummary(tier: {
  rowPrice: string;
  totalDuration: string;
}): string {
  const parts: string[] = [];
  const price = Number(tier.rowPrice.trim().replace(",", "."));
  if (tier.rowPrice.trim() && Number.isFinite(price)) {
    parts.push(formatEURExact(price));
  }
  const minutes = Number(tier.totalDuration.trim());
  if (tier.totalDuration.trim() && Number.isFinite(minutes)) {
    parts.push(durationLabel(minutes));
  }
  // Пустая ступень честно молчит прочерком, а не печатает «€0 · 0 мин».
  return parts.length > 0 ? parts.join(" · ") : "—";
}
