import { Text, View } from "react-native";
import { AlertCircle } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";
import { Button } from "@/components/ui/Button";

// ПЛАШКА «ДАННЫЕ НЕ ПРИЕХАЛИ» — слова в карточке, действие ВНИЗУ.
//
// Раньше «Повторить» стояло внутри карточки своей серой пилюлей (44pt, кегль
// 14) — четвёртая порода кнопки в продукте, да ещё посередине экрана, когда
// плашка занимает его целиком. Владелец 21.09: «кнопка всегда… чтоб они были
// внизу, как мы привыкли». Теперь это обычная кнопка продукта под карточкой,
// а при `fullScreen` — у нижнего края, как действие любого экрана.

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
    <View className={fullScreen ? "flex-1 px-6" : "mx-4 mt-3"} accessibilityRole="alert">
      <View className={fullScreen ? "flex-1 justify-center" : undefined}>
        <View
          className="rounded-[10px] px-4 py-4"
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
        </View>
      </View>

      <View style={{ paddingTop: 12, paddingBottom: fullScreen ? 16 : 0 }}>
        <Button
          label={retrying ? "Загружаю…" : "Повторить"}
          onPress={onRetry}
          disabled={retrying}
          loading={retrying}
          accessibilityHint="Загрузить данные ещё раз"
        />
      </View>
    </View>
  );
}
