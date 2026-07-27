// OptionalDateField — необязательная дата (YYYY-MM-DD) в хвосте строки:
// «Указать» → КОЛЕСО В НИЖНЕМ ЛИСТЕ → значение с крестиком-очисткой.
//
// Владелец 2026-07-27: «на день рождения поставь такой же тумблер выбора даты,
// как в финансах или в фильтрах — прям точно такой же, такое же нажатие».
//
// Что было: два разных нативных compact-пикера в одной строке. Тап по
// «Указать» ничего не открывал — он лишь ДОРИСОВЫВАЛ второй крошечный контрол
// у правого края, и в него надо было попасть ещё раз. Одной рукой в машине это
// два прицельных касания по 30pt вместо одного понятного. Теперь одно нажатие
// открывает лист снизу с колесом — та же физика, что у периода в Финансах.

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { DateWheelSheet } from "@/components/ui/DateWheelSheet";
import { parseYMD } from "@/features/appointments/helpers";
import { formatShortDateRu } from "@/features/clients/format";
import { useThemeColors } from "@/theme/colors";

/** Строгий YYYY-MM-DD или «не указано» — мусор от старого свободного
 *  TextInput приводим к пустому значению. */
export function normalizeYMD(v: string | undefined): string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return "";
  return Number.isNaN(parseYMD(v).getTime()) ? "" : v;
}

export function OptionalDateField({
  label,
  value,
  onChange,
  align = "start",
  seed,
}: {
  /** Подпись строки: идёт в заголовок листа и в озвучку. */
  label?: string;
  /** "" = не указано; иначе валидный YYYY-MM-DD. */
  value: string;
  onChange: (v: string) => void;
  /** "end" — контрол в хвосте подписанной строки (страница кондиционера). */
  align?: "start" | "end";
  /** С какой даты открывать колесо, когда значения ещё нет (YYYY-MM-DD).
   *  Для дня рождения «сегодня» — бессмысленная отправная точка. */
  seed?: string;
}) {
  const t = useThemeColors();
  const [open, setOpen] = useState(false);
  const end = align === "end";
  const title = label ?? "Дата";

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        alignSelf: end ? "flex-end" : "flex-start",
      }}
    >
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={
          value ? `${title}: ${formatShortDateRu(value)}` : `Указать: ${title}`
        }
        accessibilityHint="Открывает выбор даты"
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
        style={({ pressed }) => ({
          minHeight: 32,
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            fontSize: 15,
            fontWeight: value ? "600" : "500",
            color: value ? t.ink : t.accent,
          }}
        >
          {value ? formatShortDateRu(value) : "Указать"}
        </Text>
      </Pressable>

      {value ? (
        <Pressable
          onPress={() => onChange("")}
          accessibilityRole="button"
          accessibilityLabel={`Очистить: ${title}`}
          // Слоп только вправо: слева стоит сама дата, а смыкание зон уже
          // однажды заставляло палец делать не то (аудит 2026-07-27).
          hitSlop={{ top: 14, bottom: 14, left: 2, right: 10 }}
          style={({ pressed }) => ({
            width: 24,
            alignItems: "center",
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <X color={t.ink} size={15} strokeWidth={2.4} />
        </Pressable>
      ) : null}

      <DateWheelSheet
        visible={open}
        title={title}
        value={value || null}
        seed={seed}
        clearLabel={value ? "Убрать дату" : undefined}
        onApply={(ymd) => {
          onChange(ymd);
          setOpen(false);
        }}
        onClear={() => {
          onChange("");
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
    </View>
  );
}
