// `request_id` ОПЕРАЦИИ ПРИВЯЗАН К ЕЁ СОДЕРЖИМОМУ — как у переводов
// (`transfer-intent.ts`).
//
// Повтор после потерянного ответа обязан попасть в тот же серверный дедуп:
// тот же id, и сервер отдаст уже записанную строку, а не вторую. Но если
// человек успел поправить сумму (100 → 120), тот же id упёрся бы в строку со
// старой суммой, и экран объявил бы «добавлена» про деньги, которых в базе
// нет. Поэтому в ключе — всё, что человек правит перед повтором; правка любого
// поля даёт новое намерение и новый id.
//
// Модуль без зависимостей: генератор id приходит снаружи, и правило проверяет
// тест без окружения RN.

/** Всё, что различает намерения. */
export interface OperationIntentFields {
  type: string;
  /** Итоговая сумма в центах (с учётом налога сверху). */
  amountCents: number;
  categoryId: string | null;
  accountId: string | null;
  teamId: string | null;
  date: string;
  time: string | null;
  notes: string;
  vatMode: string | null;
  vatRate: number;
  masterId: string | null;
  clientId: string | null;
  receiptUrl: string | null;
  debtId: string | null;
}

/** Заметка — свободный текст, поэтому ключ собирается JSON-массивом, а не
 *  склейкой: разделитель внутри текста не сдвинет границы полей. */
export function operationIntentKey(f: OperationIntentFields): string {
  return JSON.stringify([
    f.type,
    f.amountCents,
    f.categoryId,
    f.accountId,
    f.teamId,
    f.date,
    f.time,
    f.notes.trim(),
    f.vatMode,
    f.vatRate,
    f.masterId,
    f.clientId,
    f.receiptUrl,
    f.debtId,
  ]);
}

/** Память «ключ → id» на время жизни формы: повтор без правок — тот же id,
 *  правка — новый ключ и новый id. */
export function createIntentRequestIds<F>(
  uuid: () => string,
  keyOf: (fields: F) => string,
): {
  idFor(fields: F): string;
  /** Намерение закрыто (записано) или форма открыта заново: следующее
   *  получит свежий id даже с теми же полями. */
  done(): void;
} {
  let current: { key: string; id: string } | null = null;
  return {
    idFor(fields) {
      const key = keyOf(fields);
      if (current?.key !== key) current = { key, id: uuid() };
      return current.id;
    },
    done() {
      current = null;
    },
  };
}

export function createOperationRequestIds(uuid: () => string) {
  return createIntentRequestIds(uuid, operationIntentKey);
}

/** Возврат: намерение — «эта операция и эта сумма в центах». */
export function createRefundRequestIds(uuid: () => string) {
  return createIntentRequestIds(uuid, (f: { txId: string; cents: number }) => `${f.txId}|${f.cents}`);
}
