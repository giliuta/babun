// STORY-091 (Brief 2 #18) — Pure expansion engine for personal-event
// recurrence rules. Turns a seed `Appointment` + its `event_repeat`
// rule into the set of virtual occurrences that fall inside a window.
//
// Design goals:
//   · Pure & deterministic — same inputs always produce same output.
//   · Hard occurrence cap (365) regardless of rule so a runaway
//     «daily until 2199» can't blow memory.
//   · Virtual occurrences carry `virtualParentId` so the UI can route
//     edits / cancellations back to the seed record. Original `id`
//     stays unchanged on the seed; virtuals get synthesised ids of
//     the form `${seed.id}@${dateKey}`.
//   · Cancelled seeds expand to nothing by default; a caller that
//     shows cancelled records (hideCancelled off) passes
//     `includeCancelled: true` and filters on its own side.
//   · `kind === "none"` returns just the seed itself when it falls
//     inside the window.

import type { Appointment, PersonalEventRepeat } from "../../local/appointments";

const MAX_OCCURRENCES = 365;
// Жёсткий предохранитель прохода по дням (~55 лет). Именно ДНИ ПРОХОДА,
// а не вхождения: раньше кап 365 стоял на днях от seed, и еженедельное
// событие старше года «не доходило» до текущего окна и молча исчезало
// из календаря. Прогулка тривиальной арифметикой на 20k итераций —
// микросекунды; смысловые лимиты ниже (count / MAX_OCCURRENCES) не тронуты.
const HARD_WALK_DAYS = 20000;

interface VirtualAppointment extends Appointment {
  virtualParentId: string;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function inWindow(dateKey: string, fromKey: string, toKey: string): boolean {
  return dateKey >= fromKey && dateKey <= toKey;
}

/**
 * Expand a seed appointment into all of its occurrences that fall
 * inside the [fromKey, toKey] window (inclusive on both ends).
 *
 * The seed itself is included if it has `event_repeat.kind === "none"`
 * OR is missing the field; otherwise the seed contributes one of the
 * occurrences (the first one ≥ fromKey).
 */
export function expandRepeat(
  seed: Appointment,
  fromKey: string,
  toKey: string,
  opts?: {
    /** Разворачивать и отменённый seed. Судьбу отменённых решает
     *  вызывающий (мобильный byTeam фильтрует по hideCancelled) —
     *  безусловное короткое замыкание здесь прятало отменённую серию
     *  даже при «показывать отменённые», и восстановить её из сетки
     *  было нельзя. Дефолт false = прежнее поведение веба. */
    includeCancelled?: boolean;
  },
): (Appointment | VirtualAppointment)[] {
  if (seed.status === "cancelled" && !opts?.includeCancelled) return [];
  const rule: PersonalEventRepeat = seed.event_repeat ?? { kind: "none" };

  // No recurrence — seed appears once (if in window).
  if (rule.kind === "none") {
    return inWindow(seed.date, fromKey, toKey) ? [seed] : [];
  }

  const out: (Appointment | VirtualAppointment)[] = [];
  const seedDate = parseDate(seed.date);
  const toDate = parseDate(toKey);
  const untilDate = rule.until ? parseDate(rule.until) : null;
  // until раньше даты seed не должен прятать событие целиком: исходное
  // вхождение рисуется всегда, поэтому терминатор не бывает раньше seed.
  if (untilDate && untilDate < seedDate) untilDate.setTime(seedDate.getTime());
  const countLimit = rule.count && rule.count > 0 ? rule.count : MAX_OCCURRENCES;

  // Walk forward day-by-day from seed until we exit the window or hit
  // the rule's terminator. Day-by-day is simple to reason about; emitted
  // ДО окна тоже считается (count = «N вхождений от seed»), поэтому
  // прематч-часть не перепрыгиваем, а просто дёшево проходим.
  const cursor = new Date(seedDate);
  let emitted = 0;
  let iterations = 0;
  while (
    iterations < HARD_WALK_DAYS &&
    out.length < MAX_OCCURRENCES &&
    emitted < countLimit &&
    cursor <= toDate &&
    (!untilDate || cursor <= untilDate)
  ) {
    iterations++;
    const cursorKey = ymd(cursor);

    if (matches(rule, seedDate, cursor)) {
      if (cursorKey >= fromKey) {
        const occ =
          cursorKey === seed.date
            ? seed
            : ({
                ...seed,
                id: `${seed.id}@${cursorKey}`,
                date: cursorKey,
                virtualParentId: seed.id,
              } as VirtualAppointment);
        out.push(occ);
      }
      emitted++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function matches(
  rule: Exclude<PersonalEventRepeat, { kind: "none" }>,
  seedDate: Date,
  cursor: Date,
): boolean {
  if (cursor < seedDate) return false;
  const dayMs = 24 * 60 * 60 * 1000;
  // Normalize both to midnight before subtraction so DST shifts don't
  // produce 23/25 hour differences that round wrong.
  const seedMid = new Date(seedDate);
  seedMid.setHours(0, 0, 0, 0);
  const curMid = new Date(cursor);
  curMid.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (curMid.getTime() - seedMid.getTime()) / dayMs,
  );

  switch (rule.kind) {
    case "daily":
      return true;
    case "weekdays": {
      const dow = cursor.getDay(); // 0=Sun..6=Sat
      return dow >= 1 && dow <= 5;
    }
    case "weekly":
      return diffDays % 7 === 0;
    case "biweekly":
      return diffDays % 14 === 0;
    case "monthly":
      return cursor.getDate() === seedDate.getDate();
    case "yearly":
      return (
        cursor.getDate() === seedDate.getDate() &&
        cursor.getMonth() === seedDate.getMonth()
      );
    case "custom_weekdays":
      return rule.days.length > 0 && rule.days.includes(cursor.getDay());
  }
}
