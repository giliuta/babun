import { Pressable, Text, View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

/** Строка блока: одна тап-зона «имя + шеврон … значение». Значение —
 *  «Все» faint в покое, оттиск в чёрный при выборе; у сущностей перед
 *  значением тик цвета первой выбранной. */
export function FilterRow({
  name,
  value,
  tick,
  hint,
  expanded,
  onPress,
}: {
  name: string;
  value: { label: string; extra: number } | null;
  /** Цвет тика сущности (метка/тег/команда) — только при выборе. */
  tick?: string;
  /** VoiceOver-хинт: у одиночного и мультивыбора он разный. */
  hint?: string;
  /** Варианты раскрыты под строкой — шеврон смотрит вверх. */
  expanded?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={name}
      // Значение — в accessibilityValue: VoiceOver читает «Статус, Должники
      // и ещё 2», а не склеенную строку с плюсом.
      accessibilityValue={{
        text: value
          ? value.extra > 0
            ? `${value.label} и ещё ${value.extra}`
            : value.label
          : "Все",
      }}
      accessibilityHint={hint ?? (expanded ? "Сворачивает выбор" : "Раскрывает выбор")}
      accessibilityState={{ expanded: !!expanded }}
      // Раскладка ТОЛЬКО в style: NativeWind v5 роняет style-функцию
      // Pressable, если рядом есть className. Нажатие углубляет материал,
      // а не гасит прозрачностью.
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        minHeight: 44,
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: t.radius.card,
        backgroundColor: pressed ? t.rowFillPressed : t.rowFill,
      })}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        style={{
          flexShrink: 1,
          fontSize: 15,
          fontWeight: "600",
          color: t.ink,
          marginRight: 4,
        }}
      >
        {name}
      </Text>
      <ChevronDown
        color={t.chevron}
        size={14}
        strokeWidth={2.6}
        style={expanded ? { transform: [{ rotate: "180deg" }] } : undefined}
      />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginLeft: "auto",
          paddingLeft: 10,
          flexShrink: 1,
          minWidth: 56,
          justifyContent: "flex-end",
        }}
      >
        {value && tick ? (
          <View
            style={{
              width: 2,
              height: 16,
              borderRadius: 1,
              marginRight: 6,
              backgroundColor: tick,
            }}
          />
        ) : null}
        {/* Вес значения постоянный — при выборе меняется только цвет,
            иначе строка «дёргалась» с 500 на 700. */}
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{
            flexShrink: 1,
            fontSize: 15,
            fontWeight: "700",
            color: value ? t.ink : t.faint,
            fontVariant: ["tabular-nums"],
          }}
        >
          {value ? value.label : "Все"}
        </Text>
        {/* «+K» — отдельный несжимаемый Text: обрезаться должно длинное
            имя, а не счётчик остальных. */}
        {value && value.extra > 0 ? (
          <Text
            maxFontSizeMultiplier={1.2}
            style={{
              flexShrink: 0,
              fontSize: 15,
              fontWeight: "700",
              color: t.ink,
              fontVariant: ["tabular-nums"],
            }}
          >
            {` +${value.extra}`}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
