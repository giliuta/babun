import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  DiscountRow,
  DueRow,
  TOTAL_GRID,
  VatRow,
} from "@/features/appointments/VatLooks";
import type { ServicesBlockLine } from "@/features/appointments/ServicesBlock";
import { applyTxVat, type TxVatMode } from "@babun/shared/local/finance/vat";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { parseMoneyInput } from "@/features/appointments/helpers";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ДЕНЬГИ ЗАПИСИ ОДНИМ ЛИСТОМ (владелец 2026-09-04: «когда я открываю „Итого“,
// открывается снизу вверх шторка, где прописаны каждая услуга, количество их,
// и там уже можно редактировать и нажимать „Применить“; там же можно делать
// скидки, выбирать в евро или в процентах»).
//
// До этого «Итого» было полем в строке: сумма правилась прямо в списке, а
// скидки в форме не было вовсе — её ставила только программа лояльности, и
// снять её было нечем. Считать деньги в узкой строке между услугами и
// предоплатой неудобно: не видно, из чего сумма сложилась.
//
// ЛИСТ ОТВЕЧАЕТ НА ОДИН ВОПРОС — «ИЗ ЧЕГО ЭТИ ДЕНЬГИ»: услуги с количеством и
// ценой, скидка, и итог. Всё остальное (предоплата, способ оплаты) живёт своей
// секцией на странице: это уже НЕ про цену работы, а про полученные деньги.
//
// ИТОГ НЕ ПРАВЯТ РУКОЙ (владелец 2026-09-04: «сумму „итого“ изменить нельзя —
// от этого может испортиться сам инвойс; меняется услуга: чистка 135 €, я
// ставлю 130 €, и тогда меняется итого»). Итог — следствие строк, а не
// отдельное число: счёт, где сумма не сходится со строками, не объяснить ни
// клиенту, ни себе. Поэтому правится ЦЕНА УСЛУГИ в этой записи, а «Итого»
// печатается.

const SIDE = 20;

export type DiscountKind = "fixed" | "percent";

export function TotalSheet({
  visible,
  onClose,
  lines,
  onQtyChange,
  onPriceChange,
  discount,
  total,
  customTotal = false,
  onResetTotal,
  vat: vatControl,
}: {
  visible: boolean;
  onClose: () => void;
  /** СТРОКА — ТА ЖЕ, ЧТО У БЛОКА «УСЛУГИ» (`ServicesBlockLine`). Лист считал
   *  деньги ТОЛЬКО записи (`AppointmentService`), и позиция инвойса, у которой
   *  нет ни `serviceId`, ни длительности, в него не помещалась. Перевод
   *  «своя сущность → строка» делает вызывающий — как и в самом блоке. */
  lines: readonly ServicesBlockLine[];
  onQtyChange: (lineId: string, qty: number) => void;
  /** Цена ОДНОЙ штуки В ЭТОМ ДОКУМЕНТЕ. Прайс не трогается: это снимок строки. */
  onPriceChange: (lineId: string, price: number) => void;
  /** СКИДКА ЕСТЬ НЕ У ВСЯКОГО ДОКУМЕНТА. У записи и чека она своя строка, у
   *  инвойса её нет вовсе — сервер не знает такого поля, и рисовать поле,
   *  которое никуда не поедет, нельзя. Нет скидки — нет и строки. */
  discount?: {
    kind: DiscountKind;
    /** Сырой текст поля — разбор живёт у формы. */
    value: string;
    onKindChange: (kind: DiscountKind) => void;
    onValueChange: (value: string) => void;
  };
  total: number;
  /** У записи, сохранённой со «своей» суммой: её можно вернуть к расчёту.
   *  У документов такого прошлого нет — поэтому по умолчанию `false`. */
  customTotal?: boolean;
  onResetTotal?: () => void;
  /** НАЛОГ — РЕШЕНИЕ ВЫЗЫВАЮЩЕГО, А НЕ ЭТОЙ ШТОРКИ.
   *
   *  Владелец 2026-09-20, увидев чек: «НДС почему-то добавляется, или он
   *  включён — так не должно быть». И правда: шторка держала режим налога
   *  внутри себя и включала его сама по настройке компании, а документ потом
   *  печатал то, чего человек не выбирал.
   *
   *  Теперь режим приходит СНАРУЖИ и туда же возвращается. `undefined` —
   *  у документа налога нет вовсе (так зовёт запись): строка итога тогда
   *  печатает одну сумму, без ставки и клавиши. */
  vat?: {
    mode: TxVatMode;
    rate: number;
    onModeChange: (next: TxVatMode) => void;
    /** Ставка меняется тапом по ней (см. `PayRow`). */
    onRateChange?: (rate: number) => void;
  };
}) {
  const t = useThemeColors();
  // ДЕНЬГИ СЧИТАЕТ КАНОН, А НЕ ЭТОТ ЛИСТ (`applyTxVat`): ровно та же функция
  // кладёт сумму в проводку, и серверная `fill_transaction_vat` достаёт налог
  // из неё же. Своей формулы здесь нет — иначе бумага и журнал разошлись бы
  // на цент.
  const money = vatControl
    ? applyTxVat(total, vatControl.mode, vatControl.rate)
    : null;
  const shownTotal = money ? money.gross : total;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Итого"
      padded={false}
      scroll
      avoidKeyboard
      maxHeightRatio={0.8}
      footer={
        <View style={{ paddingHorizontal: SIDE }}>
          <Button label="Применить" onPress={onClose} />
        </View>
      }
    >
      <View style={{ paddingHorizontal: SIDE, paddingBottom: 10, gap: 8 }}>
        {/* ОДНА ТАБЛИЦА НА ВСЁ (владелец 2026-09-22: «всё красиво
            столбиками — количество, услуги, скидки, VAT, итого, к оплате»).
            Шапка колонок сказана один раз сверху; ниже услуги, скидка,
            налог и «К оплате» — в тех же столбцах. */}
        <View
          style={{
            borderRadius: t.radius.input,
            backgroundColor: t.rowFill,
            overflow: "hidden",
          }}
        >
          {lines.length > 0 ? (
            <>
              <ColumnHeader />
              {lines.map((line, index) => (
                <ServiceLine
                  key={line.id}
                  line={line}
                  separated={index > 0}
                  onQtyChange={onQtyChange}
                  onPriceChange={onPriceChange}
                />
              ))}
            </>
          ) : (
            <EmptyState title="Услуги ещё не выбраны" />
          )}
          {discount && lines.length > 0 ? (
            <DiscountRow
              value={discount.value}
              onValueChange={discount.onValueChange}
              percent={discount.kind === "percent"}
              onPercentChange={(next) =>
                discount.onKindChange(next ? "percent" : "fixed")
              }
              amount={Math.max(
                0,
                lines.reduce((sum, line) => sum + line.total, 0) - total,
              )}
              after={total}
            />
          ) : null}
          {vatControl && money ? (
            <VatRow
              mode={vatControl.mode}
              rate={vatControl.rate}
              amount={money.vat}
              onModeChange={vatControl.onModeChange}
              onRateChange={vatControl.onRateChange}
            />
          ) : null}
          <DueRow
            total={shownTotal}
            action={
              customTotal && onResetTotal ? (
                <Pressable
                  onPress={() => {
                    haptics.tap();
                    onResetTotal();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Вернуть сумму по услугам"
                  hitSlop={8}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <Text
                    style={{ fontSize: 13, fontWeight: "600", color: t.accent }}
                  >
                    По услугам
                  </Text>
                </Pressable>
              ) : null
            }
          />
        </View>
      </View>
    </BottomSheet>
  );
}

/** Ширины колонок — ОДНИ на шапку и на строки: иначе подпись и число
 *  разъезжаются на первом же длинном имени. */
// Сетка — ОБЩАЯ со строками скидки, налога и «К оплате» (`TOTAL_GRID`):
// количество, процент скидки и ставка стоят в одном столбце, цена, «−€5» и
// налог — в другом, суммы — в третьем.
const COL_QTY = TOTAL_GRID.qty;
const COL_PRICE = TOTAL_GRID.price;
const COL_SUM = TOTAL_GRID.sum;
const COL_GAP = TOTAL_GRID.gap;

/** ШАПКА КОЛОНОК — ВМЕСТО ПОДПИСЕЙ В КАЖДОЙ СТРОКЕ (владелец 2026-09-08:
 *  «названия — красивый блок, потом количество — тоже красивый блок, потом
 *  цена за единицу и общая цена»). Слова «за шт» и «всего» повторялись в
 *  каждой строке и съедали ту самую ширину, которой не хватало именам. Здесь
 *  они сказаны один раз сверху, и список становится таблицей. */
function ColumnHeader() {
  const t = useThemeColors();
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
        flexDirection: "row",
        alignItems: "center",
        gap: COL_GAP,
        paddingHorizontal: TOTAL_GRID.padX,
        paddingTop: 8,
        paddingBottom: 4,
      }}
    >
      <Text style={[cap, { flex: 1 }]}>Услуга</Text>
      <Text style={[cap, { width: COL_QTY, textAlign: "center" }]}>Кол-во</Text>
      {/* Без знака валюты: «Сумма, €» переносилось на вторую строку и рвало
          шапку, а лист и так весь про деньги одной валюты. */}
      <Text style={[cap, { width: COL_PRICE, textAlign: "right" }]}>Цена</Text>
      <Text style={[cap, { width: COL_SUM, textAlign: "right" }]}>Сумма</Text>
    </View>
  );
}

function ServiceLine({
  line,
  separated,
  onQtyChange,
  onPriceChange,
}: {
  line: ServicesBlockLine;
  /** Не первая строка списка — волосок сверху. */
  separated?: boolean;
  onQtyChange: (lineId: string, qty: number) => void;
  onPriceChange: (lineId: string, price: number) => void;
}) {
  const name = line.name;
  const t = useThemeColors();
  // ЧЕРНОВИКИ — СВОИ У КАЖДОГО ПОЛЯ. Пока набирают «13», строка не должна
  // превращаться в «€13» и терять то, что человек ещё не дописал; число уходит
  // в запись на каждый символ, а показывает поле набранное.
  const [unitDraft, setUnitDraft] = useState<string | null>(null);
  const [totalDraft, setTotalDraft] = useState<string | null>(null);
  const unitShown = unitDraft ?? String(Number(line.pricePerUnit.toFixed(2)));
  const totalShown = totalDraft ?? String(Number(line.total.toFixed(2)));

  // ОДНА СТРОКА НА УСЛУГУ, ЧЕТЫРЕ КОЛОНКИ. Было две строки: во второй стояли
  // цветная точка услуги и её длительность — и то и другое здесь лишнее
  // (владелец 2026-09-08: «цвет услуги не нужен»; «полтора часа — на хуя его
  // второй раз дублировать, оно не меняется»). Длительность живёт в строке
  // услуги на самой странице записи и от правки цены не меняется, цвет тут
  // ничего не различает — услуг в списке немного, и каждая названа словом.
  //
  // Имя переносится на вторую строку, а не обрезается: «Заправка фреоном» в
  // 130pt не влезает, а услуга без имени — не услуга.
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: COL_GAP,
        minHeight: 46,
        paddingHorizontal: TOTAL_GRID.padX,
        paddingVertical: 4,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
      }}
    >
      <Text
        numberOfLines={2}
        style={{ flex: 1, fontSize: 15, fontWeight: "600", color: t.ink }}
      >
        {name}
      </Text>
      <QtyStepper
        name={name}
        qty={line.qty}
        onChange={(next) => onQtyChange(line.id, next)}
      />
      {/* ЦЕНА ЗА ОДНУ И СУММА СТРОКИ — ПРАВЯТСЯ ОБЕ (владелец 2026-09-07:
          «в итого редактировать могу либо по количеству за штуку, либо общую
          сумму»). Снимок строки хранит цену за штуку, итог = цена × количество
          в копейках; набранная сумма пересчитывает цену за одну. Прайс
          каталога не трогается. */}
      <MoneyCell
        width={COL_PRICE}
        value={unitShown}
        accessibilityLabel={`Цена за одну: ${name}`}
        onChange={(next) => {
          setUnitDraft(next);
          setTotalDraft(null);
          onPriceChange(line.id, parseMoneyInput(next));
        }}
        onBlur={() => setUnitDraft(null)}
      />
      <MoneyCell
        width={COL_SUM}
        value={totalShown}
        strong
        accessibilityLabel={`Сумма строки: ${name}`}
        onChange={(next) => {
          setTotalDraft(next);
          setUnitDraft(null);
          const total = parseMoneyInput(next);
          const qty = Math.max(1, line.qty);
          onPriceChange(line.id, Math.round((total / qty) * 100) / 100);
        }}
        onBlur={() => setTotalDraft(null)}
      />
    </View>
  );
}

/** Денежное поле колонки. Знака валюты в ячейке нет — он сказан в шапке
 *  колонки один раз; подложка говорит, что число правится. */
function MoneyCell({
  value,
  width,
  strong,
  accessibilityLabel,
  onChange,
  onBlur,
}: {
  value: string;
  width: number;
  /** Сумма работы: крупнее и чернилами — её читают, остальное крутят. */
  strong?: boolean;
  accessibilityLabel: string;
  onChange: (next: string) => void;
  onBlur: () => void;
}) {
  const t = useThemeColors();
  return (
    <TextInput
      keyboardAppearance="light"
      value={value}
      onChangeText={onChange}
      onBlur={onBlur}
      selectTextOnFocus
      keyboardType="decimal-pad"
      placeholder="0"
      placeholderTextColor={t.placeholder}
      accessibilityLabel={accessibilityLabel}
      maxFontSizeMultiplier={1.2}
      style={{
        width,
        height: 34,
        paddingHorizontal: 8,
        borderRadius: t.radius.input,
        backgroundColor: t.fill,
        textAlign: "right",
        fontSize: strong ? 16 : 15,
        fontWeight: "700",
        color: t.ink,
        fontVariant: ["tabular-nums"],
      }}
    />
  );
}

/** Количество — ОДНОЙ ПИЛЮЛЕЙ «− 3 +», а не тремя предметами через всю
 *  строку. Три отдельных кружка, разъехавшихся по ширине карточки, читались
 *  как три разные кнопки; здесь это один орган с числом посередине.
 *
 *  «−» на единице УБИРАЕТ услугу из записи — тот же закон, что в списке услуг
 *  на странице записи (ноль = вычеркнули), поэтому знак не гаснет. */
function QtyStepper({
  name,
  qty,
  onChange,
}: {
  name: string;
  qty: number;
  onChange: (next: number) => void;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        width: COL_QTY,
        height: 34,
        borderRadius: t.radius.input,
        backgroundColor: t.fill,
      }}
    >
      <StepButton
        icon="minus"
        label={qty <= 1 ? `Убрать: ${name}` : `Убавить: ${name}`}
        onPress={() => onChange(qty - 1)}
      />
      <Text
        maxFontSizeMultiplier={1.2}
        style={{
          fontSize: 15,
          fontWeight: "700",
          color: t.ink,
          fontVariant: ["tabular-nums"],
        }}
      >
        {qty}
      </Text>
      <StepButton
        icon="plus"
        label={`Добавить: ${name}`}
        onPress={() => onChange(qty + 1)}
      />
    </View>
  );
}

// Круг 30pt с зоной касания 44pt: в листе, где считают деньги, промах по
// «минусу» стоит дороже, чем лишние пиксели.
//
// ЗНАКИ — ТЕКСТОМ, А НЕ ИКОНКАМИ. Продуктовая политика запрещает `Plus` из
// lucide во всём приложении (`ui-policy-contract`): плюс-иконка означала
// «создать» и уводила от `AddRow`. Здесь это не создание, а арифметика — и
// набирается она теми же знаками, что человек видит на клавиатуре.
function StepButton({
  icon,
  label,
  onPress,
}: {
  icon: "minus" | "plus";
  label: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      hitSlop={7}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Внутри пилюли `QtyStepper`: подложку и радиус даёт она, кнопке
      // остаётся зона касания. Своя заливка рисовала бы круг в круге.
      // Внутри пилюли `QtyStepper`: подложку и радиус даёт она, кнопке
      // остаётся зона касания. Своя заливка рисовала бы круг в круге.
      style={({ pressed }) => ({
        width: 28,
        height: 34,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.5 : 1,
      })}
    >
      <Text
        maxFontSizeMultiplier={1}
        style={{
          fontSize: 18,
          fontWeight: "600",
          color: t.ink,
          lineHeight: 22,
        }}
      >
        {icon === "minus" ? "−" : "+"}
      </Text>
    </Pressable>
  );
}
