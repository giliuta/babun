import { Pressable } from "react-native";
import type { LucideIcon } from "lucide-react-native";

/** Кнопка в ХВОСТЕ строки — действие над самим значением этой строки:
 *  связаться с этим номером, проложить маршрут к этому адресу.
 *
 *  32pt кружок: меньше цели касания 44pt по кругу, поэтому hitSlop
 *  добирает остальное — иначе палец бьёт по строке и уводит со экрана.
 *
 *  РАЗМЕР ОДИН НА ПРОДУКТ: иконка вызова везде одинаковая во всей системе.
 *  Кнопка 44-го размера или звонок своим 44-м кружком рядом с 32-м «…»
 *  читались бы как две разные вещи. */
export function RowActionButton({
  icon: Icon,
  color,
  label,
  hint,
  onPress,
  onLongPress,
  accessibilityActions,
  onAccessibilityAction,
}: {
  icon: LucideIcon;
  color: string;
  label: string;
  hint?: string;
  onPress: () => void;
  /** Второе действие удержанием (кнопка звонка: тап звонит, удержание —
   *  способы связи). Удержание незаметно VoiceOver — дублируй его действием
   *  ротора через `accessibilityActions`. */
  onLongPress?: () => void;
  accessibilityActions?: readonly { name: string; label: string }[];
  onAccessibilityAction?: (name: string) => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={
        onAccessibilityAction
          ? (e) => onAccessibilityAction(e.nativeEvent.actionName)
          : undefined
      }
      // 28 + 8 с каждой стороны = 44pt зоны касания.
      hitSlop={8}
      style={({ pressed }) => ({
        // 28 — РАЗМЕР ПЛИТКИ СТРОКИ (`SelectRow`, плитка объекта): кружок
        // маршрута стоит в одной строке с плиткой объекта, и значки там сравнивают
        // рядом — 32 против 28 читалось бы «разного размера».
        width: 28,
        height: 28,
        // Круг: w === h. Круг не может стать прямоугольником — это
        // геометрическое исключение из закона одного радиуса.
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: `${color}1a`,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon color={color} size={16} strokeWidth={2.2} />
    </Pressable>
  );
}
