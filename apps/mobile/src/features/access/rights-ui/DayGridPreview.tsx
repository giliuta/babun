import { Text, View } from "react-native";
import { Card } from "@/components/ui/Card";
import { useThemeColors } from "@/theme/colors";
import type { SampleTile } from "./preview-sample";

const HOUR = 46;

/** Кусок сетки дня: запись в 10:00, свободный час, событие в 12:00. */
export function DayGrid({
  color,
  tile,
  free,
  event,
}: {
  color: string;
  /** Подпись записи — с тем, что из неё видно (`sampleTile`); `null` —
   *  записей на сетке нет вовсе («Записи клиентов: Скрыты»). */
  tile: SampleTile | null;
  /** Подпись свободного часа, по которому можно создать; нет — час пустой. */
  free?: string;
  event?: "read" | "write";
}) {
  const t = useThemeColors();
  const hours = ["10:00", "11:00", "12:00"];
  return (
    <Card style={{ marginHorizontal: 16, marginTop: 8, paddingVertical: 6 }}>
      {hours.map((hour, i) => (
        <View key={hour} style={{ flexDirection: "row", height: HOUR }}>
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ width: 52, paddingLeft: 12, paddingTop: 2, fontSize: 12, color: t.faint, fontVariant: ["tabular-nums"] }}
          >
            {hour}
          </Text>
          <View style={{ flex: 1, borderTopWidth: 1, borderTopColor: t.separator, paddingRight: 10, paddingVertical: 4 }}>
            {i === 0 && tile ? (
              <View
                style={{
                  flex: 1,
                  borderRadius: 6,
                  paddingHorizontal: 8,
                  justifyContent: "center",
                  backgroundColor: `${color}2e`,
                  borderLeftWidth: 3,
                  borderLeftColor: color,
                }}
              >
                <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontSize: 13, fontWeight: "600", color: t.ink }}>
                  {tile.title}
                </Text>
                <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontSize: 11, color: t.sub }}>
                  {tile.sub}
                </Text>
              </View>
            ) : null}
            {i === 1 && free ? (
              <View
                style={{
                  flex: 1,
                  borderRadius: 6,
                  borderWidth: 1.5,
                  borderStyle: "dashed",
                  borderColor: t.accent,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 13, fontWeight: "600", color: t.accent }}>
                  {free}
                </Text>
              </View>
            ) : null}
            {i === 2 && event ? (
              <View
                style={{
                  height: HOUR / 2,
                  borderRadius: 6,
                  paddingHorizontal: 8,
                  justifyContent: "center",
                  backgroundColor: t.fill,
                }}
              >
                <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontSize: 12, fontWeight: "600", color: t.body }}>
                  Обед · 12:00–12:30
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      ))}
    </Card>
  );
}
