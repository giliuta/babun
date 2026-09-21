import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { formatEURExact } from "@babun/shared/common/utils/money";

import { QtyBadge } from "@/features/appointments/QtyBadge";
import { durationLabel } from "@/features/services/format";
import { useThemeColors } from "@/theme/colors";

import type { CrewWorkLine } from "./crew-work";

/** Строки карточки записи у команды: подпись над значением и строка-действие
 *  (маршрут, звонок, карточка клиента). */

export function InfoRow({ label, value }: { label: string; value: string }) {
  const t = useThemeColors();
  return (
    <View style={{ minHeight: 52, paddingHorizontal: 16, paddingVertical: 10 }}>
      <Text style={{ fontSize: 12, color: t.faint }}>{label}</Text>
      <Text style={{ marginTop: 2, fontSize: 15, color: t.ink }}>{value}</Text>
    </View>
  );
}

export function ActionRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={{ fontSize: 15, color: t.ink }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ marginTop: 2, fontSize: 12, color: t.sub }}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

/** Строка работы — та же грамматика, что в записи у владельца (`ServicesBlock`):
 *  имя и длительность, оттиск «×3», мелкая цена за штуку и сумма строки. Здесь
 *  строка только читается: услуги мастер не меняет. Цен нет без «Суммы». */
export function WorkLineRow({ line }: { line: CrewWorkLine }) {
  const t = useThemeColors();
  const subtitle = line.minutes > 0 ? durationLabel(line.minutes) : null;
  return (
    <View
      className="flex-row items-center px-4 py-2.5"
      accessible
      accessibilityLabel={[
        line.name,
        subtitle,
        line.total !== null ? formatEURExact(line.total) : null,
      ]
        .filter(Boolean)
        .join(", ")}
    >
      <View className="flex-1 pr-2">
        <Text style={{ fontSize: 15, color: t.ink }}>{line.name}</Text>
        {subtitle ? (
          <Text style={{ fontSize: 13, color: t.placeholder, marginTop: 1 }}>{subtitle}</Text>
        ) : null}
      </View>
      <QtyBadge qty={line.qty} unit={line.unit} />
      {line.pricePerUnit !== null ? (
        <Text
          style={{
            fontSize: 12,
            color: t.sub,
            minWidth: 44,
            marginLeft: 8,
            textAlign: "right",
            fontVariant: ["tabular-nums"],
          }}
        >
          {formatEURExact(line.pricePerUnit)}
        </Text>
      ) : null}
      {line.total !== null ? (
        <Text
          style={{
            fontSize: 15,
            fontWeight: "600",
            color: t.ink,
            minWidth: 56,
            marginLeft: 8,
            textAlign: "right",
            fontVariant: ["tabular-nums"],
          }}
        >
          {formatEURExact(line.total)}
        </Text>
      ) : null}
    </View>
  );
}

/** Строка «подпись — сумма»: «Итого», «Оплачено». Сумма справа, цифры
 *  табличные; подпись под словом — причина цифры («Скидка €20»). */
export function AmountRow({
  label,
  value,
  note,
  strong = false,
}: {
  label: string;
  value: string | null;
  note?: string | null;
  strong?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View
      className="flex-row items-center px-4"
      style={{ minHeight: 52, paddingVertical: 10 }}
      accessible
      accessibilityLabel={[label, value, note].filter(Boolean).join(", ")}
    >
      <View className="flex-1 pr-2">
        <Text style={{ fontSize: 15, color: t.ink, fontWeight: strong ? "600" : "400" }}>
          {label}
        </Text>
        {note ? (
          <Text style={{ fontSize: 13, color: t.sub, marginTop: 1 }}>{note}</Text>
        ) : null}
      </View>
      {value ? (
        <Text
          style={{
            fontSize: 15,
            fontWeight: strong ? "700" : "600",
            color: t.ink,
            fontVariant: ["tabular-nums"],
          }}
        >
          {value}
        </Text>
      ) : null}
    </View>
  );
}
