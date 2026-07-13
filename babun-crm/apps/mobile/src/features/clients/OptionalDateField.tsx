// OptionalDateField — «не указано» → «Указать» → compact DateTimePicker
// + ✕-очистка для необязательных YYYY-MM-DD полей карточки клиента
// (даты ТО кондиционера, день рождения). Извлечён из ObjectsBlock, чтобы
// PersonalBlock использовал тот же нативный контрол вместо свободного
// текстового ввода, кормившего селекторы мусором.

import { Pressable, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { X } from "lucide-react-native";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
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
}: {
  /** Подпись над контролом; не передавать, если строка уже подписана. */
  label?: string;
  /** "" = не указано; иначе валидный YYYY-MM-DD. */
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useThemeColors();
  const a11y = label ? `: ${label}` : "";
  return (
    <View className="flex-1">
      {label ? (
        <Text className="mb-1 text-[11px]" style={{ color: t.sub }}>
          {label}
        </Text>
      ) : null}
      {value ? (
        <View className="flex-row items-center">
          <DateTimePicker
            value={parseYMD(value)}
            mode="date"
            display="compact"
            maximumDate={new Date()}
            onChange={(_, d) => d && onChange(formatYMD(d))}
          />
          <Pressable
            onPress={() => onChange("")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Очистить дату${a11y}`}
            className="ml-1 h-7 w-7 items-center justify-center rounded-full active:opacity-60"
          >
            <X color={t.faint} size={13} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => onChange(formatYMD(new Date()))}
          accessibilityRole="button"
          accessibilityLabel={`Указать дату${a11y}`}
          className="self-start rounded-lg px-2.5 py-2 active:opacity-60"
          style={{ backgroundColor: t.fill }}
        >
          <Text className="text-[13px] font-medium" style={{ color: t.accent }}>
            Указать
          </Text>
        </Pressable>
      )}
    </View>
  );
}
