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

/** Пара «весь день» (0–24) — кодовое «Автоматически»: окно выводится.
 *  Отдельного null в колонках нет (start/end_hour NOT NULL), а окно на все
 *  сутки и так ничего не ограничивает — сентинел совпадает со смыслом. */
export function isAutoWindow(w: { start: number; end: number } | undefined): boolean {
  return !w || (w.start <= 0 && w.end >= 24);
}

/**
 * Окно для набора видимых дней.
 * @param bands действующие рабочие полосы этих дней (null = выходной)
 * @param fallback общие рабочие часы — когда у команды нет своего графика
 *                 (у половины живых команд строки расписания нет вовсе)
 * @param explicit «Часы календаря» (владелец 2026-08-16: «должно быть два —
 *                 часы календаря и рабочие часы»). Заданная пара становится
 *                 БАЗОЙ рельса вместо вывода из полос; записи по-прежнему
 *                 раздвигают окно — «запись вне окна не потеряется» остаётся
 *                 правдой при любой настройке. Пара 0–24 = «Автоматически».
 */
export function deriveWindow(
  bands: readonly (WorkBand | null | undefined)[],
  fallback: { start: number; end: number },
  appts: readonly Appointment[],
  explicit?: { start: number; end: number },
): { startHour: number; endHour: number } {
  let lo: number;
  let hi: number;

  if (explicit && !isAutoWindow(explicit)) {
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
