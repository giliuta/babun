import { Pressable, Text } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";

// ЧЕЙ ЭТО ЧЕЛОВЕК — СТРОКОЙ ПОД ИМЕНЕМ (STORY-086; владелец 2026-09-21:
// «сделать всё единой страницей»). Как должность и компания под именем в
// Контактах iPhone: «жена · Павел Иванов», «жилец · Наталья · Вилла 5».
//
// Отдельного блока «Входит в» нет. Он читался наоборот: строка «Павел
// Иванов · жена» на карточке Екатерины говорила, будто жена — Павел. Здесь
// роль стоит ПЕРВОЙ: это роль ЭТОГО человека, а за точкой — чей он.
//
// СТРОКУ СОБИРАЕТ НЕ ЭТОТ ФАЙЛ. Она приходит готовой из общего построителя
// `linkLine` (`selectors/client-links.ts`) — того же, что печатает
// `ClientRow.link` в списке и `linkFor` в шторке выбора. Пока строка
// собиралась здесь своими руками, у неё был и свой запасной вид («Без
// имени»), которого построитель не знает: связь, которую нечем назвать, он
// не отдаёт вовсе — «жилец · (никого)» это запрещённое «видно, но пусто».
//
// Тап открывает карточку того, в чьих людях он стоит. Роль правится там же,
// где её вписали, — в блоке «Клиент» той карточки.

export function MemberOfLine({
  line,
  onOpen,
}: {
  /** Готовая строка связи — «жилец · Наталья · Вилла 5». */
  line: string;
  /** Нет — строка только читается: карточки-группы не открыть (черновик,
   *  связь пришла с дверью и клиента ещё нет). Тогда нет и шеврона: он
   *  обещал бы дверь, за которой ничего нет. */
  onOpen?: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onOpen}
      disabled={!onOpen}
      // Строка ~26pt, а тап по ней уводит на чужую карточку — частое движение
      // («жена → Павел Иванов»). Слоп добирает цель к норме, не раздвигая
      // вёрстку; вверх — меньше: там поле имени, и тап по нему не должен
      // уводить со страницы.
      hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
      accessibilityRole={onOpen ? "link" : "text"}
      accessibilityLabel={line}
      accessibilityHint={onOpen ? "Открывает карточку" : undefined}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        // 32 + слоп 6/6 = 44: частый тап «жена → Павел» (аудит 22.09 мерил 37).
        minHeight: 32,
        paddingHorizontal: 16,
        paddingBottom: 4,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
        style={{
          flexShrink: 1,
          fontSize: 15,
          fontWeight: "500",
          color: onOpen ? t.accent : t.sub,
        }}
      >
        {line}
      </Text>
      {onOpen ? (
        <ChevronRight
          color={t.accent}
          size={16}
          strokeWidth={2.2}
          style={{ marginLeft: 2 }}
        />
      ) : null}
    </Pressable>
  );
}
