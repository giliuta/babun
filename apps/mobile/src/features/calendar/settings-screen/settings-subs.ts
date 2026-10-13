// Pure subtitles and spans of the «Календарь» settings screen.

import type { TimeOfDay } from "../window";

/** Subtitle of the «Записи» row: where the colour comes from and how many
 *  form blocks are on. */
export function bookingSubtitle(ruleLabel: string | undefined, blocksOn: number, blocksTotal: number): string {
  return [
    ruleLabel ?? "Цвет команды",
    blocksOn === blocksTotal
      ? "все блоки"
      : `${blocksOn} из ${blocksTotal} блоков`,
  ].join(" · ");
}

// Первые имена меток — чтобы строка отвечала «что у меня заведено», не
// проваливаясь внутрь. Пусто — честное «Пока нет».
export function labelsSubtitle(labelNames: readonly (string | null | undefined)[]): string {
  const names = labelNames.filter(Boolean);
  if (names.length === 0) return "Пока нет меток";
  const head = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${head} и ещё ${names.length - 3}` : head;
}

/** Whole hours the visible window covers (at least one) — the zoom percent
 *  is measured against it. */
export function windowSpanHours(window: { start: TimeOfDay; end: TimeOfDay }): number {
  return Math.max(
    1,
    Math.ceil((window.end.hour * 60 + window.end.minute) / 60) -
      Math.floor((window.start.hour * 60 + window.start.minute) / 60),
  );
}
