import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { formatEURExact } from "@babun/shared/common/utils/money";
import type { TxVatMode } from "@babun/shared/local/finance/vat";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// НИЖНИЕ СТРОКИ ШТОРКИ «ИТОГО»: СКИДКА → VAT → К ОПЛАТЕ.
//
// Владелец 2026-09-22: «вылижи этот блок — всё красиво столбиками:
// количество, услуги, скидки, VAT, итого, к оплате… ровненько, чтоб всё было
// на своём месте». Раньше скидка и налог стояли своей сеткой (клавиша 80,
// ставка 54, налог 70) и не совпадали со столбцами услуг над ними, а налог
// жил отдельной карточкой со своей шапкой. Теперь это ОДНА ТАБЛИЦА с одной
// сеткой `TOTAL_GRID`:
//
//   столбец 1 (гибкий)  — имя услуги · клавиша «Скидка» · клавиша «VAT» · «К оплате»
//   столбец 2 (qty)      — количество · процент/сумма скидки · ставка
//   столбец 3 (price)    — цена за одну · «−€5» · налог в евро
//   столбец 4 (sum)      — сумма строки · после скидки · (пусто) · итог
//
// СВОЕЙ АРИФМЕТИКИ ЗДЕСЬ НЕТ: налог считает канон `applyTxVat`
// (`local/finance/vat.ts`) у вызывающего — та же функция, что кладёт деньги
// в проводку, и которой вторит серверная `fill_transaction_vat`.

/** Сетка шторки «Итого» — одна на шапку, строки услуг и строки денег. */
export const TOTAL_GRID = {
  qty: 84,
  price: 66,
  sum: 76,
  gap: 8,
  padX: 14,
} as const;

const NEXT: Record<TxVatMode, TxVatMode> = {
  none: "exclusive",
  exclusive: "inclusive",
  inclusive: "none",
};

const SPOKEN: Record<TxVatMode, string> = {
  none: "без налога",
  exclusive: "налог сверху цены",
  inclusive: "налог внутри цены",
};

/** Ставка из набранного: запятая и точка одинаковы, два знака, 0…99.99. */
export function parseVatRate(text: string): number | null {
  const value = Number(text.replace(",", ".").trim());
  if (!Number.isFinite(value) || value < 0 || value >= 100) return null;
  return Math.round(value * 100) / 100;
}

/** Строка таблицы: волосок сверху, четыре столбца сетки. */
function GridRow({ children, strong }: { children: ReactNode; strong?: boolean }) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: TOTAL_GRID.gap,
        minHeight: strong ? 56 : 48,
        paddingHorizontal: TOTAL_GRID.padX,
        paddingVertical: 4,
        borderTopWidth: 1,
        borderTopColor: t.separator,
      }}
    >
      {children}
    </View>
  );
}

/** Число в столбце — справа, моноширинные цифры. */
function Cell({
  width,
  children,
  tone = "ink",
  size = 15,
}: {
  width: number;
  children?: ReactNode;
  tone?: "ink" | "sub";
  size?: number;
}) {
  const t = useThemeColors();
  return (
    <Text
      numberOfLines={1}
      maxFontSizeMultiplier={1.2}
      style={{
        width,
        textAlign: "right",
        fontSize: size,
        fontWeight: "700",
        color: tone === "sub" ? t.sub : t.ink,
        fontVariant: ["tabular-nums"],
      }}
    >
      {children}
    </Text>
  );
}

/** Поле числа в столбце количества — та же «пилюля», что у цены услуги,
 *  с единицей внутри: «10 %», «5 €», «+19 %». */
function InputPill({
  value,
  onChangeText,
  onEndEditing,
  prefix,
  unit,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (next: string) => void;
  onEndEditing?: () => void;
  prefix?: string;
  unit: string;
  accessibilityLabel: string;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        width: TOTAL_GRID.qty,
        height: 34,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
        gap: 2,
        borderRadius: t.radius.input,
        backgroundColor: t.fill,
      }}
    >
      {prefix ? (
        <Text style={{ fontSize: 15, fontWeight: "700", color: t.sub }}>{prefix}</Text>
      ) : null}
      <TextInput
        keyboardAppearance="light"
        value={value}
        onChangeText={onChangeText}
        onEndEditing={onEndEditing}
        selectTextOnFocus
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={t.placeholder}
        accessibilityLabel={accessibilityLabel}
        maxFontSizeMultiplier={1.2}
        style={{
          flex: 1,
          height: 34,
          padding: 0,
          textAlign: "right",
          fontSize: 15,
          fontWeight: "700",
          color: t.ink,
          fontVariant: ["tabular-nums"],
        }}
      />
      <Text style={{ fontSize: 14, fontWeight: "600", color: t.sub }}>{unit}</Text>
    </View>
  );
}

/** Клавиша в первом столбце: «Скидка» (€ ↔ %) и «VAT» (по кругу). */
function Key({
  children,
  label,
  hint,
  struck,
  onPress,
}: {
  children: ReactNode;
  label: string;
  hint?: string;
  struck?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <View style={{ flex: 1, alignItems: "flex-start" }}>
      <Pressable
        onPress={() => {
          haptics.tap();
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        hitSlop={6}
        style={({ pressed }) => ({
          minWidth: 76,
          height: 32,
          paddingHorizontal: 12,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: t.radius.input,
          backgroundColor: t.surface,
          boxShadow: t.cardShadow,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text
          style={{
            fontSize: 15,
            fontWeight: "700",
            color: struck ? t.faint : t.ink,
            textDecorationLine: struck ? "line-through" : "none",
          }}
        >
          {children}
        </Text>
      </Pressable>
    </View>
  );
}

/** Скидка: клавиша «Скидка» меняет € ↔ %, число — в столбце количества,
 *  «−€5» — в столбце цены, сумма после скидки — в столбце суммы. */
export function DiscountRow({
  value,
  onValueChange,
  percent,
  onPercentChange,
  amount,
  after,
}: {
  value: string;
  onValueChange: (next: string) => void;
  percent: boolean;
  onPercentChange: (next: boolean) => void;
  /** Сколько скидка съела в деньгах. */
  amount: number;
  /** Сумма работ после скидки. */
  after: number;
}) {
  return (
    <GridRow>
      <Key
        label={percent ? "Скидка в процентах" : "Скидка в валюте"}
        hint="Переключить проценты и валюту"
        onPress={() => onPercentChange(!percent)}
      >
        Скидка
      </Key>
      <InputPill
        value={value}
        onChangeText={onValueChange}
        unit={percent ? "%" : "€"}
        accessibilityLabel="Скидка"
      />
      <Cell width={TOTAL_GRID.price} tone="sub">
        {amount > 0 ? `−${formatEURExact(amount)}` : ""}
      </Cell>
      <Cell width={TOTAL_GRID.sum}>{formatEURExact(after)}</Cell>
    </GridRow>
  );
}

/** VAT: клавиша по кругу (сверху → внутри → без), ставка цифрами в столбце
 *  количества — как скидка, пересчёт на каждом символе, — налог в евро в
 *  столбце цены. Запоминает ставку вызывающий (`useRememberedVatRate`). */
export function VatRow({
  mode,
  rate,
  amount,
  onModeChange,
  onRateChange,
}: {
  mode: TxVatMode;
  rate: number;
  /** Сколько налога внутри «К оплате». */
  amount: number;
  onModeChange: (next: TxVatMode) => void;
  onRateChange?: (rate: number) => void;
}) {
  const off = mode === "none";
  // Текст поля живёт своей жизнью, пока его набирают: «1» на пути к «19»
  // пересчитывает итог, но неразборчивое («1,») ждёт следующего символа.
  const [text, setText] = useState(String(rate));
  useEffect(() => {
    setText(String(rate));
  }, [rate]);
  return (
    <GridRow>
      <Key
        label={`VAT: ${SPOKEN[mode]}`}
        hint="Переключить: сверху цены, внутри цены, без налога"
        struck={off}
        onPress={() => onModeChange(NEXT[mode])}
      >
        VAT
      </Key>
      {off ? (
        <Cell width={TOTAL_GRID.qty} tone="sub" />
      ) : onRateChange ? (
        <InputPill
          value={text}
          prefix={mode === "exclusive" ? "+" : "в т.ч."}
          unit="%"
          accessibilityLabel="Ставка VAT, процентов"
          onChangeText={(next) => {
            setText(next);
            const parsed = parseVatRate(next);
            if (parsed != null && parsed !== rate) onRateChange(parsed);
          }}
          onEndEditing={() => {
            if (parseVatRate(text) == null) setText(String(rate));
          }}
        />
      ) : (
        <Cell width={TOTAL_GRID.qty}>{`${mode === "exclusive" ? "+" : ""}${rate}%`}</Cell>
      )}
      <Cell width={TOTAL_GRID.price} tone="sub">
        {off ? "" : formatEURExact(amount)}
      </Cell>
      <Cell width={TOTAL_GRID.sum} />
    </GridRow>
  );
}

/** «К оплате» — последняя строка таблицы, крупно. Слева — необязательная
 *  клавиша (у записи со старой ручной суммой это «По услугам»). */
export function DueRow({ total, action }: { total: number; action?: ReactNode }) {
  const t = useThemeColors();
  return (
    <GridRow strong>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: t.ink }}>К оплате</Text>
        {action}
      </View>
      <Text
        maxFontSizeMultiplier={1.2}
        style={{
          fontSize: 22,
          fontWeight: "800",
          color: t.ink,
          fontVariant: ["tabular-nums"],
        }}
      >
        {formatEURExact(total)}
      </Text>
    </GridRow>
  );
}
