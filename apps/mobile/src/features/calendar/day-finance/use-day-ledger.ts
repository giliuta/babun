import { useEffect, useMemo, useState } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { DayExtrasMap } from "@babun/shared/local/day-extras";
import { getDayExtras } from "@babun/shared/local/day-extras";
import { formatHM } from "@/features/appointments/helpers";
import { useInvoicedAppointmentSet } from "@/features/calendar/use-invoiced-appointments";
import { dayMoney } from "@/features/calendar/day-money";
import { dayMoneyRowReadable } from "@/features/calendar/day-money-access";
import { awaitingAnswer } from "@/features/finances/ledger-select";
import { useAppointmentsLedger, useTransactions } from "@/features/finances/queries";
import type { useFinanceServices } from "@/features/calendar/queries";
import type { useClients } from "@/features/clients/queries";
import type { useFinanceCategories } from "@/features/finances/queries";
import type { useMyAccess } from "@/session/access-queries";
import type { useCurrentRole } from "@/session/tenant";
import type { DayView } from "./types";

/** The shown day, its ledger rows and the money of its four tiles. */
export function useDayLedger({
  dateYmd,
  appointments,
  teamId,
  businessToday,
  nowHmProp,
  findRecord,
  role,
  myAccess,
  services,
  extrasMap,
  clients,
  categories,
}: {
  dateYmd: string | null;
  appointments: Appointment[];
  teamId: string | null;
  businessToday: string;
  nowHmProp?: string;
  findRecord?: (id: string) => Appointment | undefined;
  role: ReturnType<typeof useCurrentRole>["data"];
  myAccess: ReturnType<typeof useMyAccess>["data"];
  services: ReturnType<typeof useFinanceServices>;
  extrasMap: DayExtrasMap;
  clients: NonNullable<ReturnType<typeof useClients>["data"]>;
  categories: NonNullable<ReturnType<typeof useFinanceCategories>["data"]>;
}) {
  const [view, setView] = useState<DayView>("all");

  // Лист остаётся смонтированным с dateYmd=null: последний открытый день и
  // его записи держим снимком, чтобы содержимое не мигало на анимации ухода.
  // Новый день открывается планом целиком (плитка не выбрана); на том же
  // дне повторное открытие плитку не сбрасывает (после формы операции
  // человек возвращается туда, откуда ушёл).
  const [shownYmd, setShownYmd] = useState<string | null>(dateYmd);
  const [shownAppts, setShownAppts] = useState<Appointment[]>(appointments);
  useEffect(() => {
    if (dateYmd == null) return;
    if (dateYmd !== shownYmd) setView("all");
    setShownYmd(dateYmd);
    setShownAppts(appointments);
  }, [dateYmd, appointments, shownYmd]);
  const ymd = shownYmd ?? businessToday;
  const appts = shownAppts;
  // Часы бизнеса, а не телефона — как у сетки.
  const nowHm = nowHmProp ?? formatHM(new Date());

  const txQuery = useTransactions(ymd, ymd, {
    brigadeIds: teamId ? [teamId] : undefined,
    enabled: shownYmd != null,
  });
  // Операции записей дня — в любой день внесения: предоплата за запись
  // стоит в дне записи (правило в `day-money.ts`).
  const recordsTxQuery = useAppointmentsLedger(
    useMemo(() => appts.map((a) => a.id), [appts]),
    { enabled: shownYmd != null },
  );
  // Обе выборки вместе; к дню строки относит `dayMoney` — и прошлый день,
  // подсунутый keepPreviousData, туда не попадёт. «Его глазами» сервер
  // отдаёт всё (токен ваш): строки режутся его правом календаря и
  // «Ограничениями», как у полосы под сеткой.
  const dayTx = useMemo(() => {
    const readable = dayMoneyRowReadable({ role, map: myAccess, today: businessToday });
    return [
      ...(txQuery.data ?? []),
      ...(recordsTxQuery.isPlaceholderData ? [] : recordsTxQuery.data ?? []),
    ].filter(readable);
  }, [txQuery.data, recordsTxQuery.isPlaceholderData, recordsTxQuery.data, role, myAccess, businessToday]);
  // Загрузка — пока ответ в пути (`awaitingAnswer`). По одному
  // `isPlaceholderData` день БЕЗ ЗАПИСЕЙ, открытый после дня с записями,
  // крутил загрузку вечно: запрос по записям у него выключен, а заглушку
  // прошлого дня react-query держит и выключенному.
  const ledgerLoading = awaitingAnswer(txQuery) || awaitingAnswer(recordsTxQuery);

  const legacyExtras = useMemo(
    () => (shownYmd ? getDayExtras(extrasMap, teamId, shownYmd) : []),
    [extrasMap, teamId, shownYmd],
  );
  // ДЕНЬГИ ДНЯ — ТЕМ ЖЕ ПРАВИЛОМ, ЧТО ПОЛОСА ПОД СЕТКОЙ (`day-money.ts`):
  // деньги записи — в дне записи, операция без записи — в своём дне, события —
  // не деньги.
  const invoiced = useInvoicedAppointmentSet();
  const money = useMemo(
    () =>
      dayMoney({
        ymd,
        appointments: appts,
        transactions: dayTx,
        services,
        teamId,
        extras: legacyExtras,
        businessToday,
        nowHm,
        invoiced,
      }),
    [ymd, appts, dayTx, services, teamId, legacyExtras, businessToday, nowHm, invoiced],
  );
  const { incomeRows, expenseRows, debtRecords, plannedRecords } = money;

  const apptById = useMemo(
    () => new Map(money.records.map((a) => [a.id, a])),
    [money.records],
  );
  /** Запись строки леджера: своего дня — из записей дня, чужого — у экрана. */
  const recordOf = (tx: FinanceTransaction): Appointment | undefined =>
    tx.appointment_id
      ? apptById.get(tx.appointment_id) ?? findRecord?.(tx.appointment_id)
      : undefined;
  const nameById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.full_name])),
    [clients],
  );
  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  // ПЛАН ДНЯ — всё по времени: записи дня (оплачено · долг · ожидается) и
  // операции, которых запись дня не показывает: ручные и оплаты ДРУГИХ дней
  // (предоплата сегодня за завтра — сегодняшние деньги). Оплата записи этого
  // дня не дублирует саму запись.
  const timeOfTx = (tx: FinanceTransaction): string =>
    (tx.appointment_id ? apptById.get(tx.appointment_id)?.time_start : null) ||
    tx.occurred_time ||
    "24:00";
  const dayPlan = useMemo(() => {
    const items: { key: string; time: string; record?: Appointment; tx?: FinanceTransaction }[] = [];
    for (const a of money.records) {
      items.push({ key: `a:${a.id}`, time: a.time_start, record: a });
    }
    for (const tx of incomeRows) {
      if (tx.appointment_id && apptById.has(tx.appointment_id)) continue;
      items.push({ key: `t:${tx.id}`, time: timeOfTx(tx), tx });
    }
    for (const tx of expenseRows) {
      if (tx.appointment_id && apptById.has(tx.appointment_id) && !tx.id.startsWith("material:")) continue;
      items.push({ key: `t:${tx.id}`, time: timeOfTx(tx), tx });
    }
    return items.sort((x, y) => x.time.localeCompare(y.time));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- timeOfTx читает apptById, он в зависимостях
  }, [money.records, incomeRows, expenseRows, apptById]);

  return {
    view,
    setView,
    shownYmd,
    ymd,
    ledgerLoading,
    legacyExtras,
    money,
    incomeRows,
    expenseRows,
    debtRecords,
    plannedRecords,
    apptById,
    recordOf,
    nameById,
    categoryName,
    dayPlan,
  };
}
