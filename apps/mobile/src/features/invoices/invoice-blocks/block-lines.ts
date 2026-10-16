import { invoiceLineTotal } from "@babun/shared/local/finance/invoice-ledger";
import { parseDecimal, parseMoneyAmount, type EditableInvoiceLine } from "@/lib/paper/format";

export interface InvoiceBlockLine {
  id: string;
  name: string;
  subtitle: string | null;
  qty: number;
  unit: string | null;
  pricePerUnit: number;
  total: number;
  editableName?: string;
}

// ПЕРЕВОД «ПОЗИЦИЯ СЧЁТА → СТРОКА БЛОКА» — ОДИН НА ЭКРАН: его читают и блок
// «Позиции», и шторка «Итого». Числа позиции лежат СТРОКАМИ, пока их правят
// руками (иначе каретка прыгает в конец), и разбираются здесь — в одном
// месте, теми же функциями, которыми их разберёт отправка на сервер.
export function invoiceBlockLines(lines: readonly EditableInvoiceLine[]): InvoiceBlockLine[] {
  return lines.map((line) => {
    const qty = parseDecimal(line.qty) ?? 0;
    const price = parseMoneyAmount(line.unitPrice) ?? 0;
    return {
      id: line.id,
      name: line.title.trim() || "Услуга",
      // Вторая строка у позиции — что входит в работу, а не длительность:
      // у счёта нет минут.
      subtitle: line.description?.trim() || null,
      qty,
      unit: line.unit ?? null,
      pricePerUnit: price,
      // ОДИН СЧЁТ НА ВЕСЬ ПРОДУКТ (`invoiceLineTotal`): своё
      // `round(qty * price * 100) / 100` в double печатало в карточке
      // позиции €3,01 там, где бумага, PDF и сервер считают €3,02.
      total: invoiceLineTotal(qty, price),
      // Своя строка: имя правится в «Итого».
      ...(line.serviceId ? {} : { editableName: line.title }),
    };
  });
}

/** Правка числа возвращается в позицию СТРОКОЙ — той же, какую набрал бы
 *  человек: у позиции числа хранятся текстом, и превращать их в `1.0000001`
 *  на обратном пути нельзя. */
export function typedNumber(field: "qty" | "unitPrice", value: number): string {
  return String(Number(value.toFixed(field === "qty" ? 3 : 2)));
}

// ВЫБОР УСЛУГ — ТОТ ЖЕ, ЧТО В ЗАПИСИ: в другом нельзя выбрать количество.
// Выбор знает услугу по id: строка инвойса помнит, из какой
// она услуги (`serviceId`), и количество правится степпером прямо в списке.
export function serviceSelection(lines: readonly EditableInvoiceLine[]): {
  selectedServiceIds: string[];
  quantities: Record<string, number>;
} {
  const serviceLines = lines.filter((line) => line.serviceId);
  const selectedServiceIds = serviceLines.map((line) => line.serviceId as string);
  const quantities = Object.fromEntries(
    serviceLines.map((line) => [line.serviceId as string, parseDecimal(line.qty) ?? 1]),
  );
  return { selectedServiceIds, quantities };
}
