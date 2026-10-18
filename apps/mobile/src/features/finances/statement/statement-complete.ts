import type { MemberAccessMap } from "@/session/access-map";
import { moneyKey } from "@/session/my-access";
import type { UserRole } from "@/session/role-policy";
import { asRecordWindow, recordWindowStart } from "@/features/appointments/record-window";
import { levelInCalendar } from "../finance-page-access";

// ВИДНЫ ЛИ ЧЕЛОВЕКУ ВСЕ ОПЕРАЦИИ СЧЁТА.
//
// Операции выписки читаются под правами человека (RLS), а «На счёте» сервер
// считает по всем. Владельцу они совпадают. Партнёру — только если ему открыты
// доходы, расходы и переводы команды счёта и нет «Ограничений» по сроку:
// иначе «Остаток на конец» показал бы число, которое не сойдётся с настоящим
// остатком, и выписка выглядела бы сверкой, не будучи ею.

export function statementIsComplete(input: {
  role: UserRole | null | undefined;
  map: MemberAccessMap | undefined;
  /** Команда счёта; `null` — счёт без команды. */
  teamId: string | null;
  /** Сегодня по часам бизнеса — для окна «Ограничений». */
  today: string;
}): boolean {
  const { role, map, teamId, today } = input;
  if (role === "owner" || map?.isOwner === true) return true;
  // Права не пришли или счёт ничей — полноту доказать нельзя.
  if (role === undefined || role === null || !map || !teamId) return false;
  const open = (key: string): boolean =>
    levelInCalendar({ role, map }, key, teamId) !== "locked";
  if (!open(moneyKey(map, "income")) || !open(moneyKey(map, "expense")) || !open("finance.accounts")) {
    return false;
  }
  const window = map.calendars[teamId]?.["finance.window"];
  if (window === undefined) return true;
  return recordWindowStart(asRecordWindow(window), today) === null;
}
