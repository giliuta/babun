import { isUserRole, type UserRole } from "@/features/settings/role-policy";

/** Роль в аккаунте страницы Кабинета — из СВОИХ членств (04.10): аккаунт со
 *  ссылки (`?tenant=`) на слово не берут, чужой идентификатор ничего не
 *  открывает. `undefined` — членства ещё едут, `null` — его там нет. */
export function roleInAccount(
  memberships: readonly { tenantId: string; role: string }[] | undefined,
  tenantId: string,
): UserRole | null | undefined {
  if (!memberships) return undefined;
  const row = memberships.find((m) => m.tenantId === tenantId);
  return row && isUserRole(row.role) ? row.role : null;
}
