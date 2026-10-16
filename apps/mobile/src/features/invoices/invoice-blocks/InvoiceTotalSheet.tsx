import type { InvoiceVatMode } from "@babun/shared/local/finance/invoice-ledger";
import type { TxVatMode } from "@babun/shared/local/finance/vat";
import { TotalSheet, type DiscountKind } from "@/features/appointments/TotalSheet";
import type { EditableInvoiceLine } from "@/lib/paper/format";
import { typedNumber, type InvoiceBlockLine } from "./block-lines";

/** «Итого» of the invoice — the same sheet as the appointment's and receipt's. */
export function InvoiceTotalSheet({
  visible,
  onClose,
  lines,
  blockLines,
  linesSum,
  onAddCustomLine,
  onRemoveLine,
  onLineChange,
  discount,
  vatMode,
  vatRate,
  onVatModeChange,
  onVatRateChange,
}: {
  visible: boolean;
  onClose: () => void;
  lines: readonly EditableInvoiceLine[];
  blockLines: InvoiceBlockLine[];
  /** Сумма строк КАК ЕЁ НАБРАЛ ЧЕЛОВЕК — вход для канона налога. */
  linesSum: number;
  onAddCustomLine: () => void;
  onRemoveLine: (line: EditableInvoiceLine) => void;
  onLineChange: (line: EditableInvoiceLine) => void;
  discount: {
    kind: DiscountKind;
    value: string;
    amount: number;
    onKindChange: (kind: DiscountKind) => void;
    onValueChange: (value: string) => void;
  };
  vatMode: InvoiceVatMode;
  vatRate: number;
  onVatModeChange: (mode: InvoiceVatMode) => void;
  onVatRateChange: (rate: number) => void;
}) {
  const writeNumber = (id: string, field: "qty" | "unitPrice", value: number) => {
    const line = lines.find((item) => item.id === id);
    if (!line) return;
    onLineChange({ ...line, [field]: typedNumber(field, value) });
  };

  // ДЕНЬГИ СЧЁТА — ТА ЖЕ ШТОРКА, ЧТО У ЗАПИСИ И ЧЕКА: скидка (строкой счёта с
  // флагом, миграция 20260922030000) и налог.
  // Налог приходит сюда и возвращается обратно — шторка его не
  // включает сама.
  return (
    <TotalSheet
      visible={visible}
      // СВОЯ СТРОКА БЕЗ НАЗВАНИЯ УХОДИТ САМА (стёрли имя услуги — она удаляется):
      // в услугах остаются только названные.
      onClose={() => {
        for (const line of lines) {
          if (!line.serviceId && !line.title.trim()) onRemoveLine(line);
        }
        onClose();
      }}
      onAddLine={onAddCustomLine}
      onRemoveLine={(id) => {
        const line = lines.find((item) => item.id === id);
        if (line) onRemoveLine(line);
      }}
      onNameChange={(id, title) => {
        const line = lines.find((item) => item.id === id);
        if (line) onLineChange({ ...line, title });
      }}
      lines={blockLines}
      onQtyChange={(id, qty) => writeNumber(id, "qty", qty)}
      onPriceChange={(id, price) => writeNumber(id, "unitPrice", price)}
      // СЫРАЯ СУММА СТРОК, А НЕ НЕТТО. `applyTxVat` внутри шторки
      // трактует вход как «то, что человек набрал руками»: при «налог
      // сверху» это нетто, при «налог в цене» — уже брутто. Нетто из
      // `calculateInvoiceTotals` в режиме «в цене» уже очищено от налога, и
      // шторка снимала его ВТОРОЙ раз: счёт на €119 показывал «К оплате
      // €99,99». Чек передаёт сюда ровно так же — сырую сумму.
      // После скидки: так шторка считает свою строку скидки (сумма строк −
      // это число) и налог — с суммы после скидки, как запись и сервер.
      total={Math.max(0, linesSum - discount.amount)}
      discount={{
        kind: discount.kind,
        value: discount.value,
        onKindChange: discount.onKindChange,
        onValueChange: discount.onValueChange,
      }}
      vat={{
        // «off» у счёта и «none» у операции — одно и то же слово на двух
        // диалектах; канон считает налог по `TxVatMode`.
        mode: vatMode === "off" ? "none" : vatMode,
        rate: vatRate,
        onModeChange: (next: TxVatMode) =>
          onVatModeChange(next === "none" ? "off" : next),
        onRateChange: onVatRateChange,
      }}
    />
  );
}
