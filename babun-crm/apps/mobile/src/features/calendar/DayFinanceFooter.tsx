import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  computeDayFinance,
  getDayMode,
} from "@babun/shared/local/finance/day-summary";
import { getDayExtras } from "@babun/shared/local/day-extras";
import { formatYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import { RAIL_W } from "@/features/calendar/DayView";
import { useDayExtras, useFinanceServices } from "@/features/calendar/queries";

// Thin money strip pinned under the day/week grid — per-day Доход (green) over
// Расход (red), aligned to the day columns (gutter width = the hour rail).
//
// Web parity (web DayFinanceFooter + shared day-summary): «Доход» is
// contextual — past days show what was actually EARNED (paid), today and
// future show the day's PLANNED revenue so a booked tomorrow never reads €0.
// «Расход» comes from computeDayFinance (materials + manual expenses +
// day extras), never a hardcoded zero.
export function DayFinanceFooter({
  days,
  appointments,
  teamId,
  todayYmd,
  onTapDay,
}: {
  days: Date[];
  appointments: Appointment[];
  /** Active team filter — day extras are stored per (team, date), so with
   *  no team selected extras are skipped (same as web's personal tab). */
  teamId: string | null;
  /** Business-timezone today (YYYY-MM-DD) — drives earned vs planned. */
  todayYmd: string;
  onTapDay?: (d: Date) => void;
}) {
  const t = useThemeColors();
  const sharedServices = useFinanceServices();
  const { data: extrasMap = {} } = useDayExtras();

  const byDate = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const arr = m.get(a.date) ?? [];
      arr.push(a);
      m.set(a.date, arr);
    }
    return m;
  }, [appointments]);

  // computeDayFinance проходит записи+услуги каждого дня — без мемо это
  // пересчитывалось на каждый кадр зума/пейджинга.
  const rows = useMemo(
    () =>
      days.map((d) => {
        const ymd = formatYMD(d);
        const totals = computeDayFinance(
          byDate.get(ymd) ?? [],
          sharedServices,
          getDayExtras(extrasMap, teamId, ymd),
        );
        return {
          d,
          ymd,
          // Past → actually earned; today/future → planned revenue.
          income:
            getDayMode(ymd, todayYmd) === "past"
              ? totals.earned
              : totals.planned,
          spent: totals.spent,
          // VoiceOver: «пятница, 18 июля», а не сырое YYYY-MM-DD.
          dateLabel: d.toLocaleDateString("ru-RU", {
            weekday: "long",
            day: "numeric",
            month: "long",
          }),
        };
      }),
    [days, byDate, sharedServices, extrasMap, teamId, todayYmd],
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
        paddingVertical: 4,
      }}
    >
      {/* Лейблы — нейтральный t.sub: семантический цвет несут только суммы.
          11pt — минимум читаемости iOS (было 9pt, владелец читает деньги
          десятки раз в день). */}
      <View style={{ width: RAIL_W, paddingRight: 6, alignItems: "flex-end", justifyContent: "center" }}>
        <Text style={{ fontSize: 11, fontWeight: "600", color: t.sub }} maxFontSizeMultiplier={1.3}>Доход</Text>
        <Text style={{ fontSize: 11, fontWeight: "600", color: t.sub }} maxFontSizeMultiplier={1.3}>Расход</Text>
      </View>
      {rows.map(({ d, ymd, income, spent, dateLabel }, i) => {
        return (
          <Pressable
            key={ymd}
            onPress={() => onTapDay?.(d)}
            accessibilityRole="button"
            accessibilityLabel={`Финансы за ${dateLabel}: доход ${formatEUR(income)}, расход ${formatEUR(spent)}`}
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
            <Text
              style={{ fontSize: days.length > 3 ? 11 : 12, fontWeight: "600", color: income !== 0 ? t.success : t.faint }}
              className="tabular-nums"
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
            >
              {formatEUR(income)}
            </Text>
            <Text
              style={{ fontSize: days.length > 3 ? 11 : 12, fontWeight: "600", color: spent !== 0 ? t.danger : t.faint }}
              className="tabular-nums"
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
            >
              {formatEUR(spent)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
