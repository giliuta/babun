import { Pressable, Text, View } from "react-native";
import { ListPlus } from "lucide-react-native";
import { PayRow, ServicesRow } from "@/features/appointments/VatLooks";
import type { ServicesBlockLine } from "@/features/appointments/ServicesBlock";
import { applyTxVat, type TxVatMode } from "@babun/shared/local/finance/vat";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { ColumnHeader, ServiceLine } from "./total-sheet/ServiceLine";

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
//
// Таблица строк — в `total-sheet/`.

const SIDE = 20;

export type DiscountKind = "fixed" | "percent";

export function TotalSheet({
  visible,
  onClose,
  lines,
  onQtyChange,
  onPriceChange,
  onAddLine,
  onNameChange,
  onRemoveLine,
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
  /** Значок «добавить строку» справа в шапке — своя строка документа (владелец
   *  2026-09-22: «открываю „Итого“, сверху справа „Добавить“, выбираю и
   *  количество, и всё; при закрытии она сразу в услугах с названием»). Есть
   *  только у инвойса. */
  onAddLine?: () => void;
  /** Имя своей строки (`editableName`) правится прямо в таблице. */
  onNameChange?: (lineId: string, name: string) => void;
  /** Убрать свою строку — свайпом «Удалить» (владелец 2026-09-22). У строк
   *  прайса свой путь: количество в ноль или снятие в выборе услуг. */
  onRemoveLine?: (lineId: string) => void;
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
      headerAction={
        onAddLine ? (
          <Pressable
            onPress={() => {
              haptics.tap();
              onAddLine();
            }}
            accessibilityRole="button"
            accessibilityLabel="Добавить свою услугу"
            hitSlop={10}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            {/* ЗНАЧОК, А НЕ СЛОВО (владелец 22.09: «можно просто значок»).
                «Список с плюсом» — добавить строку в перечень; общий «плюс
                создания» продукт запрещает (ui-policy). */}
            <ListPlus color={t.accent} size={24} strokeWidth={2} />
          </Pressable>
        ) : undefined
      }
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
            <ColumnHeader />
            {lines.map((line, index) => (
              line.editableName !== undefined && onRemoveLine ? (
                <SwipeRow
                  key={line.id}
                  label="Удалить"
                  color={t.danger}
                  onAction={() => onRemoveLine(line.id)}
                  accessibilityLabel={`Удалить услугу ${line.editableName}`.trim()}
                >
                  <ServiceLine
                    line={line}
                    separated={index > 0}
                    onQtyChange={onQtyChange}
                    onPriceChange={onPriceChange}
                    onNameChange={onNameChange}
                  />
                </SwipeRow>
              ) : (
                <ServiceLine
                  key={line.id}
                  line={line}
                  separated={index > 0}
                  onQtyChange={onQtyChange}
                  onPriceChange={onPriceChange}
                  onNameChange={onNameChange}
                />
              )
            ))}
            {/* СУММА РАБОТ И СКИДКА — последняя строка перечня (владелец 20.09:
                «скидку закинуть туда, где надпись „Услуги“, и справа будет
                точная цена»). Справа — цена работ после скидки. */}
            {discount ? (
              <ServicesRow
                discountValue={discount.value}
                onDiscountValueChange={discount.onValueChange}
                percent={discount.kind === "percent"}
                onPercentChange={(next) =>
                  discount.onKindChange(next ? "percent" : "fixed")
                }
                discountAmount={
                  lines.reduce((sum, line) => sum + line.total, 0) - total
                }
                afterDiscount={total}
              />
            ) : null}
          </View>
        ) : (
          <EmptyState title="Услуги ещё не выбраны" />
        )}

        {/* ИТОГ — ПОСЛЕДНЯЯ СТРОКА ЛИСТА. У документа в ней ещё ставка и
            налог, у записи — только сумма и, у старых записей с ручным
            числом, клавиша «По услугам». */}
        <PayRow
          total={shownTotal}
          vat={
            vatControl && money
              ? {
                  mode: vatControl.mode,
                  rate: vatControl.rate,
                  amount: money.vat,
                  onModeChange: vatControl.onModeChange,
                  onRateChange: vatControl.onRateChange,
                }
              : undefined
          }
          action={
            /* «ПО УСЛУГАМ» ОСТАЁТСЯ ТОЛЬКО ДЛЯ ЗАПИСЕЙ СО СТАРОЙ РУЧНОЙ
               СУММОЙ: вписать новую больше нельзя, а вернуть посчитанную —
               можно, иначе такая запись навсегда осталась бы со своим
               числом, не сходящимся со строками. Клавиша ЖИВАЯ: вместе с
               прежней разметкой итога она на полдня уехала под
               `display: "none"` — единственный выход из ручной суммы
               пропал с экрана молча (аудит кода 2026-09-20). */
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
                <Text style={{ fontSize: 13, fontWeight: "600", color: t.accent }}>
                  По услугам
                </Text>
              </Pressable>
            ) : null
          }
        />

      </View>
    </BottomSheet>
  );
}
