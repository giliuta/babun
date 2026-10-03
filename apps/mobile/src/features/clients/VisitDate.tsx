import { Text, View, useWindowDimensions } from "react-native";
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

/** Ширина места номера — та же, что в строке списка клиентов (`ClientRow`):
 *  «+357 99 999 999» и «+7 916 123 45 67» шрифтом 14 с моноширинными цифрами
 *  и запас до даты. */
export const PHONE_COLUMN = 138;

/** НОМЕР И ДАТА ВИЗИТА — СТОЛБИКАМИ (владелец 01.10 и 03.10: «у номера
 *  собственный столбик, зафиксированный… чтоб не было, что дата то здесь, то
 *  там — красиво в столбик»). У номера место одной ширины под самый длинный
 *  номер (растёт с крупным шрифтом, как и строки, до 1.3), дата начинается за
 *  ним в одной точке у каждой строки — даже без номера. `phone` — уже в виде
 *  для глаза; `wide` — текст вместо номера («Номер откроется в день записи»):
 *  в столбик он не влезет и идёт своей шириной. */
export function PhoneVisitLine({
  phone,
  phoneColor,
  mark,
  wide = false,
}: {
  phone: string | null;
  phoneColor?: string;
  mark: VisitMark | null;
  wide?: boolean;
}) {
  const t = useThemeColors();
  const { fontScale } = useWindowDimensions();
  if (!phone && !mark) return null;
  const column = Math.round(PHONE_COLUMN * Math.min(fontScale, 1.3));
  const phoneText = phone ? (
    <Text
      maxFontSizeMultiplier={1.3}
      numberOfLines={1}
      style={{ fontSize: 14, color: phoneColor ?? t.sub, fontVariant: ["tabular-nums"] }}
    >
      {phone}
    </Text>
  ) : null;
  return (
    <View className="mt-0.5 flex-row items-center">
      {wide ? (
        <View style={{ flexShrink: 1, marginRight: mark ? 12 : 0 }}>{phoneText}</View>
      ) : (
        <View style={{ width: column }}>{phoneText}</View>
      )}
      {mark ? <VisitDate mark={mark} /> : null}
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
