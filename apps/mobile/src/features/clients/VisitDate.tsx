import { Text, View } from "react-native";
import { CalendarClock, Clock } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";
import { formatShortDateRu } from "./format";
import type { VisitMark } from "./visit-mark";

// ДАТА ВИЗИТА ЦВЕТОМ — ОДНА НА ПРОДУКТ (владелец 01.10 и 03.10: «как на
// странице клиентов — имя, номер и дата последнего визита»). Синяя —
// последний визит, жёлтая — визит не закрыт, серая — записан вперёд; правило
// выбора даты — `visit-mark.ts`. Стоит за номером в строке списка клиентов,
// в блоке «Клиент» записи и в шторке выбора клиента.

export function VisitDate({ mark }: { mark: VisitMark }) {
  const t = useThemeColors();
  const color = mark.kind === "unclosed" ? t.warning : mark.kind === "ahead" ? t.sub : t.accent;
  const Icon = mark.kind === "ahead" ? CalendarClock : Clock;
  return (
    <View className="shrink flex-row items-center gap-1">
      <Icon color={color} size={12} strokeWidth={2} />
      <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ fontSize: 13, color, fontVariant: ["tabular-nums"] }}>
        {formatShortDateRu(mark.date)}
      </Text>
    </View>
  );
}

/** То же словами — для VoiceOver. */
export function visitMarkWords(mark: VisitMark): string {
  const date = formatShortDateRu(mark.date);
  if (mark.kind === "unclosed") return `визит ${date} не закрыт`;
  if (mark.kind === "ahead") return `записан ${date}`;
  return `последний визит ${date}`;
}
