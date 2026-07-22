import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { AlertCircle, RefreshCw } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";

interface ClientDataNoticeProps {
  title: string;
  message: string;
  onRetry: () => void;
  retrying?: boolean;
  fullScreen?: boolean;
}

export function ClientDataNotice({
  title,
  message,
  onRetry,
  retrying = false,
  fullScreen = false,
}: ClientDataNoticeProps) {
  const t = useThemeColors();
  return (
    <View
      className={`${fullScreen ? "flex-1 justify-center px-6" : "mx-3 mt-3"}`}
      accessibilityRole="alert"
    >
      <View
        className="rounded-2xl px-4 py-4"
        style={{ backgroundColor: t.surface, borderColor: t.separator, borderWidth: 1 }}
      >
        <View className="flex-row items-start gap-3">
          <AlertCircle color={t.danger} size={20} strokeWidth={2} />
          <View className="flex-1">
            <Text className="text-[15px] font-semibold" style={{ color: t.ink }}>
              {title}
            </Text>
            <Text className="mt-1 text-[13px] leading-5" style={{ color: t.sub }}>
              {message}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={onRetry}
          disabled={retrying}
          accessibilityRole="button"
          accessibilityLabel="Повторить загрузку"
          accessibilityState={{ disabled: retrying }}
          className="mt-3 min-h-11 flex-row items-center justify-center gap-2 rounded-xl active:opacity-70"
          style={{ backgroundColor: t.fill }}
        >
          {retrying ? (
            <ActivityIndicator color={t.accent} />
          ) : (
            <RefreshCw color={t.accent} size={16} strokeWidth={2.2} />
          )}
          <Text className="text-sm font-semibold" style={{ color: t.accent }}>
            {retrying ? "Загружаю…" : "Повторить"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
