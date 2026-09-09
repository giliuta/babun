import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ColorDot } from "@/components/ui/picker-fields";
import { durationLabel } from "@/features/services/format";
import { parseMoneyInput } from "@/features/appointments/helpers";
import { formatEURExact } from "@babun/shared/common/utils/money";
import { useMoney } from "@/features/settings/currency";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import type { AppointmentService } from "@babun/shared/local/appointments";

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
  nameFor,
  colorFor,
  onQtyChange,
  onPriceChange,
  servicesTotal,
  discountKind,
  discountValue,
  discountAmount,
  discountReason,
  onDiscountKindChange,
  onDiscountValueChange,
  total,
  customTotal,
  onResetTotal,
}: {
  visible: boolean;
  onClose: () => void;
  lines: readonly AppointmentService[];
  /** Имя строки — снимок записи, а не сегодняшний прайс. */
  nameFor: (line: AppointmentService) => string;
  colorFor: (line: AppointmentService) => string | null;
  onQtyChange: (serviceId: string, qty: number) => void;
  /** Цена ОДНОЙ услуги в этой записи. Прайс не трогается: это снимок строки. */
  onPriceChange: (serviceId: string, price: number) => void;
  servicesTotal: number;
  discountKind: DiscountKind;
  /** Сырой текст поля скидки — разбор живёт у формы. */
  discountValue: string;
  discountAmount: number;
  /** «Постоянный», «VIP» — причина от программы лояльности. */
  discountReason: string | null;
  onDiscountKindChange: (kind: DiscountKind) => void;
  onDiscountValueChange: (value: string) => void;
  total: number;
  /** У записи, сохранённой со «своей» суммой: её можно вернуть к расчёту. */
  customTotal: boolean;
  onResetTotal: () => void;
}) {
  const t = useThemeColors();
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
      <View style={{ paddingHorizontal: SIDE, paddingBottom: 12, gap: 16 }}>
        {lines.length > 0 ? (
          /* ОДНА КАРТОЧКА НА ВЕСЬ СПИСОК, СТРОКИ — ВОЛОСКОМ (владелец
             2026-09-08: «это не одна услуга будет, а там будет чистка, потом
             заправка и так далее — куча услуг, чтоб каждую можно было
             редактировать»). Карточка на каждую услугу читалась как пять
             отдельных предметов: пять подложек, пять зазоров, пять радиусов.
             Работы одной записи — один список, и колонки в нём обязаны стоять
             друг под другом. */
          <View
            style={{
              borderRadius: t.radius.input,
              backgroundColor: t.rowFill,
              overflow: "hidden",
            }}
          >
            {lines.map((line, index) => (
              <ServiceLine
                key={line.serviceId}
                line={line}
                name={nameFor(line)}
                color={colorFor(line)}
                separated={index > 0}
                onQtyChange={onQtyChange}
                onPriceChange={onPriceChange}
              />
            ))}
          </View>
        ) : (
          <EmptyState title="Услуги ещё не выбраны" />
        )}

        {/* СКИДКА — ОДНА СТРОКА, А НЕ ТРИ КЛАВИШИ (владелец 2026-09-04:
            «не блоками „без скидки“ и проценты или евро — сделай маленький
            блок, где это сразу всё выбирается, и там всегда будет ноль; а
            если я напишу скидку, тогда уже выбираю валюту или процент»).
            Клавиша «Без скидки» называла НОРМУ: обычный день работы объявлялся
            выбором. Ноль в поле говорит то же самое молча, а переключатель
            «€ | %» стоит рядом и нужен только тому, кто уже что-то вписал. */}
        {/* КОМПАКТНО — И В ОДНОЙ СТРОКЕ С ИТОГОМ (владелец 2026-09-08:
            «поставим скидку посередине блока „Итого“, или скидку слева в этом
            блоке, а „Итого“ прямо возле суммы»). Своей полосы у скидки больше
            нет вовсе: она стоит слева в блоке итога, а слово «Итого» съехало
            вплотную к сумме — деньги записи читаются одной строкой, слева
            вычет, справа результат. */}
        {/* ИЗ ЧЕГО СЛОЖИЛАСЬ СУММА — строки, читаются сверху вниз.
            «УСЛУГИ» СТОЯТ ТОЛЬКО ПРИ СКИДКЕ (владелец 2026-09-08: «вот это мы
            и так знаем, в „Итого“ всё написано — зачем повторять, услуги это
            не надо»). Без скидки строка печатала то же число, что и «Итого»
            двумя строками ниже: «Услуги €180 / Итого €180». Со скидкой она
            перестаёт быть повтором и становится тем, ИЗ ЧЕГО вычли, — без неё
            «−€20 / Итого €180» не с чем сверить. */}
        <View style={{ gap: 8 }}>
          {discountAmount > 0 ? (
            <>
              <SumRow label="Услуги" value={formatEURExact(servicesTotal)} />
              <SumRow
                label={`Скидка${discountReason ? ` · ${discountReason}` : ""}`}
                value={`−${formatEURExact(discountAmount)}`}
                color={t.success}
              />
            </>
          ) : null}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              minHeight: 56,
              paddingHorizontal: 14,
              borderRadius: t.radius.input,
              backgroundColor: t.rowFill,
            }}
          >
            {/* СКИДКА — ЛЕВЫЙ КРАЙ БЛОКА ИТОГА. Без своей подложки: пилюля
                внутри пилюли читалась бы вторым блоком, а это одна строка.

                ПОДПИСЬ ТА ЖЕ, ЧТО У ИТОГА (владелец 2026-09-08: «сделай
                „Скидка“ таким же словом, как „Итого“ — точно такого же цвета,
                и двоеточие»). Она была тише — 13pt серым, — и строка читалась
                как «мелочь слева, главное справа», хотя слева ввод, а справа
                результат: два имени одного разговора о деньгах записи. */}
            <Text style={{ fontSize: 15, fontWeight: "700", color: t.ink }}>
              Скидка:
            </Text>
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
                minWidth: 40,
                height: 44,
                paddingHorizontal: 2,
                textAlign: "right",
                fontSize: 16,
                fontWeight: "700",
                color: t.ink,
                fontVariant: ["tabular-nums"],
              }}
            />
            <UnitToggle value={discountKind} onChange={onDiscountKindChange} />
            {/* «ПО УСЛУГАМ» ОСТАЁТСЯ ТОЛЬКО ДЛЯ ЗАПИСЕЙ СО СТАРОЙ РУЧНОЙ
                СУММОЙ: вписать новую больше нельзя, а вернуть посчитанную —
                можно, иначе такая запись навсегда осталась бы со своим
                числом, не сходящимся со строками. */}
            {customTotal ? (
              <Pressable
                onPress={() => {
                  haptics.tap();
                  onResetTotal();
                }}
                accessibilityRole="button"
                accessibilityLabel="Вернуть сумму по услугам"
                style={{
                  minHeight: 44,
                  justifyContent: "center",
                  paddingHorizontal: 6,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "600", color: t.accent }}>
                  По услугам
                </Text>
              </Pressable>
            ) : null}
            <View style={{ flex: 1 }} />
            {/* «ИТОГО» ВПЛОТНУЮ К СУММЕ: слово и число — один предмет, и
                читаются вместе, а не через всю строку друг от друга. */}
            <Text style={{ fontSize: 15, fontWeight: "700", color: t.ink }}>
              Итого:
            </Text>
            {/* СУММУ ЗДЕСЬ НЕ ПРАВЯТ (владелец 2026-09-08: «её менять нельзя,
                если что»): это результат — услуги минус скидка. Ручную сумму
                записи больше не вписывают нигде; у старых записей с ней
                остаётся только «По услугам», чтобы вернуть посчитанную. */}
            <Text
              style={{
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
      </View>
    </BottomSheet>
  );
}

/** ОДНА КЛАВИША, А НЕ ДВЕ (владелец 2026-09-06: «евро и проценты — это не
 *  выбор: нажал на евро — стало проценты, нажал на проценты — стало обратно,
 *  причём не евро, а валюта из настроек»). Клавиша показывает текущую единицу
 *  и переворачивается тапом. */
function UnitToggle({
  value,
  onChange,
}: {
  value: DiscountKind;
  onChange: (next: DiscountKind) => void;
}) {
  const t = useThemeColors();
  const { symbol } = useMoney();
  const percent = value === "percent";
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onChange(percent ? "fixed" : "percent");
      }}
      accessibilityRole="button"
      accessibilityLabel={percent ? "Скидка в процентах" : "Скидка в валюте"}
      accessibilityHint={percent ? "Переключить на сумму" : "Переключить на проценты"}
      // 32pt вместо 36 и без своих полей: пилюля сидит внутри маленькой
      // строки, а до 44pt зону касания добирает hitSlop — не размер.
      hitSlop={8}
      style={({ pressed }) => ({
        minWidth: 32,
        height: 32,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: t.radius.input,
        backgroundColor: t.surface,
        boxShadow: t.cardShadow,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ fontSize: 15, fontWeight: "700", color: t.ink }}>
        {percent ? "%" : symbol}
      </Text>
    </Pressable>
  );
}

function SumRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 14,
      }}
    >
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: t.sub }}>
        {label}
      </Text>
      <Text
        style={{
          fontSize: 15,
          fontWeight: "600",
          color: color ?? t.ink,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function ServiceLine({
  line,
  name,
  color,
  separated,
  onQtyChange,
  onPriceChange,
}: {
  line: AppointmentService;
  name: string;
  color: string | null;
  /** Не первая строка списка — волосок сверху. */
  separated?: boolean;
  onQtyChange: (serviceId: string, qty: number) => void;
  onPriceChange: (serviceId: string, price: number) => void;
}) {
  const t = useThemeColors();
  // ЧЕРНОВИКИ — СВОИ У КАЖДОГО ПОЛЯ. Пока набирают «13», строка не должна
  // превращаться в «€13» и терять то, что человек ещё не дописал; число уходит
  // в запись на каждый символ, а показывает поле набранное.
  const [unitDraft, setUnitDraft] = useState<string | null>(null);
  const [totalDraft, setTotalDraft] = useState<string | null>(null);
  const unitShown = unitDraft ?? String(Number(line.pricePerUnit.toFixed(2)));
  const totalShown = totalDraft ?? String(Number(line.totalPrice.toFixed(2)));

  // ЧТО ЧИТАЮТ — НАВЕРХУ, ЧТО КРУТЯТ — ВНИЗУ (владелец 2026-09-08: «сделай
  // этот блок аккуратнее, количество не очень нравится»). Было наоборот:
  // первую строку занимал степпер во всю ширину, а сумма работы пряталась во
  // второй между словами «за шт» и «всего». Слова ушли: цену и количество
  // называет знак «×» между ними, а сумму — её место в колонке справа.
  return (
    <View
      style={{
        paddingHorizontal: 14,
        paddingTop: separated ? 10 : 8,
        paddingBottom: 8,
        gap: 2,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <ColorDot value={color} size={10} />
        <Text
          numberOfLines={1}
          style={{ flex: 1, fontSize: 15, fontWeight: "600", color: t.ink }}
        >
          {name}
        </Text>
        {/* СУММА РАБОТЫ — В КОЛОНКЕ СПРАВА, у всех строк на одной вертикали:
            список читается сверху вниз одним взглядом. Правится тоже здесь. */}
        <MoneyCell
          value={totalShown}
          strong
          accessibilityLabel={`Сумма строки: ${name}`}
          onChange={(next) => {
            setTotalDraft(next);
            setUnitDraft(null);
            const total = parseMoneyInput(next);
            const qty = Math.max(1, line.quantity);
            onPriceChange(line.serviceId, Math.round((total / qty) * 100) / 100);
          }}
          onBlur={() => setTotalDraft(null)}
        />
      </View>

      {/* ЦЕНА ЗА ОДНУ И КОЛИЧЕСТВО — ОДНИМ ВЫРАЖЕНИЕМ «45 € × 3» (владелец
          2026-09-07: «в итого редактировать могу либо по количеству за штуку,
          либо общую сумму»). Снимок строки хранит цену за штуку, итог = цена ×
          количество в копейках; набранная сумма пересчитывает цену за одну.
          Прайс каталога не трогается. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text
          numberOfLines={1}
          style={{ flex: 1, fontSize: 13, color: t.sub }}
        >
          {durationLabel(line.duration)}
        </Text>
        <MoneyCell
          value={unitShown}
          accessibilityLabel={`Цена за одну: ${name}`}
          onChange={(next) => {
            setUnitDraft(next);
            setTotalDraft(null);
            onPriceChange(line.serviceId, parseMoneyInput(next));
          }}
          onBlur={() => setUnitDraft(null)}
        />
        <Text style={{ fontSize: 14, color: t.faint }}>×</Text>
        <QtyStepper
          name={name}
          qty={line.quantity}
          onChange={(next) => onQtyChange(line.serviceId, next)}
        />
      </View>
    </View>
  );
}

/** Денежное поле строки. Подписей «за шт» и «всего» больше нет: цену от суммы
 *  отличает место — цена стоит в выражении «45 € × 3», сумма в колонке
 *  справа. Подложка говорит, что число правится. */
function MoneyCell({
  value,
  strong,
  accessibilityLabel,
  onChange,
  onBlur,
}: {
  value: string;
  /** Сумма работы: крупнее и чернилами — её читают, остальное крутят. */
  strong?: boolean;
  accessibilityLabel: string;
  onChange: (next: string) => void;
  onBlur: () => void;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        height: 32,
        paddingHorizontal: 8,
        borderRadius: t.radius.input,
        backgroundColor: t.fill,
      }}
    >
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
          minWidth: strong ? 46 : 36,
          height: 32,
          textAlign: "right",
          fontSize: strong ? 16 : 15,
          fontWeight: "700",
          color: t.ink,
          fontVariant: ["tabular-nums"],
        }}
      />
      <Text
        maxFontSizeMultiplier={1.2}
        style={{ fontSize: 13, fontWeight: "600", color: t.sub }}
      >
        €
      </Text>
    </View>
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
        height: 32,
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
          minWidth: 20,
          textAlign: "center",
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
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.5 : 1,
      })}
    >
      <Text
        maxFontSizeMultiplier={1}
        style={{ fontSize: 18, fontWeight: "600", color: t.ink, lineHeight: 22 }}
      >
        {icon === "minus" ? "−" : "+"}
      </Text>
    </Pressable>
  );
}
