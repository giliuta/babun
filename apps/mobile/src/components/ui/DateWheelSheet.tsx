import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { DateSpinner } from "@/components/ui/DateSpinner";
import { FOOTER_SIDE } from "@/components/ui/tokens";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";

// ОДНА ДАТА — ТЕМ ЖЕ КОЛЕСОМ, ЧТО ПЕРИОД В ФИНАНСАХ.
//
// День рождения выбирается таким же тумблером, как в финансах или в фильтрах:
// то же нажатие.
//
// Нативный compact-пикер прямо в строке не годится: тап по «Указать» ничего не
// открывает — он лишь ДОРИСОВЫВАЕТ второй крошечный контрол у правого края, в
// который надо попасть вторым тапом. Одной рукой в машине это два
// прицельных касания по 30pt вместо одного понятного.
//
// Здесь физика периода: лист снизу, колесо-спиннер, «Применить». Значение
// применяется кнопкой, а не на каждый щелчок — колесо проезжает через
// промежуточные даты, и живая запись слала бы их все.
//
// АНАТОМИЯ — КАНОН ЛИСТА, как у «Своего периода»: заголовок пропом `title`
// (внутри жеста грабера, с ролью заголовка), барабан в теле, «Применить» и
// «Убрать дату» — в `footer`. Свою шапку и кнопку внутри тела этот лист
// рисовал сам: заголовок не тянул лист вниз, а кнопка стояла не на месте
// кнопок остальных листов и без их нижнего отступа.

export function DateWheelSheet({
  visible,
  title,
  value,
  /** С какой даты начинать, когда значения ещё нет (у дня рождения сегодня —
   *  бессмысленная отправная точка). */
  seed,
  maximumDate,
  minimumDate,
  clearLabel,
  onApply,
  onClear,
  onClose,
}: {
  visible: boolean;
  title: string;
  value: string | null;
  seed?: string;
  /** Дальше этой даты не пускаем («YYYY-MM-DD»): операция не бывает в
   *  будущем, и запрет должен стоять в самом барабане, а не в отказе после. */
  maximumDate?: string;
  /** Раньше этой даты не пускаем: срок оплаты не бывает до выставления. */
  minimumDate?: string;
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
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      title={title}
      footer={
        <View style={{ paddingHorizontal: FOOTER_SIDE }}>
          <Button label="Применить" onPress={() => onApply(draft)} />
          {onClear && clearLabel ? (
            <Pressable
              onPress={onClear}
              accessibilityRole="button"
              accessibilityLabel={clearLabel}
              style={({ pressed }) => ({
                marginTop: 4,
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
      }
    >
      <View style={{ alignItems: "center", paddingHorizontal: 20, paddingBottom: 8 }}>
        <DateSpinner
          value={parseYMD(draft)}
          maximumDate={maximumDate ? parseYMD(maximumDate) : undefined}
          minimumDate={minimumDate ? parseYMD(minimumDate) : undefined}
          onChange={(next) => setDraft(formatYMD(next))}
        />
      </View>
    </BottomSheet>
  );
}
