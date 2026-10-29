import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// СТРОКА-ДВЕРЬ В КОЛОНКУ: «Подпись | значение ›». Тот же рисунок, что у поля
// `FieldRow column` (подпись 15 тихим цветом колонкой слева, значение 17, шов
// от колонки значений), только правка — не на месте, а за дверью: дата
// барабаном, адрес и реквизиты выплат листом. Данные человека — профиль,
// карточка партнёра, его «Личное» и «Выплаты», реквизиты — читаются одним
// способом, а не тремя (плитка с подписью, поле в рамке, колонка).
export function ColumnDoorRow({
  label,
  value,
  placeholder,
  column,
  separated,
  onPress,
}: {
  label: string;
  value: string | null | undefined;
  /** Пусто — подсказкой называет, что здесь будет. */
  placeholder: string;
  column: number;
  separated?: boolean;
  /** Нет — строка только показывает значение (нет права менять). */
  onPress?: () => void;
}) {
  const t = useThemeColors();
  const shown = (value ?? "").trim();
  return (
    <View>
      {separated ? (
        <View style={{ height: 1, marginLeft: 16 + column, backgroundColor: t.separator }} />
      ) : null}
      <Pressable
        onPress={
          onPress
            ? () => {
                haptics.tap();
                onPress();
              }
            : undefined
        }
        disabled={!onPress}
        accessibilityRole={onPress ? "button" : "text"}
        accessibilityLabel={shown ? `${label}, ${shown}` : label}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          minHeight: 44,
          paddingLeft: 16,
          paddingRight: onPress ? 12 : 16,
          paddingVertical: 2,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{ width: column, fontSize: 15, color: t.caption, paddingRight: 8 }}
        >
          {label}
        </Text>
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{ flex: 1, fontSize: 17, color: shown ? t.ink : t.placeholder }}
        >
          {shown || placeholder}
        </Text>
        {onPress ? <ChevronRight color={t.faint} size={16} strokeWidth={1.75} /> : null}
      </Pressable>
    </View>
  );
}
