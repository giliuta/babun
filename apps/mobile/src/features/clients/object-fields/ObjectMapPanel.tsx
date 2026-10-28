import { Pressable, Text, View } from "react-native";
import { MapPicker } from "@/features/clients/MapPicker";
import { formatCoords, type Coords } from "@/features/clients/location-request-form";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

/** The map unfolded under the address of `ObjectFields`: pick a point,
 *  see it. It folds with the same map icon in the block header — one action,
 *  one door, so there is no button under the map. */
export function ObjectMapPanel({
  value,
  pinCoords,
  follow,
  onPick,
  onClear,
}: {
  /** Where the map opens: the saved pin, else the point inside the address. */
  value: Coords | null;
  pinCoords: Coords | null;
  /** The geocoded address the map should move to. */
  follow: Coords | null;
  onPick: (coords: Coords) => void;
  /** Drops the pin — the only way out of a point set by mistake. */
  onClear: () => void;
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
        <View
          style={{
            marginTop: 8,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
          }}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 13, color: t.sub }}
          >
            {`Точка отмечена · ${formatCoords(pinCoords)}`}
          </Text>
          <Pressable
            onPress={() => {
              haptics.tap();
              onClear();
            }}
            accessibilityRole="button"
            hitSlop={10}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <Text
              maxFontSizeMultiplier={1.2}
              style={{ fontSize: 13, fontWeight: "600", color: t.danger }}
            >
              Убрать точку
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
