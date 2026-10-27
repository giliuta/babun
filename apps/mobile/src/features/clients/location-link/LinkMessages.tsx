import { View, Text } from "react-native";
import { CircleCheck } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";
import { useThemeColors } from "@/theme/colors";
import { TYPE } from "@/components/ui/tokens";

// Final and message states of the public location page.

export function Done({ business, address }: { business: string; address: string }) {
  const t = useThemeColors();
  return (
    <View style={{ alignItems: "center", paddingHorizontal: 24, paddingTop: 48 }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${t.success}14`,
        }}
      >
        <CircleCheck color={t.success} size={36} />
      </View>
      <Text
        accessibilityRole="header"
        style={{ marginTop: 18, ...TYPE.title, color: t.ink, textAlign: "center" }}
      >
        Адрес отправлен
      </Text>
      {address ? (
        <Text
          selectable
          style={{ marginTop: 8, fontSize: 15, lineHeight: 21, color: t.body, textAlign: "center" }}
        >
          {address}
        </Text>
      ) : null}
      <Text style={{ marginTop: 14, fontSize: 14, lineHeight: 20, color: t.sub, textAlign: "center" }}>
        {business ? `${business} получил адрес.` : "Мастер получил адрес."} Страницу можно закрыть.
      </Text>
    </View>
  );
}

export function Message({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: { label: string; onPress: () => void };
}) {
  const t = useThemeColors();
  return (
    <SectionCard padded className="mt-4">
      <Text style={{ fontSize: 17, fontWeight: "700", color: t.ink }}>{title}</Text>
      <Text style={{ marginTop: 5, fontSize: 14, lineHeight: 20, color: t.sub }}>{text}</Text>
      {action ? (
        <View className="mt-4">
          <Button label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </SectionCard>
  );
}
