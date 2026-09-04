import { Text, View } from "react-native";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { formatEUR } from "@babun/shared/common/utils/money";
import { clientDebt } from "@/features/clients/filter";
import { formatShortDateRu, visitsWord } from "@/features/clients/format";
import { useThemeColors } from "@/theme/colors";

// ВВОДНАЯ О КЛИЕНТЕ ОДНОЙ СТРОКОЙ (владелец 2026-09-04: «когда я выбираю
// клиента, там должна быть уже вводная информация, как это написано в
// клиентах, — сколько было заработано, когда был последний визит, короче
// такая информация, которая может помочь нам»).
//
// Строка живёт ОТДЕЛЬНО от списков, потому что её читают в трёх местах:
// список выбора клиента, блок «Клиент» в записи и (через `accessibilityLabel`)
// голосом. Разойдись эти три текста — продукт говорил бы о человеке разное на
// соседних экранах.
//
// ПОРЯДОК — ПО СРОЧНОСТИ, ТОТ ЖЕ, ЧТО В СТРОКЕ СПИСКА КЛИЕНТОВ: долг первым и
// янтарём (это разговор, который придётся начать), потом сколько раз были,
// сколько принесли, и когда были в последний раз. Пусто — значит человек ещё
// ни разу не обслуживался, и врать «0 визитов» незачем.

export interface HistoryPart {
  key: string;
  text: string;
  tone: "debt" | "income" | "plain";
}

export function clientHistoryParts(
  client: Client,
  stats: ClientStats | undefined,
): HistoryPart[] {
  if (!stats) return [];
  const parts: HistoryPart[] = [];
  const debt = Math.round(clientDebt(client, stats));
  if (debt > 0) {
    parts.push({ key: "debt", text: `долг ${formatEUR(debt)}`, tone: "debt" });
  }
  if (stats.visits > 0) {
    parts.push({
      key: "visits",
      text: `${stats.visits} ${visitsWord(stats.visits)}`,
      tone: "plain",
    });
  }
  const spent = Math.round(stats.totalSpent);
  if (spent > 0) {
    parts.push({ key: "spent", text: formatEUR(spent), tone: "income" });
  }
  if (stats.lastVisitDate) {
    parts.push({
      key: "last",
      text: `визит ${formatShortDateRu(stats.lastVisitDate)}`,
      tone: "plain",
    });
  }
  return parts;
}

/** Тот же текст, что видит глаз, — для `accessibilityLabel` и подписей. */
export function clientHistoryText(
  client: Client,
  stats: ClientStats | undefined,
): string | null {
  const parts = clientHistoryParts(client, stats);
  return parts.length > 0 ? parts.map((p) => p.text).join(" · ") : null;
}

export function ClientHistoryLine({
  client,
  stats,
  size = 13,
}: {
  client: Client;
  stats: ClientStats | undefined;
  size?: number;
}) {
  const t = useThemeColors();
  const parts = clientHistoryParts(client, stats);
  if (parts.length === 0) return null;
  const color = (tone: HistoryPart["tone"]) =>
    tone === "debt" ? t.warning : tone === "income" ? t.success : t.sub;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 1 }}>
      {parts.map((part, i) => (
        <Text
          key={part.key}
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          style={{
            fontSize: size,
            fontWeight: part.tone === "plain" ? "400" : "600",
            color: color(part.tone),
          }}
        >
          {i > 0 ? " · " : ""}
          {part.text}
        </Text>
      ))}
    </View>
  );
}

