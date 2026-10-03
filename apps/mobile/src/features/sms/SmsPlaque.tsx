import { AlertCircle, CheckCheck, Clock, Send } from "lucide-react-native";
import { SelectRow } from "@/components/ui/select-rows";
import { fileTime } from "@/features/clients/client-files";
import { useThemeColors, type ThemeColors } from "@/theme/colors";
import { when } from "./SmsHistoryRow";
import type { SmsHistoryItem } from "./sms-model";
import { isFailure, statusWords, triggerWords } from "./sms-words";

// SMS КЛИЕНТУ — ПЛАШКОЙ, КАК ЗАПИСЬ В «ИСТОРИИ» И ФАЙЛ (владелец 03.10:
// «постараться улучшить блок SMS, чтобы было более красиво»). Наш
// `SelectRow` на белом: плитка — итог сообщения цветом и значком
// (доставлено — зелёным, ушло — синим, ждёт своего часа — янтарём, не
// дошло — красным), название — шаблон, подпись — время и номер. День —
// заголовком над плашкой, в строке его нет. Итог словами — для VoiceOver.

type Look = { icon: typeof Send; color: (t: ThemeColors) => string };

function lookOf(item: SmsHistoryItem, waits: boolean): Look {
  if (isFailure(item.status)) return { icon: AlertCircle, color: (t) => t.danger };
  if (item.status === "delivered") return { icon: CheckCheck, color: (t) => t.success };
  if (waits) return { icon: Clock, color: (t) => t.warning };
  return { icon: Send, color: (t) => t.accent };
}

export function SmsPlaque({
  item,
  phone,
  onPress,
}: {
  item: SmsHistoryItem;
  /** Номер, на который ушло, — уже в виде для глаза. */
  phone?: string | null;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const waits =
    item.status === "queued" && !!item.sendAfter && new Date(item.sendAfter).getTime() > Date.now();
  const look = lookOf(item, waits);
  const title = item.templateName ?? (item.trigger === "manual" ? "SMS" : triggerWords(item.trigger));
  const status = waits && item.sendAfter ? `уйдёт ${when(item.sendAfter)}` : statusWords(item.status);
  const subtitle = [waits ? status : fileTime(item.createdAt), phone || null].filter(Boolean).join(" · ");
  return (
    <SelectRow
      icon={look.icon}
      color={look.color(t)}
      plain
      title={title}
      subtitle={subtitle || undefined}
      accessibilityLabel={[title, subtitle, status].filter(Boolean).join(", ")}
      accessibilityHint="Открывает сообщение целиком"
      onPress={onPress}
    />
  );
}
