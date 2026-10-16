// КЛЮЧ НАМЕРЕНИЯ ПЕРЕВОДА — «тот же request_id только для того же перевода».
//
// `request_id` привязан к НАМЕРЕНИЮ, а не к открытию листа: повтор после
// потерянного ответа обязан попасть в тот же серверный дедуп и вернуть ТОТ ЖЕ
// перевод, а не второй. Но сервер, увидев знакомый id с ДРУГИМИ параметрами,
// отвечает «Запрос перевода уже использован с другими данными» — поэтому в
// ключе обязано быть всё, что человек может поправить перед повтором: счета,
// сумма, день и комментарий. Без дня в ключе смена «Когда» после потерянного
// ответа упиралась в этот отказ, не сказав, что перевод уже записан старой
// датой.
//
// Модуль нарочно без зависимостей: генератор id передаётся снаружи, и логика
// «правка — новое намерение» проверяется тестом без окружения RN.

import { createRequestIntent } from "./request-intent";

/** Всё, что различает намерения перевода. */
export interface TransferIntentFields {
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  /** День перевода `YYYY-MM-DD` — сегодняшний входит в ключ наравне с задним. */
  occurredOn: string;
  note: string;
}

/** Комментарий стоит последним: он единственный со свободным текстом, и в
 *  хвосте не сдвигает границы остальных полей. */
export function transferIntentKey(fields: TransferIntentFields): string {
  return [
    fields.fromAccountId,
    fields.toAccountId,
    fields.amountCents,
    fields.occurredOn,
    fields.note.trim(),
  ].join("|");
}

/** Память «ключ → id» намерения перевода (`request-intent.ts`): повтор без
 *  правок — тот же id и серверный дедуп, правка любого поля — новый ключ и
 *  новый id. */
export function createTransferRequestIds(uuid: () => string): {
  idFor(fields: TransferIntentFields): string;
  done(): void;
} {
  const intent = createRequestIntent(uuid);
  return {
    idFor: (fields) => intent.idFor(transferIntentKey(fields)),
    done: intent.done,
  };
}
