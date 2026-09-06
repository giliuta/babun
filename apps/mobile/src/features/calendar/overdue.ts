import type { Appointment } from "@babun/shared/local/appointments";
import { toMin } from "@/features/calendar/layout";

// ПРОСРОЧЕННАЯ РАБОТА — ЗАПЛАНИРОВАННАЯ РАБОТА, ВРЕМЯ КОТОРОЙ ПРОШЛО.
//
// Это про деньги: незакрытая работа — недополученный счёт. Правило жило
// инлайном в одном месте сетки, и первая же правка колонки утащила бы его
// молча; теперь оно чистая функция под тестом, и им пользуются сетка, лента
// и месяц.
//
// «В работе» просрочкой НЕ СЧИТАЕТСЯ: её уже начали, диспетчер знает.
// Событие (kind !== "work") — тоже: закрывать нечего.

/** Конец записи в минутах — ТОТ ЖЕ, что считает раскладка (`layoutDay` даёт
 *  минимум 15 минут), иначе сетка и счётчик разойдутся на нулевых записях. */
export function endMinutesOf(apt: Appointment): number {
  const start = toMin(apt.time_start);
  return Math.max(toMin(apt.time_end), start + 15);
}

/** `nowMinutes == null` означает «про сегодня не знаем» — сегодняшние записи
 *  просроченными не считаются. Этим пользуется Месяц: там счёт идёт долгам
 *  ПРОШЛОГО, а сегодняшнюю работу ещё закрывают. */
export function isOverdue(
  apt: Appointment,
  todayYmd: string | null | undefined,
  nowMinutes: number | null | undefined,
): boolean {
  if (!todayYmd) return false;
  if (apt.status !== "scheduled" || apt.kind !== "work") return false;
  if (apt.date < todayYmd) return true;
  if (apt.date > todayYmd) return false;
  return nowMinutes != null && endMinutesOf(apt) < nowMinutes;
}

/** Сколько работ дня не закрыто. */
export function countOverdue(
  appts: readonly Appointment[],
  todayYmd: string | null | undefined,
  nowMinutes: number | null | undefined,
): number {
  let n = 0;
  for (const a of appts) if (isOverdue(a, todayYmd, nowMinutes)) n++;
  return n;
}
