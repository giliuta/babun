import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeOut,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Clock } from "lucide-react-native";
import { useReduceMotion } from "@/lib/reduce-motion";
import { useThemeColors } from "@/theme/colors";

/**
 * ПЛАШКА КАЛЕНДАРЯ — ВОПРОС, КОТОРЫЙ НАКРЫВАЕТ ШАПКУ.
 *
 * Появляется в ответ на тап по времени, куда записывать не следует: выходной
 * команды, нерабочий час, прошедший день. Тап по «Записать» снимает запрет и
 * ведёт дальше — к выбору времени.
 *
 * ГДЕ ОНА ЛЕЖИТ (владелец 2026-08-24): на строке «шестерёнка · месяц · вид»
 * — единственном месте шапки, которое можно занять на несколько секунд без
 * потери. Лента команд остаётся открытой: она говорит, ЧЕЙ это календарь.
 *
 * ЗАМЕТНАЯ, НО В НАШЕМ СТИЛЕ (владелец 13.10). Сначала: «много людей не
 * видят… сделай ярким, с анимацией, чтобы выплывало, и чтобы кнопка
 * „Записать" подсвечивалась» — тихая почти белая полоска во всю ширину
 * сливалась с белой шапкой. Оранжевая заливка оказалась перебором: «не
 * настолько, сохраняем наш стиль, не едкое в глаза, аккуратно». Итог:
 * белая карточка с лёгким янтарным тоном и мягкой тенью — она висит над
 * шапкой, а не сливается с ней; падает сверху на короткой пружине; янтарь
 * несёт только значок; «Записать» — наша синяя пилюля, которая спокойно
 * дышит; тонкая полоска внизу тает за время жизни плашки. «Уменьшение
 * движения» — без пружины и дыхания.
 */

/** Падение сверху: короткий путь (не с края экрана — пружина с полной
 *  высоты проскакивала цель и ныряла под ленту команд). */
function dropIn() {
  "worklet";
  const spring = { damping: 18, stiffness: 200 };
  return {
    initialValues: { opacity: 0, transform: [{ translateY: -40 }, { scale: 0.97 }] },
    animations: {
      opacity: withTiming(1, { duration: 160 }),
      transform: [{ translateY: withSpring(0, spring) }, { scale: withSpring(1, spring) }],
    },
  };
}

export function CalendarNotice({
  message,
  actionLabel,
  onAction,
  lifetimeMs,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
  /** Сколько плашка живёт — столько тает полоска внизу. */
  lifetimeMs: number;
}) {
  const t = useThemeColors();
  const reduce = useReduceMotion();

  // Дыхание кнопки и полоска жизни (1 → 0 за время плашки).
  const pulse = useSharedValue(0);
  const life = useSharedValue(1);

  useEffect(() => {
    life.value = 1;
    life.value = withTiming(0, { duration: lifetimeMs, easing: Easing.linear });
    if (!reduce) {
      pulse.value = 0;
      pulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 800, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 800, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      );
    }
    return () => {
      cancelAnimation(pulse);
      cancelAnimation(life);
    };
  }, [message, lifetimeMs, reduce, pulse, life]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.04 }],
    shadowOpacity: 0.18 + pulse.value * 0.22,
  }));
  const lifeStyle = useAnimatedStyle(() => ({ width: `${life.value * 100}%` }));

  return (
    <Animated.View
      entering={reduce ? undefined : dropIn}
      exiting={FadeOut.duration(180)}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      // Накрывает ровно свою строку шапки (родитель — обёртка шапки):
      // ни один пиксель ленты команд под ней не оказывается.
      style={{
        position: "absolute",
        top: 3,
        left: 8,
        right: 8,
        bottom: 3,
        borderRadius: t.radius.card,
        justifyContent: "center",
        backgroundColor: t.surface,
        shadowColor: "#0b1220",
        shadowOpacity: 0.12,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      }}
    >
      {/* Лёгкий янтарный тон поверх белого и полоска жизни — под
          скруглением карточки. */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: t.radius.card,
          overflow: "hidden",
          backgroundColor: `${t.warning}12`,
        }}
      >
        <Animated.View
          style={[
            {
              position: "absolute",
              left: 0,
              bottom: 0,
              height: 2,
              backgroundColor: `${t.warning}66`,
            },
            lifeStyle,
          ]}
        />
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 12,
          paddingRight: 8,
          gap: 8,
        }}
      >
        <Clock size={18} color={t.warning} strokeWidth={2.2} />
        <Text
          numberOfLines={2}
          maxFontSizeMultiplier={1.2}
          style={{ flex: 1, fontSize: 15, lineHeight: 18, fontWeight: "600", color: t.ink }}
        >
          {message}
        </Text>
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={8}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          {({ pressed }) => (
            <Animated.View
              style={[
                {
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  borderRadius: 999,
                  backgroundColor: t.accent,
                  opacity: pressed ? 0.7 : 1,
                  shadowColor: t.accent,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 2 },
                },
                pillStyle,
              ]}
            >
              <Text
                maxFontSizeMultiplier={1.2}
                style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}
              >
                {actionLabel}
              </Text>
            </Animated.View>
          )}
        </Pressable>
      </View>
    </Animated.View>
  );
}
