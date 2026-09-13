// ЗАГОЛОВОК КОМПАНИИ: ЯВНЫЙ ПОБЕЖДАЕТ ФОНОВЫЙ.
//
// Обёртка `fetch` ставит `x-babun-tenant` из активной компании устройства на
// каждый запрос. Но прогрев ЧУЖОЙ компании должен уметь назвать её сам, не
// трогая активную: привязанный клиент (`bind-tenant.ts`) ставит заголовок на
// билдер, а обёртка обязана его не затирать.
//
// Безопасности это не меняет: сервер считает заголовок ВОПРОСОМ и отвечает
// NULL (ноль строк) на компанию, в которой человека нет, — см. миграцию
// `active_tenant_from_verified_header`. Кто бы ни поставил заголовок, ответ
// даёт `tenant_members`.
//
// Лист без зависимостей: `supabase.ts` тянет react-native, и правило внутри
// него было бы непроверяемым.

export const TENANT_HEADER = "x-babun-tenant";

/** Ставит фоновую компанию, если вызывающий не назвал свою. Возвращает те же
 *  заголовки — удобно для цепочки. */
export function applyTenantHeader(
  headers: Headers,
  ambientTenantId: string | null,
): Headers {
  if (ambientTenantId && !headers.has(TENANT_HEADER)) {
    headers.set(TENANT_HEADER, ambientTenantId);
  }
  return headers;
}
