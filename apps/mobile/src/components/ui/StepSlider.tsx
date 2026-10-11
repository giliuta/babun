import { useEffect, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ПОЛЗУНОК — тянут бегунок или тапают по дорожке (владелец 11.10: «ползунок
// в процентах, чтоб можно было двигать»). Своего в продукте не было, а
// нативный модуль по воздуху не доставить. Касания — встроенной системой
// ответчиков RN, а не жестами RNGH: ползунок живёт в нижнем листе (`Modal`),
// и жест RNGH там молчал (проверено в вебе 11.10). Значение шагает (`step`),
// каждый шаг — лёгкий щелчок.

const THUMB = 28;
const TRACK = 6;

function tick(): void {
  haptics.tap();
}

/** Значение под точкой `x` дорожки шириной `w`, со снапом к шагу. */
export function sliderValueAt(x: number, w: number, min: number, max: number, step: number): number {
  "worklet";
  if (w <= 0 || max <= min) return min;
  const ratio = Math.min(1, Math.max(0, x / w));
  const raw = min + ratio * (max - min);
  const snapped = Math.round((raw - min) / step) * step + min;
  return Math.min(max, Math.max(min, snapped));
}

export function StepSlider({
  value,
  min,
  max,
  step,
  onChange,
  accessibilityLabel,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  accessibilityLabel: string;
}) {
  const t = useThemeColors();
  const [width, setWidth] = useState(0);
  const w = useSharedValue(0);
  const x = useSharedValue(0);
  const last = useSharedValue(value);
  const span = Math.max(1, max - min);

  // Значение пришло снаружи (открыли лист, сменили окно часов) — бегунок туда.
  useEffect(() => {
    last.value = value;
    x.value = ((Math.min(max, Math.max(min, value)) - min) / span) * w.value;
  }, [value, min, max, span, x, w, last]);

  const onLayout = (e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.width - THUMB;
    setWidth(next);
    w.value = next;
    x.value = ((Math.min(max, Math.max(min, value)) - min) / span) * next;
  };

  const move = (px: number) => {
    const v = sliderValueAt(px - THUMB / 2, w.value, min, max, step);
    x.value = ((v - min) / span) * w.value;
    if (v !== last.value) {
      last.value = v;
      tick();
      onChange(v);
    }
  };

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const fillStyle = useAnimatedStyle(() => ({ width: x.value + THUMB / 2 }));

  return (
    <View
        onLayout={onLayout}
        // Палец на ползунке — ползунок его не отдаёт ни листу, ни прокрутке.
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => move(e.nativeEvent.locationX)}
        onResponderMove={(e) => move(e.nativeEvent.locationX)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min, max, now: value }}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === "increment") onChange(Math.min(max, value + step));
          if (e.nativeEvent.actionName === "decrement") onChange(Math.max(min, value - step));
        }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        style={{ height: 44, justifyContent: "center" }}
      >
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: THUMB / 2,
            right: THUMB / 2,
            height: TRACK,
            borderRadius: TRACK / 2,
            backgroundColor: t.fill,
          }}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            { position: "absolute", left: 0, height: TRACK, borderRadius: TRACK / 2, backgroundColor: t.accent },
            fillStyle,
          ]}
        />
        {width > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                left: 0,
                width: THUMB,
                height: THUMB,
                borderRadius: THUMB / 2,
                backgroundColor: "#ffffff",
                boxShadow: "0 2px 6px rgba(11,18,32,0.22)",
              },
              thumbStyle,
            ]}
          />
        ) : null}
    </View>
  );
}
