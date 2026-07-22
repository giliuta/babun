import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useThemeColors } from "@/theme/colors";

export interface SheetOption<V extends string> {
  value: V;
  label: string;
  /** Вторая строка — чем этот вариант отличается. Пусто у обычных строк. */
  hint?: string;
}

// Список выбора с галочкой — один афорданс на все настройки календаря.
// Диалект центрированной iOS-карточки взят у CityPickerModal, чтобы два
// списка выбора в одном приложении не выглядели разными продуктами.
//
// Заменяет собой три несовместимых способа выбрать одно значение: степпер
// ±1 час (девять тапов до 09:00), свободный TextInput «HH:MM» (принимал
// 06:30 там, где рельс целочасовой) и полосу чипов (не влезает в 24 часа).
// Строка «Как везде» — обычная опция этого же списка: единственное место
// во всём UI, откуда в базу уходит null.
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
  const reducedMotion = useReducedMotion();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reducedMotion ? "none" : "fade"}
      onRequestClose={onClose}
    >
      {/* accessible={false} на скриме и карточке: иначе VoiceOver схлопывает
          лист в один безымянный «button» и строки недостижимы. */}
      <Pressable
        onPress={onClose}
        accessible={false}
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          backgroundColor: t.scrim,
        }}
      >
        <Pressable
          onPress={() => {}}
          accessible={false}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={{
            width: "100%",
            maxWidth: 340,
            borderRadius: t.radius.card,
            overflow: "hidden",
            paddingBottom: 12,
            backgroundColor: t.canvas,
            boxShadow: t.cardShadow,
          }}
        >
          <View
            className="flex-row items-center pl-4 pr-2"
            style={{
              minHeight: 52,
              backgroundColor: t.surface,
              borderBottomWidth: 1,
              borderBottomColor: t.separator,
            }}
          >
            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={{ flex: 1, fontSize: 17, fontWeight: "600", color: t.ink }}
            >
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Закрыть"
              style={({ pressed }) => ({
                minHeight: 44,
                minWidth: 64,
                alignItems: "flex-end",
                justifyContent: "center",
                opacity: pressed ? 0.65 : 1,
              })}
            >
              <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 15, fontWeight: "500", color: t.accent }}>
                Закрыть
              </Text>
            </Pressable>
          </View>

          <View
            className="mx-3 mt-3 overflow-hidden rounded-[14px]"
            style={{ backgroundColor: t.surface }}
          >
            <ScrollView style={{ maxHeight: 380 }} bounces={false}>
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
                      accessibilityLabel={
                        o.hint ? `${o.label}, ${o.hint}` : o.label
                      }
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
            </ScrollView>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
