import {
  Pressable,
  Text as NativeText,
  TextInput as NativeTextInput,
  View,
  type TextInputProps,
  type TextProps,
} from "react-native";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
} from "lucide-react-native";

import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { humanDay } from "@/features/appointments/helpers";
import { durationLabel } from "@/features/services/format";

function Text({ maxFontSizeMultiplier = 1.3, ...props }: TextProps) {
  return (
    <NativeText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />
  );
}


function TextInput({
  maxFontSizeMultiplier = 1.3,
  ...props
}: TextInputProps) {
  return (
    <NativeTextInput
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      {...props}
    />
  );
}


export function Stepper({
  qty,
  unit,
  onDec,
  onInc,
}: {
  qty: number;
  /** Единица услуги: «4 м» вместо голой четвёрки. `null` — просто число.
   *  Ради этого единицу и вернули: бригадир, набивая количество, обязан
   *  видеть, метры это или блоки. */
  unit?: string | null;
  onDec: () => void;
  onInc: () => void;
}) {
  const t = useThemeColors();
  const btn = (
    direction: "down" | "up",
    onPress: () => void,
  ) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        direction === "up" ? "Увеличить количество" : "Уменьшить количество"
      }
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
    >
      {direction === "up" ? (
        <ChevronUp color={t.accent} size={18} />
      ) : (
        <ChevronDown color={t.accent} size={18} />
      )}
    </Pressable>
  );
  return (
    <View
      className="mr-3 flex-row items-center rounded-[10px]"
      style={{ backgroundColor: t.fill }}
      accessibilityLabel={`Количество: ${qty}${unit ? ` ${unit}` : ""}`}
    >
      {btn("down", onDec)}
      <Text
        numberOfLines={1}
        style={{
          minWidth: 24,
          paddingHorizontal: 2,
          textAlign: "center",
          fontSize: 14,
          fontWeight: "600",
          color: t.ink,
          fontVariant: ["tabular-nums"],
        }}
      >
        {unit ? `${qty} ${unit}` : qty}
      </Text>
      {btn("up", onInc)}
    </View>
  );
}

export function MoneyRow({
  label,
  value,
  color,
  strong,
  top,
}: {
  label: string;
  value: string;
  color?: string;
  strong?: boolean;
  top?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View
      className="flex-row items-center px-4 py-3"
      style={top ? { borderTopWidth: 1, borderTopColor: t.separator } : undefined}
    >
      <Text style={{ fontSize: 14, color: strong ? t.ink : t.sub, fontWeight: strong ? "600" : "400", flex: 1 }}>
        {label}
      </Text>
      <Text
        style={{
          fontSize: 15,
          fontWeight: strong ? "700" : "400",
          color: color ?? t.ink,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
    </View>
  );
}

export function TotalEditor({
  value,
  custom,
  onChange,
  onReset,
  accessoryId,
}: {
  value: string;
  custom: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
  accessoryId?: string;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 16,
        borderTopWidth: 1,
        borderTopColor: t.separator,
      }}
    >
      <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: t.ink }}>
        Итого
      </Text>
      {custom ? (
        <Pressable
          onPress={onReset}
          accessibilityRole="button"
          accessibilityLabel="Вернуть сумму по услугам"
          style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 6 }}
        >
          <Text style={{ fontSize: 13, fontWeight: "600", color: t.accent }}>
            По услугам
          </Text>
        </Pressable>
      ) : null}
      <TextInput
        keyboardAppearance="light"
        value={value}
        onChangeText={onChange}
        selectTextOnFocus
        keyboardType="decimal-pad"
        inputAccessoryViewID={accessoryId}
        placeholder="0"
        placeholderTextColor={t.placeholder}
        accessibilityLabel="Итоговая сумма записи"
        style={{
          minWidth: 58,
          minHeight: 44,
          paddingVertical: 8,
          textAlign: "right",
          fontSize: 17,
          fontWeight: "700",
          color: t.ink,
          fontVariant: ["tabular-nums"],
        }}
      />
      <Text style={{ fontSize: 17, fontWeight: "600", color: t.sub }}>€</Text>
    </View>
  );
}

// «Докет» — одна спокойная строка «Команда · Когда», заменившая отдельную
// пилюлю команды и карточку «Когда» с мини-таймлайном. Слева команда (тап →
// выбор команды/мастера), справа дата·время (тап → колесо). Тонкий цветной
// корешок слева несёт identity записи; под строкой — ОДНА янтарная строка,
// когда есть предупреждение (пересечение ИЛИ вне графика/перерыв/буфер).
export function DocketRow({
  teamName,
  teamColor,
  masterName,
  date,
  timeStart,
  duration,
  allDay,
  warning,
  accent,
  onEditTeam,
  onEditTime,
}: {
  teamName: string;
  teamColor: string;
  masterName?: string | null;
  date: string;
  timeStart: string;
  duration: number;
  allDay?: boolean;
  warning?: string | null;
  accent: string;
  onEditTeam: () => void;
  onEditTime: () => void;
}) {
  const t = useThemeColors();
  return (
    <View className="mx-4 mt-2">
      <View
        style={{
          flexDirection: "row",
          alignItems: "stretch",
          backgroundColor: t.surface,
          borderRadius: t.radius.card,
          boxShadow: t.cardShadow,
          overflow: "hidden",
        }}
      >
        {/* цветной корешок = identity записи (цвет команды / выбранный цвет) */}
        <View style={{ width: 3, backgroundColor: accent }} />

        {/* команда — тап открывает выбор команды и мастера */}
        <Pressable
          onPress={onEditTeam}
          className="flex-row items-center gap-2 py-3 pl-3.5 pr-2"
          style={({ pressed }) => ({
            flex: 1,
            backgroundColor: pressed ? t.pressed : "transparent",
          })}
          accessibilityRole="button"
          accessibilityLabel={`Команда: ${teamName}${masterName ? `, мастер ${masterName}` : ""}`}
          accessibilityHint="Открывает выбор команды и мастера"
        >
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: teamColor }} />
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: t.ink }} numberOfLines={1}>
              {teamName}
            </Text>
            {masterName ? (
              <Text style={{ fontSize: 13, color: t.sub, marginTop: 1 }} numberOfLines={1}>
                {masterName}
              </Text>
            ) : null}
          </View>
          {/* шеврон = «тап, чтобы сменить команду/мастера» */}
          <ChevronRight color={t.chevron} size={ICON.xs} />
        </Pressable>

        {/* волосяной разделитель — две независимые зоны тапа в одной строке */}
        <View style={{ width: 1, marginVertical: 10, backgroundColor: t.separator }} />

        {/* когда — тап открывает колесо даты/времени */}
        <Pressable
          onPress={onEditTime}
          className="flex-row items-center py-3 pl-2 pr-3"
          style={({ pressed }) => ({ backgroundColor: pressed ? t.pressed : "transparent" })}
          accessibilityRole="button"
          accessibilityLabel={`Дата и время: ${humanDay(date)}, ${allDay ? "весь день" : `${timeStart}, ${durationLabel(duration)}`}`}
          accessibilityHint="Открывает выбор даты и времени"
        >
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 12, color: t.sub }}>{humanDay(date)}</Text>
            <Text style={{ fontSize: 17, fontWeight: "700", color: t.ink, marginTop: 1 }}>
              {allDay ? "весь день" : `${timeStart} · ${durationLabel(duration)}`}
            </Text>
          </View>
          <ChevronRight color={t.chevron} size={ICON.sm} style={{ marginLeft: 2 }} />
        </Pressable>
      </View>

      {warning ? (
        <View
          className="mt-2 flex-row items-center gap-2 rounded-[10px] px-3 py-2.5"
          style={{ backgroundColor: `${t.warning}14`, borderWidth: 1, borderColor: `${t.warning}33` }}
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
        >
          <AlertTriangle color={t.warning} size={ICON.sm} />
          <Text style={{ fontSize: 13, fontWeight: "500", color: t.warning, flex: 1 }}>
            {warning}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
