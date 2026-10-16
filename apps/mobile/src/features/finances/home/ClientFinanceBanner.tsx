import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { X } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";

/** «Финансы клиента» — the deep-link client filter, with its way back. */
export function ClientFinanceBanner({ clientName }: { clientName: string | null | undefined }) {
  const t = useThemeColors();
  const router = useRouter();
  return (
    <View
      className="mx-4 mb-2 flex-row items-center px-4 py-3"
      style={{
        backgroundColor: t.surface,
        borderRadius: t.radius.card,
        borderCurve: "continuous",
      }}
    >
      <View className="min-w-0 flex-1">
        <Text className="text-xs font-semibold uppercase tracking-wider" style={{ color: t.faint }}>
          Финансы клиента
        </Text>
        <Text className="mt-0.5 text-[15px] font-semibold" style={{ color: t.ink }} numberOfLines={1}>
          {clientName || "Клиент"}
        </Text>
      </View>
      <Pressable
        onPress={() => router.replace("/finances")}
        accessibilityRole="button"
        accessibilityLabel="Показать финансы всех клиентов"
        hitSlop={8}
        className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
        style={{ backgroundColor: t.fill }}
      >
        <X color={t.sub} size={18} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}
