import { Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useThemeColors } from "@/theme/colors";

// Строка с нативным выбором времени — тот же рецепт, что уже стоит в форме
// записи (display="compact" + minuteInterval={5}), поэтому время в приложении
// вводится ОДНИМ способом. Заменяет свободный TextInput «HH:MM» из хаба
// бригады: тот принимал «06:30» и «9», молча ронял мусор и требовал ручной
// нормализации — нативный пикер невалидного значения не отдаёт в принципе.
//
// Слой ui/ не знает про домен: HH:MM ↔ Date конвертируется здесь, локально.

function parseHM(hm: string): Date {
  const [h, m] = hm.split(":").map(Number);
  const d = new Date();
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

function formatHM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

export function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  /** «HH:MM». */
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 6,
      }}
    >
      <Text style={{ fontSize: 16, color: t.ink }}>{label}</Text>
      <DateTimePicker
        themeVariant="light"
        value={parseHM(value)}
        mode="time"
        display="compact"
        minuteInterval={5}
        accessibilityLabel={label}
        onChange={(_, d) => d && onChange(formatHM(d))}
      />
    </View>
  );
}
