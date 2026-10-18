import type { MemberAccessMap } from "@/session/access-map";
import { accessGate, moneyKey } from "@/session/my-access";
import type { UserRole } from "@/session/role-policy";

/**
 * ЧТО РИСУЕТ ВКЛАДКА «ФИНАНСЫ».
 *
 *   • `open`     — сами финансы: владелец, или сотрудник, у которого «Доходы»
 *                  или «Расходы» хотя бы в одном его календаре не закрыты;
 *   • `locked`   — та же страница серым и по нулям, лента команд живая
 *                  (`LockedFinances`: не «раздел недоступен», а всё серое и по
 *                  нулям, но переключаться можно);
 *   • `loading`  — сотрудник, чья карта прав ещё едет: ни денег, ни серого;
 *   • `boundary` — роль ещё едет или человека в компании больше нет: это
 *                  решает граница прав (спиннер, «нет связи», стирание
 *                  компании с телефона).
 *
 * РЕШАЕТ УРОВЕНЬ, А НЕ РОЛЬ: права меняются в живом времени. Если бы ворота смотрели
 * только роль, мастеру финансы были бы закрыты, какие бы права ни выставил владелец. Карта прав
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
  // Две стороны денег (срез 2а): открывает любая из них.
  const gates = (["income", "expense"] as const).map((side) =>
    accessGate({ role, map, blockKey: moneyKey(map, side), scope: "calendar" }),
  );
  if (gates.includes("loading")) return "loading";
  if (gates.some((gate) => gate === "read" || gate === "write")) return "open";
  return "locked";
}
