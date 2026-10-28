import { Dimensions, PixelRatio, Platform } from "react-native";
import { reloadApp } from "./reload-app";

// КРУПНЫЙ ШРИФТ ПОМЕНЯЛИ НА ХОДУ — КОД ЗАПУСКАЕТСЯ ЗАНОВО (Android).
//
// Android пересоздаёт окно с новым размером шрифта, а код остаётся прежним, и
// прежними остаются замеры текста: строка рисуется новым кеглем в ширине,
// измеренной старым. Шапки резались посреди слова — «Lis», «October 20…»,
// «Bab…» — до следующего запуска (QAA, font_scale 1.15 → 1.3). Свежий запуск
// мерит всё заново, и тот же экран при том же шрифте целый. Поэтому смена
// шрифта — как смена языка: новый запуск кода (`reloadApp`). Черновики записи
// и клиента лежат на телефоне и переживают его.
//
// ЧЕГО ЭТО НЕ ДЕЛАЕТ. Шрифт крупнее — новый кегль сразу. Шрифт мельче —
// текст остаётся прежнего кегля до следующего холодного запуска (его держит
// натив), но мерится и рисуется одним размером и больше не режется. iOS
// меряет текст с учётом размера шрифта сам — там не нужно.

/** Шрифт поменялся настолько, что прежние замеры врут. */
export function fontScaleMoved(before: number, now: number): boolean {
  return Math.abs(now - before) >= 0.01;
}

/** Подписка на смену размера шрифта; возвращает отписку. */
export function watchFontScaleReload(): () => void {
  if (Platform.OS !== "android") return () => {};
  const atStart = PixelRatio.getFontScale();
  const sub = Dimensions.addEventListener("change", ({ window }) => {
    if (fontScaleMoved(atStart, window.fontScale)) reloadApp();
  });
  return () => sub.remove();
}
