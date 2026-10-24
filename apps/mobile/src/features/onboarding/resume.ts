import type { TourChapter } from "@/components/tour/tour-store";

// ГЛАВА ПРОДОЛЖАЕТСЯ С ТОГО ЖЕ ШАГА. Приложение закрыли посреди главы —
// при следующем запуске она идёт не с начала, а с шага, на котором
// остановились. Шаг хранится на телефоне: это место в обучении, а не данные.

export type SavedStep = { chapter: string; step: string };

/** Ключ места в обучении — свой у человека в каждом аккаунте. */
export function savedStepKey(userId: string, tenantId: string): string {
  return `onboarding.step:${userId}:${tenantId}`;
}

/** С какого шага начать главу. Сохранённый шаг берётся, только если он не
 *  раньше обычного начала: созданный календарь не создают второй раз, и
 *  глава, начавшаяся со страницы, не возвращается к кнопке, которой уже нет.
 *  Шаг, чей экран сейчас закрыт, сам вернёт к своему началу (`fallback`). */
export function resumeStep(
  chapter: TourChapter,
  defaultStart: string | undefined,
  saved: SavedStep | null,
): string | undefined {
  if (!saved || saved.chapter !== chapter.id) return defaultStart;
  const at = chapter.steps.findIndex((s) => s.id === saved.step);
  if (at < 0) return defaultStart;
  const from = defaultStart ? chapter.steps.findIndex((s) => s.id === defaultStart) : 0;
  return at >= Math.max(0, from) ? saved.step : defaultStart;
}
