// ПАМЯТЬ ПАРЫ «ОТКУДА → КУДА» (ТЗ §5.2).
//
// Команда сдаёт выручку на один и тот же счёт изо дня в день, поэтому второй
// вопрос листа отвечается заранее. Это ТОЛЬКО предзаполнение: если счёт
// закрыли, удалили или пара стала недопустимой, подстановки просто нет —
// проверку делает `defaultTransferTarget`, а не это хранилище.
//
// Местно (MMKV), а не в базе: это привычка ЭТОГО телефона, а не свойство
// фирмы. Ключ живёт под общим префиксом `babun:` — значит смена тенанта
// сносит его вместе со всем остальным (auth-clear.ts), и чужая пара из
// предыдущей учётки не всплывает в новой.

import { getStorage } from "@babun/shared/storage";

const KEY_PREFIX = "babun:transfer:last:";

export function loadLastTransferTarget(fromAccountId: string): string | null {
  return getStorage().getRaw(`${KEY_PREFIX}${fromAccountId}`);
}

export function rememberTransferTarget(
  fromAccountId: string,
  toAccountId: string,
): void {
  getStorage().setRaw(`${KEY_PREFIX}${fromAccountId}`, toAccountId);
}
