// OptionalDateField — «не указано» → «Указать» → compact DateTimePicker
// + ✕-очистка для необязательных YYYY-MM-DD полей карточки клиента
// (даты ТО кондиционера, день рождения). Извлечён из ObjectsBlock, чтобы
// PersonalBlock использовал тот же нативный контрол вместо свободного
// текстового ввода, кормившего селекторы мусором.

import { useState } from "react";
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
  align = "start",
  seed,
}: {
  /** Подпись над контролом; не передавать, если строка уже подписана. */
  label?: string;
  /** "" = не указано; иначе валидный YYYY-MM-DD. */
  value: string;
  onChange: (v: string) => void;
  /** "end" — контрол в хвосте подписанной строки (страница кондиционера).
   *  Пустое значение читается как у остальных строк — тихим «Указать» у
   *  правого края, без плашки-пилюли. */
  align?: "start" | "end";
  /** С какой даты открывать выбор, когда значения ещё нет (YYYY-MM-DD).
   *  Для дня рождения «сегодня» — бессмысленная отправная точка. */
  seed?: string;
}) {
  const t = useThemeColors();
  const a11y = label ? `: ${label}` : "";
  const end = align === "end";
  const [picking, setPicking] = useState(false);
  // Точка отсчёта для ПЕРВОГО выбора: сегодня как отправная позиция колеса,
  // но в данные она не попадает, пока человек не подтвердил.
  const seedYmd = seed ?? formatYMD(new Date());
  return (
    <View className={end ? "items-end" : "flex-1"}>
      {/* В хвосте подписанной строки ярлык уже есть — здесь он остаётся
          только для озвучки, видимой подписи не рисуем. */}
      {label && !end ? (
        <Text className="mb-1 text-[11px]" style={{ color: t.sub }}>
          {label}
        </Text>
      ) : null}
      {value ? (
        <View className="flex-row items-center">
          <DateTimePicker
            themeVariant="light"
            value={parseYMD(value)}
            mode="date"
            display="compact"
            maximumDate={new Date()}
            onChange={(_, d) => d && onChange(formatYMD(d))}
          />
          <Pressable
            onPress={() => onChange("")}
            accessibilityRole="button"
            accessibilityLabel={`Очистить дату${a11y}`}
            className="ml-1 h-11 w-11 items-center justify-center rounded-full active:opacity-60"
          >
            <X color={t.faint} size={13} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          // Тап ОТКРЫВАЕТ выбор, а не пишет сегодняшнюю дату в базу. Раньше
          // «Указать» немедленно сохраняло сегодня: у кондиционера появлялось
          // «ТО сделано сегодня», у клиента — день рождения сегодня, и это
          // уезжало на сервер до того, как человек что-то выбрал.
          onPress={() => setPicking(true)}
          accessibilityRole="button"
          accessibilityLabel={`Указать дату${a11y}`}
          className={
            end
              ? "min-h-11 justify-center pl-3 active:opacity-60"
              : "min-h-11 self-start justify-center rounded-lg px-3 py-2 active:opacity-60"
          }
          style={end ? undefined : { backgroundColor: t.fill }}
        >
          <Text className="text-[13px] font-medium" style={{ color: t.accent }}>
            Указать
          </Text>
        </Pressable>
      )}

      {/* Выбор ПЕРВОЙ даты: пока не подтвердили — в данных ничего нет. */}
      {picking ? (
        <View className={end ? "items-end" : "items-start"}>
          <DateTimePicker
            themeVariant="light"
            value={parseYMD(seedYmd)}
            mode="date"
            display="compact"
            maximumDate={new Date()}
            onChange={(event, d) => {
              // «dismissed» — человек закрыл выбор, значение не ставим.
              if (event.type === "dismissed") {
                setPicking(false);
                return;
              }
              if (d) {
                setPicking(false);
                onChange(formatYMD(d));
              }
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
