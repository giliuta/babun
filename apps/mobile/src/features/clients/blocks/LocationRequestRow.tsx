import { Pressable, Text, View } from "react-native";
import { Link2, MoreHorizontal } from "lucide-react-native";
import { IconCircle } from "@/components/ui/IconCircle";
import { ICON } from "@/components/ui/tokens";
import {
  locationRequestCaption,
  locationRequestState,
  type LocationRequest,
} from "@/features/clients/location-request-link";
import { useThemeColors } from "@/theme/colors";

// СТРОКА «ЖДЁМ АДРЕС ОТ КЛИЕНТА» (STORY-077) — место объекта, которого ещё
// нет. Стоит в списке объектов той же высоты и с тем же ритмом, что строка
// объекта; кружок со значком ссылки отличает её от заведённого адреса, а тап
// по всей строке открывает меню ссылки (поделиться ещё раз, скопировать,
// отозвать). Кружок «…» справа — подсказка, что у строки есть меню, как у
// объекта на форме записи.

export function LocationRequestRow({
  request,
  separated,
  onPress,
}: {
  request: LocationRequest;
  separated?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const { title, caption } = locationRequestCaption(request);
  const expired = locationRequestState(request) === "expired";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${caption}`}
      accessibilityHint="Открывает действия со ссылкой"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingLeft: 16,
        paddingRight: 12,
        paddingVertical: 10,
        minHeight: 60,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <IconCircle icon={Link2} />
      <View style={{ flex: 1 }}>
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{
            fontSize: 15,
            fontWeight: "600",
            color: expired ? t.sub : t.ink,
          }}
        >
          {title}
        </Text>
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{ fontSize: 13, color: t.sub }}
        >
          {caption}
        </Text>
      </View>
      <View
        style={{
          width: 32,
          height: 32,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          backgroundColor: t.rowFill,
        }}
      >
        <MoreHorizontal color={t.body} size={ICON.sm} />
      </View>
    </Pressable>
  );
}
