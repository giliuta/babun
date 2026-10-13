import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Clock } from "lucide-react-native";
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
 */
export function CalendarNotice({
  when,
  message,
  actionLabel,
  onAction,
}: {
  /** Тапнутое время: «13:00» сегодня, «7 октября, 13:00» — в другой день. */
  when: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const t = useThemeColors();
  return (
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
          backgroundColor: `${t.warning}14`,
          borderBottomWidth: 1,
          borderBottomColor: `${t.warning}2e`,
        }}
      />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 16,
          paddingRight: 6,
          gap: 8,
        }}
      >
        <Clock size={18} color={t.warning} strokeWidth={2.2} />
        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 12, color: t.sub, fontVariant: ["tabular-nums"] }}
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
  );
}
