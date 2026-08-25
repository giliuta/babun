import { Pressable, Text, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { ICON } from "./tokens";
import { useThemeColors } from "@/theme/colors";

// Строка настройки с действующим значением справа (диалект iOS Settings).
//
// `muted` — центральная идея настроек календаря: значение может быть
// УНАСЛЕДОВАНО. Тогда строка показывает не пустоту и не выключенный тумблер
// (оба врут — см. `hide_cancelled: v || null`), а живое значение серым:
// «Как везде · 09:00». Своё — чёрным. Смысл несёт текст, цвет только
// усиливает: серое = «поедет за общей настройкой».
//
// Текст значения целиком собирает вызывающий: наследование звучит по-разному
// («Как везде · 09:00», «Как шаг сетки · 30 мин»), и примитив не вправе
// диктовать формулировку.
export function ValueRow({
  label,
  value,
  muted,
  expanded,
  separated,
  onPress,
  onLongPress,
  longPressLabel,
}: {
  label: string;
  /** Действующее значение — всегда конкретное, никогда не плейсхолдер. */
  value: string;
  /** Значение унаследовано, своего у объекта нет. */
  muted?: boolean;
  /** СТРОКА-РАСКРЫВАШКА вместо строки-двери: `undefined` — обычная
   *  навигационная строка (шеврон вправо, ведёт куда-то); `true/false`
   *  превращают её в раскрывающуюся — редактор родитель рисует ПОД ней,
   *  шеврон поворачивается вниз, подпись уходит в акцент. Галки здесь нет
   *  намеренно (владелец 2026-08-17: «галочка справа мне не нравится»):
   *  раскрытый контрол под строкой и так говорит, что правят именно её —
   *  рецепт строки даты в Apple Calendar. */
  expanded?: boolean;
  /** Шов сверху — когда строка стоит не первой в группе. Тот же проп и тот же
   *  смысл, что у `FieldRow`: группа строк рисует границы сама, примитив не
   *  догадывается о своём месте. */
  separated?: boolean;
  onPress: () => void;
  /** Долгое нажатие — ВИДИМЫЙ ДУБЛЁР смахивания (закон «у жеста обязан быть
   *  дублёр словом»): смахнули влево — кнопка, зажали — меню с тем же словом.
   *  Оно же попадает в ротор VoiceOver, для которого свайпа не существует. */
  onLongPress?: () => void;
  /** Подпись действия ротора; без неё длинное нажатие останется только для
   *  зрячего пальца. */
  longPressLabel?: string;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityActions={
        onLongPress && longPressLabel
          ? [{ name: "longpress", label: longPressLabel }]
          : undefined
      }
      onAccessibilityAction={
        onLongPress
          ? (e) => {
              if (e.nativeEvent.actionName === "longpress") onLongPress();
            }
          : undefined
      }
      accessibilityRole="button"
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => ({
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 10,
        ...(separated
          ? { borderTopWidth: 1, borderTopColor: t.separator }
          : null),
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      {/* Подпись важнее значения: она сжимается последней. У Text в RN
          flexShrink по умолчанию 0 — без явного shrink у значения оно
          забирало всю свою ширину, и обрезалась именно ПОДПИСЬ
          («Длительность по…», «Отменённые зап…»). */}
      <Text
        maxFontSizeMultiplier={1.3}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={{
          flexShrink: 0,
          fontSize: 16,
          fontWeight: expanded ? "600" : "400",
          color: expanded ? t.accent : t.ink,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
      <View style={{ flex: 1, minWidth: 8 }} />
      <Text
        maxFontSizeMultiplier={1.3}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        style={{
          flexShrink: 1,
          fontSize: 16,
          color: muted ? t.faint : t.ink,
          marginRight: 6,
        }}
        numberOfLines={1}
      >
        {value}
      </Text>
      {expanded ? (
        <ChevronDown color={t.accent} size={ICON.sm} />
      ) : (
        <ChevronRight color={t.chevron} size={ICON.sm} />
      )}
    </Pressable>
  );
}
