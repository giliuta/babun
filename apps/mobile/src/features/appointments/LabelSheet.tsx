import { Pressable, Text, View } from "react-native";
import { Check, MapPin } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
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
// ПЕРВАЯ СТРОКА — «КАК У ДНЯ», и она не пустая: она называет метку, которую
// запись возьмёт, если своей у неё нет. Так видно, ОТ ЧЕГО отступаешь.
// Диалект строк тот же, что у выбора клиента, объекта и команды.

export interface LabelOption {
  name: string;
  color: string;
}

const SIDE = 20;

export function LabelSheet({
  visible,
  options,
  value,
  dayLabel,
  onPick,
  onClose,
}: {
  visible: boolean;
  /** Метки команды — те же, что предлагаются дню. */
  options: readonly LabelOption[];
  /** Метка самой записи; null — «как у дня». */
  value: string | null;
  /** Что стоит на дне у этой команды — для первой строки. */
  dayLabel: string | null;
  onPick: (next: string | null) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const pick = (next: string | null) => {
    haptics.tap();
    onPick(next);
  };
  const row = (
    key: string,
    name: string,
    hint: string | null,
    color: string | null,
    chosen: boolean,
    onPress: () => void,
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: chosen }}
      accessibilityLabel={hint ? `${name}, ${hint}` : name}
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
          backgroundColor: color ? `${color}26` : t.fill,
        }}
      >
        <MapPin color={color ?? t.sub} size={16} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
        >
          {name}
        </Text>
        {hint ? (
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            style={{ fontSize: 13, color: t.sub }}
          >
            {hint}
          </Text>
        ) : null}
      </View>
      {chosen ? <Check color={t.accent} size={18} strokeWidth={2.4} /> : null}
    </Pressable>
  );

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
        {row(
          "day",
          "Как у дня",
          dayLabel ?? "у дня метки нет",
          null,
          value == null,
          () => pick(null),
        )}
        {options.map((option) =>
          row(
            option.name,
            option.name,
            null,
            option.color,
            value === option.name,
            () => pick(option.name),
          ),
        )}
      </View>
    </BottomSheet>
  );
}
