import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

// Стандарт «Добавить» (DS): в кабинете и справочниках создание живёт НЕ в
// нав-баре, а полноширинной строкой-кнопкой под последним элементом списка:
// явная текстовая команда «Добавить счёт»/«Добавить услугу» и шеврон.
// Универсального глифа «плюс» в приложении нет. В пустом состоянии CTA даёт EmptyState — AddRow
// тогда не рендерить, чтобы не дублировать.
export function AddRow({
  label,
  onPress,
  disabled,
  separated,
}: {
  /** Полная подпись действия: «Добавить счёт», «Добавить услугу»… */
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Верхняя линия — когда строка идёт под списком, а не одна в группе. */
  separated?: boolean;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      // БЕЗ className. `className` вместе со `style`-ФУНКЦИЕЙ молча убивает
      // весь стиль: react-native-css складывает их в массив
      // `[классовые_стили, fn]`, а React Native вызывает `style`, только когда
      // он САМ функция — массив с функцией внутри выбрасывается целиком.
      // Из-за этого строка рендерилась высотой 24pt (коробка шеврона) вместо
      // 52: единственная дверь создания имела цель касания вдвое меньше
      // минимума Apple. Заодно не работали подсветка нажатия, верхняя линия и
      // гашение при disabled. Раскладку держим числами в той же функции.
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        minHeight: 52,
        opacity: disabled ? 0.4 : 1,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <Text
        maxFontSizeMultiplier={1.3}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        // ТОЖЕ БЕЗ className, и по той же причине, что у строки выше: с
        // `adjustsFontSizeToFit` кегль обязан приехать в САМОМ `style`.
        // Классовый `text-base` доходит до текста другим путём, алгоритм сжатия
        // считает диапазон без него — и подпись «Добавить счёт» ужималась до
        // нечитаемых ~7pt, хотя `minimumFontScale` обещает не ниже 12.
        style={{ flex: 1, fontSize: 16, fontWeight: "500", color: t.accent }}
        numberOfLines={1}
      >
        {label}
      </Text>
      <View className="ml-3 h-7 w-7 items-center justify-center">
        <ChevronRight color={t.chevron} size={ICON.sm} />
      </View>
    </Pressable>
  );
}
