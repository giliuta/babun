import { Pressable, Text, View } from "react-native";
import type { Client } from "@babun/shared/local/clients";
import { useThemeColors } from "@/theme/colors";

interface ClientDraftNoticeProps {
  duplicate: Client | null;
  error: string | null;
  onOpenDuplicate: (id: string) => void;
}

export function ClientDraftNotice({
  duplicate,
  error,
  onOpenDuplicate,
}: ClientDraftNoticeProps) {
  const t = useThemeColors();
  if (!duplicate && !error) return null;
  return (
    <View
      className="mt-2 border-t pt-2.5"
      style={{ borderColor: t.separator }}
      accessibilityRole="alert"
    >
      {duplicate ? (
        <>
          <Text
            className="pb-2 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: t.sub }}
          >
            Похоже, такой уже есть
          </Text>
          <View className="flex-row items-center gap-3">
            <View className="flex-1">
              <Text
                className="text-sm font-semibold"
                style={{ color: t.ink }}
                numberOfLines={1}
              >
                {duplicate.full_name || duplicate.phone || "Клиент"}
              </Text>
              <Text className="text-xs" style={{ color: t.sub }} numberOfLines={1}>
                {[duplicate.phone, duplicate.city].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <Pressable
              onPress={() => onOpenDuplicate(duplicate.id)}
              accessibilityRole="button"
              accessibilityLabel="Открыть существующего клиента"
              className="min-h-11 justify-center rounded-xl px-3.5 active:opacity-80"
              style={{ backgroundColor: t.accent }}
            >
              <Text className="text-sm font-semibold" style={{ color: t.onAccent }}>
                Открыть
              </Text>
            </Pressable>
          </View>
          <Text className="pt-2 text-[11px]" style={{ color: t.faint }}>
            Повторное сохранение создаст отдельного клиента с этим номером.
          </Text>
        </>
      ) : null}
      {error ? (
        <Text className={`text-sm ${duplicate ? "pt-2" : ""}`} style={{ color: t.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
