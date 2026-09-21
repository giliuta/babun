import type { MemberAccessMap } from "@/features/access/access-map";
import { accessGate } from "@/features/access/my-access";
import type { UserRole } from "@/features/settings/role-policy";

/**
 * ЧТО РИСУЕТ ВКЛАДКА «ФИНАНСЫ».
 *
 *   • `open`     — сами финансы: владелец, или сотрудник, у которого «Доходы и
 *                  расходы» хотя бы в одном его календаре — «Смотрит» или
 *                  «Меняет»;
 *   • `locked`   — та же страница серым и по нулям, лента команд живая
 *                  (`LockedFinances`; владелец 15.09: «не „раздел
 *                  недоступен“ — всё серое, всё по нулям, но переключаться
 *                  можно»);
 *   • `loading`  — сотрудник, чья карта прав ещё едет: ни денег, ни серого;
 *   • `boundary` — роль ещё едет или человека в компании больше нет: это
 *                  решает граница прав (спиннер, «нет связи», стирание
 *                  компании с телефона).
 *
 * РЕШАЕТ УРОВЕНЬ, А НЕ РОЛЬ (этап 2 доступа, владелец 15.09: «чтоб всё сразу
 * менялось в живом времени»). Раньше ворота смотрели только роль, и мастеру
 * финансы были закрыты, какие бы права ни выставил владелец. Карта прав
 * приходит без неживых блоков, поэтому ворота открываются ровно тогда, когда
 * сервер начинает проверять блок, — не раньше.
 *
 * Лист без react-native — чтобы правило проверялось тестом.
 */
export type FinancesGate = "open" | "locked" | "loading" | "boundary";

export function financesGate(
  role: UserRole | null | undefined,
  map: MemberAccessMap | undefined,
): FinancesGate {
  if (!role) return "boundary";
  const gate = accessGate({ role, map, blockKey: "finance.operations", scope: "calendar" });
  if (gate === "loading") return "loading";
  if (gate === "read" || gate === "write") return "open";
  return "locked";
}
