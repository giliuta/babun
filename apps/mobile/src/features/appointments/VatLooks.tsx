import { useEffect, useState, type ReactNode } from "react";
import { useMoney } from "@/features/settings/currency";
import { Text, TextInput, View } from "react-native";
import type { TxVatMode } from "@babun/shared/local/finance/vat";
import { useThemeColors } from "@/theme/colors";
import { parseVatRate } from "./vat-looks/parse-vat-rate";
import { COL_GAP, KEY_W, Key, RATE_W, Rate, Row, Sum, Unit, VAT_W } from "./vat-looks/parts";

// ДВЕ ИТОГОВЫЕ СТРОКИ ДЕНЕЖНОГО ЛИСТА.
//
// Органов ровно два, и каждый стоит в своей итоговой строке: скидка (там, где
// надпись «Услуги», справа точная цена) закрывает перечень работ, налог (у
// итоговой стоимости) закрывает деньги клиента.
//
// СВОЕЙ АРИФМЕТИКИ ЗДЕСЬ НЕТ. Налог считает канон `applyTxVat`
// (`local/finance/vat.ts`) — та же функция, что кладёт деньги в проводку и
// которой вторит серверная `fill_transaction_vat`. Своя копия
// формулы в double расходилась бы с каноном на цент
// (нетто €42,50 при 19 % «сверху»: €50,57 против €50,58) — то есть бумага и
// журнал по одной работе называли РАЗНЫЕ суммы.
//
// Ячейки строк — `vat-looks/parts.tsx`.

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
  // Знак скидки в деньгах — валюта компании, а не «€» гвоздём.
  const { symbol: currencySymbol, fmtExact } = useMoney();
  return (
    <Row>
      {/* Слова «Услуги» здесь нет: колонка уже подписана в шапке, а строку
          открывает её орган — клавиша скидки. */}
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
        <Unit>{percent ? "%" : currencySymbol}</Unit>
      </Rate>
      {/* ПРОЦЕНТ — И СРАЗУ В ЕВРО: правее процента пишется сумма в евро. В колонке та
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
        {percent && discountAmount > 0 ? `−${fmtExact(discountAmount)}` : ""}
      </Text>
      <Sum value={afterDiscount} />
    </Row>
  );
}

/** Второй блок — такой же таблицей, как работы: своя шапка колонок, под ней
 *  строка «клавиша · ставка · налог · к оплате» (кнопка VAT, потом процент, потом
 *  отдельное число).
 *
 *  НАЛОГ — НЕОБЯЗАТЕЛЬНАЯ ЧАСТЬ СТРОКИ. Он есть у записи, чека и
 *  инвойса: запись хранит режим и ставку (`appointments.vat_rate`), и оплата
 *  ложится на счёт с выделенным налогом. Без `vat` (старая запись со «своей
 *  суммой») строка печатает только итог. */
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
    /** СТАВКУ ПИШУТ ЦИФРАМИ, КАК СКИДКУ (не выбор из списка: свой VAT
     *  запоминается и дальше используется). Поле в колонке ставки, та же
     *  анатомия, что у поля скидки строкой выше. Запоминает вызывающий
     *  (`useRememberedVatRate`). Нет обработчика — ставка только читается. */
    onRateChange?: (rate: number) => void;
  };
  /** Одна необязательная клавиша слева, на месте VAT: у записи со старой
   *  ручной суммой это «По услугам». */
  action?: ReactNode;
}) {
  const t = useThemeColors();
  // Суммы итога и налога — валютой компании, как скидка выше.
  const { fmtExact } = useMoney();
  // Текст поля ставки живёт своей жизнью, пока его набирают: «1» на пути к
  // «19» не должен пересчитывать итог на каждом символе в ноль-налог.
  const [rateText, setRateText] = useState(vat ? String(vat.rate) : "");
  useEffect(() => {
    if (vat) setRateText(String(vat.rate));
  }, [vat?.rate]); // eslint-disable-line react-hooks/exhaustive-deps
  const commitRate = () => {
    if (!vat?.onRateChange) return;
    const next = parseVatRate(rateText);
    if (next == null) setRateText(String(vat.rate));
    else if (next !== vat.rate) vat.onRateChange(next);
  };
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
          paddingHorizontal: 14,
          paddingTop: 8,
          paddingBottom: 4,
        }}
      >
        <Text style={[cap, { width: KEY_W }]}>Итого</Text>
        {vat ? (
          <>
            <Text style={[cap, { width: RATE_W, textAlign: "center" }]}>Ставка</Text>
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
          paddingHorizontal: 14,
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
            {vat.onRateChange && !off ? (
              <Rate>
                <Unit>{vat.mode === "exclusive" ? "+" : "−"}</Unit>
                <TextInput
                  keyboardAppearance="light"
                  value={rateText}
                  // ЖИВЬЁМ, КАК СКИДКА: налог и «К оплате» пересчитываются на
                  // каждом символе; неразборчивое (пусто, «1,») ждёт следующего
                  // символа, а уход с поля возвращает последнюю верную ставку.
                  onChangeText={(text) => {
                    setRateText(text);
                    const next = parseVatRate(text);
                    if (next != null && next !== vat.rate) vat.onRateChange?.(next);
                  }}
                  onEndEditing={commitRate}
                  selectTextOnFocus
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={t.placeholder}
                  accessibilityLabel="Ставка VAT, процентов"
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
                <Unit>%</Unit>
              </Rate>
            ) : (
              // Налог выключен — место столбца держится пустым, чтобы «Налог»
              // и «К оплате» не съезжали под пальцем.
              <View style={{ width: RATE_W, alignItems: "flex-end" }}>
                {off ? null : (
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: "700",
                      color: t.ink,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {vat.mode === "exclusive" ? `+${vat.rate}%` : `−${vat.rate}%`}
                  </Text>
                )}
              </View>
            )}
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
              {off ? "" : fmtExact(vat.amount)}
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
          {fmtExact(total)}
        </Text>
      </View>
    </View>
  );
}
