import { Linking } from "react-native";
import {
  buildMapUrl,
  parseAddress,
  type MapService,
} from "@babun/shared/common/utils/map-links";
import { chooseOption } from "@/lib/choose";
import { haptics } from "@/lib/haptics";

// «МАРШРУТ» — один экшен-шит на весь продукт: экран записи, строка объекта,
// страница объекта. Раньше жил копией внутри app/book/index.tsx.
//
// Выбор карты — через общий chooseOption: у одних диспетчеров пробки в Google,
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
  const parsed = parseAddress(clean);
  if (parsed.isUrl && !parsed.coords) {
    haptics.tap();
    void Linking.openURL(clean.startsWith("http") ? clean : `https://${clean}`);
    return;
  }
  // Четыре сервиса, а не два (владелец 2026-07-27: «оно определяет Google,
  // Waze, Яндекс и так далее»). buildMapUrl умеет все четыре; какие из них
  // предлагать — станет настройкой клиентов, когда владелец скажет свой набор.
  const services: { label: string; service: MapService }[] = [
    { label: "Google Карты", service: "google" },
    { label: "Apple Карты", service: "apple" },
    { label: "Waze", service: "waze" },
    { label: "Яндекс Карты", service: "yandex" },
  ];
  void chooseOption(
    clean,
    services.map((s) => ({ label: s.label })),
  ).then((index) => {
    const picked = index === null ? null : services[index];
    const url = picked ? buildMapUrl(picked.service, clean) : null;
    if (url) void Linking.openURL(url);
  });
}
