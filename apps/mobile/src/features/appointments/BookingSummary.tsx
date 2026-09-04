import {
  Pressable,
  Text as NativeText,
  TextInput as NativeTextInput,
  View,
  type TextInputProps,
  type TextProps,
} from "react-native";
import { AlertTriangle, ChevronRight } from "lucide-react-native";

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

// СТЕППЕР СО СТРЕЛКАМИ СНЕСЁН 2026-09-04. Количество услуги набирают ТАПАМИ
// по строке в списке услуг, а сама запись печатает его оттиском «×3»
// (`QtyBadge`): владелец, сравнив четыре варианта на экране рядом, выбрал
// этот — «стрелочки вверх-вниз можно сделать красивее и статичнее».
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

// ДВА БЛОКА ВМЕСТО ОДНОГО (владелец 2026-09-04: «мы можем по сути совместить
// команду и метку в одно, а время поставить блоком ниже — так будет лучше»).
//
// Верхний блок отвечает на «КТО и ГДЕ»: команда с мастером и метка этого
// выезда — две зоны тапа в одной карточке, разделённые волоском. Нижний — на
// «КОГДА»: дата, начало и длительность во всю ширину, и под ним единственная
// янтарная строка предупреждения (пересечение, вне графика, буфер).
//
// Раньше это была одна строка «команда · когда», а метка стояла третьей
// карточкой ниже — три разных предмета в трёх местах. Теперь порядок читается
// сверху вниз: кто едет и куда, когда, к кому, на какой объект.

/** Тонкий цветной корешок — identity записи (цвет команды либо выбранный). */
function Spine({ color }: { color: string }) {
  return <View style={{ width: 3, backgroundColor: color }} />;
}

export function TeamLabelRow({
  teamName,
  teamColor,
  masterName,
  label,
  labelColor,
  labelFromDay,
  accent,
  onEditTeam,
  onEditLabel,
}: {
  teamName: string;
  teamColor: string;
  masterName?: string | null;
  /** Метка этого выезда: своя либо унаследованная у дня. */
  label: string | null;
  labelColor?: string | null;
  /** Метка не своя, а взята у дня — читается тише, чтобы отличать. */
  labelFromDay?: boolean;
  accent: string;
  onEditTeam: () => void;
  onEditLabel: () => void;
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
        <Spine color={accent} />

        {/* БЕЗ className: вместе со `style`-функцией он молча съедает её
            целиком (закон записан в `AddRow`), и `flex: 1` до половинки
            карточки не доезжает — зона сжимается по содержимому, а текст
            внутри неё исчезает. Раскладку держим числами здесь же. */}
        <Pressable
          onPress={onEditTeam}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 12,
            paddingLeft: 14,
            paddingRight: 8,
            backgroundColor: pressed ? t.pressed : "transparent",
          })}
          accessibilityRole="button"
          accessibilityLabel={`Команда: ${teamName}${masterName ? `, мастер ${masterName}` : ""}`}
          accessibilityHint="Открывает выбор команды и мастера"
        >
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: teamColor }} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: t.ink }} numberOfLines={1}>
              {teamName}
            </Text>
            {masterName ? (
              <Text style={{ fontSize: 13, color: t.sub, marginTop: 1 }} numberOfLines={1}>
                {masterName}
              </Text>
            ) : null}
          </View>
          <ChevronRight color={t.chevron} size={ICON.xs} />
        </Pressable>

        <View style={{ width: 1, marginVertical: 10, backgroundColor: t.separator }} />

        {/* МЕТКА — вторая зона той же карточки: куда именно едут. Взятая у
            дня читается тише собственной, но стоит на том же месте. */}
        <Pressable
          onPress={onEditLabel}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 12,
            paddingLeft: 10,
            paddingRight: 12,
            backgroundColor: pressed ? t.pressed : "transparent",
          })}
          accessibilityRole="button"
          accessibilityLabel={
            label
              ? `Метка: ${label}${labelFromDay ? ", как у дня" : ""}`
              : "Метка не выбрана"
          }
          accessibilityHint="Открывает выбор метки"
        >
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: label ? labelColor ?? t.accent : t.separator,
            }}
          />
          <View style={{ flex: 1 }}>
            <Text
              numberOfLines={1}
              style={{
                fontSize: 15,
                fontWeight: "600",
                color: label ? (labelFromDay ? t.body : t.ink) : t.placeholder,
              }}
            >
              {label ?? "Метка"}
            </Text>
          </View>
          <ChevronRight color={t.chevron} size={ICON.xs} />
        </Pressable>
      </View>
    </View>
  );
}

export function WhenRow({
  date,
  timeStart,
  duration,
  allDay,
  warning,
  accent,
  onPress,
}: {
  date: string;
  timeStart: string;
  duration: number;
  allDay?: boolean;
  warning?: string | null;
  accent: string;
  onPress: () => void;
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
        <Spine color={accent} />
        <Pressable
          onPress={onPress}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            paddingVertical: 12,
            paddingLeft: 14,
            paddingRight: 12,
            backgroundColor: pressed ? t.pressed : "transparent",
          })}
          accessibilityRole="button"
          accessibilityLabel={`Дата и время: ${humanDay(date)}, ${allDay ? "весь день" : `${timeStart}, ${durationLabel(duration)}`}`}
          accessibilityHint="Открывает выбор даты и времени"
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, color: t.sub }}>{humanDay(date)}</Text>
            <Text style={{ fontSize: 17, fontWeight: "700", color: t.ink, marginTop: 1 }}>
              {allDay ? "весь день" : `${timeStart} · ${durationLabel(duration)}`}
            </Text>
          </View>
          <ChevronRight color={t.chevron} size={ICON.sm} />
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
