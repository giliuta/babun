import { useEffect, useRef } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { useReduceMotion } from "@/lib/reduce-motion";
import type { Rect, Size } from "./tour-geometry";

// ЗАТЕМНЕНИЕ С ВЫРЕЗОМ. Один контур «экран минус цель» (evenodd): рамка-
// бордюр толщиной в экран не годится — на тройной плотности такой слой
// больше предельной текстуры iOS и не рисуется вовсе.
//
// ВЫРЕЗ ПЕРЕЕЗЖАЕТ ОТ ЦЕЛИ К ЦЕЛИ, а не гаснет и вспыхивает на новом месте:
// глаз ведёт за подсветкой, и понятно, откуда и куда перешло объяснение.
// Касаний контур не ловит — их держат полосы вокруг выреза.

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Переезд выреза к следующей цели. */
export const SPOT_MOVE_MS = 260;
const MOVE = { duration: SPOT_MOVE_MS, easing: Easing.inOut(Easing.cubic) };

function useMoving(value: number, instant: boolean): SharedValue<number> {
  const sv = useSharedValue(value);
  useEffect(() => {
    sv.value = instant ? value : withTiming(value, MOVE);
  }, [sv, value, instant]);
  return sv;
}

export function TourSpotlight({
  spot,
  radius,
  size,
  color,
  passes,
  pulse,
  pulseKey,
  accent,
}: {
  spot: Rect;
  radius: number;
  size: Size;
  color: string;
  /** Подсвеченное нажимается («нажмите сюда», «заполните»). */
  passes: boolean;
  /** Рамка «нажмите сюда». */
  pulse: boolean;
  /** Новая рамка на каждом шаге: появляется, когда вырез приехал. */
  pulseKey: string;
  accent: string;
}) {
  const reduced = useReduceMotion();
  // Первый показ — сразу на месте: переезжать неоткуда.
  const shown = useRef(false);
  const instant = reduced || !shown.current;
  useEffect(() => {
    shown.current = true;
  }, []);
  const x = useMoving(spot.x, instant);
  const y = useMoving(spot.y, instant);
  const w = useMoving(spot.w, instant);
  const h = useMoving(spot.h, instant);
  const r = useMoving(radius, instant);
  const sw = useMoving(size.w, true);
  const sh = useMoving(size.h, true);

  const animatedProps = useAnimatedProps(() => {
    const rr = Math.max(0, Math.min(r.value, w.value / 2, h.value / 2));
    const X = x.value;
    const Y = y.value;
    const W = w.value;
    const H = h.value;
    return {
      d:
        `M0,0 H${sw.value} V${sh.value} H0 Z ` +
        `M${X + rr},${Y} H${X + W - rr} A${rr},${rr} 0 0 1 ${X + W},${Y + rr} ` +
        `V${Y + H - rr} A${rr},${rr} 0 0 1 ${X + W - rr},${Y + H} ` +
        `H${X + rr} A${rr},${rr} 0 0 1 ${X},${Y + H - rr} V${Y + rr} A${rr},${rr} 0 0 1 ${X + rr},${Y} Z`,
    };
  });

  const block = { position: "absolute" as const };
  return (
    <>
      <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0 }}>
        <Svg width={size.w} height={size.h}>
          <AnimatedPath animatedProps={animatedProps} fill={color} fillRule="evenodd" />
        </Svg>
      </View>
      {/* Касания вокруг выреза гасятся: нажать можно только показанное. */}
      <View style={{ ...block, left: 0, right: 0, top: 0, height: Math.max(0, spot.y) }} />
      <View style={{ ...block, left: 0, right: 0, top: spot.y + spot.h, bottom: 0 }} />
      <View style={{ ...block, left: 0, width: Math.max(0, spot.x), top: spot.y, height: spot.h }} />
      <View style={{ ...block, left: spot.x + spot.w, right: 0, top: spot.y, height: spot.h }} />
      {/* Пояснение: цель видна, но не нажимается. */}
      {passes ? null : <View style={{ ...block, left: spot.x, top: spot.y, width: spot.w, height: spot.h }} />}
      {pulse ? (
        <Animated.View
          key={pulseKey}
          pointerEvents="none"
          entering={reduced ? undefined : FadeIn.delay(SPOT_MOVE_MS).duration(160)}
          style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
        >
          <Pulse spot={spot} radius={radius} accent={accent} />
        </Animated.View>
      ) : null}
    </>
  );
}

/** Рамка цели «нажмите сюда»: дышит, пока на неё не нажали. Сидит вплотную
 *  вокруг выреза и повторяет его скругление. */
function Pulse({ spot, radius, accent }: { spot: Rect; radius: number; accent: string }) {
  const reduced = useReduceMotion();
  const phase = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    phase.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(phase);
  }, [phase, reduced]);
  const style = useAnimatedStyle(() => ({
    opacity: reduced ? 1 : 1 - phase.value,
    transform: [{ scale: reduced ? 1 : 1 + phase.value * 0.06 }],
  }));
  const pad = 3;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: spot.x - pad,
          top: spot.y - pad,
          width: spot.w + pad * 2,
          height: spot.h + pad * 2,
          borderRadius: radius + pad,
          borderWidth: 3,
          borderColor: accent,
        },
        style,
      ]}
    />
  );
}
