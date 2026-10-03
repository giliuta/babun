import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import { getDayExtras } from "@babun/shared/local/day-extras";
import { formatYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import { RAIL_W } from "@/features/calendar/DayView";
import { useDayExtras, useFinanceServices } from "@/features/calendar/queries";
import { dayMoney } from "@/features/calendar/day-money";
import { useAppointmentsLedger, useTransactions } from "@/features/finances/queries";
import { awaitingAnswer } from "@/features/finances/ledger-select";

// Thin money strip pinned under the day/week grid — per-day Доход (green) over
// Расход (red), aligned to the day columns (gutter width = the hour rail).
//
// «ДОХОД» — ТОЛЬКО ПРИШЕДШИЕ ДЕНЬГИ, В ЛЮБОЙ ДЕНЬ (владелец 2026-09-24: «при
// открытии записывает в доход ожидаемую сумму; если не заплатили — это не
// считается доходом»). Раньше сегодня и будущие дни показывали ПЛАН — сумму
// записей, оплаченных или нет, — и неоплаченная запись на €135 стояла зелёным
// «доходом». План дня живёт в шторке дня (тап по столбцу), а полоса под
// сеткой говорит только о деньгах, которые уже есть.
//
// ДЕНЬГИ ЗАПИСИ — В ДНЕ ЗАПИСИ (владелец 2026-10-01, правило в
// `day-money.ts`): предоплата, внесённая сегодня за завтрашнюю запись, стоит
// доходом завтра и переезжает вместе с записью; операция без записи (доход
// или расход с категорией) — в своём дне. Расход — расходы журнала тем же
// правилом и материалы записей дня.
export function DayFinanceFooter({
  days,
  appointments,
  teamId,
  onTapDay,
  showIncome = true,
  showExpense = true,
}: {
  days: Date[];
  appointments: Appointment[];
  /** Active team filter — day extras are stored per (team, date), so with
   *  no team selected extras are skipped (same as web's personal tab). */
  teamId: string | null;
  /** Сегодня в поясе компании. Полоса его больше не читает (доход — только
   *  оплаченное), проп остаётся, чтобы не трогать экран календаря. */
  todayYmd?: string;
  onTapDay?: (d: Date) => void;
  /** Доходы и расходы — два права (срез 2а): строка стороны, которую человек
   *  не видит, не рисуется — иначе «Расход €0» читался бы как правда. */
  showIncome?: boolean;
  showExpense?: boolean;
}) {
  const t = useThemeColors();
  const sharedServices = useFinanceServices();
  const { data: extrasMap = {} } = useDayExtras();
  // Журнал видимых дней — операции без записи по дню операции.
  const rangeFrom = days.length > 0 ? formatYMD(days[0]) : "";
  const rangeTo = days.length > 0 ? formatYMD(days[days.length - 1]) : "";
  const ledgerQuery = useTransactions(rangeFrom, rangeTo, {
    brigadeIds: teamId ? [teamId] : undefined,
    enabled: days.length > 0,
  });
  // Операции видимых записей — в любой день внесения (предоплата неделей
  // раньше тоже стоит в дне записи).
  const recordsLedgerQuery = useAppointmentsLedger(
    useMemo(() => appointments.map((a) => a.id), [appointments]),
    { enabled: days.length > 0 },
  );
  const recordsLedger = recordsLedgerQuery.data;
  // ДЕНЕГ ЕЩЁ НЕТ — НЕ НОЛЬ (повторный аудит 03.10). Пока журнал новой недели
  // в пути, запрос отдаёт заглушкой строки ПРОШЛОГО периода, и дни новой
  // недели секунду стояли «Доход €0» — у среды с оплатой €131 тоже. Ноль
  // здесь — утверждение о деньгах; пока ответа нет, в клетке прочерк.
  // Только пока запрос в пути (`awaitingAnswer`): у недели без записей
  // запрос по записям выключен, а заглушку прошлой недели react-query
  // показывает и выключенному — полоса стояла бы прочерками навсегда.
  //
  // Прочерк — по смене ПЕРИОДА, а не по каждому перечитыванию операций
  // записей: создание события или перенос записи меняют список номеров, и вся
  // неделя на секунду уходила в прочерки. Строки операций записей несут номер
  // записи, к дню их относит `dayMoney` — заглушка с прежним списком верна для
  // всех прежних записей. Прочерк от них — только когда ответа нет вовсе.
  const settling =
    awaitingAnswer(ledgerQuery) ||
    (awaitingAnswer(recordsLedgerQuery) && !recordsLedgerQuery.isPlaceholderData);
  const ledger = useMemo(
    () => [...(ledgerQuery.data ?? []), ...(recordsLedger ?? [])],
    [ledgerQuery.data, recordsLedger],
  );

  const byDate = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const arr = m.get(a.date) ?? [];
      arr.push(a);
      m.set(a.date, arr);
    }
    return m;
  }, [appointments]);

  // Расчёт дня проходит записи+услуги каждого дня — без мемо это
  // пересчитывалось на каждый кадр зума/пейджинга.
  const rows = useMemo(
    () =>
      days.map((d) => {
        const ymd = formatYMD(d);
        const money = dayMoney({
          ymd,
          appointments: byDate.get(ymd) ?? [],
          transactions: ledger,
          services: sharedServices,
          teamId,
          extras: getDayExtras(extrasMap, teamId, ymd),
          // Полоса говорит только о пришедшем и ушедшем: долг и план ей не
          // нужны, «сейчас» для них не важно.
          businessToday: ymd,
          nowHm: "00:00",
        });
        return {
          d,
          ymd,
          income: money.income,
          spent: money.expense,
          // VoiceOver: «пятница, 18 июля», а не сырое YYYY-MM-DD.
          dateLabel: d.toLocaleDateString("ru-RU", {
            weekday: "long",
            day: "numeric",
            month: "long",
          }),
        };
      }),
    [days, byDate, sharedServices, extrasMap, ledger, teamId],
  );

  // САМА ПОЛОСА БОЛЬШЕ НЕ РЕШАЕТ, ПОКАЗЫВАТЬСЯ ЛИ ЕЙ. Здесь стояло «пустая
  // неделя — вернуть null», чтобы не занимать две строки семью нулями. Со
  // стороны это выглядело пропажей функции: владелец открыл пустую неделю новой
  // команды и не нашёл денег вовсе (2026-08-17). Ответ теперь даёт человек —
  // тумблер «Доход и расход под сеткой» в «Что показывать», и решает его
  // РОДИТЕЛЬ: полоса, которую попросили, обязана стоять на месте даже с нулями.

  return (
    <View
      style={{
        flexDirection: "row",
        borderTopWidth: 1,
        // В тон линиям сетки над футером — один шов, а не два диалекта.
        borderTopColor: `${t.ink}33`,
        backgroundColor: t.surface,
        // 7 + две строки ≈ 44pt мишени у ячейки дня (аудит 24.09: было ~38).
        paddingVertical: 7,
      }}
    >
      {/* Лейблы — нейтральный t.sub: семантический цвет несут только суммы.
          11pt — минимум читаемости iOS (было 9pt, владелец читает деньги
          десятки раз в день). */}
      <View style={{ width: RAIL_W, paddingRight: 6, alignItems: "flex-end", justifyContent: "center" }}>
        {/* Одной строкой: крупный шрифт системы рвал «Доход» на «Дохо» и
            «д» в 42pt рельса (повторный аудит 03.10). */}
        {showIncome ? (
          <Text style={{ fontSize: 11, fontWeight: "600", color: t.sub }} maxFontSizeMultiplier={1.3} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>Доход</Text>
        ) : null}
        {showExpense ? (
          <Text style={{ fontSize: 11, fontWeight: "600", color: t.sub }} maxFontSizeMultiplier={1.3} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>Расход</Text>
        ) : null}
      </View>
      {rows.map(({ d, ymd, income, spent, dateLabel }, i) => {
        return (
          <Pressable
            key={ymd}
            onPress={() => onTapDay?.(d)}
            // Мишень — во всю высоту полосы: поле полосы тоже нажимает день.
            hitSlop={{ top: 7, bottom: 7 }}
            accessibilityRole="button"
            accessibilityLabel={`Финансы за ${dateLabel}: ${
              settling
                ? "загружаются"
                : [
                    showIncome ? `доход ${formatEUR(income)}` : null,
                    showExpense ? `расход ${formatEUR(spent)}` : null,
                  ]
                    .filter(Boolean)
                    .join(", ")
            }`}
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: 1,
              borderLeftWidth: i === 0 ? 0 : 1,
              borderLeftColor: `${t.ink}33`,
            }}
          >
            {/* €0 — приглушённый t.faint: зелёный/красный только там, где
                есть реальные деньги (цвет = смысл). */}
            {showIncome ? (
              <Text
                style={{ fontVariant: ["tabular-nums"], fontSize: days.length > 3 ? 11 : 12, fontWeight: "600", color: income !== 0 && !settling ? t.success : t.faint }}
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
              >
                {settling ? "—" : formatEUR(income)}
              </Text>
            ) : null}
            {showExpense ? (
              <Text
                style={{ fontVariant: ["tabular-nums"], fontSize: days.length > 3 ? 11 : 12, fontWeight: "600", color: spent !== 0 && !settling ? t.danger : t.faint }}
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
              >
                {settling ? "—" : formatEUR(spent)}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
