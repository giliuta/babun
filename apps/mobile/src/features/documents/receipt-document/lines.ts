import type { Appointment } from "@babun/shared/local/appointments";
import {
  invoiceLineTotal,
  type InvoiceLineLedger,
} from "@babun/shared/local/finance/invoice-ledger";
import {
  generateInvoiceFromAppointment,
  INVOICE_GENERATOR_DEFAULTS,
  type ServiceNameLookup,
} from "@babun/shared/local/finance/invoice-generator";

// Receipt line items: their input shape and the two sources that build
// them (an issued invoice, an appointment snapshot).

export interface ReceiptDocumentLineInput {
  name: string;
  qty: number;
  /** Единица количества: «4 м» вместо голого «4», как в счёте. */
  unit?: string | null;
  unitPrice: number;
  sum: number;
}

export interface ReceiptLineItemsInput {
  lines: readonly ReceiptDocumentLineInput[];
  /** Скидка ОТДЕЛЬНОЙ СТРОКОЙ — только когда цены строк её ЕЩЁ НЕ учитывают.
   *
   *  Единственный такой путь сегодня — чек, составленный вручную: там строки
   *  идут по прайсу, а скидка вычитается из итога. У чека по записи её нет
   *  (генератор уже ужал цены), у чека по инвойсу тоже (инвойс не хранит
   *  скидку отдельно от цены строки). Передать её там, где она уже в ценах,
   *  значит вычесть дважды — аудит бумаги 2026-09-20 поймал ровно это. */
  discountAmount?: number;
}

/**
 * Перечень печатается ТОЛЬКО когда чек закрывает источник ПОЛНОСТЬЮ.
 *
 * И у инвойса, и у записи в проводке может быть НЕСКОЛЬКО чеков — оплата
 * частями рождает свой чек на каждую проводку дохода
 * (`issue_receipt_for_income` срабатывает на КАЖДУЮ из них). Напечатать на
 * чеке частичного платежа ПОЛНЫЙ перечень работ значило бы соврать: «Итого
 * работ €250» рядом с «Получено €100» без единого слова об остатке. Здесь —
 * простое и безопасное правило: суммы совпали до цента → перечень
 * печатается; нет → чек остаётся таким, как сегодня, без строк.
 */
export function receiptCoversFullAmount(
  receiptAmount: number,
  sourceTotal: number,
): boolean {
  return Math.round(receiptAmount * 100) === Math.round(sourceTotal * 100);
}

/**
 * Строки чека из УЖЕ ВЫСТАВЛЕННОГО инвойса.
 *
 * Суммы берутся ГОТОВЫМИ (`line.total`) — инвойс сверил их с сервером в
 * момент выставления (`assertInvoiceControlRead`), пересчитывать здесь ещё
 * раз нечего.
 */
export function receiptLinesFromInvoice(
  lines: readonly Pick<InvoiceLineLedger, "title" | "qty" | "unit" | "unit_price" | "total">[],
): ReceiptLineItemsInput {
  return {
    lines: lines.map((line) => ({
      name: line.title,
      qty: line.qty,
      unit: line.unit,
      unitPrice: line.unit_price,
      sum: line.total,
    })),
  };
}

/** Каталог здесь не спрашиваем: у записей после 2026-08-25 имя и единица уже
 *  лежат в снимке услуги (`AppointmentService.serviceName`/`unit`), а у более
 *  старых чек печатает дефолтную строку генератора — та же деградация, что и
 *  у счёта по такой же записи. Второй поход в справочник не добавил бы новых
 *  данных, а только завёл бы лишний запрос там, где чек уже открыт. */
const NO_CATALOG_FALLBACK: ServiceNameLookup = () => undefined;

/**
 * Строки чека из СНИМКА УСЛУГ ЗАПИСИ — тем же генератором, что печатает счёт
 * по этой записи (`generateInvoiceFromAppointment`): одна и та же работа не
 * имеет права печататься разным перечнем в счёте и в чеке.
 *
 * РЕЖИМ ЗАФИКСИРОВАН НА «УСЛУГИ» (решение разработчика 2026-09-20): чек обязан
 * перечислять работы всегда, даже если компания настроила свои счета одной
 * строкой (`tenants.invoice_line_source = 'total'`) — это два разных
 * документа с разной целью, и настройка ОДНОГО не разоружает перечень в другом.
 */
export function receiptLinesFromAppointment(
  appointment: Appointment,
): ReceiptLineItemsInput {
  const draft = generateInvoiceFromAppointment(
    appointment,
    { ...INVOICE_GENERATOR_DEFAULTS, lineSource: "services" },
    NO_CATALOG_FALLBACK,
  );
  return {
    // `unit` НОРМАЛИЗУЕТСЯ ДО `null` (генератор его местами вовсе не кладёт в
    // объект — «одна строка» без услуг обходится без него, и `line.unit`
    // читался бы как `undefined`): у поля документа должно быть ровно два
    // состояния, «есть строка» и «нет», а не три с невидимой разницей.
    lines: draft.lines.map((line) => ({
      name: line.title,
      qty: line.qty,
      unit: line.unit ?? null,
      unitPrice: line.unitPrice,
      sum: invoiceLineTotal(line.qty, line.unitPrice),
    })),
    // СКИДКИ ЗДЕСЬ НЕТ, И ЭТО НЕ ЗАБЫВЧИВОСТЬ. Генератор масштабирует строки
    // по `total_amount` (`invoice-generator.ts`, `factor = total / gross`) —
    // скидка на визит УЖЕ сидит в ценах строк. Напечатать её ещё и отдельной
    // строкой значит вычесть дважды: работ на €200 со скидкой €20 давали
    // «Итого работ €180 · Скидка −€20 · Получено €180», и клиент, сложив,
    // искал пропавшие двадцать евро. Найдено аудитом бумаги 2026-09-20.
  };
}
