import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check } from "lucide-react-native";
import { haptics } from "@/lib/haptics";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { LIST_ROW } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

/** Попап одиночного выбора — закон «галка = один»: тап применяет и
 *  ЗАКРЫВАЕТ (эталон — пресеты периода). Для «Сортировки»: это
 *  персистентная настройка списка, «Сбросить» её не трогает. */
export function SinglePickSheet({
  visible,
  title,
  subtitle,
  blocks,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  /** Смысловые группы рядов — блоки разделены воздухом, как у периода. */
  blocks: { value: string; label: string }[][];
  selected: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  return (
    // Шапка — общая `BottomSheet` (имя по центру, под ним подпись), как у
    // всех шторок выбора: своя левая шапка была одна на продукт.
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      maxHeightRatio={0.85}
      title={title}
      subtitle={subtitle}
    >
      {/* Скролл обязателен: при крупном шрифте нижние оси иначе
          недостижимы — до них просто не дотянуться. */}
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: Math.max(insets.bottom, 16) + 12,
        }}
      >
        {blocks.map((block, bi) =>
          block.length === 0 ? null : (
            <View
              key={bi}
              accessibilityRole="radiogroup"
              style={{
                marginBottom: 8,
                borderRadius: t.radius.card,
                overflow: "hidden",
                backgroundColor: t.rowFill,
              }}
            >
              {block.map((o, i) => {
                const on = selected === o.value;
                return (
                  <Pressable
                    key={o.value}
                    onPress={() => {
                      haptics.tap();
                      if (!on) onSelect(o.value);
                      onClose();
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={o.label}
                    accessibilityHint="Применяет и закрывает"
                    // Раскладка ТОЛЬКО через style: NativeWind v5 роняет
                    // style-функцию Pressable, если рядом есть className
                    // (тот же баг, что с паддингами на ScrollView).
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      paddingHorizontal: 16,
                      minHeight: LIST_ROW.minHeight,
                      borderTopWidth: i > 0 ? 1 : 0,
                      borderTopColor: t.separator,
                      backgroundColor: pressed
                        ? t.rowFillPressed
                        : "transparent",
                    })}
                  >
                    <Text
                      maxFontSizeMultiplier={1.3}
                      numberOfLines={1}
                      style={{
                        flexShrink: 1,
                        fontSize: 15,
                        fontWeight: "600",
                        color: on ? t.accent : t.ink,
                      }}
                    >
                      {o.label}
                    </Text>
                    {on ? (
                      <View style={{ marginLeft: "auto", paddingLeft: 8 }}>
                        <Check color={t.accent} size={18} strokeWidth={2.6} />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ),
        )}
      </ScrollView>
    </BottomSheet>
  );
}
