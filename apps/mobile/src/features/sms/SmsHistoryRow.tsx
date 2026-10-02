import { Pressable, Text, View } from "react-native";
import { formatDateKey, formatDateShortRu } from "@babun/shared/common/utils/date-utils";
import { useThemeColors } from "@/theme/colors";
import type { SmsHistoryItem } from "./sms-model";
import { costWords, isFailure, statusWords, triggerWords } from "./sms-words";

// СТРОКА ИСТОРИИ SMS (STORY-089): кому и когда — первой строкой, текст —
// второй, итог и цена — справа. Отказ красный: владелец должен увидеть его,
// не читая каждую строку.
//
// КОРОТКАЯ — В ЗАПИСИ И У КЛИЕНТА (владелец 03.10: «не нужно там полноценно
// переписывать эту SMS… отправленное SMS — просто дата, время»): шаблон, когда
// и итог, без текста; тап — сообщение целиком.

export function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${formatDateShortRu(formatDateKey(date))}, ${time}`;
}

export function SmsHistoryRow({
  item,
  showClient = true,
  body,
  phone,
  compact = false,
  onPress,
}: {
  item: SmsHistoryItem;
  /** Без текста: имя шаблона, когда, итог (запись и карточка клиента). */
  compact?: boolean;
  /** Номер, на который ушло, — уже в виде для глаза. У клиента номеров
   *  бывает несколько, и в его истории видно, на какой именно. */
  phone?: string | null;
  /** Тап — сообщение целиком (страница истории). */
  onPress?: () => void;
  /** Нет — в записи и у клиента: кому, и так ясно; первой строкой — повод. */
  showClient?: boolean;
  /** Текст вместо сохранённого — у ещё не ушедшего: шаблон, заполненный
   *  полями записи. */
  body?: string | null;
}) {
  const t = useThemeColors();
  const text = compact ? null : (item.body ?? body ?? null);
  const title = showClient
    ? (item.clientName ?? (item.toPhone || "SMS"))
    : compact
      ? (item.templateName ?? (item.trigger === "manual" ? "SMS" : triggerWords(item.trigger)))
      : triggerWords(item.trigger);
  // В общей истории (кому — заголовком) повод уступает имени шаблона, если
  // строка короткая: «За день · 3 окт, 00:50».
  const reason = compact ? (item.templateName ?? triggerWords(item.trigger)) : triggerWords(item.trigger);
  const meta = [showClient ? reason : null, when(item.createdAt), phone || null]
    .filter(Boolean)
    .join(" · ");
  const failed = isFailure(item.status);
  const cost = costWords(item);
  // Ждёт своего часа (тихие часы, «Спасибо» через 2 часа) — когда уйдёт.
  const waits = item.status === "queued" && item.sendAfter && new Date(item.sendAfter).getTime() > Date.now();
  const status = waits && item.sendAfter ? `Уйдёт ${when(item.sendAfter)}` : statusWords(item.status);
  return (
    <Pressable
      accessible
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={[title, meta, status, cost, text]
        .filter(Boolean)
        .join(", ")}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
          {title}
        </Text>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: t.sub, marginTop: 1 }}>
          {meta}
        </Text>
        {text ? (
          <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ fontSize: 14, lineHeight: 19, color: t.body, marginTop: 4 }}>
            {text}
          </Text>
        ) : null}
        {failed && item.error ? (
          <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: t.danger, marginTop: 4 }}>
            {item.error}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text maxFontSizeMultiplier={1.2} style={{
            fontSize: 13,
            fontWeight: "600",
            color: failed ? t.danger : item.status === "delivered" ? t.success : waits ? t.warning : t.sub,
          }}>
          {status}
        </Text>
        {cost ? (
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 13, color: t.sub, marginTop: 2, fontVariant: ["tabular-nums"] }}
          >
            {cost}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
