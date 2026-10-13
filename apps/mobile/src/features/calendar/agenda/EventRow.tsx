import { Pressable, Text, View } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import type { ThemeColors } from "@/theme/colors";

// Событие — свой шаблон (web design-keeper #6): title из comment, знак
// записи слева, превью заметок — иначе событие выглядело как «битая запись»
// (Без клиента / €0).
export function EventRow({
  apt,
  onPress,
  onLongPress,
  rowFill,
  cancelled,
  t,
}: {
  apt: Appointment;
  onPress: () => void;
  onLongPress?: () => void;
  rowFill: string;
  cancelled: boolean;
  t: ThemeColors;
}) {
  const title = apt.comment?.trim() || "Событие";
  const address = apt.address?.trim();
  const notes = apt.event_notes?.trim();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      className="active:opacity-60"
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${apt.event_all_day ? "весь день" : `${apt.time_start}–${apt.time_end}`}`}
      style={{
        flexDirection: "row",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        minHeight: 64,
        backgroundColor: rowFill,
      }}
    >
      {/* Ширина 56 — ТА ЖЕ, что у строки работы: обе строки лежат в одной
          карточке дня, и время в них обязано стоять в одной колонке. */}
      <View style={{ width: 56 }}>
        {/* У СОБЫТИЯ «ВЕСЬ ДЕНЬ» ВРЕМЕНИ НЕТ. Лента печатала служебные 00:00
            и 23:59 как настоящее время — то же враньё, что и полоска в
            сетке, только словами. Слово уже живёт в продукте (наряд
            мастера), нового словаря не заводим. */}
        {apt.event_all_day === true ? (
          <Text
            numberOfLines={2}
            style={{ fontSize: 12, fontWeight: "600", color: t.ink }}
          >
            Весь день
          </Text>
        ) : (
          <>
            <Text
              style={{
                fontVariant: ["tabular-nums"],
                fontSize: 14,
                fontWeight: "600",
                color: t.ink,
              }}
            >
              {apt.time_start}
            </Text>
            <Text
              style={{
                fontVariant: ["tabular-nums"],
                marginTop: 2,
                fontSize: 11,
                color: t.faint,
              }}
            >
              {apt.time_end}
            </Text>
          </>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: 14, fontWeight: "600", color: t.ink }}
        >
          {title}
        </Text>
        {address ? (
          <Text
            numberOfLines={1}
            style={{ marginTop: 2, fontSize: 12, color: t.sub }}
          >
            {address}
          </Text>
        ) : null}
        {notes ? (
          <Text
            numberOfLines={1}
            style={{ marginTop: 2, fontSize: 12, color: t.sub }}
          >
            {notes}
          </Text>
        ) : null}
        <Text
          style={{
            marginTop: 2,
            fontSize: 11,
            color: cancelled ? t.faint : t.sub,
            textDecorationLine: cancelled ? "line-through" : "none",
          }}
        >
          {apt.team_id ? "Событие команды" : "Личное событие"}
        </Text>
      </View>
    </Pressable>
  );
}
