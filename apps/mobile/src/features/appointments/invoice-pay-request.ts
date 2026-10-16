// ИДЕНТИФИКАТОР ПЛАТЕЖА ИНВОЙСА — ОДИН НА ПОПЫТКУ, А НЕ НА ТАП.
//
// Сервер считает платёж с тем же `request_id` одним и тем же платежом. Новый id
// на каждый тап превращал потерянный ответ в двойную оплату: человек не видел
// исхода, нажимал снова — и вторая проводка ложилась поверх первой. Поэтому id
// живёт, пока попытка не закончилась успехом, и повторный тап с теми же
// счётом и суммой несёт тот же id. Другой счёт или сумма — другая попытка.
// Дата в ключ не входит: платёж, начатый до полуночи и повторённый после, — тот
// же платёж.

export interface PayAttempt {
  key: string;
  id: string;
}

export interface PayAttemptRef {
  current: PayAttempt | null;
}

export function payAttemptKey(input: {
  invoiceId: string;
  accountId: string;
  amountCents: number;
}): string {
  return `${input.invoiceId}|${input.accountId}|${input.amountCents}`;
}

/** Id текущей попытки; для новой попытки (другой ключ) выдаёт свежий. */
export function payAttemptId(ref: PayAttemptRef, key: string, make: () => string): string {
  if (ref.current?.key !== key) ref.current = { key, id: make() };
  return ref.current.id;
}

/** Попытка удалась — следующий платёж по тем же данным уже новый. */
export function finishPayAttempt(ref: PayAttemptRef): void {
  ref.current = null;
}
