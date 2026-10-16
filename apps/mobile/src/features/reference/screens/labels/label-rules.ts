import type { TeamSchedule } from "@babun/shared/local/schedule";
import type { City } from "@/features/reference/queries";
import { allDays, ISO_BY_KEY } from "@/features/reference/schedule-days";

// Pure rules of the labels screen (`LabelsScreen.tsx`): list order, usage,
// who holds a weekday, team days off, the revive patch and the blocked-day
// note. No React here, so the rules run under node:test.

/** Что лист отдаёт наружу при сохранении. Объектом, а не пятью позиционными
 *  аргументами: имя, цвет, дни и заливка — один ответ на один вопрос «какая
 *  это метка», и порядок в вызове не должен быть частью правды. */
export interface LabelDraft {
  name: string;
  color: string;
  weekdays: number[];
  tintDay: boolean;
}

export type Editing =
  | { mode: "create" }
  | { mode: "edit"; city: City };

export const FALLBACK_COLOR = "#8E8E93";
/** Высота строки фиксирована: по ней перетаскивание считает, через сколько
 *  соседей перелетел палец. */
export const ROW_H = 52;

/** Полное имя дня по ISO-номеру — для объяснения, почему день не берётся. */
export const WEEKDAY_FULL_BY_ISO: Record<number, string> = {
  1: "Понедельник",
  2: "Вторник",
  3: "Среда",
  4: "Четверг",
  5: "Пятница",
  6: "Суббота",
  7: "Воскресенье",
};

/** Who already holds a weekday: the owning label's name and colour. */
export type DayOwners = Map<number, { name: string; color: string | null }>;

// Живые сверху, скрытые под ними, удалённые в самом хвосте — тем же
// порядком, что у услуг. Удалённая остаётся ВИДНОЙ: обещание «можно
// вернуть 30 дней» без двери было бы враньём.
export function orderLabels(all: readonly City[]): City[] {
  return [
    ...all.filter((c) => c.is_active && !c.deleted_at),
    ...all.filter((c) => !c.is_active && !c.deleted_at),
    ...all.filter((c) => c.deleted_at),
  ];
}

/** Использование метки: на скольких днях она уже стоит рукой. */
export function labelUsage(dayCities: Readonly<Record<string, string>>): Map<string, number> {
  const m = new Map<string, number>();
  for (const name of Object.values(dayCities)) {
    m.set(name, (m.get(name) ?? 0) + 1);
  }
  return m;
}

/** День недели → живая метка, которая его уже держит (первая по порядку). */
export function labelDayOwners(cities: readonly City[]): DayOwners {
  const m: DayOwners = new Map();
  for (const c of cities) {
    if (!c.is_active || c.deleted_at) continue;
    for (const d of c.weekdays ?? []) {
      if (!m.has(d)) m.set(d, { name: c.name, color: c.color });
    }
  }
  return m;
}

/** ISO weekdays the team's own schedule marks as not working. */
export function teamDaysOff(schedule: TeamSchedule | undefined): Set<number> {
  if (!schedule) return new Set<number>();
  const off = new Set<number>();
  for (const { key, day } of allDays(schedule)) {
    if (!day.is_working) off.add(ISO_BY_KEY[key]);
  }
  return off;
}

/** Метка скрыта или удалена — патч, который возвращает её в живые. */
export function reviveIfGone(
  city: Pick<City, "deleted_at" | "is_active">,
): { deleted_at: null; is_active: true } | Record<string, never> {
  return city.deleted_at || !city.is_active ? { deleted_at: null, is_active: true } : {};
}

/** Why a weekday tile refuses the tap: the team's day off or another label. */
export function blockedDayNote(day: number, reason: "off" | { holder: string }): string {
  return reason === "off"
    ? `${WEEKDAY_FULL_BY_ISO[day]} — выходной у команды`
    : `${WEEKDAY_FULL_BY_ISO[day]} занят меткой «${reason.holder}». У дня одна метка.`;
}
