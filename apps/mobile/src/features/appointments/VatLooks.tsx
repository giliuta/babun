import type { ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { formatEURExact } from "@babun/shared/common/utils/money";
import type { TxVatMode } from "@babun/shared/local/finance/vat";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ДВЕ ИТОГОВЫЕ СТРОКИ ДЕНЕЖНОГО ЛИСТА.
//
// Владелец 2026-09-20, после восьми отвергнутых видов выбора налога и живой
// примерки на своём экране: «скидку закинуть туда, где надпись „Услуги“, и
// справа будет точная цена; а VAT закинуть к итоговой стоимости». Значит
// органов ровно два, и каждый стоит в своей итоговой строке: скидка закрывает
// перечень работ, налог закрывает деньги клиента.
//
// СВОЕЙ АРИФМЕТИКИ ЗДЕСЬ НЕТ. Налог считает канон `applyTxVat`
// (`local/finance/vat.ts`) — та же функция, что кладёт деньги в проводку и
// которой вторит серверная `fill_transaction_vat`. Здесь стояла своя копия
// формулы в double, и на реальных деньгах она расходилась с каноном на цент
// (нетто €42,50 при 19 % «сверху»: €50,57 против €50,58) — то есть бумага и
// журнал по одной работе называли РАЗНЫЕ суммы.

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

/** Клавиша одной ширины на обе строки — иначе строка едет под пальцем. */
const KEY_W = 80;
const RATE_W = 54;
const VAT_W = 70;
const COL_GAP = 8;

/** Последняя строка перечня работ: сумма услуг, скидка и цена после неё. */
export function ServicesRow({
  discountValue,
  onDiscountValueChange,
  percent,
  onPercentChange,
  discountAmount,
  afterDiscount,
}: {
  discountValue: string;
  onDiscountValueChange: (next: string) => void;
  percent: boolean;
  onPercentChange: (next: boolean) => void;
  /** Сколько скидка съела в деньгах. */
  discountAmount: number;
  afterDiscount: number;
}) {
  const t = useThemeColors();
  return (
    <Row>
      {/* Слова «Услуги» здесь нет: колонка уже подписана в шапке, а строку
          открывает её орган — клавиша скидки (владелец 20.09). */}
      <Key
        label={percent ? "Скидка в процентах" : "Скидка в валюте"}
        hint="Переключить проценты и валюту"
        onPress={() => onPercentChange(!percent)}
      >
        Скидка
      </Key>
      <Rate>
        <TextInput
          keyboardAppearance="light"
          value={discountValue}
          onChangeText={onDiscountValueChange}
          selectTextOnFocus
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={t.placeholder}
          accessibilityLabel="Скидка"
          style={{
            flex: 1,
            height: 28,
            paddingHorizontal: 0,
            textAlign: "right",
            fontSize: 15,
            fontWeight: "700",
            color: t.ink,
            fontVariant: ["tabular-nums"],
          }}
        />
        <Unit>{percent ? "%" : "€"}</Unit>
      </Rate>
      {/* ПРОЦЕНТ — И СРАЗУ В ЕВРО (владелец 20.09: «если выбираю процент и
          пишу процент, то правее от процента пишется в евро»). В колонке та
          же ширина, что у налога внизу, — числа стоят друг под другом. */}
      <Text
        style={{
          width: VAT_W,
          textAlign: "right",
          fontSize: 15,
          fontWeight: "700",
          color: t.sub,
          fontVariant: ["tabular-nums"],
        }}
      >
        {percent && discountAmount > 0 ? `−${formatEURExact(discountAmount)}` : ""}
      </Text>
      <Sum value={afterDiscount} />
    </Row>
  );
}

/** Второй блок — такой же таблицей, как работы: своя шапка колонок, под ней
 *  строка «клавиша · ставка · налог · к оплате» (владелец 20.09: «второй блок
 *  назовём так же, как первый; добавляем кнопку VAT, потом процент, потом
 *  отдельное число»).
 *
 *  НАЛОГ — НЕОБЯЗАТЕЛЬНАЯ ЧАСТЬ СТРОКИ. Он есть у документа: чек и инвойс
 *  печатают ставку и сумму налога, и человек их выбирает. У ЗАПИСИ его нет:
 *  цена записи налога не несёт (он назначается на каждом платеже отдельно), и
 *  клавиша, меняющая «К оплате» и больше ничего в продукте, была бы обещанием
 *  денег, которых запись не сохранит. Поэтому без `vat` строка печатает
 *  только итог — ту самую строку «Итого: €180», что стояла здесь всегда. */
export function PayRow({
  total,
  vat,
  action,
}: {
  total: number;
  vat?: {
    mode: TxVatMode;
    rate: number;
    /** Сколько налога внутри «К оплате» — считает канон `applyTxVat`. */
    amount: number;
    onModeChange: (next: TxVatMode) => void;
  };
  /** Одна необязательная клавиша слева, на месте VAT: у записи со старой
   *  ручной суммой это «По услугам». */
  action?: ReactNode;
}) {
  const t = useThemeColors();
  const off = !vat || vat.mode === "none";
  const cap = {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 0.6,
    textTransform: "uppercase" as const,
    color: t.faint,
  };
  return (
    <View
      style={{
        borderRadius: t.radius.input,
        backgroundColor: t.rowFill,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: COL_GAP,
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: 4,
        }}
      >
        <Text style={[cap, { width: KEY_W }]}>Итого</Text>
        {vat ? (
          <>
            <Text style={[cap, { width: RATE_W, textAlign: "right" }]}>Ставка</Text>
            <Text style={[cap, { width: VAT_W, textAlign: "right" }]}>Налог</Text>
          </>
        ) : null}
        <Text style={[cap, { flex: 1, textAlign: "right" }]}>К оплате</Text>
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: COL_GAP,
          minHeight: 46,
          paddingHorizontal: 12,
          paddingBottom: 6,
        }}
      >
        {vat ? (
          <Key
            label={`VAT: ${SPOKEN[vat.mode]}`}
            hint="Переключить: сверху цены, внутри цены, без налога"
            struck={off}
            onPress={() => vat.onModeChange(NEXT[vat.mode])}
          >
            VAT
          </Key>
        ) : (
          // Ширина клавиши держится и пустой: «К оплате» обязано стоять на
          // том же месте, что у документа с налогом.
          <View style={{ width: KEY_W, justifyContent: "center" }}>{action}</View>
        )}
        {vat ? (
          <>
            <Text
              style={{
                width: RATE_W,
                textAlign: "right",
                fontSize: 15,
                fontWeight: "700",
                color: t.ink,
                fontVariant: ["tabular-nums"],
              }}
            >
              {off ? "" : vat.mode === "exclusive" ? `+${vat.rate}%` : `−${vat.rate}%`}
            </Text>
            <Text
              style={{
                width: VAT_W,
                textAlign: "right",
                fontSize: 15,
                fontWeight: "700",
                color: t.ink,
                fontVariant: ["tabular-nums"],
              }}
            >
              {off ? "" : formatEURExact(vat.amount)}
            </Text>
          </>
        ) : null}
        <Text
          style={{
            flex: 1,
            textAlign: "right",
            fontSize: 20,
            fontWeight: "700",
            color: t.ink,
            fontVariant: ["tabular-nums"],
          }}
        >
          {formatEURExact(total)}
        </Text>
      </View>
    </View>
  );
}

function Row({
  strong,
  children,
}: {
  strong?: boolean;
  children: ReactNode;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: COL_GAP,
        minHeight: strong ? 48 : 44,
        paddingHorizontal: 12,
        borderTopWidth: strong ? 0 : 1,
        borderTopColor: t.separator,
      }}
    >
      {children}
    </View>
  );
}

/** Колонка числа рядом с клавишей: число прижато к своей единице. */
function Rate({ children }: { children?: ReactNode }) {
  return (
    <View
      style={{
        width: RATE_W,
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
      }}
    >
      {children}
    </View>
  );
}

function Unit({ children }: { children: ReactNode }) {
  const t = useThemeColors();
  return (
    <Text style={{ fontSize: 14, fontWeight: "600", color: t.sub }}>
      {children}
    </Text>
  );
}

/** Сумма строки — в той же колонке, что «СУММА» у работ. */
function Sum({ value }: { value: number }) {
  const t = useThemeColors();
  return (
    <Text
      style={{
        minWidth: 96,
        textAlign: "right",
        fontSize: 15,
        fontWeight: "700",
        color: t.ink,
        fontVariant: ["tabular-nums"],
      }}
    >
      {formatEURExact(value)}
    </Text>
  );
}

/** Подпись-клавиша постоянной ширины, как «%» у скидки. */
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
        width: KEY_W,
        height: 28,
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
  );
}
