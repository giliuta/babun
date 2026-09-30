import { UIManager } from "react-native";

// ЕСТЬ ЛИ НАТИВНАЯ ВЬЮХА В ЭТОЙ СБОРКЕ (владелец 2026-09-10: «нажимаю на карту
// — сразу ошибка; сделай, чтобы такого больше никогда не было»).
//
// Ловушка, на которую наступили с `react-native-maps`: пакет ставится в
// `package.json`, JS-часть требуется без единой жалобы, компонент `MapView`
// импортируется и выглядит живым — а нативной вьюхи `AIRMap` в уже собранном
// дев-клиенте нет. Падает поэтому не импорт, а РЕНДЕР: «View config not found
// for component `AIRMap`», и это не пойманная ошибка рендера, то есть красный
// экран вместо всего экрана, а не пустая карточка.
//
// try/catch вокруг `require` от этого не спасает — он проверяет JS. Спрашивать
// надо у самого приложения: знает ли оно такую вьюху. `UIManager` в новой
// архитектуре отвечает через слой совместимости, поэтому берём оба способа и
// любую осечку считаем «нет»: соврать «есть» здесь дороже, чем соврать «нет».
type ViewManagerLookup = {
  hasViewManagerConfig?: (name: string) => boolean;
  getViewManagerConfig?: (name: string) => unknown;
};

export function hasNativeView(name: string): boolean {
  const ui = UIManager as unknown as ViewManagerLookup;
  try {
    if (typeof ui.hasViewManagerConfig === "function") {
      return ui.hasViewManagerConfig(name);
    }
    return ui.getViewManagerConfig?.(name) != null;
  } catch {
    return false;
  }
}
