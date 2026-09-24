import { Text, View } from "react-native";
import { formatDateKey, formatDateShortRu } from "@babun/shared/common/utils/date-utils";
import { useThemeColors } from "@/theme/colors";
import type { SmsHistoryItem } from "./sms-model";
import { costWords, isFailure, statusWords, triggerWords } from "./sms-words";

// СТРОКА ИСТОРИИ SMS (STORY-089): кому и когда — первой строкой, текст —
// второй, итог и цена — справа. Отказ красный: владелец должен увидеть его,
// не читая каждую строку.

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${formatDateShortRu(formatDateKey(date))}, ${time}`;
}

export function SmsHistoryRow({ item }: { item: SmsHistoryItem }) {
  const t = useThemeColors();
  const failed = isFailure(item.status);
  const cost = costWords(item);
  // Ждёт своего часа (тихие часы, «Спасибо» через 2 часа) — когда уйдёт.
  const waits = item.status === "queued" && item.sendAfter && new Date(item.sendAfter).getTime() > Date.now();
  const status = waits && item.sendAfter ? `Уйдёт ${when(item.sendAfter)}` : statusWords(item.status);
  return (
    <View
      accessible
      accessibilityLabel={[
        item.clientName ?? item.toPhone,
        triggerWords(item.trigger),
        status,
        cost,
        item.body,
      ]
        .filter(Boolean)
        .join(", ")}
      style={{ flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
          {item.clientName ?? item.toPhone}
        </Text>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: t.sub, marginTop: 1 }}>
          {`${triggerWords(item.trigger)} · ${when(item.createdAt)}`}
        </Text>
        {item.body ? (
          <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ fontSize: 14, lineHeight: 19, color: t.body, marginTop: 4 }}>
            {item.body}
          </Text>
        ) : null}
        {failed && item.error ? (
          <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: t.danger, marginTop: 4 }}>
            {item.error}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 13, fontWeight: "600", color: failed ? t.danger : t.sub }}>
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
    </View>
  );
}
