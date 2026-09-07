import { View } from "react-native";
import {
  osmEmbedUrl,
  type Coords,
} from "@/features/clients/location-request-form";
import { useThemeColors } from "@/theme/colors";

// КАРТА-ВРЕЗКА С ТОЧКОЙ — веб (STORY-077). Клиент нажал «Я сейчас здесь» и
// должен УВИДЕТЬ, куда встал пин, до отправки: координаты цифрами ему ничего
// не говорят. OpenStreetMap отдаёт врезку без ключей и скриптов; маркер —
// в самой ссылке. Контракт пропов повторяет нативный MapEmbed.tsx.

export function MapEmbed({ coords, height = 180 }: { coords: Coords; height?: number }) {
  const t = useThemeColors();
  return (
    <View
      style={{
        height,
        borderRadius: t.radius.input,
        overflow: "hidden",
        backgroundColor: t.fill,
      }}
    >
      <iframe
        title="Карта с отмеченной точкой"
        src={osmEmbedUrl(coords)}
        loading="lazy"
        style={{ border: 0, width: "100%", height: "100%", display: "block" }}
      />
    </View>
  );
}
