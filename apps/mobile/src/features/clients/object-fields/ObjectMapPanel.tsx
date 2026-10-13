import { Pressable, Text, View } from "react-native";
import { MapPicker } from "@/features/clients/MapPicker";
import { formatCoords, type Coords } from "@/features/clients/location-request-form";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

/** The map unfolded under the address of `ObjectFields`: pick a point,
 *  see it, fold back with «Готово». */
export function ObjectMapPanel({
  value,
  pinCoords,
  follow,
  onPick,
  onDone,
}: {
  /** Where the map opens: the saved pin, else the point inside the address. */
  value: Coords | null;
  pinCoords: Coords | null;
  /** The geocoded address the map should move to. */
  follow: Coords | null;
  onPick: (coords: Coords) => void;
  onDone: () => void;
}) {
  const t = useThemeColors();
  return (
    <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
      <MapPicker
        value={value}
        follow={follow}
        onChange={onPick}
      />
      {pinCoords ? (
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            marginTop: 8,
            fontSize: 13,
            color: t.sub,
            textAlign: "center",
          }}
        >
          {`Точка отмечена · ${formatCoords(pinCoords)}`}
        </Text>
      ) : null}
      <Pressable
        onPress={() => {
          haptics.tap();
          onDone();
        }}
        accessibilityRole="button"
        accessibilityLabel="Свернуть карту"
        style={({ pressed }) => ({
          minHeight: 40,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.5 : 1,
        })}
      >
        <Text style={{ fontSize: 14, fontWeight: "600", color: t.accent }}>
          Готово
        </Text>
      </Pressable>
    </View>
  );
}
