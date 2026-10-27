// СКОЛЬКО КАЛЕНДАРЕЙ В ПОДПИСКЕ — общее для `tariff-checkout` (оплата и
// сверка «sync») и `stripe-webhook` (сверка перед счётом).
//
// Платит живой календарь, в котором есть работа: запись, операция финансов
// или SMS. Календарь только с событиями бесплатен. Правило живёт в функции
// базы `paid_calendar_count` (миграция `paid_calendar_count`): у служебного
// ключа нет права читать операции финансов, а функция определителя отвечает
// одним числом. Приложение считает тем же правилом сам
// (`session/calendar-price.ts`), совпадение держит тест.

/** Календарей в подписке — не меньше одного: оплачивают, чтобы работать.
 *  Сбой чтения — исключение, а не «один календарь»: молчаливая единица
 *  выставила бы счёт за один календарь при пяти рабочих. */
// deno-lint-ignore no-explicit-any
export async function paidCalendars(service: any, tenantId: string): Promise<number> {
  const { data, error } = await service.rpc("paid_calendar_count", { p_tenant: tenantId });
  if (error || typeof data !== "number") {
    throw new Error(`paid calendars unreadable: ${error?.code ?? "no count"}`);
  }
  return Math.max(1, data);
}
