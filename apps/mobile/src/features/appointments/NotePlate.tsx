import { Pressable, Text, View } from "react-native";
import { StickyNote } from "lucide-react-native";
import { ICON } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// МАЛЕНЬКАЯ ПЛАШКА ЗАМЕТКИ ПОД КЛИЕНТОМ И ПОД ОБЪЕКТОМ (владелец 2026-09-03:
// «сделай под клиентом внизу маленькую плашку заметки — заметка клиента,
// заметка объекта»).
//
// Это то, что бригаде надо знать ДО выезда и что живёт не в записи, а в
// клиенте («звонить после 18») и в объекте («код ворот 1234»). Раньше за этим
// ходили в карточку клиента, куда из записи не ходят. Плашка ПОКАЗЫВАЕТ
// заметку; тап ведёт туда, где её правят на карточке, — куда именно, знает
// вызывающий (`hint`).
//
// Пустая плашка предлагает действие, а не объясняет (закон пустого поля):
// «Добавить заметку» акцентом — чья заметка, уже сказано карточкой.
// Кегль — Subhead 13/18: плашка маленькая по слову владельца, а 13 — тот же
// размер, каким заметка объекта печатается третьей строкой на карточке.

export function NotePlate({
  text,
  subject,
  hint,
  onPress,
}: {
  /** Текст заметки; пусто — плашка зовёт добавить. */
  text: string | null | undefined;
  /** Чья заметка, в родительном: «клиента», «объекта» — для VoiceOver. */
  subject: string;
  /** Что откроет тап — VoiceOver-подсказка. */
  hint: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const value = (text ?? "").trim();
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={
        value ? `Заметка ${subject}: ${value}` : `Добавить заметку ${subject}`
      }
      accessibilityHint={hint}
      style={({ pressed }) => ({
        marginHorizontal: 12,
        marginBottom: 10,
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: t.radius.input,
        backgroundColor: pressed ? t.rowFillPressed : t.fill,
      })}
    >
      <StickyNote color={value ? t.sub : t.accent} size={ICON.xs} />
      <Text
        maxFontSizeMultiplier={1.3}
        numberOfLines={3}
        style={{
          flex: 1,
          fontSize: 13,
          lineHeight: 18,
          fontWeight: value ? "500" : "600",
          color: value ? t.ink : t.accent,
        }}
      >
        {value || "Добавить заметку"}
      </Text>
    </Pressable>
  );
}
