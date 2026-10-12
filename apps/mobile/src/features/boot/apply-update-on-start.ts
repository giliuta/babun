import { Platform } from "react-native";
import * as Updates from "expo-updates";

// СВЕЖИЙ КОД — С ПЕРВОГО ЗАПУСКА (владелец 12.10: «первая установка показала
// без регистрации, закрыл и открыл — появилась; почему не сразу?»).
//
// Обновление по воздуху `expo-updates` по умолчанию лишь СКАЧИВАЕТ при
// запуске, а включает на следующем: первый запуск идёт кодом из магазина.
// Здесь, пока на экране заставка, спрашиваем, есть ли свежее; есть — берём и
// перезапускаемся сразу, так человек видит новое с первого открытия. Сети нет
// или ответ дольше нескольких секунд — работаем тем, что есть, а скачанное
// включится в следующий раз, как и раньше.
//
// Срабатывает у тех, в ком этот код уже есть (следующая сборка магазина и
// всё, что пришло по воздуху после неё).

/** Позже этого от запуска не перезапускаемся: человек уже начал что-то делать
 *  на экране, и перезапуск выбросил бы набранное. */
const DEADLINE_MS = 5000;
let started = false;

function within<T>(ms: number, work: Promise<T>): Promise<T | null> {
  return Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

export function applyUpdateOnStart(): void {
  if (started || Platform.OS === "web" || __DEV__ || !Updates.isEnabled) return;
  started = true;
  const startedAt = Date.now();
  const left = () => DEADLINE_MS - (Date.now() - startedAt);
  void (async () => {
    try {
      const check = await within(left(), Updates.checkForUpdateAsync());
      if (!check?.isAvailable) return;
      const fetched = await within(left(), Updates.fetchUpdateAsync());
      if (!fetched?.isNew || left() <= 0) return;
      await Updates.reloadAsync();
    } catch {
      // Нет сети, сервер не ответил — работаем тем, что есть.
    }
  })();
}
