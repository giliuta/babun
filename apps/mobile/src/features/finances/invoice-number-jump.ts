import { formatCountRu } from "@babun/shared/common/utils/plural-ru";

// ПЕРЕХОД НОМЕРА ВПЕРЁД ОСТАВЛЯЕТ ДЫРУ В СЕРИИ. Серия сплошная: пропущенные
// номера никому не достанутся, а закон о VAT ждёт номера подряд. Поэтому ручной
// переход вперёд человек подтверждает, увидев, какие номера пропадут. Назад и
// «на месте» сервер не пускает или это не переход — вопроса нет.

/** «INV-2026-104» с другим хвостом: префикс и год — из серии сервера. */
export function numberWithSeq(number: string, seq: number): string {
  return number.replace(/(\d+)$/, (tail) => String(seq).padStart(tail.length, "0"));
}

interface SkippedNumbers {
  /** Сколько номеров останется без документов. */
  count: number;
  /** Первый и последний из пропущенных, подписью серии. */
  first: string;
  last: string;
}

/** Какие номера пропадут, если следующим стал `typed`; `null` — переход не
 *  вперёд (или текущий номер ещё неизвестен). */
export function skippedNumbers(
  next: { seq: number; number: string } | null | undefined,
  typed: number,
): SkippedNumbers | null {
  if (!next || typed <= next.seq) return null;
  return {
    count: typed - next.seq,
    first: numberWithSeq(next.number, next.seq),
    last: numberWithSeq(next.number, typed - 1),
  };
}

/** Текст вопроса о переходе. */
export function jumpMessage(skipped: SkippedNumbers): string {
  const range = skipped.count === 1 ? skipped.first : `${skipped.first} – ${skipped.last}`;
  const count = formatCountRu(skipped.count, ["номер", "номера", "номеров"]);
  return `Пропущенные номера (${count}: ${range}) останутся дырой в серии: ни один документ их не получит, вернуть их нельзя.`;
}
