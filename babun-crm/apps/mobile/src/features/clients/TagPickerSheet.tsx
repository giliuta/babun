import { Pressable, ScrollView, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import type { ClientTag } from "@babun/shared/local/clients";
import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ПИКЕР ТЕГОВ — тот же лист, что у метки (владелец 2026-07-26: «теги должны
// быть на уровне „Личное“ как метки… туда же добавь теги, сделай одинаковое
// как метки, чтоб внизу так вот вылазило красиво»).
//
// Отличие от метки одно и оно смысловое: метка у клиента ОДНА (тап выбирает и
// закрывает), тегов может быть несколько — поэтому лист остаётся открытым, а
// выбранные помечаются галкой. Закрывает «Готово».
//
// Чипы из карточки убраны: они были единственным местом, где выбор жил прямо
// на странице, и разъезжались с диалектом строк.

export function TagPickerSheet({
  visible,
  tags,
  selected,
  onToggle,
  onClose,
}: {
  visible: boolean;
  /** Каталог тегов тенанта (Кабинет → «Теги клиентов»). */
  tags: ClientTag[];
  selected: string[];
  onToggle: (id: string) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View className="items-center pb-2 pt-2">
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.2}
          className="text-[17px] font-semibold"
          style={{ color: t.ink }}
        >
          Теги
        </Text>
      </View>

      {/* px через contentContainerStyle — className на ScrollView
          NativeWind молча роняет. */}
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20 }}
      >
        <View className="gap-2 pb-2">
          {tags.map((tag) => {
            const on = selected.includes(tag.id);
            const dot = tag.color || getAvatarColor(tag.name);
            return (
              <Pressable
                key={tag.id}
                onPress={() => {
                  haptics.tap();
                  onToggle(tag.id);
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={tag.name}
                className="h-11 flex-row items-center gap-2.5 border px-3 active:opacity-70"
                style={{
                  borderRadius: t.radius.input,
                  borderColor: on ? t.accent : "transparent",
                  backgroundColor: on ? `${t.accent}1F` : t.fill,
                }}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: dot,
                  }}
                />
                <Text
                  maxFontSizeMultiplier={1.3}
                  numberOfLines={1}
                  className="flex-1 text-sm font-medium"
                  style={{ color: on ? t.accent : t.ink }}
                >
                  {tag.name}
                </Text>
                {on ? (
                  <Check color={t.accent} size={16} strokeWidth={2.6} />
                ) : null}
              </Pressable>
            );
          })}

          {tags.length === 0 ? (
            <Text
              maxFontSizeMultiplier={1.3}
              className="px-1 py-2 text-[13px]"
              style={{ color: t.faint }}
            >
              В каталоге пока нет тегов — создайте их в настройках клиентов,
              раздел «Теги клиентов».
            </Text>
          ) : null}
        </View>

        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Готово"
          className="mb-6 mt-1 h-12 items-center justify-center active:opacity-80"
          style={{ borderRadius: t.radius.input, backgroundColor: t.accent }}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            className="text-[15px] font-semibold"
            style={{ color: t.onAccent }}
          >
            Готово
          </Text>
        </Pressable>
      </ScrollView>
    </BottomSheet>
  );
}
