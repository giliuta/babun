import { Pressable, Text, View } from "react-native";
import { useEffect } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Clock } from "lucide-react-native";
import { haptics } from "@/lib/haptics";
import { useReduceMotion } from "@/lib/reduce-motion";
import { useThemeColors } from "@/theme/colors";

/**
 * ПЛАШКА КАЛЕНДАРЯ — ВОПРОС, КОТОРЫЙ НАКРЫВАЕТ ШАПКУ.
 *
 * Появляется в ответ на тап по времени, куда записывать не следует: выходной
 * команды, нерабочий час, прошедший день. Тап по кнопке снимает запрет и ведёт
 * дальше — к выбору времени.
 *
 * ГДЕ ОНА ЛЕЖИТ И ПОЧЕМУ ИМЕННО ТАМ (владелец 2026-08-24: «она должна
 * накладываться чётко на верхний блок — там, где настройки, август и неделя, —
 * не перекрывая при этом команды»). Строка «шестерёнка · месяц · вид» —
 * единственное место шапки, которое можно занять на пять секунд без потери:
 * пока человек отвечает на вопрос, ни месяц, ни вид ему не нужны. Лента команд
 * остаётся открытой — она говорит, ЧЕЙ это календарь, и закрывать её ответом
 * про время нельзя.
 *
 * ПОЧЕМУ ОНА ТИХАЯ (он же: «не должна быть броской и бросаться в глаза, вообще
 * не делай её ядовитую»). Это не авария и не ошибка — это уточняющий вопрос,
 * на который в половине случаев отвечают «да, записывай». Поэтому: подложка
 * почти белая и слегка просвечивает, тон — один тонкий янтарный слой поверх
 * неё, и ни одной заливки в полный цвет. Громкость несёт кнопка, а не фон.
 *
 * ЧАСЫ И ВРЕМЯ (владелец 13.10, после проб и отката): слева значок часов,
 * сверху мелким серым — какое время тапнули («7 октября, 13:00»), под ним
 * вопрос чёрным, как весь текст приложения. Новый тап — новое время.
 * Значок — чёрный, янтарь гуще (он же: «цвет немного ярче, иконку чёрной»).
 * СМАХНУТЬ ВВЕРХ — убрать, не дожидаясь. ПОЛОСКА ВНИЗУ — та же, что у
 * загрузки календаря (`LoadingBar`: 2 pt, кобальт по бледной дорожке), но
 * убывает: сколько осталось жить плашке.
 */

/** Смахнули достаточно — плашка уходит. */
const DISMISS_DISTANCE = 16;
const DISMISS_VELOCITY = 400;
export function CalendarNotice({
  when,
  message,
  actionLabel,
  onAction,
  onDismiss,
  lifetimeMs,
}: {
  /** Тапнутое время: «13:00» сегодня, «7 октября, 13:00» — в другой день. */
  when: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
  /** Смахнули вверх — убрать плашку. */
  onDismiss: () => void;
  /** Сколько плашка живёт — столько убывает полоска внизу. */
  lifetimeMs: number;
}) {
  const t = useThemeColors();
  const reduce = useReduceMotion();
  const life = useSharedValue(1);
  const dragY = useSharedValue(0);

  useEffect(() => {
    life.value = withTiming(0, { duration: lifetimeMs, easing: Easing.linear });
    return () => cancelAnimation(life);
  }, [lifetimeMs, life]);

  const dismiss = () => {
    haptics.tap();
    onDismiss();
  };
  // Только вверх: вниз плашка не тянется — под ней лента команд.
  const swipeUp = Gesture.Pan()
    .activeOffsetY(-6)
    .failOffsetY(12)
    .onUpdate((e) => {
      dragY.value = Math.min(0, e.translationY);
    })
    .onEnd((e) => {
      if (
        e.translationY < -DISMISS_DISTANCE ||
        e.velocityY < -DISMISS_VELOCITY
      ) {
        runOnJS(dismiss)();
      } else {
        dragY.value = withTiming(0, { duration: 150 });
      }
    });
  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
    opacity: 1 + Math.max(-1, dragY.value / 50),
  }));
  const lifeStyle = useAnimatedStyle(() => ({ width: `${life.value * 100}%` }));

  return (
    <GestureDetector gesture={swipeUp}>
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(160)}
        // Накрывает ровно свою строку: родитель — обёртка шапки, и никакие
        // пиксели ленты команд под ней не оказываются.
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          justifyContent: "center",
        }}
        accessibilityActions={[{ name: "escape", label: "Скрыть" }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === "escape") onDismiss();
        }}
      >
        <Animated.View
          style={[{ flex: 1, justifyContent: "center" }, dragStyle]}
        >
          {/* Два слоя вместо одной заливки: белая подложка держит читаемость
          текста, янтарь поверх неё только окрашивает воздух. Одним цветом
          в 100% это была бы та самая ядовитая плашка.
          ПОДЛОЖКА ПОЧТИ ГЛУХАЯ, И ЭТО НЕ ПРИДИРКА. На 0.94 сквозь неё
          проступали «Август 2026» и «Неделя» — буквы ложились на буквы, и
          тихая плашка читалась как дефект вёрстки. С 13.10 подложка глухая:
          и на 0.985 «Октябрь 2026» проступал сквозь серое время. */}
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: t.surface,
            }}
          />
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: `${t.warning}22`,
              borderBottomWidth: 1,
              borderBottomColor: `${t.warning}40`,
            }}
          />
          {/* Срок плашки — полоской загрузки календаря, убывающей к нулю. */}
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 2,
              overflow: "hidden",
              backgroundColor: `${t.accent}14`,
            }}
          >
            {reduce ? null : (
              <Animated.View
                style={[
                  { height: 2, borderRadius: 1, backgroundColor: t.accent },
                  lifeStyle,
                ]}
              />
            )}
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: 16,
              paddingRight: 6,
              gap: 8,
            }}
          >
            <Clock size={18} color={t.ink} strokeWidth={2.2} />
            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
                style={{
                  fontSize: 12,
                  color: t.sub,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {when}
              </Text>
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
                style={{ fontSize: 14, fontWeight: "600", color: t.ink }}
              >
                {message}
              </Text>
            </View>
            <Pressable
              onPress={onAction}
              accessibilityRole="button"
              accessibilityLabel={actionLabel}
              hitSlop={8}
              style={({ pressed }) => ({
                minHeight: 44,
                justifyContent: "center",
                paddingHorizontal: 12,
                opacity: pressed ? 0.5 : 1,
              })}
            >
              <Text
                maxFontSizeMultiplier={1.2}
                style={{ fontSize: 15, fontWeight: "700", color: t.accent }}
              >
                {actionLabel}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}
