import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";

// ОДНА ДАТА — ТЕМ ЖЕ КОЛЕСОМ, ЧТО ПЕРИОД В ФИНАНСАХ.
//
// Владелец 2026-07-27: «на день рождения поставь такой же тумблер выбора даты,
// как в финансах или в фильтрах — прям точно такой же, такое же нажатие».
//
// Было: нативный compact-пикер прямо в строке. Тап по «Указать» ничего не
// открывал — он лишь ДОРИСОВЫВАЛ второй крошечный контрол у правого края, в
// который надо было попасть вторым тапом. Одной рукой в машине это два
// прицельных касания по 30pt вместо одного понятного.
//
// Здесь физика периода: лист снизу, колесо-спиннер, «Применить». Значение
// применяется кнопкой, а не на каждый щелчок — колесо проезжает через
// промежуточные даты, и живая запись слала бы их все.

export function DateWheelSheet({
  visible,
  title,
  value,
  /** С какой даты начинать, когда значения ещё нет (у дня рождения сегодня —
   *  бессмысленная отправная точка). */
  seed,
  clearLabel,
  onApply,
  onClear,
  onClose,
}: {
  visible: boolean;
  title: string;
  value: string | null;
  seed?: string;
  clearLabel?: string;
  onApply: (ymd: string) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const [draft, setDraft] = useState(value ?? seed ?? formatYMD(new Date()));

  // Открытие всегда начинается с текущего значения, а не с того, что крутили
  // в прошлый раз.
  useEffect(() => {
    if (visible) setDraft(value ?? seed ?? formatYMD(new Date()));
  }, [visible, value, seed]);

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 28, paddingTop: 4 }}>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.2}
          style={{
            marginBottom: 4,
            fontSize: 17,
            fontWeight: "600",
            color: t.ink,
            textAlign: "center",
          }}
        >
          {title}
        </Text>

        <View style={{ alignItems: "center" }}>
          <DateTimePicker
            themeVariant="light"
            value={parseYMD(draft)}
            mode="date"
            display="spinner"
            locale="ru-RU"
            onChange={(_, d) => {
              if (d) setDraft(formatYMD(d));
            }}
          />
        </View>

        <Button label="Применить" onPress={() => onApply(draft)} />

        {onClear && clearLabel ? (
          <Pressable
            onPress={onClear}
            accessibilityRole="button"
            accessibilityLabel={clearLabel}
            style={({ pressed }) => ({
              marginTop: 8,
              minHeight: 48,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text
              maxFontSizeMultiplier={1.2}
              style={{ fontSize: 15, fontWeight: "600", color: t.danger }}
            >
              {clearLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </BottomSheet>
  );
}
