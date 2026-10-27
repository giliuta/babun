import { Image, Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";

// ШАПКА ПУБЛИЧНОЙ СТРАНИЦЫ — кто прислал ссылку: логотип компании (или её
// первая буква в плитке акцента) и имя. Одна на все страницы без входа —
// «Ваша запись» (/r) и «Онлайн-запись» (/b): заказчик узнаёт бизнес по одной
// и той же шапке.
export function PublicBusinessHeader({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const t = useThemeColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 8 }}>
      {logoUrl ? (
        <Image
          source={{ uri: logoUrl }}
          accessibilityIgnoresInvertColors
          style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: t.fill }}
        />
      ) : (
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${t.accent}14`,
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: "700", color: t.accent }}>
            {name.trim().charAt(0).toUpperCase() || "•"}
          </Text>
        </View>
      )}
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 17, fontWeight: "700", color: t.ink }}>
        {name}
      </Text>
    </View>
  );
}
