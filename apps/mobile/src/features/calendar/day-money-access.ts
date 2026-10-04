import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { MemberAccessMap } from "@/features/access/access-map";
import { accessGate, type AccessGate, type AccessGateInput } from "@/features/access/my-access";
import { asRecordWindow, recordWindowStart } from "@/features/appointments/record-window";

// ДОХОД И РАСХОД ДНЯ — ПРАВО КАЛЕНДАРЯ, А НЕ «ФИНАНСОВ» (владелец 04.10:
// «функция расход/доход должна быть в доступах календаря — финансы этого
// календаря за день, не общие финансы; он не может оттуда увидеть общую
// картину»).
//
// Полоса под сеткой, клетка месяца и лист «Финансы дня» открываются правом
// `calendar.day_money` (Скрыты · Видит · Вносит), а не доходами и расходами
// «Финансов». Деньгами дня считаются оплаты записей и операции, внесённые
// кнопкой листа (`from_calendar`); расход на рекламу из «Финансов» сюда не
// попадает. «Вносит» заводит свои доходы и расходы из календаря и правит или
// удаляет только их — ровно то, что пускает сервер
// (`finance_transactions_*_day_money`, миграция 20261004080218).
//
// В ЗЕРКАЛЕ («его глазами») токен владельца, и сервер отдаёт всё: строки
// режутся здесь тем же правилом — календарь с правом и «Ограничения»
// календаря (`calendar.window`), как окно сервера
// (`member_day_money_window_starts`).

export const DAY_MONEY_KEY = "calendar.day_money";

interface Reader {
  role: AccessGateInput["role"];
  map: MemberAccessMap | undefined;
}

/** Уровень права в календаре; без календаря — лучший из его календарей. */
export function dayMoneyGate({ role, map, teamId }: Reader & { teamId?: string | null }): AccessGate {
  return accessGate({ role, map, blockKey: DAY_MONEY_KEY, scope: "calendar", teamId });
}

export const seesDayMoney = (gate: AccessGate): boolean => gate === "read" || gate === "write";

/** Строка журнала — деньги дня календаря: оплата записи или операция,
 *  внесённая из календаря. Прочее — касса «Финансов», календарю чужое. */
export function isDayMoneyRow(
  tx: Pick<FinanceTransaction, "appointment_id"> & { from_calendar?: boolean | null },
): boolean {
  return !!tx.appointment_id || tx.from_calendar === true;
}

type TxLike = Pick<FinanceTransaction, "team_id" | "occurred_on">;

/** Видит ли человек эту строку денег дня (`today` — сегодня по часам бизнеса). */
export function dayMoneyRowReadable({ role, map, today }: Reader & { today: string }) {
  return (tx: TxLike): boolean => {
    if (role === "owner" || map?.isOwner) return true;
    if (!map || !tx.team_id) return false;
    if (!seesDayMoney(dayMoneyGate({ role, map, teamId: tx.team_id }))) return false;
    const level = map.calendars[tx.team_id]?.["calendar.window"];
    // Ступени в карте нет (старая карта) — окна нет: прятать по догадке хуже.
    if (level === undefined) return true;
    const start = recordWindowStart(asRecordWindow(level), today);
    return start === null || tx.occurred_on >= start;
  };
}

/** Можно ли править и удалять эту операцию из календаря: владельцу — любую,
 *  партнёру с «Вносит» — только свою, внесённую из календаря. */
export function canEditDayMoneyRow(input: Reader & {
  teamId: string | null | undefined;
  createdBy: string | null | undefined;
  me: string | null | undefined;
  fromCalendar: boolean | undefined;
}): boolean {
  const { role, map, teamId, createdBy, me, fromCalendar } = input;
  if (role === "owner" || map?.isOwner) return true;
  if (!teamId || !fromCalendar || !me || createdBy !== me) return false;
  return dayMoneyGate({ role, map, teamId }) === "write";
}
