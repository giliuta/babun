import { Linking, Pressable, Text } from "react-native";
import { MapPin } from "lucide-react-native";
import { ICON } from "@/components/ui/tokens";
import {
  googleMapsSearchUrl,
  type Coords,
} from "@/features/clients/location-request-form";
import { useThemeColors } from "@/theme/colors";

// КАРТА-ВРЕЗКА С ТОЧКОЙ — нативный двойник (STORY-077). Страницу «куда
// приехать мастеру» клиент открывает в браузере, где стоит MapEmbed.web.tsx
// с врезкой OpenStreetMap. В приложении врезки нет (WebView не собран), и
// вместо неё — дверь в карту той же высоты: контракт пропов один.

export function MapEmbed({ coords, height = 180 }: { coords: Coords; height?: number }) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={() => void Linking.openURL(googleMapsSearchUrl(coords))}
      accessibilityRole="link"
      accessibilityLabel="Открыть точку на карте"
      style={({ pressed }) => ({
        height,
        borderRadius: t.radius.input,
        backgroundColor: pressed ? t.rowFillPressed : t.fill,
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      })}
    >
      <MapPin color={t.accent} size={ICON.md} />
      <Text style={{ fontSize: 15, fontWeight: "600", color: t.accent }}>
        Открыть точку на карте
      </Text>
    </Pressable>
  );
}
