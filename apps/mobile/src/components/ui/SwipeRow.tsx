import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// СМАХНУТЬ ВЛЕВО → ОДНО ДЕЙСТВИЕ (владелец 2026-08-06: «можно смахнуть влево
// и там можно будет нажать удалить»). Тот же жест, что в Почте и Сообщениях —
// объяснять его не нужно.
//
// Действие НА СТОРОНУ — РОВНО ОДНО, и оно настраивается: цвет, значок,
// подпись. Батарея кнопок под пальцем — это меню, вывернутое наизнанку:
// выбирать из четырёх прямоугольников вслепую, удерживая палец, никто не
// умеет. Что не влезло в одну кнопку, живёт в long-press-меню, и ПЕРВЫЙ пункт
// меню совпадает со свайпом — жест и слово говорят одно и то же.
//
// ВТОРАЯ СТОРОНА (`leading`, владелец 2026-08-17: «если слева вправо потянуть,
// то только тогда можно открыть звёздочку») — для действия, ОБРАТНОГО по
// смыслу разрушительному: уносит вправо-налево, отмечает слева-направо. Обе
// кромки никогда не открыты одновременно.
//
// Почему не крестик в строке: 32pt кнопка живёт в строке ВСЕГДА и отбирает
// место у содержания, а её зона смыкается с соседними кнопками (у номеров
// это уже приводило к ошибочным удалениям, аудит 2026-07-27). Свайп ничего
// не занимает и требует намеренного движения.
//
// Кнопка не делает разрушительного молча: у «Удалить» вызывающая сторона
// спрашивает подтверждение — объект с историей стирается насовсем.
//
// ОТКРЫТЫЙ РЯД РОВНО ОДИН на весь экран (правило живёт в примитиве, а не в
// каждом списке): вторая раскрытая кромка читается как «выбрано две строки»,
// и палец бьёт по кнопке не того ряда.

const ACTION_W = 96;
/** Дальше этого порога палец = «открыть», ближе = «вернуть». */
const OPEN_AT = ACTION_W * 0.5;
/** Размашистый свайп — сразу действие. Порог заведомо дальше раскрытия, чтобы
 *  обычное «посмотреть кнопку» в него не проваливалось. */
const FULL_AT = ACTION_W * 1.6;

/** Кто сейчас раскрыт. Модульная переменная, а не контекст: ряды живут в
 *  разных списках и разных экранах, а правило у них одно. */
let closeOpenRow: (() => void) | null = null;

export function SwipeRow({
  label,
  color,
  icon: Icon,
  accessibilityLabel,
  fullSwipe = false,
  onAction,
  leading,
  children,
}: {
  /** Подпись кнопки. Одна кромка — одно слово: она не зависит от того, какая
   *  именно строка смахнута. */
  label: string;
  /** Цвет подложки = смысл действия: `t.danger` — уносит, `t.accent` — ведёт
   *  дальше (открывает лист, переходит). */
  color: string;
  icon?: LucideIcon;
  /** Озвучка действия: «Удалить объект Вилла». */
  accessibilityLabel?: string;
  /** Размашистый свайп до конца СРАБАТЫВАЕТ, не дожидаясь тапа по кнопке.
   *  Только для ОБРАТИМЫХ действий (открыть лист, перейти) — см. закон
   *  «свайп не носит разрушительного» в DESIGN-SYSTEM.md. По умолчанию
   *  выключен: у «Удалить» промах пальца стоил бы объекта. */
  fullSwipe?: boolean;
  onAction: () => void;
  /** ВТОРАЯ КРОМКА — потянуть СЛЕВА НАПРАВО (владелец 2026-08-17: «если слева
   *  вправо потянуть, то только тогда можно открыть звёздочку и сделать её
   *  выбранной»). Правило то же: одна сторона — одно действие. Кромки
   *  взаимоисключающие: открыта всегда ровно одна. */
  leading?: {
    label: string;
    color: string;
    icon?: LucideIcon;
    accessibilityLabel?: string;
    onAction: () => void;
  };
  children: ReactNode;
}) {
  const t = useThemeColors();
  const x = useSharedValue(0);
  /** Какая кромка раскрыта: −1 — правая («Удалить»), 1 — левая, 0 — никакая. */
  const opened = useSharedValue(0);

  const close = useCallback(() => {
    x.value = withTiming(0, { duration: 140 });
    opened.value = 0;
    if (closeOpenRow === close) closeOpenRow = null;
  }, [opened, x]);

  // Открылись — закрываем предыдущий ряд и занимаем его место.
  const claim = useCallback(() => {
    if (closeOpenRow && closeOpenRow !== close) closeOpenRow();
    closeOpenRow = close;
    haptics.impact();
  }, [close]);

  // Ряд уехал с экрана раскрытым (список перерисовался, экран закрылся) —
  // иначе «единственный открытый» остаётся занят призраком навсегда.
  useEffect(
    () => () => {
      if (closeOpenRow === close) closeOpenRow = null;
    },
    [close],
  );

  // Действие живёт в ref: жест собран один раз, а обработчик у строки списка
  // меняется на каждый рендер.
  const latest = useRef(onAction);
  latest.current = onAction;
  const fire = useCallback(() => {
    close();
    latest.current();
  }, [close]);

  const latestLead = useRef(leading?.onAction);
  latestLead.current = leading?.onAction;
  const fireLead = useCallback(() => {
    close();
    latestLead.current?.();
  }, [close]);

  const hasLeading = !!leading;
  const pan = Gesture.Pan()
    // По горизонтали: вертикальный скролл списка должен побеждать.
    .activeOffsetX([-12, 12])
    .failOffsetY([-8, 8])
    .onChange((e) => {
      const base = opened.value * ACTION_W;
      // Ход в сторону, где действия нет, упирается в ноль. Размашистый свайп
      // должен доезжать до порога, поэтому у него ход длиннее.
      const low = fullSwipe ? -FULL_AT - 24 : -ACTION_W - 24;
      const high = hasLeading ? ACTION_W + 24 : 0;
      x.value = Math.min(high, Math.max(base + e.translationX, low));
    })
    .onEnd(() => {
      if (fullSwipe && x.value < -FULL_AT) {
        // Действие обратимо (лист только открывается), поэтому подтверждения
        // нет: строка возвращается на место, а лист приезжает поверх.
        x.value = withTiming(0, { duration: 160 });
        opened.value = 0;
        runOnJS(fire)();
        return;
      }
      const side = x.value < -OPEN_AT ? -1 : x.value > OPEN_AT ? 1 : 0;
      opened.value = side;
      x.value = withSpring(side * ACTION_W, {
        damping: 20,
        stiffness: 220,
      });
      if (side !== 0) runOnJS(claim)();
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }));

  return (
    <View>
      {/* Цветная подложка живёт ПОД строкой и видна ровно настолько,
          насколько её сдвинули.

          ДЛЯ РОТОРА ЕЁ НЕ СУЩЕСТВУЕТ. Кромка — часть жеста, а не элемент
          списка: то же действие строка отдаёт через `accessibilityActions`, и
          без этого VoiceOver читал под каждым счётом фантомную кнопку. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: ACTION_W,
          alignItems: "stretch",
        }}
      >
        <Pressable
          onPress={fire}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? label}
          style={({ pressed }) => ({
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            backgroundColor: color,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          {Icon ? <Icon color="#fff" size={18} strokeWidth={2.2} /> : null}
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{ fontSize: 15, fontWeight: "600", color: "#fff" }}
          >
            {label}
          </Text>
        </Pressable>
      </View>

      {leading ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: ACTION_W,
            alignItems: "stretch",
          }}
        >
          <Pressable
            onPress={fireLead}
            accessibilityRole="button"
            accessibilityLabel={leading.accessibilityLabel ?? leading.label}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              backgroundColor: leading.color,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            {leading.icon ? (
              <leading.icon color="#fff" size={18} strokeWidth={2.2} />
            ) : null}
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={{ fontSize: 15, fontWeight: "600", color: "#fff" }}
            >
              {leading.label}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <GestureDetector gesture={pan}>
        <Animated.View style={[rowStyle, { backgroundColor: t.surface }]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
