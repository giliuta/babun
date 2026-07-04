import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";

// Пикер метки дня — web parity CityPickerModal: список меток бригады
// (team.cities, цвет из справочника городов) + «Убрать метку».

export interface CityOption {
  name: string;
  color: string;
}

export function CityPickerSheet({
  visible,
  dateLabel,
  options,
  selected,
  onPick,
  onClear,
  onClose,
}: {
  visible: boolean;
  /** «пятница, 10 июля» — заголовок листа. */
  dateLabel: string;
  options: CityOption[];
  /** Текущая метка дня (имя) или "". */
  selected: string;
  onPick: (name: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1" style={{ backgroundColor: t.scrim }} onPress={onClose} />
      <View className="max-h-[60%] rounded-t-3xl pb-8 pt-4" style={{ backgroundColor: t.surface }}>
        <Text className="mb-2 px-5 text-lg font-bold" style={{ color: t.ink }}>
          Метка дня
        </Text>
        <Text className="mb-2 px-5 text-sm" style={{ color: t.sub }}>
          {dateLabel}
        </Text>
        <ScrollView>
          {options.length === 0 ? (
            <Text className="px-5 py-3 text-sm" style={{ color: t.faint }}>
              У бригады пока нет меток — добавьте их в настройках команды
              (Команды → Метки).
            </Text>
          ) : (
            options.map((o) => {
              const active = o.name === selected;
              return (
                <Pressable
                  key={o.name}
                  onPress={() => onPick(o.name)}
                  accessibilityRole="button"
                  className="flex-row items-center gap-3 px-5 py-3 active:opacity-60"
                  style={active ? { backgroundColor: `${t.accent}14` } : undefined}
                >
                  <View
                    style={{
                      height: 12,
                      width: 12,
                      borderRadius: 6,
                      backgroundColor: o.color,
                    }}
                  />
                  <Text className="flex-1 text-base" style={{ color: t.ink }}>
                    {o.name}
                  </Text>
                  {active ? <Check color={t.accent} size={18} /> : null}
                </Pressable>
              );
            })
          )}
          {selected ? (
            <Pressable
              onPress={onClear}
              accessibilityRole="button"
              className="px-5 py-3 active:opacity-60"
            >
              <Text className="text-base font-medium" style={{ color: t.danger }}>
                Убрать метку
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}
