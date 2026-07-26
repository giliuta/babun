import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Check } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { haptics } from "@/lib/haptics";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import {
  makePeriod,
  PERIOD_BLOCKS,
  PERIOD_LABELS,
  periodDates,
  presetHint,
  type Period,
} from "./period";

// LOCKED v5 header split (finances-design.html): the period NAME opens this
// preset list — paired «текущий/прошлый» blocks (День/Неделя/Месяц/Год),
// each row shows its concrete range, tap applies instantly (web parity:
// PeriodPicker.pickPreset). Общий диалект периода приложения: этим же
// листом пользуются «Клиенты» (там сверху добавляется «Всё время»).
export function PeriodPresetModal({
  visible,
  current,
  businessNow,
  allTime,
  onClose,
  onApply,
}: {
  visible: boolean;
  /** null = период не выбран («Всё время» у Клиентов). */
  current: Period | null;
  businessNow: Date;
  /** Строка «Всё время» над блоками — сброс периода (Клиенты). */
  allTime?: { active: boolean; hint?: string; onSelect: () => void };
  onClose: () => void;
  onApply: (p: Period) => void;
}) {
  const t = useThemeColors();

  const row = (
    label: string,
    hint: string | undefined,
    active: boolean,
    separated: boolean,
    onPress: () => void,
  ) => (
    <Pressable
      key={label}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={hint ? `${label}, ${hint}` : label}
      accessibilityHint="Применяет и закрывает"
      onPress={() => {
        haptics.tap();
        onPress();
        onClose();
      }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        minHeight: 48,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        backgroundColor: pressed ? t.rowFillPressed : "transparent",
      })}
    >
      <Text
        className={`text-[15px] ${active ? "font-semibold" : ""}`}
        style={{ color: active ? t.accent : t.ink }}
      >
        {label}
      </Text>
      {hint ? (
        <Text className="ml-auto text-[13px] tabular-nums" style={{ color: t.faint }}>
          {hint}
        </Text>
      ) : null}
      {active ? (
        <View className={hint ? "ml-2" : "ml-auto"}>
          <Check color={t.accent} size={ICON.sm} strokeWidth={3} />
        </View>
      ) : null}
    </Pressable>
  );

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View className="px-5 pb-8 pt-1">
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.2}
          className="mb-3 text-[17px] font-semibold"
          style={{ color: t.ink }}
        >
          Период
        </Text>
        {allTime ? (
          <View
            className="mb-2 overflow-hidden rounded-xl"
            style={{ backgroundColor: t.canvas }}
          >
            {row("Всё время", allTime.hint, allTime.active, false, allTime.onSelect)}
          </View>
        ) : null}
        {PERIOD_BLOCKS.map(([cur, prev]) => (
          <View
            key={cur}
            className="mb-2 overflow-hidden rounded-xl"
            style={{ backgroundColor: t.canvas }}
          >
            {[cur, prev].map((kind, i) =>
              row(
                PERIOD_LABELS[kind],
                presetHint(kind, businessNow),
                current?.preset === kind,
                i > 0,
                () => onApply(makePeriod(kind, businessNow)),
              ),
            )}
          </View>
        ))}
      </View>
    </BottomSheet>
  );
}

// LOCKED v5: the period DATES open the «Свой период» range picker with
// С–До wheels (finances-design.html .fin-pcv) — a С/До segment picks the
// endpoint, one spinner wheel edits it, «Применить» commits.
export function PeriodWheelsModal({
  visible,
  current,
  onClose,
  onApply,
}: {
  visible: boolean;
  current: Period;
  onClose: () => void;
  onApply: (p: Period) => void;
}) {
  const t = useThemeColors();
  const [from, setFrom] = useState(current.from);
  const [to, setTo] = useState(current.to);
  const [side, setSide] = useState<"from" | "to">("from");

  // Ресинк — по ФРОНТУ открытия, а не на каждое изменение current: иначе
  // догрузка записей (охват «Всего времени» приезжает позже) перескакивала
  // диапазон, который человек прямо сейчас крутит.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setFrom(current.from);
      setTo(current.to);
      setSide("from");
    }
    wasVisible.current = visible;
  }, [visible, current.from, current.to]);

  const apply = () => {
    haptics.tap();
    // Колесо не двигали — не стираем имя пресета: «Применить» после
    // «Текущей недели» превращал её в безымянный «Свой период».
    if (from === current.from && to === current.to) {
      onApply({ preset: current.preset, from: current.from, to: current.to });
      onClose();
      return;
    }
    // An inverted range would silently query an empty window — swap it.
    const [f, t2] = from <= to ? [from, to] : [to, from];
    onApply({ preset: "custom", from: f, to: t2 });
    onClose();
  };

  const segment = (key: "from" | "to", label: string, value: string) => {
    const active = side === key;
    return (
      <Pressable
        key={key}
        accessibilityRole="radio"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`${label}: ${value}`}
        onPress={() => {
          haptics.tap();
          setSide(key);
        }}
        className="flex-1 items-center justify-center rounded-[10px]"
        style={{
          minHeight: 48,
          paddingVertical: 4,
          backgroundColor: active ? t.surface : "transparent",
        }}
      >
        <Text
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: active ? t.accent : t.faint }}
        >
          {label}
        </Text>
        <Text
          className="text-[15px] font-semibold tabular-nums"
          style={{ color: t.ink }}
        >
          {value}
        </Text>
      </Pressable>
    );
  };

  const shown: Period = { preset: "custom", from, to };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View className="px-5 pb-8 pt-1">
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.2}
          className="mb-1 text-[17px] font-semibold"
          style={{ color: t.ink }}
        >
          Свой период
        </Text>
        <Text
          className="mb-3 text-center text-base font-semibold tabular-nums"
          style={{ color: t.sub }}
        >
          {periodDates(shown)}
        </Text>

        {/* С | До endpoint segment */}
        <View
          className="mb-3 flex-row rounded-xl p-1"
          style={{ backgroundColor: t.fill, gap: 4 }}
        >
          {segment("from", "С", periodDates({ preset: "custom", from, to: from }))}
          {segment("to", "До", periodDates({ preset: "custom", from: to, to }))}
        </View>

        {/* one wheel edits the active endpoint */}
        <View className="items-center">
          <DateTimePicker
            themeVariant="light"
            value={parseYMD(side === "from" ? from : to)}
            mode="date"
            display="spinner"
            locale="ru-RU"
            onChange={(_, d) => {
              if (!d) return;
              if (side === "from") setFrom(formatYMD(d));
              else setTo(formatYMD(d));
            }}
          />
        </View>

        <View className="mt-2">
          <Button label="Применить" onPress={apply} />
        </View>
      </View>
    </BottomSheet>
  );
}
