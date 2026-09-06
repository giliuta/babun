import type { ReactNode } from "react";
import { Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Check, ChevronRight, FileText } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { AddRow } from "@/components/ui/AddRow";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

// ПЛИТКИ БЛОКА «ОПЛАТА» — только вид (STORY-065, выбор владельца 2026-09-06:
// «плитки Б2, компактнее; предоплата и инвойс — маленькие иконки справа;
// сумму в шапке не дублировать»). Логика денег живёт в PaymentBlock.

export const TILE_GAP = 8;
const TILE_HEIGHT = 48;
const TILE_HEIGHT_PAID = 56;

/** Ширина плитки: три в ряд внутри карточки с полями 16. */
export function useTileWidth(perRow = 3): number {
  const { width } = useWindowDimensions();
  const inner = width - GUTTER * 2 - 32;
  return Math.floor((inner - TILE_GAP * (perRow - 1)) / perRow);
}

export type PaymentTileState = "idle" | "dim" | "pending" | "paid";

export function PaymentTile({
  icon: Icon,
  label,
  color,
  tint,
  width,
  state,
  amount,
  disabled,
  onPress,
  accessibilityLabel,
}: {
  icon: LucideIcon;
  label: string;
  /** Цвет глифа в покое — цвет счёта из финансов либо чернила. */
  color: string;
  /** Цвет счёта для заливки плитки (владелец 2026-09-06: «подсвечивать
   *  блок, как указано в счёте»); null — нейтральная заливка `fill`. */
  tint?: string | null;
  width: number;
  state: PaymentTileState;
  /** Полученная на этот счёт сумма (только для `paid`). */
  amount?: string;
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const t = useThemeColors();
  const paid = state === "paid";
  const pending = state === "pending";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled), selected: pending }}
      style={({ pressed }) => ({
        width,
        height: paid ? TILE_HEIGHT_PAID : TILE_HEIGHT,
        borderRadius: t.radius.card,
        backgroundColor: paid
          ? `${t.success}1f`
          : pending
            ? `${t.accent}14`
            : tint
              ? `${tint}1a`
              : t.fill,
        borderWidth: paid || pending ? 1 : 0,
        borderColor: paid ? t.success : t.accent,
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        opacity: pressed ? 0.7 : state === "dim" ? 0.35 : 1,
      })}
    >
      {paid ? (
        <Check size={16} strokeWidth={2.4} color={t.success} />
      ) : (
        <Icon size={16} strokeWidth={2} color={pending ? t.accent : color} />
      )}
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        style={{
          fontSize: 12,
          fontWeight: "600",
          color: paid ? t.successInk : t.ink,
          paddingHorizontal: 6,
        }}
      >
        {label}
      </Text>
      {paid && amount ? (
        <Text
          maxFontSizeMultiplier={1.3}
          style={{
            fontSize: 12,
            fontWeight: "700",
            color: t.successInk,
            fontVariant: ["tabular-nums"],
          }}
        >
          {amount}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Круглая иконка-режим справа от заголовка: «Предоплата», «Инвойс». */
export function ModeIconButton({
  icon: Icon,
  label,
  active,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(active) }}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        borderRadius: t.radius.pill,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active ? `${t.accent}1f` : "transparent",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon size={18} strokeWidth={2} color={active ? t.accent : t.sub} />
    </Pressable>
  );
}

/** Строка состояния денег под малой надписью карточки: слева «Долг €135» /
 *  «Оплачено», справа иконки режимов (владелец 2026-09-06: «долг на строчке,
 *  справа вот эти, а „Оплата“ — как у „Услуг“, без пропуска»). */
export function PaymentStateRow({
  caption,
  captionColor,
  captionTone = "neutral",
  right,
}: {
  caption?: string;
  captionColor?: string;
  /** Денежное состояние печатается крупно, подсказка — тише. */
  captionTone?: "neutral" | "money";
  right?: ReactNode;
}) {
  const t = useThemeColors();
  return (
    <View
      className="flex-row items-center justify-between"
      style={{ paddingHorizontal: 16, minHeight: 36, gap: 8 }}
    >
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        style={{
          flex: 1,
          fontSize: captionTone === "money" ? 17 : 15,
          fontWeight: captionTone === "money" ? "600" : "500",
          color: captionColor ?? t.sub,
          fontVariant: ["tabular-nums"],
        }}
      >
        {caption ?? ""}
      </Text>
      {right ? (
        <View className="flex-row items-center" style={{ gap: 4 }}>
          {right}
        </View>
      ) : null}
    </View>
  );
}

/** Тихая текстовая ссылка под сеткой («Внести часть» / «Вся сумма»). */
export function QuietLink({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <View
      className="flex-row justify-end"
      style={{ paddingHorizontal: 16, paddingBottom: 8, marginTop: -4 }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        hitSlop={8}
        style={{ minHeight: 32, justifyContent: "center" }}
      >
        <Text style={{ fontSize: 13, fontWeight: "600", color: t.accent }}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

/** Строка выставленного инвойса: номер, срок или «Оплачен», сумма. */
export function InvoiceRow({
  number,
  subtitle,
  onPress,
}: {
  number: string;
  subtitle: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Инвойс ${number}, открыть`}
      className="flex-row items-center"
      style={{ marginHorizontal: 16, marginTop: 4, minHeight: 44, gap: 10 }}
    >
      <FileText size={18} strokeWidth={2} color={t.accent} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
          Инвойс {number}
        </Text>
        <Text style={{ fontSize: 13, color: t.sub }}>{subtitle}</Text>
      </View>
      <ChevronRight size={18} color={t.faint} />
    </Pressable>
  );
}

/** У команды нет касс: владельцу — дверь создания, остальным — слова. */
export function NoAccountsNotice({
  canCreate,
  onCreate,
}: {
  canCreate: boolean;
  onCreate: () => void;
}) {
  const t = useThemeColors();
  return (
    <View style={{ paddingTop: 4 }}>
      <Text style={{ marginHorizontal: 16, fontSize: 13, color: t.sub }}>
        {canCreate
          ? "У команды нет счёта — некуда положить деньги."
          : "У команды нет счёта. Попросите владельца завести его в финансах."}
      </Text>
      {canCreate ? (
        <AddRow label="Создать счёт" onPress={onCreate} />
      ) : (
        <View style={{ height: 12 }} />
      )}
    </View>
  );
}

/** Компактная строка суммы: «€ [сумма]» слева, остаток или ошибка справа.
 *  Без ярлыка и без крупных цифр (владелец 2026-09-06: «коротко, компактно,
 *  премиально»). */
export function AmountRow({
  symbol,
  value,
  onChangeText,
  hint,
  hintTone = "neutral",
}: {
  symbol: string;
  value: string;
  onChangeText: (next: string) => void;
  hint: string;
  hintTone?: "neutral" | "danger";
}) {
  const t = useThemeColors();
  return (
    <View
      className="flex-row items-center"
      style={{ paddingHorizontal: 16, paddingTop: 6, gap: 12 }}
    >
      <View
        className="flex-row items-center"
        style={{
          flex: 1,
          height: 40,
          borderRadius: t.radius.input,
          borderCurve: "continuous",
          backgroundColor: t.fill,
          paddingHorizontal: 12,
          gap: 6,
        }}
      >
        <Text
          accessible={false}
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 15, fontWeight: "600", color: t.faint }}
        >
          {symbol}
        </Text>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          autoFocus
          keyboardType="decimal-pad"
          placeholder="Сумма"
          placeholderTextColor={t.placeholder}
          selectionColor={t.accent}
          keyboardAppearance="light"
          accessibilityLabel="Сумма"
          maxFontSizeMultiplier={1.2}
          style={{
            flex: 1,
            padding: 0,
            fontSize: 17,
            fontWeight: "600",
            color: t.ink,
            fontVariant: ["tabular-nums"],
          }}
        />
      </View>
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        style={{
          flexShrink: 0,
          fontSize: 13,
          fontWeight: "600",
          color: hintTone === "danger" ? t.danger : t.sub,
          fontVariant: ["tabular-nums"],
        }}
      >
        {hint}
      </Text>
    </View>
  );
}
