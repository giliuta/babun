// ПОПЫТКА ПЛАТЕЖА ИНВОЙСА — ОДНА НА ПОПЫТКУ, А НЕ НА ТАП.
//
// Сервер считает платёж с тем же `request_id` одним и тем же платежом. Новый id
// на каждый тап превращал потерянный ответ в двойную оплату: человек не видел
// исхода, нажимал снова — и вторая проводка ложилась поверх первой. Поэтому
// попытка живёт, пока не закончилась успехом, и повторный тап с теми же
// счётом и суммой несёт тот же id.
//
// ДАТА ПЛАТЕЖА — ЧАСТЬ ПОПЫТКИ. Платёж, начатый до полуночи и повторённый
// после, — тот же платёж, и сервер сверяет повтор по всем полям: с новой датой
// он отвечал «Идентификатор платежа уже использован с другими данными», хотя
// деньги записаны. Повтор несёт дату первой попытки.

export interface PayAttempt {
  key: string;
  id: string;
  occurredOn: string;
}

interface PayAttemptRef {
  current: PayAttempt | null;
}

export function payAttemptKey(input: {
  invoiceId: string;
  accountId: string;
  amountCents: number;
}): string {
  return `${input.invoiceId}|${input.accountId}|${input.amountCents}`;
}

/** Текущая попытка; для новой (другой ключ) — свежий id и сегодняшняя дата. */
export function payAttempt(
  ref: PayAttemptRef,
  key: string,
  make: () => string,
  today: string,
): PayAttempt {
  if (ref.current?.key !== key) ref.current = { key, id: make(), occurredOn: today };
  return ref.current;
}

/** Попытка удалась — следующий платёж по тем же данным уже новый. */
export function finishPayAttempt(ref: PayAttemptRef): void {
  ref.current = null;
}
