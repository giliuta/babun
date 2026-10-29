import { Text, View, useWindowDimensions } from "react-native";
import { CalendarCheck, CalendarClock, CalendarX2, type LucideIcon } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import type { ClientInvoicing } from "@babun/shared/local/selectors/client-stats";
import { DayDivider } from "@/components/ui/DayDivider";
import { SelectRow } from "@/components/ui/select-rows";
import { humanDayYear } from "@/features/appointments/helpers";
import { visitStatus, type VisitStatusKind } from "@/features/clients/visit-status";
import { useRecordColor } from "@/features/clients/use-record-color";
import { useThemeColors, type ThemeColors } from "@/theme/colors";

// ЗАПИСЬ КЛИЕНТА — ОТДЕЛЬНОЙ ПЛАШКОЙ, КАК ТЕГИ И МЕТКИ: отдельные друг от
// друга компактные блоки. Это наш `SelectRow`: плашка белая (без заливки
// фона), слева плитка цветом записи со значком; цвет — тот же, что у блока
// записи в календаре (`useRecordColor`).
//   · ДАТА — НЕ В ПЛАШКЕ, А ЗАГОЛОВКОМ НАД НЕЙ, как дни в «Финансах»,
//     с годом («ЧТ, 1 ОКТЯБРЯ 2026»: клиент бывает прошлогодний);
//   · название — команда, подпись — время;
//   · справа — только число своим цветом, в столбике одной ширины:
//     оплачено — зелёным, долг — янтарём, впереди — кобальтом.
// Плашки стоят в `SelectList` — с воздухом между ними, без швов.

/** «чт, 1 октября 2026» — день с годом всегда (общий `humanDayYear`). */
function visitDay(ymd: string): string {
  return humanDayYear(ymd);
}

/** Заголовок дня над плашками — тем же шрифтом и местом, что день в
 *  «Финансах» (`RecordRowsPanel`). */
export function VisitDayHeader({ date }: { date: string }) {
  return <DayDivider label={visitDay(date)} />;
}

/** Цвет числа — тем же языком, что метка визита в списке клиентов. */
function amountColor(kind: VisitStatusKind, t: ThemeColors): string {
  if (kind === "paid") return t.success;
  if (kind === "debt") return t.warning;
  if (kind === "ahead") return t.accent;
  return t.faint;
}

/** Значок — о самой записи: впереди, отменена или уже была. */
function statusIcon(kind: VisitStatusKind): LucideIcon {
  if (kind === "ahead") return CalendarClock;
  if (kind === "cancelled") return CalendarX2;
  return CalendarCheck;
}

/** Столбик числа — под «€1 250» при крупном тексте: числа стоят ровно. */
const AMOUNT_COLUMN = 64;

const noop = () => {};

interface VisitTeam {
  name: string;
  is_active: boolean;
  color?: string | null;
}

export function VisitRow({
  appointment: a,
  team,
  today,
  showMoney,
  onPress,
  invoicing,
}: {
  appointment: Appointment;
  /** Команда записи из справочника с архивом; нет — без подписи команды. */
  team: VisitTeam | undefined;
  today: string;
  /** Деньги клиента — за правом «История»: нет — числа нет. */
  showMoney: boolean;
  /** Нет — плашка показание (запись открыть нельзя). */
  onPress?: () => void;
  /** Работа под инвойсом: её долг — остаток инвойса (`client-invoicing.ts`). */
  invoicing?: ClientInvoicing;
}) {
  const t = useThemeColors();
  const { fontScale } = useWindowDimensions();
  const status = visitStatus(a, today, showMoney, invoicing);
  const hue = useRecordColor(a, team?.color, today) || t.accent;
  const teamName = team ? (team.is_active ? team.name : `${team.name} · в архиве`) : "";
  const time = a.time_start ? a.time_start.slice(0, 5) : "";
  // ПРОШЕДШАЯ НЕЗАКРЫТАЯ ЗАПИСЬ — НЕ ВИЗИТ (`isVisit`): в ленте она стоит с
  // пометкой, чтобы число визитов над лентой сходилось с тем, что в ней видно.
  const unclosed =
    a.status !== "cancelled" && a.status !== "completed" && !!a.date && a.date < today;
  const sub = [time, unclosed ? "не закрыта" : ""].filter(Boolean).join(" · ");
  return (
    <SelectRow
      icon={statusIcon(status.kind)}
      color={hue}
      // Фон — белый, цвет записи — только у плитки.
      plain
      title={teamName || "Запись"}
      subtitle={sub || undefined}
      accessibilityLabel={[visitDay(a.date), time, teamName, unclosed ? "не закрыта" : "", status.label]
        .filter(Boolean)
        .join(", ")}
      onPress={onPress ?? noop}
      trailing={
        showMoney ? (
          <View style={{ minWidth: Math.round(AMOUNT_COLUMN * Math.min(fontScale, 1.3)), alignItems: "flex-end" }}>
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={{
                fontSize: 15,
                fontWeight: "700",
                color: amountColor(status.kind, t),
                fontVariant: ["tabular-nums"],
                textDecorationLine: status.kind === "cancelled" ? "line-through" : "none",
              }}
            >
              {status.text}
            </Text>
          </View>
        ) : undefined
      }
    />
  );
}
