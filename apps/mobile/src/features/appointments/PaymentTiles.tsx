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
// Та же плитка — счёт в форме операции и в панели «Счета» на «Финансах»
// (владелец 2026-09-15: «как в счёт оплаты»): счёт узнают по плитке всюду.

export const TILE_GAP = 8;
const TILE_HEIGHT = 48;
const TILE_HEIGHT_PAID = 56;
/** Значок в строку с именем: плитка счёта с остатком, но на ряд ниже. */
const TILE_HEIGHT_COMPACT = 44;

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
  selected,
  amount,
  amountColor,
  compact,
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
  /** ВЫБРАН, А НЕ ОПЛАЧЕН. В записи плитка — действие: тап принимает деньги,
   *  и «выбранного» состояния у неё нет. В форме операции счёт ВЫБИРАЮТ, и
   *  метка выбора обязана оставить плитке её собственный цвет: перекрашенная
   *  в акцент, она теряла то, чем счёт узнают (владелец 2026-09-10). */
  selected?: boolean;
  /** Сумма под именем: полученная на счёт (`paid`) либо остаток счёта в
   *  панели «Счета» на «Финансах». */
  amount?: string;
  /** Цвет суммы вне `paid`: минус — `danger`, ноль — тише живых денег. */
  amountColor?: string;
  /** Значок в строку с именем, сумма под ними — 44pt вместо 56. Владелец
   *  2026-09-15: панель «Счета» — «ещё немножечко компактней», затем форма
   *  операции и оплата записи — «чтоб иконка была слева… одной плашкой».
   *  У оплаченной плитки на месте значка галка. */
  compact?: boolean;
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
      accessibilityState={{
        disabled: Boolean(disabled),
        selected: pending || Boolean(selected),
      }}
      style={({ pressed }) => ({
        width,
        height: compact
          ? TILE_HEIGHT_COMPACT
          : paid || amount
            ? TILE_HEIGHT_PAID
            : TILE_HEIGHT,
        borderRadius: t.radius.card,
        backgroundColor: paid
          ? `${t.success}1f`
          : pending
            ? `${t.accent}14`
            : tint
              ? `${tint}1a`
              : t.fill,
        borderWidth: paid || pending || selected ? (selected ? 2 : 1) : 0,
        borderColor: paid ? t.success : selected ? (tint ?? t.accent) : t.accent,
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        opacity: pressed ? 0.7 : state === "dim" ? 0.35 : 1,
      })}
    >
      {compact ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            maxWidth: "100%",
            paddingHorizontal: 6,
          }}
        >
          {paid ? (
            <Check size={14} strokeWidth={2.4} color={t.success} />
          ) : (
            <Icon size={14} strokeWidth={2} color={pending ? t.accent : color} />
          )}
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            style={{
              flexShrink: 1,
              fontSize: 12,
              fontWeight: "600",
              color: paid ? t.successInk : t.ink,
            }}
          >
            {label}
          </Text>
        </View>
      ) : (
        <>
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
        </>
      )}
      {amount ? (
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          style={{
            fontSize: 12,
            fontWeight: "700",
            color: paid ? t.successInk : (amountColor ?? t.ink),
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

/** ОДНА строка под малой надписью карточки: слева состояние денег («Долг
 *  €135», «Оплачено») либо — по кнопке суммы — поле «€ Сумма» с остатком,
 *  справа иконки режимов. Блок от нажатия кнопки не растёт (владелец
 *  2026-09-06: «чтобы всё в одной строчке, компактно и красиво»). */
export interface StateRowAmount {
  symbol: string;
  value: string;
  onChangeText: (next: string) => void;
  hint: string;
  hintTone?: "neutral" | "danger";
}

export function PaymentStateRow({
  caption,
  captionColor,
  captionTone = "neutral",
  amount,
  right,
}: {
  caption?: string;
  captionColor?: string;
  /** Денежное состояние печатается крупно, подсказка — тише. */
  captionTone?: "neutral" | "money";
  /** Открытое поле суммы занимает место подписи. */
  amount?: StateRowAmount;
  right?: ReactNode;
}) {
  const t = useThemeColors();
  return (
    <View
      className="flex-row items-center"
      style={{ paddingHorizontal: 16, minHeight: 40, gap: 10 }}
    >
      {amount ? (
        <>
          <View
            className="flex-row items-center"
            style={{
              flex: 1,
              height: 36,
              borderRadius: t.radius.input,
              borderCurve: "continuous",
              backgroundColor: t.fill,
              paddingHorizontal: 10,
              gap: 4,
            }}
          >
            <Text
              accessible={false}
              maxFontSizeMultiplier={1.2}
              style={{ fontSize: 15, fontWeight: "600", color: t.faint }}
            >
              {amount.symbol}
            </Text>
            <TextInput
              value={amount.value}
              onChangeText={amount.onChangeText}
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
                fontSize: 16,
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
              color: amount.hintTone === "danger" ? t.danger : t.sub,
              fontVariant: ["tabular-nums"],
            }}
          >
            {amount.hint}
          </Text>
        </>
      ) : (
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
      )}
      {right ? (
        <View className="flex-row items-center" style={{ gap: 2 }}>
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
