import { ActionSheetIOS, Linking } from "react-native";
import { buildMapUrl } from "@babun/shared/common/utils/map-links";
import { haptics } from "@/lib/haptics";

// «МАРШРУТ» — один экшен-шит на весь продукт: экран записи, строка объекта,
// страница объекта. Раньше жил копией внутри app/book/index.tsx.
//
// Выбор карты — нативным ActionSheetIOS: у одних диспетчеров пробки в Google,
// у других CarPlay с Apple Картами, и навязывать одну карту нельзя. Кастомный
// лист снизу для этого владелец отверг — это системное «что сделать».
//
// Приоритет цели: присланный клиентом пин (Location.mapUrl) выше текстового
// адреса — на кипрских виллах текстовый адрес часто не прокладывается.

/** Что открывать: пин важнее текста. Пустая строка → маршрута нет. */
export function routeTarget(
  mapUrl: string | null | undefined,
  address: string | null | undefined,
): string {
  return (mapUrl || "").trim() || (address || "").trim();
}

/** Открывает выбор карты для цели. Молча выходит, если цели нет — мёртвых
 *  контролов не держим, вызывающая сторона просто не рисует кнопку. */
export function openRouteMenu(target: string): void {
  const clean = target.trim();
  if (!clean) return;
  haptics.tap();
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: clean,
      options: ["Apple Карты", "Google Карты", "Отмена"],
      cancelButtonIndex: 2,
    },
    (index) => {
      const url =
        index === 0
          ? buildMapUrl("apple", clean)
          : index === 1
            ? buildMapUrl("google", clean)
            : null;
      if (url) void Linking.openURL(url);
    },
  );
}
