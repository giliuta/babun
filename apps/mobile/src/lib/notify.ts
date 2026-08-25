import { Alert, Platform } from "react-native";

// СООБЩЕНИЕ, КОТОРОЕ НЕЛЬЗЯ ПОТЕРЯТЬ — ОДНА ТОЧКА НА ВЕСЬ ПРОДУКТ.
//
// `Alert.alert` в react-native-web — буквально `static alert() {}`: пустое
// тело, ничего не рисуется, кнопки не нажимаются. Поэтому в браузере любая
// ошибка сохранения уходила в никуда, и человек был уверен, что записалось.
//
// Тост здесь не подходит: его мост живёт в React-дереве (ToastProvider), а
// глобальная сетка ошибок мутаций, sync-runtime и выход из аккаунта зовут
// сообщение ИЗ-ЗА пределов дерева. Пока такого моста нет, на вебе показываем
// системное окно браузера — оно всегда видно и не отнимает единственный слот
// у листа подтверждения (ChoiceSheetHost). Подтверждения с кнопками живут
// отдельно — см. ./confirm.
export function notify(title: string, message?: string): void {
  if (Platform.OS === "web") {
    globalThis.alert?.(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}
