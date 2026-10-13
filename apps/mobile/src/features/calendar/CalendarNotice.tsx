import { Pressable, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Clock } from "lucide-react-native";
import { haptics } from "@/lib/haptics";
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
 * почти белая, тон — один янтарный слой поверх неё, и ни одной заливки в
 * полный цвет. Громкость несёт кнопка, а не фон.
 *
 * 13.10 ВЛАДЕЛЕЦ ПРОБОВАЛ ЯРЧЕ И ВЕРНУЛ ПРЕЖНЮЮ («сделай как было, в нашем
 * стиле, только цвет немного ярче»; оранжевая карточка, дышащая кнопка и
 * пружина — отвергнуты). От проб остались: значок часов и тапнутое время над
 * вопросом (новый тап — новое время: родитель перемонтирует плашку по `key`),
 * янтарный слой гуще прежнего и смахивание вверх — убрать, не дожидаясь.
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
}: {
  /** Тапнутое время: «11:00» или «12 октября, 11:00». */
  when: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
  /** Смахнули вверх — убрать плашку. */
  onDismiss: () => void;
}) {
  const t = useThemeColors();
  const dragY = useSharedValue(0);

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
      if (e.translationY < -DISMISS_DISTANCE || e.velocityY < -DISMISS_VELOCITY) {
        runOnJS(dismiss)();
      } else {
        dragY.value = withTiming(0, { duration: 150 });
      }
    });
  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
    opacity: 1 + Math.max(-1, dragY.value / 50),
  }));

  return (
    <Animated.View
      entering={FadeIn.duration(160)}
      exiting={FadeOut.duration(160)}
      accessibilityRole="alert"
      // Накрывает ровно свою строку: родитель — обёртка шапки, и никакие
      // пиксели ленты команд под ней не оказываются.
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }}
    >
      <GestureDetector gesture={swipeUp}>
        <Animated.View
          accessibilityActions={[{ name: "escape", label: "Скрыть" }]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === "escape") onDismiss();
          }}
          style={[{ flex: 1, justifyContent: "center" }, dragStyle]}
        >
          {/* Два слоя вместо одной заливки: белая подложка держит читаемость
              текста, янтарь поверх неё только окрашивает воздух. Подложка
              глухая: на 0.985 сквозь неё проступали «Октябрь 2026» и значок
              «сегодня» (снято 13.10). Янтарь — 14% (было 8%): ярче, но не
              заливка. */}
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
              backgroundColor: `${t.warning}24`,
              borderBottomWidth: 1,
              borderBottomColor: `${t.warning}55`,
            }}
          />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: 16,
              paddingRight: 6,
              gap: 10,
            }}
          >
            <Clock size={18} color={t.warning} strokeWidth={2.2} />
            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
                style={{ fontSize: 12, fontWeight: "700", color: t.warning, fontVariant: ["tabular-nums"] }}
              >
                {when}
              </Text>
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
                style={{ fontSize: 14, fontWeight: "600", color: t.warning }}
              >
                {message}
              </Text>
            </View>
            <Pressable
              onPress={onAction}
              accessibilityRole="button"
              accessibilityLabel={`${actionLabel}, ${when}`}
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
      </GestureDetector>
    </Animated.View>
  );
}
