import { Pressable, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import { todayYmd } from "./format";

// ДАТА ДОКУМЕНТА СТАВИТСЯ ТАК ЖЕ, КАК У ДОХОДА И РАСХОДА (владелец 2026-08-15).
//
// Было: строка-значение, открывающая СВОЙ модал с барабаном и кнопкой
// «Выбрать дату» — три тапа и отдельное окно ради одного числа. В листе
// операции дата всегда стояла компактным нативным пикером прямо в строке:
// тап → календарь-поповер → готово. Теперь то же самое и в документах —
// одно движение на весь продукт.
//
// ⚠️ ПИКЕР ОБЯЗАН РОЖДАТЬСЯ СО ЗНАЧЕНИЕМ. Компактный `DateTimePicker`,
// смонтированный до того, как дата известна, НАВСЕГДА запоминает «1 янв.
// 1970» — Fast Refresh это не чинит. Поэтому пустой необязательный срок
// рисуется НЕ пикером, а кнопкой «Поставить срок»: пикер появляется уже с
// датой. По той же причине экран редактора монтируется только после загрузки
// (`new.tsx` держит его за `loading`).
export function InvoiceDateRow({
  label,
  value,
  optional,
  minimum,
  onChange,
}: {
  label: string;
  /** null — срок не поставлен. Бывает только у `optional`. */
  value: string | null;
  /** Срок можно снять вовсе: инвойс без срока оплаты — обычное дело. */
  optional?: boolean;
  /** Нижняя граница (для «Оплатить до» — день выставления). */
  minimum?: string;
  onChange: (value: string | null) => void;
}) {
  const t = useThemeColors();
  return (
    <View className="flex-row items-center justify-between px-4 py-2.5">
      <Text className="text-base" style={{ color: t.ink }}>
        {label}
      </Text>
      {value ? (
        <View className="flex-row items-center" style={{ gap: 4 }}>
          <DateTimePicker
            value={parseYMD(value)}
            minimumDate={minimum ? parseYMD(minimum) : undefined}
            mode="date"
            display="compact"
            themeVariant="light"
            locale="ru-RU"
            onChange={(_, date) => date && onChange(formatYMD(date))}
          />
          {optional ? (
            <Pressable
              onPress={() => onChange(null)}
              accessibilityRole="button"
              accessibilityLabel={`Убрать ${label.toLowerCase()}`}
              hitSlop={10}
              style={({ pressed }) => ({
                paddingHorizontal: 6,
                minHeight: 44,
                justifyContent: "center",
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ fontSize: 15, fontWeight: "600", color: t.accent }}>
                Убрать
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <Pressable
          onPress={() => onChange(minimum ?? todayYmd())}
          accessibilityRole="button"
          accessibilityLabel={`Поставить ${label.toLowerCase()}`}
          hitSlop={8}
          style={({ pressed }) => ({
            minHeight: 44,
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ fontSize: 16, fontWeight: "600", color: t.accent }}>
            Поставить срок
          </Text>
        </Pressable>
      )}
    </View>
  );
}
