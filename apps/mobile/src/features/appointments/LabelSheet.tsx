import { Pressable, Text, View } from "react-native";
import { Check, MapPin } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// МЕТКА ЭТОЙ ЗАПИСИ (владелец 2026-09-04: «в день есть целый день Лимассол,
// но последний клиент — можем поставить другую метку; целый день ребята
// работают на одной метке, а в конце просто ставится другая»).
//
// До этого метка жила на двух уровнях — день команды и клиент, — и чтобы
// отметить одну работу иначе, приходилось перекрашивать весь день.
//
// ЛИСТ ОТКРЫВАЕТСЯ С УЖЕ ВЫБРАННОЙ МЕТКОЙ: новая запись надевает метку дня
// сама, поэтому выбирать «как у дня» нечего — выбирают ДРУГУЮ метку, если
// эта работа не там, где остальной день. Диалект строк тот же, что у выбора
// клиента, объекта и команды.

export interface LabelOption {
  name: string;
  color: string;
}

const SIDE = 20;

export function LabelSheet({
  visible,
  options,
  value,
  onPick,
  onClose,
}: {
  visible: boolean;
  /** Метки команды — те же, что предлагаются дню. */
  options: readonly LabelOption[];
  /** Метка, действующая сейчас: своя либо взятая у дня. */
  value: string | null;
  onPick: (next: string) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Метка записи"
      padded={false}
      scroll
      maxHeightRatio={0.5}
      footer={
        <View style={{ paddingHorizontal: SIDE }}>
          <Button label="Применить" onPress={onClose} />
        </View>
      }
    >
      <View style={{ paddingHorizontal: SIDE, paddingTop: 4, paddingBottom: 12, gap: 8 }}>
        {options.length > 0 ? (
          options.map((option) => {
            const chosen = value === option.name;
            return (
              <Pressable
                key={option.name}
                onPress={() => {
                  haptics.tap();
                  // Тап по уже выбранной ничего не снимает: метка у записи
                  // есть всегда, и «пустой» она быть не может.
                  onPick(option.name);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: chosen }}
                accessibilityLabel={option.name}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  minHeight: 52,
                  paddingHorizontal: 14,
                  borderRadius: t.radius.input,
                  backgroundColor: pressed ? t.rowFillPressed : t.rowFill,
                })}
              >
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: t.radius.pill,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: `${option.color}26`,
                  }}
                >
                  <MapPin color={option.color} size={16} strokeWidth={2.2} />
                </View>
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                  style={{ flex: 1, fontSize: 15, fontWeight: "600", color: t.ink }}
                >
                  {option.name}
                </Text>
                {chosen ? (
                  <Check color={t.accent} size={18} strokeWidth={2.4} />
                ) : null}
              </Pressable>
            );
          })
        ) : (
          <EmptyState title="У команды пока нет меток" />
        )}
      </View>
    </BottomSheet>
  );
}
