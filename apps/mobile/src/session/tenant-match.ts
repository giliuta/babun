// ОТВЕТ ЛОЖИТСЯ ТОЛЬКО ПОД КЛЮЧ СВОЕЙ КОМПАНИИ.
//
// Ключ запроса называет компанию, и всё, что под ним лежит, экраны считают
// ответом про неё: роль, тариф, права. Запрос сам ходит привязанным клиентом,
// но профиль и карта прав несут id компании, и сверка с ключом — последняя
// линия: ответ другой компании отбрасывается ошибкой, прежние данные ключа
// остаются на месте.

/** Бросает, если ответ пришёл про другую компанию, чем называет ключ. */
export function assertAnswerOfTenant(
  answerTenantId: string | null | undefined,
  keyTenantId: string | null | undefined,
): void {
  if (!answerTenantId || !keyTenantId || answerTenantId !== keyTenantId) {
    throw new Error("Tenant-scoped answer belongs to another tenant than its query key");
  }
}
