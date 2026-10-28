import { Linking } from "react-native";
import { confirmThen } from "@/lib/confirm";

/** КАМЕРА ЗАПРЕЩЕНА — СРАЗУ ДВЕРЬ В НАСТРОЙКИ. После «Больше не спрашивать»
 *  Android (и iOS после первого отказа) системного окна второй раз не
 *  показывает: запрос молча возвращает отказ, и текстом пути человек не
 *  находил переключатель. Кнопка ведёт в настройки Babun, где он и лежит. */
export function explainCameraDenied(): void {
  confirmThen(
    "Нет доступа к камере",
    {
      message: "Разрешите камеру: Настройки → Babun → Камера.",
      confirmLabel: "Открыть настройки",
    },
    () => void Linking.openSettings(),
  );
}
