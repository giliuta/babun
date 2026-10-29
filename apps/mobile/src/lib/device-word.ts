import { Platform } from "react-native";
import { deviceKindOf, type DeviceKind } from "./device-kind";

// СЛОВО ЭТОГО УСТРОЙСТВА — ОДНО НА ПРОДУКТ. Строки «на этом iPhone» жили
// по экранам веткой `android ? телефон : iPhone`, и на сайте человек читал
// про iPhone, которого у него нет («Синхронизация», «Помощь», «Этот
// телефон» в Кабинете). Здесь три вида и готовые обороты: каждый — целая
// фраза-ключ словаря, поэтому падеж и предлог переводятся вместе со словом,
// а предложение собирается шаблоном (`Сохранено ${onThisDevice()}`).
// Правило выбора вида — `device-kind.ts`, его держит тест.

export type { DeviceKind };

/** Вид устройства, на котором открыто приложение. */
export function deviceKind(): DeviceKind {
  return deviceKindOf(Platform.OS);
}

/** «на этом iPhone» · «на этом телефоне» · «в этом браузере». */
export function onThisDevice(): string {
  const kind = deviceKind();
  if (kind === "browser") return "в этом браузере";
  if (kind === "phone") return "на этом телефоне";
  return "на этом iPhone";
}

/** Заголовок блока Кабинета: «Этот телефон» · «Этот браузер». */
export function thisDeviceTitle(): string {
  return deviceKind() === "browser" ? "Этот браузер" : "Этот телефон";
}

/** Устройство для письма в поддержку: «iPhone 18.0» · «Android 36» · «Браузер …». */
export function deviceForSupport(): string {
  const kind = deviceKind();
  if (kind === "browser") {
    const agent = typeof navigator !== "undefined" ? navigator.userAgent : "";
    return `Браузер ${agent}`.trim();
  }
  return `${kind === "phone" ? "Android" : "iPhone"} ${String(Platform.Version)}`;
}
