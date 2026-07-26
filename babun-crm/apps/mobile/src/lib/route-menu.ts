import { ActionSheetIOS, Linking } from "react-native";
import {
  buildMapUrl,
  parseAddress,
} from "@babun/shared/common/utils/map-links";
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
 *  контролов не держим, вызывающая сторона просто не рисует кнопку.
 *
 *  Присланная ссылка без координат (короткая maps.app.goo.gl и подобные) —
 *  НЕ выбор: Apple Картам такую ссылку можно отдать только текстовым
 *  запросом `?q=https%3A%2F%2F…`, и они честно ищут «https://…» вместо
 *  адреса. Ссылку открываем как есть — её разберёт то приложение, которое
 *  её понимает. Выбор карты остаётся там, где обе карты справятся: адрес
 *  текстом или координаты. */
export function openRouteMenu(target: string): void {
  const clean = target.trim();
  if (!clean) return;
  haptics.tap();
  const parsed = parseAddress(clean);
  if (parsed.isUrl && !parsed.coords) {
    void Linking.openURL(
      clean.startsWith("http") ? clean : `https://${clean}`,
    );
    return;
  }
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
