import { Alert, Platform } from "react-native";
import { tDynamic } from "@babun/shared/i18n/runtime";
import { toastOutsideTree } from "@/components/ui/Toast";

/** Ошибку с объяснением читают дольше обычного тоста. */
const NOTIFY_MS = 5000;

// СООБЩЕНИЕ, КОТОРОЕ НЕЛЬЗЯ ПОТЕРЯТЬ — ОДНА ТОЧКА НА ВЕСЬ ПРОДУКТ.
//
// `Alert.alert` в react-native-web — буквально `static alert() {}`: пустое
// тело, ничего не рисуется, кнопки не нажимаются. Поэтому в браузере любая
// ошибка сохранения уходила в никуда, и человек был уверен, что записалось.
//
// НА ВЕБЕ — ТОСТ ОШИБКИ, А НЕ ОКНО БРАУЗЕРА. Системный `window.alert`
// останавливал всю страницу, и одна и та же беда звучала двумя голосами:
// занятый номер — окном браузера, неверный — тостом. Глобальная сетка ошибок
// мутаций, sync-runtime и выход зовут сообщение из-за пределов React-дерева,
// поэтому тост берётся через хост `ToastProvider` (`toastOutsideTree`); его
// нет (страница ещё не поднялась) — тогда окно браузера, чтобы не потерять.
// Подтверждения с кнопками живут отдельно — см. ./confirm.
//
// Текст здесь часто пришёл с сервера (`error.message` из функции базы) —
// сборка его не переводила, поэтому он переводится при показе (`tDynamic`).
export function notify(rawTitle: string, rawMessage?: string): void {
  const title = tDynamic(rawTitle);
  const message = rawMessage ? tDynamic(rawMessage) : rawMessage;
  if (Platform.OS === "web") {
    const text = message ? `${title} — ${message}` : title;
    if (!toastOutsideTree(text, "error", NOTIFY_MS)) globalThis.alert?.(text);
    return;
  }
  Alert.alert(title, message);
}
