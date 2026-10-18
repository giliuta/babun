import { Pressable, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

export function WizardHeader({
  subtitle,
  onClose,
  busy,
}: {
  subtitle: string;
  onClose: () => void;
  busy: boolean;
}) {
  const t = useThemeColors();
  return (
    <View
      className="flex-row items-center gap-2 px-3 py-2"
      style={{ borderBottomWidth: 1, borderBottomColor: t.separator }}
    >
      <View className="flex-1">
        <Text className="text-[17px] font-bold" style={{ color: t.ink }}>
          Импорт клиентов
        </Text>
        <Text className="text-xs" style={{ color: t.sub }}>
          {subtitle}
        </Text>
      </View>
      <Pressable
        onPress={busy ? undefined : onClose}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Закрыть"
        accessibilityState={{ disabled: busy, busy }}
        style={{ height: 44, width: 44, alignItems: "center", justifyContent: "center", opacity: busy ? 0.4 : 1 }}
      >
        <X color={t.body} size={ICON.md} />
      </Pressable>
    </View>
  );
}
