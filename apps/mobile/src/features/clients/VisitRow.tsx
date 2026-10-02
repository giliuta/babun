import { Text, View, useWindowDimensions } from "react-native";
import { CalendarCheck, CalendarClock, CalendarX2, type LucideIcon } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { SelectRow } from "@/components/ui/select-rows";
import { humanDay } from "@/features/appointments/helpers";
import { visitStatus, type VisitStatusKind } from "@/features/clients/visit-status";
import { useRecordColor } from "@/features/clients/use-record-color";
import { useThemeColors, type ThemeColors } from "@/theme/colors";

// ЗАПИСЬ КЛИЕНТА — ОТДЕЛЬНОЙ ПЛАШКОЙ, КАК ТЕГИ И МЕТКИ (владелец 03.10:
// «полноценные блоки отдельные друг от друга, красивые, компактные — типа
// такого плана», показав список тегов). Это наш `SelectRow`: плашка залита
// тинтом цвета записи, слева плитка тем же цветом со значком; цвет — тот
// же, что у блока записи в календаре (`useRecordColor`).
//   · ДАТА — НЕ В ПЛАШКЕ, А ЗАГОЛОВКОМ НАД НЕЙ, как дни в «Финансах»
//     (владелец 03.10: «разделитель даты — перед плашкой, как в финансах»),
//     с годом («ЧТ, 1 ОКТЯБРЯ 2026»: клиент бывает прошлогодний);
//   · название — команда, подпись — время;
//   · справа — только число своим цветом, в столбике одной ширины:
//     оплачено — зелёным, долг — янтарём, впереди — кобальтом.
// Плашки стоят в `SelectList` — с воздухом между ними, без швов.

/** «чт, 1 октября 2026» — день с годом всегда. */
export function visitDay(ymd: string): string {
  const year = ymd.slice(0, 4);
  return `${humanDay(ymd)} ${year}`;
}

/** Заголовок дня над плашками — тем же шрифтом и местом, что день в
 *  «Финансах» (`RecordRowsPanel`). */
export function VisitDayHeader({ date }: { date: string }) {
  const t = useThemeColors();
  return (
    <View className="px-4 pb-1.5 pt-3">
      <Text
        maxFontSizeMultiplier={1.3}
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: t.sub }}
      >
        {visitDay(date)}
      </Text>
    </View>
  );
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

export interface VisitTeam {
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
}: {
  appointment: Appointment;
  /** Команда записи из справочника с архивом; нет — без подписи команды. */
  team: VisitTeam | undefined;
  today: string;
  /** Право «Долг и деньги»: нет — числа нет. */
  showMoney: boolean;
  /** Нет — плашка показание (запись открыть нельзя). */
  onPress?: () => void;
}) {
  const t = useThemeColors();
  const { fontScale } = useWindowDimensions();
  const status = visitStatus(a, today, showMoney);
  const hue = useRecordColor(a, team?.color, today) || t.accent;
  const teamName = team ? (team.is_active ? team.name : `${team.name} · в архиве`) : "";
  const time = a.time_start ? a.time_start.slice(0, 5) : "";
  return (
    <SelectRow
      icon={statusIcon(status.kind)}
      color={hue}
      title={teamName || "Запись"}
      subtitle={time || undefined}
      accessibilityLabel={[visitDay(a.date), time, teamName, status.label].filter(Boolean).join(", ")}
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
