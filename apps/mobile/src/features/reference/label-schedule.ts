import {
  addDaysYmd,
  isoWeekdayOf,
} from "@babun/shared/common/utils/date-utils";

// БЛИЖАЙШИЕ ДАТЫ, НА КОТОРЫЕ ВСТАНЕТ РАСПИСАНИЕ МЕТКИ.
//
// Владелец 2026-08-30: «надо понимать, какие даты выбраны — они просто
// подсветка; и если на дне уже стоит другая метка, автоматически туда
// проставляться не должно».
//
// Второе УЖЕ ВЕРНО в резолвере календаря: явная метка дня побеждает
// расписание, потому что расписание спрашивают только когда на дне пусто. Но
// узнать об этом было неоткуда — пропуск происходил молча. Здесь он получает
// имя: дата возвращается вместе с тем, КТО её занял.
//
// ПОЧЕМУ ВООБЩЕ СПИСОК ДАТ. Выбор «вторник» — обещание про будущее, а
// проверить его можно было только уйдя в календарь и пролистав месяц. Семь
// плиток не врали, они просто молчали о последствии.

/** Одна дата, которую даст расписание. `takenBy` — имя метки, уже стоящей на
 *  этой дате руками; в такой день расписание не встанет. */
export interface LabelOccurrence {
  ymd: string;
  /** ISO-день недели: 1 = понедельник … 7 = воскресенье. */
  weekday: number;
  takenBy: string | null;
}

/** Горизонт поиска. Дальше не смотрим: даже одна выбранная суббота даёт
 *  восемь дат за это окно — больше, чем помещается в полосу и чем человек
 *  способен проверить глазом. */
const HORIZON_DAYS = 70;

export function upcomingOccurrences(opts: {
  /** ISO-номера выбранных дней недели. Пусто — расписания нет. */
  weekdays: number[];
  /** Сегодня, «ГГГГ-ММ-ДД». Прошлое не считаем: канон LOCKED 2026-08-29 —
   *  расписание действует только на сегодня и вперёд. */
  fromYmd: string;
  /** Сколько дат вернуть. */
  limit: number;
  /** Явная метка дня или null. Своё же имя занятостью НЕ считается: метка,
   *  уже стоящая на дате руками, не конфликтует сама с собой. */
  assignedOn: (ymd: string) => string | null;
  /** Имя правимой метки — при создании null. */
  ownName: string | null;
}): LabelOccurrence[] {
  const days = new Set(
    opts.weekdays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7),
  );
  if (days.size === 0 || opts.limit <= 0) return [];

  const out: LabelOccurrence[] = [];
  for (let i = 0; i < HORIZON_DAYS && out.length < opts.limit; i++) {
    const ymd = i === 0 ? opts.fromYmd : addDaysYmd(opts.fromYmd, i);
    const weekday = isoWeekdayOf(ymd);
    if (!days.has(weekday)) continue;
    const assigned = opts.assignedOn(ymd);
    out.push({
      ymd,
      weekday,
      takenBy: assigned && assigned !== opts.ownName ? assigned : null,
    });
  }
  return out;
}

/** Ближайшая дата для дня недели — подпись на самой плитке. `null`, если в
 *  горизонт не попала (такого быть не может: неделя короче горизонта, но
 *  вызывающему незачем это доказывать). */
export function nextDateForWeekday(
  weekday: number,
  fromYmd: string,
): string | null {
  for (let i = 0; i < 7; i++) {
    const ymd = i === 0 ? fromYmd : addDaysYmd(fromYmd, i);
    if (isoWeekdayOf(ymd) === weekday) return ymd;
  }
  return null;
}
