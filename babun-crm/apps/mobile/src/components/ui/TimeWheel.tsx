import { useEffect, useRef, useState } from "react";
import { ScrollView, View, Text } from "react-native";
import { useThemeColors } from "@/theme/colors";

// Колесо времени — портированный 1:1 веб-TimeWheels/WheelColumn (крупная
// активная цифра, соседи тише, линии среза по центральному ряду). Вынесен
// из UnifiedTimePopup, когда колесо понадобилось второму листу
// (BookSlotSheet): правки вида — только здесь.

// wheel geometry (= web TimeWheels)
export const ITEM_H = 40;
export const VISIBLE_ROWS = 3;
export const COLUMN_W = 58;
export const DIGIT_FONT = 26;
export const WHEEL_H = ITEM_H * VISIBLE_ROWS;
export const PAD = (WHEEL_H - ITEM_H) / 2;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export const HOURS = Array.from({ length: 24 }, (_, i) => pad2(i));

export function WheelWithLines({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ position: "relative" }}>
      {children}
      <View
        pointerEvents="none"
        style={{ position: "absolute", left: 2, right: 2, top: PAD, height: 1, backgroundColor: "rgba(11,18,32,0.12)" }}
      />
      <View
        pointerEvents="none"
        style={{ position: "absolute", left: 2, right: 2, top: PAD + ITEM_H - 1, height: 1, backgroundColor: "rgba(11,18,32,0.12)" }}
      />
    </View>
  );
}

export function WheelColumn({
  items,
  selectedIndex,
  onChange,
  accessibilityLabel,
  activeColor,
  accessibilityValueSuffix,
}: {
  items: string[];
  selectedIndex: number;
  onChange: (idx: number) => void;
  accessibilityLabel: string;
  /** Цвет активной цифры (дефолт ink) — состояние «вне рабочих часов»
   *  в BookSlotSheet красит выбранное время t.warning. */
  activeColor?: string;
  /** Суффикс к accessibilityValue («, вне рабочих часов») — VoiceOver
   *  обязан слышать состояние, а не только видеть цвет. */
  accessibilityValueSuffix?: string;
}) {
  const t = useThemeColors();
  const ref = useRef<ScrollView>(null);
  const [live, setLive] = useState(selectedIndex);

  useEffect(() => {
    setLive(selectedIndex);
    const id = requestAnimationFrame(() =>
      ref.current?.scrollTo({ y: selectedIndex * ITEM_H, animated: false }),
    );
    return () => cancelAnimationFrame(id);
  }, [selectedIndex]);

  const idxAt = (y: number) => Math.max(0, Math.min(items.length - 1, Math.round(y / ITEM_H)));
  const commit = (y: number) => {
    const i = idxAt(y);
    if (i !== selectedIndex) onChange(i);
  };
  const adjust = (delta: number) => {
    const next = Math.max(0, Math.min(items.length - 1, live + delta));
    if (next === live) return;
    setLive(next);
    onChange(next);
    ref.current?.scrollTo({ y: next * ITEM_H, animated: true });
  };

  return (
    <ScrollView
      ref={ref}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_H}
      decelerationRate="fast"
      scrollEventThrottle={16}
      onScroll={(e) => {
        const i = idxAt(e.nativeEvent.contentOffset.y);
        if (i !== live) setLive(i);
      }}
      // Оба события: быстрый флик → momentum-end, медленное перетаскивание
      // без инерции → drag-end (momentum-end тогда не стреляет).
      onMomentumScrollEnd={(e) => commit(e.nativeEvent.contentOffset.y)}
      onScrollEndDrag={(e) => commit(e.nativeEvent.contentOffset.y)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{
        text: (items[live] ?? "") + (accessibilityValueSuffix ?? ""),
      }}
      accessibilityActions={[
        { name: "increment", label: "Увеличить" },
        { name: "decrement", label: "Уменьшить" },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment") adjust(1);
        if (event.nativeEvent.actionName === "decrement") adjust(-1);
      }}
      style={{ width: COLUMN_W, height: WHEEL_H }}
      contentContainerStyle={{ paddingVertical: PAD }}
    >
      {items.map((label, i) => {
        const active = i === live;
        return (
          <View key={i} style={{ height: ITEM_H, alignItems: "center", justifyContent: "center" }}>
            {/* Кап 1.2: геометрия колеса фиксированная (ITEM_H/COLUMN_W и
                полоса «вне часов» top:PAD height:ITEM_H) — цифры не должны
                вырастать из своего ряда при AX-шрифтах. */}
            <Text
              maxFontSizeMultiplier={1.2}
              style={{
                fontVariant: ["tabular-nums"],
                color: active ? activeColor ?? t.ink : t.placeholder,
                fontWeight: active ? "700" : "500",
                fontSize: active ? DIGIT_FONT : DIGIT_FONT - 3,
              }}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}
