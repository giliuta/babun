/** Причина отказа возврата — словами, или `undefined`. Берём только наш
 *  русский текст (например, «номер уже у другого клиента»): сырой текст
 *  Postgres или сети человеку ничего не говорит, для него остаётся общая
 *  фраза. */
export function restoreRefusalWords(reasons: readonly unknown[]): string | undefined {
  for (const reason of reasons) {
    const message = reason instanceof Error ? reason.message : "";
    if (/[А-Яа-яЁё]/.test(message)) return message.trim();
  }
  return undefined;
}
