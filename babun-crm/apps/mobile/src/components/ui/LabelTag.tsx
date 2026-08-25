import { Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";

// Корешок метки: компактный тег на тонированной подложке цвета метки.
// Единый визуальный язык меток библиотеки Кабинета: дни календаря
// (date-header) и ряд «Метка» на карточке клиента. sm: до 4 букв под
// числом недели, lg: полное имя (шапка Дня, карточка).
export function LabelTag({
  color,
  text,
  lg = false,
}: {
  color: string;
  text: string;
  lg?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View
      // КОРЕШОК ОБЯЗАН БЫТЬ ВИДЕН НА ЛЮБОМ ЦВЕТЕ (владелец 2026-08-24: «метки
      // под датой сливается, её вообще не видно… чтобы не было таких багов по
      // дизайну»). Заливка в 15% решала это только для тёмных меток: светло-
      // жёлтая или бледно-серая растворялась в белой шапке начисто, и корешок
      // читался пустым местом. Форму теперь держит КОНТУР — он виден при любой
      // светлоте, — а заливка осталась тихой подложкой под текст. Красить сам
      // текст цветом метки по-прежнему нельзя: произвольный оттенок не
      // обещает контраста, поэтому буквы остаются чернилами.
      style={{
        borderRadius: lg ? 5 : 4,
        paddingHorizontal: lg ? 8 : 5,
        paddingVertical: lg ? 1.5 : 1,
        backgroundColor: `${color}29`,
        borderWidth: 1,
        borderColor: `${color}8c`,
      }}
    >
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
        style={{
          fontSize: lg ? 10 : 9,
          fontWeight: "700",
          letterSpacing: 0.5,
          textTransform: "uppercase",
          // Arbitrary user tints are not guaranteed to contrast with their
          // translucent background. Keep the tint as the background and use
          // the semantic foreground for readable text.
          color: t.ink,
        }}
      >
        {text}
      </Text>
    </View>
  );
}
