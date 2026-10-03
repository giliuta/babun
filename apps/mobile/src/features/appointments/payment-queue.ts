import type { QueryClient } from "@tanstack/query-core";

// ДЕНЬГИ ОДНОЙ ЗАПИСИ — ПО ОЧЕРЕДИ (аудит 2026-10-03).
//
// «Снять» в тосте нажимают и тогда, когда сама оплата ещё летит на сервер
// (~0,8 с). Две независимые мутации уходили вместе: снятие могло обогнать
// оплату и получить «Платёж не найден в заявке» — деньги оставались, а
// человек видел ошибку; а если не обгоняло, ответ оплаты ставил плитку
// «оплачено» поверх мгновенного снятия, и она мигала
// «оплачено → снято → оплачено → снято».
//
// Общий `scope` у оплаты и снятия одной записи заставляет react-query
// отправлять их строго друг за другом. А ответ, за которым в очереди уже
// стоит следующий шаг, экран не перерисовывает: каноническую строку
// положит ответ последнего.

export function paymentScope(
  appointmentId: string | null | undefined,
): { id: string } | undefined {
  return appointmentId ? { id: `appointment-payment:${appointmentId}` } : undefined;
}

/** За этим ответом в очереди записи стоит ещё один денежный шаг. Зовут из
 *  `onSuccess`: сама мутация в этот момент ещё «pending». */
export function laterPaymentQueued(qc: QueryClient, appointmentId: string): boolean {
  const id = paymentScope(appointmentId)?.id;
  const pending = qc
    .getMutationCache()
    .findAll({ predicate: (m) => m.options.scope?.id === id && m.state.status === "pending" });
  return pending.length > 1;
}
