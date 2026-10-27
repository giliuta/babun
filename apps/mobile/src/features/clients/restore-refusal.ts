import { isHumanText } from "@babun/shared/i18n/runtime";

/** Причина отказа возврата — словами, или `undefined`. Берём только наш
 *  текст для людей (например, «номер уже у другого клиента»): сырой текст
 *  Postgres или сети человеку ничего не говорит, для него остаётся общая
 *  фраза. На другом языке наш отказ уже переведён при `throw`, поэтому
 *  проверка — «фраза из словаря», а не «есть кириллица». */
export function restoreRefusalWords(reasons: readonly unknown[]): string | undefined {
  for (const reason of reasons) {
    const message = reason instanceof Error ? reason.message.trim() : "";
    if (message && isHumanText(message)) return message;
  }
  return undefined;
}
