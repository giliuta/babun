import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import { pluralRecord } from "@babun/shared/common/utils/pluralize";
import {
  computeDayFinance,
  getDayMode,
} from "@babun/shared/local/finance/day-summary";
import { getDayExtras } from "@babun/shared/local/day-extras";
import { useDayExtras, useFinanceServices } from "@/features/calendar/queries";
import { useThemeColors } from "@/theme/colors";

// «6 записей · €450 · 3 в работе · 1 без оплаты» — утренний взгляд
// диспетчера (web DaySummaryStrip, только режим «День»). Тонированные
// пиллы под шапкой; «без оплаты» тапается.
//
// Денежный пилл считается тем же computeDayFinance + getDayMode, что и
// футер Доход/Расход под сеткой (прошлое → заработано, сегодня/будущее →
// план): две денежные поверхности одного экрана обязаны сходиться в одну
// цифру. Web-эталон суммировал оплаченное по всем не-отменённым записям и
// расходился с футером (аудит 2026-07-14 [ux]) — здесь сознательный отход.
export function DaySummaryStrip({
  appointments,
  teamId,
  dateYmd,
  todayYmd,
  onUnpaidTap,
}: {
  /** Записи ПРОСМАТРИВАЕМОГО дня — денежный набор команды (без фильтра
   *  «Скрывать отменённые»: счётчики пропускают отменённые сами). */
  appointments: Appointment[];
  /** Активная команда — day extras хранятся по (team, date). */
  teamId: string | null;
  /** Просматриваемый день (YYYY-MM-DD). */
  dateYmd: string;
  /** Бизнес-сегодня (YYYY-MM-DD) — «заработано или план», как в футере. */
  todayYmd: string;
  onUnpaidTap?: () => void;
}) {
  const t = useThemeColors();
  const services = useFinanceServices();
  const { data: extrasMap = {} } = useDayExtras();
  const stats = useMemo(() => {
    let count = 0;
    let inProgress = 0;
    let unpaid = 0;
    for (const apt of appointments) {
      if (apt.status === "cancelled") continue;
      if (apt.kind !== "work") continue;
      count++;
      if (apt.status === "in_progress") inProgress++;
      if (apt.status === "completed" && getDebtAmount(apt) > 0) unpaid++;
    }
    const totals = computeDayFinance(
      appointments,
      services,
      getDayExtras(extrasMap, teamId, dateYmd),
    );
    const income =
      getDayMode(dateYmd, todayYmd) === "past" ? totals.earned : totals.planned;
    return { count, income, inProgress, unpaid };
  }, [appointments, services, extrasMap, teamId, dateYmd, todayYmd]);

  if (stats.count === 0) return null;

  return (
    <View
      className="flex-row items-center gap-2 px-3 py-1.5"
      style={{
        backgroundColor: t.surface,
        borderBottomWidth: 1,
        borderBottomColor: t.separator,
      }}
    >
      <Pill label={pluralRecord(stats.count)} bg={t.fill} fg={t.ink} />
      {stats.income > 0 ? (
        <Pill
          label={formatEUR(stats.income)}
          bg={`${t.success}1f`}
          fg={t.success}
        />
      ) : null}
      {stats.inProgress > 0 ? (
        <Pill
          label={`${stats.inProgress} в работе`}
          bg={`${t.accent}1f`}
          fg={t.accent}
        />
      ) : null}
      {stats.unpaid > 0 ? (
        <Pill
          label={`${stats.unpaid} без оплаты`}
          bg={`${t.danger}1a`}
          fg={t.danger}
          onPress={onUnpaidTap}
        />
      ) : null}
    </View>
  );
}

function Pill({
  label,
  bg,
  fg,
  onPress,
}: {
  label: string;
  bg: string;
  fg: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? label : undefined}
      className="rounded-full px-2.5 py-1 active:opacity-70"
      style={{ minHeight: onPress ? 44 : undefined, justifyContent: "center", backgroundColor: bg }}
    >
      <Text
        className="tabular-nums"
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        style={{ fontSize: 12, fontWeight: "600", color: fg }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
