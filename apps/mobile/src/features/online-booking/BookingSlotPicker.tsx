import { Pressable, ScrollView, Text, View } from "react-native";
import { Chip } from "@/components/ui/Chip";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { dayChipWords, type BookingDay } from "./online-booking";

// ВРЕМЯ ЗАПИСИ НА ПУБЛИЧНОЙ СТРАНИЦЕ: лента дней со свободным временем и
// сетка начал выбранного дня. Дней без окон в ленте нет вовсе — заказчику
// нечего в них выбрать, а пустой день читался бы «сломалось».

export function BookingSlotPicker({
  days,
  date,
  time,
  onDate,
  onTime,
}: {
  days: readonly BookingDay[];
  date: string | null;
  time: string | null;
  onDate: (date: string) => void;
  onTime: (time: string) => void;
}) {
  const t = useThemeColors();
  const day = days.find((d) => d.date === date) ?? days[0];
  return (
    <View style={{ gap: 12 }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
      >
        {days.map((d) => {
          const words = dayChipWords(d.date);
          const selected = d.date === day?.date;
          return (
            <Pressable
              key={d.date}
              onPress={() => {
                haptics.tap();
                onDate(d.date);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${words.weekday}, ${words.day}`}
              style={({ pressed }) => ({
                minWidth: 64,
                paddingVertical: 8,
                paddingHorizontal: 10,
                alignItems: "center",
                borderRadius: t.radius.card,
                borderCurve: "continuous",
                backgroundColor: selected ? t.accent : t.surface,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ fontSize: 13, fontWeight: "600", color: selected ? t.onAccent : t.sub }}>
                {words.weekday}
              </Text>
              <Text style={{ marginTop: 2, fontSize: 15, fontWeight: "700", color: selected ? t.onAccent : t.ink }}>
                {words.day}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {day ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16 }}>
          {day.times.map((slot) => (
            <Chip
              key={slot}
              label={slot}
              radio
              selected={day.date === date && slot === time}
              onPress={() => {
                if (day.date !== date) onDate(day.date);
                onTime(slot);
              }}
              style={{ minWidth: 72 }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
