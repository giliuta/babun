import { useMemo } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import { getDayExtras } from "@babun/shared/local/day-extras";
import { formatHM } from "@/features/appointments/helpers";
import { useDayExtras, useFinanceServices } from "@/features/calendar/queries";
import { dayMoney, type DayMoney } from "@/features/calendar/day-money";
import { useAppointmentsLedger, useTransactions } from "@/features/finances/queries";
import { awaitingAnswer } from "@/features/finances/ledger-select";
import { useMyAccess } from "@/session/access-queries";
import { useCurrentRole } from "@/session/tenant";
import { dayMoneyRowReadable } from "@/features/calendar/day-money-access";
import { ymd } from "./month-grid";

/** Money of every cell of the month, by the same rule as the week strip. */
export function useMonthMoney({
  cells,
  financeAppointments,
  financeByDay,
  teamId,
  todayYmd,
  nowHmProp,
  showFinance,
}: {
  cells: Date[];
  financeAppointments: Appointment[];
  financeByDay: Map<string, Appointment[]>;
  teamId: string | null;
  todayYmd?: string;
  nowHmProp?: string;
  showFinance: boolean;
}) {
  const services = useFinanceServices();
  const { data: extrasMap = {} } = useDayExtras();

  // ДЕНЬГИ КЛЕТКИ — ТЕМ ЖЕ ПРАВИЛОМ, ЧТО ПОЛОСА НЕДЕЛИ (`day-money.ts`):
  // деньги записи — в дне записи (владелец 2026-10-01), операция из
  // календаря — в дне операции, касса «Финансов» сюда не входит (04.10).
  const todayStr = todayYmd ?? ymd(new Date());
  const ledgerQuery = useTransactions(ymd(cells[0]), ymd(cells[cells.length - 1]), {
    brigadeIds: teamId ? [teamId] : undefined,
    enabled: showFinance,
  });
  // Только записи клеток месяца: денежный набор экрана бывает шире.
  const recordIds = useMemo(() => {
    const from = ymd(cells[0]);
    const to = ymd(cells[cells.length - 1]);
    return financeAppointments.filter((a) => a.date >= from && a.date <= to).map((a) => a.id);
  }, [financeAppointments, cells]);
  const recordsLedgerQuery = useAppointmentsLedger(recordIds, { enabled: showFinance });
  // Чужой ПЕРИОД не выдаём за свой, пока свой в пути (смена месяца). У
  // месяца без записей запрос по записям выключен и держит заглушку вечно —
  // по одному `isPlaceholderData` клетки такого месяца теряли и операции без
  // записи (повторный аудит 03.10).
  //
  // Операции ЗАПИСЕЙ не гасятся вовсе: это строки с номером записи, и к дню
  // их относит `dayMoney` по записям клетки — строки заглушки чужих записей ни
  // в один день не лягут, а свои верны. Гашение по ним стирало зелёные и
  // красные суммы всего месяца на каждое создание или перенос записи, пока
  // список номеров перечитывался.
  const ledgerAwaiting = awaitingAnswer(ledgerQuery);
  // «Его глазами» — его правом календаря и «Ограничениями», как полоса недели.
  const role = useCurrentRole().data;
  const myAccess = useMyAccess().data;
  const ledger = useMemo(() => {
    if (ledgerAwaiting) return undefined;
    const readable = dayMoneyRowReadable({ role, map: myAccess, today: todayStr });
    return [...(ledgerQuery.data ?? []), ...(recordsLedgerQuery.data ?? [])].filter(readable);
  }, [ledgerAwaiting, ledgerQuery.data, recordsLedgerQuery.data, role, myAccess, todayStr]);

  // Финансы всех дней одной мемоизацией (аудит: расчёт гонялся по 42
  // клеткам в каждом рендере). Дни без записей, но с операциями леджера или
  // ручными операциями (extras) тоже попадают в карту.
  const totalsByDay = useMemo(() => {
    const m = new Map<string, DayMoney>();
    if (!showFinance) return m;
    const dates = new Set(financeByDay.keys());
    // Дни записей уже в наборе; операция из календаря добавляет свой день.
    for (const tx of ledger ?? []) if (!tx.appointment_id && tx.from_calendar) dates.add(tx.occurred_on);
    if (teamId) {
      const prefix = `${teamId}:`;
      for (const k of Object.keys(extrasMap)) {
        if (k.startsWith(prefix)) dates.add(k.slice(prefix.length));
      }
    }
    // Часы бизнеса, а не телефона (аудит 2026-10-03): запись, кончившаяся в
    // 17:00 по команде, при 23:30 на телефоне в другом поясе уже была
    // «долгом», хотя сетка считала её идущей.
    const nowHm = nowHmProp ?? formatHM(new Date());
    for (const date of dates) {
      m.set(
        date,
        dayMoney({
          ymd: date,
          appointments: financeByDay.get(date) ?? [],
          transactions: ledger ?? [],
          services,
          teamId,
          extras: getDayExtras(extrasMap, teamId, date),
          businessToday: todayStr,
          nowHm,
        }),
      );
    }
    return m;
  }, [financeByDay, ledger, services, extrasMap, teamId, showFinance, todayStr, nowHmProp]);

  return { todayStr, totalsByDay };
}
