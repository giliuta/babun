import { Text, View } from "react-native";
import { AlertCircle } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { isOutageNoise, OUTAGE_WORDS } from "@/lib/connection-words";

// ПЛАШКА «ДАННЫЕ НЕ ПРИЕХАЛИ» — слова, действие ВНИЗУ.
//
// Раньше «Повторить» стояло внутри карточки своей серой пилюлей (44pt, кегль
// 14) — четвёртая порода кнопки в продукте, да ещё посередине экрана, когда
// плашка занимает его целиком. Владелец 21.09: «кнопка всегда… чтоб они были
// внизу, как мы привыкли».
//
// ВО ВЕСЬ ЭКРАН — ОБЩИЙ ЭКРАН ОШИБКИ, А НЕ КАРТОЧКА ПОСРЕДИ ПУСТОТЫ
// (владелец 03.10, на зависшем сервере: «сделаем эту страницу более красивой,
// и кнопку — там, где все они размещаются»): `EmptyState` с футером экрана.

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
  // Обрыв — словами: в `message` сюда тоже приходит `error.message` как есть.
  if (isOutageNoise(message)) {
    title = OUTAGE_WORDS.title;
    message = OUTAGE_WORDS.subtitle;
  }

  if (fullScreen) {
    // Тот же экран ошибки, что у календаря и списков (`EmptyState`): значок
    // в мягком круге, слова по центру, «Повторить» — футером экрана.
    return (
      <EmptyState
        state="error"
        fill
        title={title}
        subtitle={message}
        action={{ label: retrying ? "Загружаю…" : "Повторить", onPress: onRetry, loading: retrying }}
      />
    );
  }

  return (
    <View className="mx-4 mt-3" accessibilityRole="alert">
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

      <View style={{ paddingTop: 12 }}>
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
