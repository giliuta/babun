import { Pressable, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useThemeColors } from "@/theme/colors";

export interface SheetOption<V extends string> {
  value: V;
  label: string;
  /** Вторая строка — чем этот вариант отличается. Пусто у обычных строк. */
  hint?: string;
}

// Список выбора с галочкой — один афорданс на все настройки календаря.
//
// ПРИЕЗЖАЕТ СНИЗУ, КАК ВСЁ ОСТАЛЬНОЕ (владелец 2026-08-27: «чтоб оно снизу
// вверх открывалось как всё остальное»). Раньше это была центрированная
// карточка на своём `Modal` с `animationType="fade"` — единственная в
// продукте панель, которая появлялась не снизу. Диалект выбирали ради
// сходства с мини-календарём, но мини-календарь — джампер по датам, а не
// выбор значения; рядом с двумя десятками нижних листов карточка читалась
// как чужой экран.
//
// Теперь идёт через канонический `BottomSheet` (§5): скрим гаснет на месте,
// панель пружинит снизу, грабер тянется, `onAccessibilityEscape` даёт выход
// VoiceOver — всё это примитив несёт сам, и здесь больше не повторяется.
//
// SELECTION LAW (канон §5): галка + акцент = ОДИНОЧНЫЙ выбор, тап применяет
// и закрывает. Множественный выбор — это «оттиск» и другая поверхность.
export function OptionSheet<V extends string>({
  visible,
  title,
  options,
  value,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: readonly SheetOption<V>[];
  value: V;
  onPick: (v: V) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} scroll>
      <View
        className="overflow-hidden rounded-[10px]"
        style={{ backgroundColor: t.surface }}
      >
        {options.map((o, i) => {
          const active = o.value === value;
          return (
            <View key={o.value}>
              {i > 0 ? (
                <View
                  style={{
                    height: 1,
                    marginLeft: 16,
                    backgroundColor: t.separator,
                  }}
                />
              ) : null}
              <Pressable
                onPress={() => {
                  onPick(o.value);
                  onClose();
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={o.hint ? `${o.label}, ${o.hint}` : o.label}
                style={({ pressed }) => ({
                  minHeight: 48,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  backgroundColor: pressed ? t.pressed : "transparent",
                })}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    style={{ fontSize: 16, color: t.ink }}
                    numberOfLines={1}
                  >
                    {o.label}
                  </Text>
                  {o.hint ? (
                    <Text
                      maxFontSizeMultiplier={1.3}
                      style={{ fontSize: 13, color: t.faint, marginTop: 1 }}
                      numberOfLines={1}
                    >
                      {o.hint}
                    </Text>
                  ) : null}
                </View>
                {active ? (
                  <Check color={t.accent} size={18} strokeWidth={2.5} />
                ) : null}
              </Pressable>
            </View>
          );
        })}
      </View>
    </BottomSheet>
  );
}
