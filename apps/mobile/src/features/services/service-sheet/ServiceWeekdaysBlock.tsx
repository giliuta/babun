import { Pressable, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { FieldLabel } from "@/components/ui/Field";
import { WEEKDAY_LABELS } from "@babun/shared/local/services";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { toggleWeekday } from "./service-sheet-math";
import type { ServiceSheetState } from "./use-service-sheet";

// РАБОЧИЕ ДНИ — ПАРАМЕТР, КОТОРЫЙ ДОБАВЛЯЮТ, А НЕ ФОРМА, КОТОРУЮ
// ЗАПОЛНЯЮТ. Пока его нет — одна строчка-кнопка,
// как «＋ Описание» у названия. Заведён — семь плиток и крестик,
// который снимает ограничение целиком.
//
// Ограничение не про график команды: команда выезжает всю неделю, а
// чистку кондиционеров в воскресенье не ставят, потому что поставщик
// закрыт. Поэтому все семь зажжены сразу после добавления — гасят из
// них лишние, а не набирают нужные.
//
// КРЕСТИК ВОЗВРАЩАЕТ «ЛЮБОЙ ДЕНЬ», а не пустой набор дней: услуга без
// единого дня не предлагалась бы никогда, и это была бы поломка,
// выглядящая как настройка.
export function ServiceWeekdaysBlock({ sheet }: { sheet: ServiceSheetState }) {
  const t = useThemeColors();
  const { hasWeekdays, setHasWeekdays, weekdays, setWeekdays } = sheet;
  return hasWeekdays ? (
    <View style={{ paddingHorizontal: GUTTER, marginTop: 18 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <FieldLabel text="График недели" />
        <Pressable
          onPress={() => {
            setHasWeekdays(false);
            setWeekdays([]);
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Убрать ограничение по дням"
          style={({ pressed }) => ({
            paddingBottom: 6,
            opacity: pressed ? 0.4 : 1,
          })}
        >
          <X color={t.faint} size={16} strokeWidth={2} />
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {([1, 2, 3, 4, 5, 6, 7] as const).map((day) => {
          const on = weekdays.length === 0 || weekdays.includes(day);
          return (
            <Pressable
              key={day}
              onPress={() => setWeekdays(toggleWeekday(weekdays, day))}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${WEEKDAY_LABELS[day]} — ${on ? "делаем" : "не делаем"}`}
              style={({ pressed }) => ({
                flex: 1,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: t.radius.card,
                borderCurve: "continuous",
                backgroundColor: on ? t.accent : t.fill,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text
                maxFontSizeMultiplier={1.2}
                style={{
                  fontSize: 14,
                  fontWeight: on ? "700" : "500",
                  color: on ? t.onAccent : t.faint,
                }}
              >
                {WEEKDAY_LABELS[day]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  ) : (
    <View style={{ paddingHorizontal: GUTTER, marginTop: 14 }}>
      <Pressable
        onPress={() => setHasWeekdays(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="График недели: в какие дни услуга доступна"
        style={({ pressed }) => ({
          alignSelf: "flex-start",
          paddingVertical: 4,
          opacity: pressed ? 0.5 : 1,
        })}
      >
        <Text
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 15, fontWeight: "500", color: t.accent }}
        >
          ＋ График недели
        </Text>
      </Pressable>
    </View>
  );
}
