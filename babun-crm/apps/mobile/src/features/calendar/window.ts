import type { Appointment } from "@babun/shared/local/appointments";
import type { WorkBand } from "@/features/calendar/DayView";

// Видимое окно рельса — ВЫВОДИТСЯ, а не спрашивается.
//
// Раньше это были три настройки («Показывать с/до», «Открывать на») на двух
// экранах, плюс их же переопределения у команды — шесть строк, отвечающих на
// вопрос, которого сервисный бизнес себе не задаёт. У сантехника нет «видимого
// времени», у него есть «работаю с 9 до 8».
//
// Правило: окно = рабочая полоса ±1 ч, расширенная под записи, которые из неё
// выпали. Второе слагаемое — не украшение: без него запись, поставленная до
// открытия, молча обрезалась клампом DayView (visStart = max(startMin,
// winStart)), и настройка «видимого времени» тихо прятала работу. Теперь
// «записи вне окна не потеряются» — правда, а не футнот.

const PAD_HOURS = 1;

/** Границы часов из набора записей: [самое раннее начало, самый поздний конец]. */
function apptBounds(appts: readonly Appointment[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of appts) {
    // «Весь день» хранится как 00:00–23:59, но на сетке живёт полоской у
    // кромки колонки НЕЗАВИСИМО от окна — одно событие-отпуск не должно
    // растягивать рельс всех дней до 00–24.
    if (a.event_all_day === true) continue;
    const s = Number(a.time_start?.slice(0, 2));
    const e = Number(a.time_end?.slice(0, 2));
    const eMin = Number(a.time_end?.slice(3, 5));
    if (Number.isFinite(s)) lo = Math.min(lo, s);
    // Конец «18:30» обязан попасть в окно целиком → округляем час вверх.
    if (Number.isFinite(e)) hi = Math.max(hi, eMin > 0 ? e + 1 : e);
  }
  return lo === Infinity ? null : [lo, hi];
}

// «АВТОМАТИЧЕСКИ» БОЛЬШЕ НЕ СУЩЕСТВУЕТ (владелец 2026-08-17: «непонятное
// автоматическое мы убираем полностью»). Пара 0–24 была его кодовым значением
// и читалась как «окно выведи сам»; теперь она означает ровно то, что
// написано, — сутки целиком, и стандарт продукта именно такой. Поэтому
// `isAutoWindow` снят, а вывод окна из рабочих полос остался ровно на один
// случай: «Часы календаря» не пришли вовсе.

// ─── ЧАСЫ КАЛЕНДАРЯ — У КАЖДОГО КАЛЕНДАРЯ СВОИ ───────────────────────
//
// Владелец 2026-08-17: «это не все календари, это только на эту команду: на
// команде один я могу выбрать такие часы, а на команде два совершенно другие».
//
// Хранит их СВОЯ КОЛОНКА КОМАНДЫ — `teams.calendar_window_start/end`, текст
// «ЧЧ:ММ». Колонки лежали в базе мёртвыми (никто не читал), и заводить рядом
// третью пару было бы нечестно: место под ровно эту настройку уже отведено, а
// текст «08:30» несёт минуты без отдельного поля.
//
// NULL = «как у компании». Наследование, а не копия стандарта в каждую
// команду: у фирмы с восемью командами перепись стандарта в восемь строк
// означала бы, что менять его надо восемь раз. Тот же приём, что у часового
// пояса и буфера (`teams.timezone`, `teams.buffer_minutes`).

export interface TimeOfDay {
  hour: number;
  minute: number;
}

/** «08:30» → {8,30}; «24:00» → {24,0}. Мусор и пустое → null (наследуем). */
export function parseHm(value: string | null | undefined): TimeOfDay | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
  // 24:30 не существует — час 24 это ровно конец суток.
  if (hour === 24 && minute !== 0) return null;
  return { hour, minute };
}

export function formatHm(t: TimeOfDay): string {
  return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
}

export function hmToMinutes(t: TimeOfDay): number {
  return t.hour * 60 + t.minute;
}

/**
 * Действующие «Часы календаря» ЭТОГО календаря: своя пара команды → стандарт
 * компании.
 *
 * Откуда пришло значение, наружу НЕ сообщается (владелец 2026-08-17: «убери
 * „стандарт компании“, это лишние слова, убираем шум»). Строка настройки
 * показывает ДЕЙСТВУЮЩИЕ часы — то, по чему живёт сетка; чьей записью они
 * оказались, человека не спрашивали и ему это ничего не меняет.
 */
export function effectiveCalendarWindow(
  team: { calendar_window_start?: string | null; calendar_window_end?: string | null } | null | undefined,
  company: { startHour?: number; endHour?: number; startMinute?: number; endMinute?: number } | null | undefined,
): { start: TimeOfDay; end: TimeOfDay } {
  const own = {
    start: parseHm(team?.calendar_window_start),
    end: parseHm(team?.calendar_window_end),
  };
  // Пара берётся ЦЕЛИКОМ либо не берётся вовсе: половина своя, половина
  // компанейская — окно, которого никто не выставлял.
  if (own.start && own.end && hmToMinutes(own.end) > hmToMinutes(own.start)) {
    return { start: own.start, end: own.end };
  }
  return {
    start: { hour: company?.startHour ?? 0, minute: company?.startMinute ?? 0 },
    end: { hour: company?.endHour ?? 24, minute: company?.endMinute ?? 0 },
  };
}

/**
 * Окно для набора видимых дней.
 * @param bands действующие рабочие полосы этих дней (null = выходной)
 * @param fallback общие рабочие часы — когда у команды нет своего графика
 *                 (у половины живых команд строки расписания нет вовсе)
 * @param explicit «Часы календаря» — отрезок суток, который человек назвал
 *                 сам. Заданная пара становится БАЗОЙ рельса вместо вывода из
 *                 полос; записи по-прежнему раздвигают окно — «запись вне окна
 *                 не потеряется» остаётся правдой при любой настройке.
 */
export function deriveWindow(
  bands: readonly (WorkBand | null | undefined)[],
  fallback: { start: number; end: number },
  appts: readonly Appointment[],
  explicit?: { start: number; end: number },
): { startHour: number; endHour: number } {
  let lo: number;
  let hi: number;

  if (explicit) {
    // Явное окно берётся как есть, без ±1: человек назвал границы сам,
    // и «показывать с 08:00» не должно тихо превращаться в 07:00.
    lo = explicit.start;
    hi = explicit.end;
  } else {
    lo = Infinity;
    hi = -Infinity;
    for (const b of bands) {
      if (!b) continue; // выходной / нет графика — молчит, решает fallback ниже
      lo = Math.min(lo, Math.floor(b.startMin / 60));
      hi = Math.max(hi, Math.ceil(b.endMin / 60));
    }
    // Все дни выходные или графика нет — рельс всё равно должен быть осмысленным.
    if (lo === Infinity) {
      lo = fallback.start;
      hi = fallback.end;
    }

    lo -= PAD_HOURS;
    hi += PAD_HOURS;
  }

  const bounds = apptBounds(appts);
  if (bounds) {
    lo = Math.min(lo, bounds[0]);
    hi = Math.max(hi, bounds[1]);
  }

  const startHour = Math.max(0, Math.min(23, Math.floor(lo)));
  const endHour = Math.max(startHour + 1, Math.min(24, Math.ceil(hi)));
  return { startHour, endHour };
}

/**
 * Час, на котором календарь открывается. Начало работы просматриваемого дня.
 *
 * Сознательно НЕ «сейчас»: openScroll перезапускается на каждое изменение
 * этого числа (zoom.tsx), а «сейчас» тикает раз в минуту — рельс дёргался бы
 * под пальцем. Вернуться к текущему часу и так есть чем: кнопка «Сегодня» в
 * шапке и «к сейчас» на сетке.
 */
export function deriveScrollHour(
  band: WorkBand | null | undefined,
  fallback: { start: number; end: number },
  window: { startHour: number; endHour: number },
): number {
  const h = band ? Math.floor(band.startMin / 60) : fallback.start;
  return Math.max(window.startHour, Math.min(h, window.endHour - 1));
}
