import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { useReduceMotion } from "@/lib/reduce-motion";
import { useThemeColors } from "@/theme/colors";

// ОЖИДАНИЕ, КОТОРОЕ ВИДНО, ЧТО ЖИВОЕ.
//
// Владелец 2026-07-27: «оно как будто зависло… давай сделаем анимацию, чтоб
// крутилась, если оно думает — а то такое ощущение, будто тупо залагало».
//
// Системный ActivityIndicator серый (вне палитры), мелкий, а в программном
// режиме (когда его показывают без жеста) iOS рисует его СТОЯЩИМ — ровно
// «залагало». Здесь дуга кобальта на своей дорожке, вращение без остановки.
//
// Это ЕДИНСТВЕННАЯ бесконечная анимация приложения кроме брендового блика на
// логине — и она честная: движение здесь и есть смысл («я работаю»). При
// «Уменьшении движения» вращение заменяется дыханием прозрачности: iOS сам
// подменяет движение растворением, а замирать спиннеру нельзя — он тогда снова
// читается как зависший.

export function Spinner({
  size = 24,
  color,
  label = "Загрузка",
}: {
  size?: number;
  /** По умолчанию кобальт. Внутри залитой кнопки передавайте onAccent. */
  color?: string;
  label?: string;
}) {
  const t = useThemeColors();
  const reduced = useReduceMotion();
  const hue = color ?? t.accent;

  const spin = useSharedValue(0);
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduced) {
      cancelAnimation(spin);
      spin.value = 0;
      pulse.value = withRepeat(
        withTiming(0.3, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
      return () => cancelAnimation(pulse);
    }
    cancelAnimation(pulse);
    pulse.value = 1;
    spin.value = 0;
    spin.value = withRepeat(
      withTiming(360, { duration: 900, easing: Easing.linear }),
      -1,
      false,
    );
    // Анимацию снимаем руками: withRepeat(-1) не заканчивается сам и держал бы
    // кадры после ухода экрана.
    return () => cancelAnimation(spin);
  }, [reduced, spin, pulse]);

  const style = useAnimatedStyle(() => ({
    opacity: pulse.value,
    transform: [{ rotate: `${spin.value}deg` }],
  }));

  const stroke = Math.max(2, Math.round(size / 9));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
    >
      <Animated.View style={style}>
        <Svg width={size} height={size}>
          {/* Дорожка: без неё одинокая дуга читается как обломок кольца. */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={`${hue}24`}
            strokeWidth={stroke}
            fill="none"
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={hue}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference * 0.3} ${circumference}`}
            fill="none"
          />
        </Svg>
      </Animated.View>
    </View>
  );
}
