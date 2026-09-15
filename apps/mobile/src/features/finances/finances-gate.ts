import { can, type UserRole } from "@/features/settings/role-policy";

/**
 * ЧТО РИСУЕТ ВКЛАДКА «ФИНАНСЫ» ПРИ ЭТОЙ РОЛИ.
 *
 *   • `open`     — сами финансы;
 *   • `locked`   — та же страница серым и по нулям, лента команд живая
 *                  (`LockedFinances`; владелец 15.09: «не „раздел
 *                  недоступен“ — всё серое, всё по нулям, но переключаться
 *                  можно»);
 *   • `boundary` — роль ещё едет или человека в компании больше нет: это
 *                  решает граница прав (спиннер, «нет связи», стирание
 *                  компании с телефона).
 *
 * Лист без react-native — чтобы правило проверялось тестом.
 */
export type FinancesGate = "open" | "locked" | "boundary";

export function financesGate(role: UserRole | null | undefined): FinancesGate {
  if (!role) return "boundary";
  return can(role, "view-finances") ? "open" : "locked";
}
