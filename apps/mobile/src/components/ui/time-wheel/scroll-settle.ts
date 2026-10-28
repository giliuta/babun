import { ITEM_H } from "./wheel-geometry";

// КОНЕЦ ПРОКРУТКИ В БРАУЗЕРЕ — ПО ТИШИНЕ.
//
// На телефоне барабан узнаёт, что лента встала, из `onMomentumScrollEnd` и
// `onScrollEndDrag`. react-native-web их не присылает вовсе: у браузера нет
// события «лента доехала и встала», приходит только поток `scroll`. Без
// замены выбор в вебе не фиксировался никогда — подсветка ехала за пальцем,
// а сохранялось прежнее значение. Конец здесь — когда поток замолчал (тот же
// приём у веб-барабана даты, `DateSpinner.web.tsx`).

/** Сколько тишины считать концом прокрутки. */
const SETTLE_QUIET_MS = 120;

type Timer = ReturnType<typeof setTimeout>;

/** Часы подменяются в тесте; в приложении это обычные таймеры. */
const realClock = {
  set: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
  clear: (id: unknown) => clearTimeout(id as Timer),
};

export function createScrollSettle(
  onSettle: (y: number) => void,
  quietMs: number = SETTLE_QUIET_MS,
  set: (fn: () => void, ms: number) => unknown = realClock.set,
  clear: (id: unknown) => void = realClock.clear,
) {
  let pending: unknown = null;
  return {
    /** Очередное событие прокрутки: отложить фиксацию до новой тишины. */
    scroll(y: number) {
      if (pending !== null) clear(pending);
      pending = set(() => {
        pending = null;
        onSettle(y);
      }, quietMs);
    },
    cancel() {
      if (pending !== null) clear(pending);
      pending = null;
    },
  };
}

/** Лента встала между строк. В браузере `snapToInterval` не работает, и
 *  довести её до строки обязан сам барабан — иначе под линией среза две
 *  половинки цифр. */
export function offRow(y: number): boolean {
  return Math.abs(y - Math.round(y / ITEM_H) * ITEM_H) > 0.5;
}

/** КОЛЁСИКО МЫШИ — ОДНА СТРОКА ЗА ЩЕЛЧОК. Браузер прокручивает щелчок на
 *  100–120 px, а строка барабана — 40: один щелчок проезжал 12 → 15.
 *  Колесо перехватывает прокрутку и шагает само: щелчок любой длины — ровно
 *  строка; тачпад шлёт поток мелких сдвигов, и строка набегает за каждые
 *  `ITEM_H` пути. Возвращает шаг: −1, 0 или +1. */
export function createWheelStepper(rowPx: number = ITEM_H) {
  let acc = 0;
  return (deltaY: number, deltaMode = 0): -1 | 0 | 1 => {
    // deltaMode 1/2 — строки и страницы (Firefox): это всегда щелчок.
    const px = deltaMode === 0 ? deltaY : Math.sign(deltaY) * rowPx;
    // Смена направления — новый счёт, иначе первый щелчок назад гасил бы
    // остаток прежнего хода.
    if (Math.sign(px) !== Math.sign(acc)) acc = 0;
    acc += px;
    if (Math.abs(acc) < rowPx) return 0;
    acc = 0;
    return px > 0 ? 1 : -1;
  };
}
