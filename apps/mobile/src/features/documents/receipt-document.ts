import type { Appointment } from "@babun/shared/local/appointments";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import {
  invoiceLineTotal,
  type InvoiceLineLedger,
} from "@babun/shared/local/finance/invoice-ledger";
import {
  generateInvoiceFromAppointment,
  INVOICE_GENERATOR_DEFAULTS,
  type ServiceNameLookup,
} from "@babun/shared/local/finance/invoice-generator";
import { formatInvoiceMoney } from "@/features/invoices/format";
import { formatQty } from "@/features/invoices/document";

// ОДИН ДОКУМЕНТ ЧЕКА — ОДНА МОДЕЛЬ ДЛЯ PDF (по образцу invoices/document.ts).
//
// Чек — снимок, а не отчёт: здесь нет ни одного запроса, только то, что уже
// лежит в строке `receipts`. Продавец печатается РОВНО таким, каким был в
// момент выдачи (`seller_snapshot`) — компанию потом переименуют, а выданная
// бумага не изменится. Деньги форматируются той же функцией, что и у инвойса
// (`formatInvoiceMoney`): один документ компании не имеет права печатать евро
// иначе, чем другой. Дата — СВОИМ форматтером (`formatReceiptDate` ниже), не
// `formatInvoiceDate`: у счёта дата словом, у чека — цифрой, это два разных
// документа со своей бумагой.
//
// ВЛАДЕЛЕЦ 2026-09-20: «в чеке должен быть перечень услуг с ценой, по сути
// как инвойс, но не инвойс». Перечень — НЕОБЯЗАТЕЛЬНЫЙ вход: его собирает
// вызывающий (`ReceiptSheet`) через `receiptLinesFromInvoice` или
// `receiptLinesFromAppointment` ниже, а эта функция остаётся чистой — только
// форматирует готовое, без единого запроса внутри.
//
// ТОТ ЖЕ ВЛАДЕЛЕЦ, ТОТ ЖЕ РАЗГОВОР, после показа чека со строками: «клиент
// убираем», «оплата давай не писать», «оплачено тоже давай не писать» — чек
// называет компанию, номер, дату, перечень работ и итог; ни получателя, ни
// способа оплаты, ни позитивного штампа «Оплачено» бумага не несёт. Пометка
// «Аннулирован» — исключение: чек мог погаснуть возвратом, это состояние
// документа, а не декоративный статус, и без неё бумага бы врала.

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

export interface ReceiptDocumentLine {
  name: string;
  qty: string;
  unitPrice: string;
  sum: string;
}

export interface ReceiptDocument {
  number: string;
  /** «Аннулирован» — печатается ТОЛЬКО когда чек погашен возвратом; живой чек
   *  не подписывает себя штампом вовсе (владелец 2026-09-20: «оплачено тоже
   *  давай не писать» — сумма в «Получено» и так очевидна). */
  voidLabel: string | null;
  seller: { name: string; lines: string[] };
  /** Цифрами и полностью — «19.09.2026» (владелец 2026-09-20: «дату оставляем,
   *  только давай дату цифрами полностью сделаем»). Считает `formatReceiptDate`
   *  ниже — не `formatInvoiceDate`, у того дата словом для другого документа. */
  issuedOn: string;
  /** Перечень услуг — пусто, когда источника нет (ручной доход с клиентом)
   *  либо запись/инвойс ещё не подтянулись. PDF и экран рисуют РОВНО этот
   *  список — второго решения «что показать» нигде больше нет. */
  lines: ReceiptDocumentLine[];
  /** Σ lines[].sum, отформатированная. Печатается только когда строки есть —
   *  чек не имеет права спорить сам с собой числом, которого не подтвердил. */
  linesTotal: string | null;
  discount: { label: string; value: string } | null;
  amount: string;
  /** Печатается ТОЛЬКО когда налог есть — документ без НДС не должен
   *  говорить о нём (тот же принцип, что у итогов инвойса). */
  vat: { label: string; value: string } | null;
}

/** Снимок продавца. С 2026-09-20 сервер кладёт в него не только имя и адрес,
 *  но и то, без чего бумагу не примет компания-клиент: номер НДС, банк и счёт
 *  (`_issue_receipt_core`, миграция реквизитов). Читаем ВСЁ, что он кладёт:
 *  поле, которое лежит в документе и не печатается, — это поле, которого для
 *  клиента нет. */
interface ReceiptSellerSnapshot {
  name?: string;
  address?: string;
  vat_number?: string;
  reg_number?: string;
  iban?: string;
  bank_name?: string;
}

/** Строки под именем продавца: адрес, налоговый номер, банк. Порядок тот же,
 *  что у инвойса, — два документа одной фирмы не имеют права представлять её
 *  по-разному. Пустые поля не оставляют пустых строк. */
function sellerLines(seller: ReceiptSellerSnapshot | null): string[] {
  const bank = compact([clean(seller?.bank_name), clean(seller?.iban)]).join(" · ");
  return compact([
    clean(seller?.address),
    clean(seller?.vat_number) ? `VAT ${clean(seller?.vat_number)}` : "",
    clean(seller?.reg_number) ? `Рег. № ${clean(seller?.reg_number)}` : "",
    bank,
  ]);
}

/**
 * ЧЕРНОВИК ЧЕКА — ТА ЖЕ МОДЕЛЬ, ЧТО У ВЫДАННОГО.
 *
 * Составитель (`ReceiptComposer`) рисует бумагу ТЕМ ЖЕ `ReceiptPaper`, что и
 * лист уже выписанного чека: иначе «зеркало документа» (владелец 2026-09-20)
 * стало бы вторым, похожим, но своим — и в день, когда изменится печать,
 * составитель остался бы показывать вчерашнюю бумагу.
 *
 * Строки `receipts` за этим документом ещё нет, поэтому поля приходят
 * россыпью, а не из неё. Номер тоже: его назначит сервер под замком в момент
 * выписки, и предсказывать его здесь нельзя — предсказание разошлось бы с
 * бумагой на руках. Вместо номера составитель передаёт слово.
 */
export function buildDraftReceiptDocument(input: {
  /** Что печатать вместо номера, пока номера нет («Черновик»). */
  numberLabel: string;
  seller: { name: string | null; address: string | null };
  currency: string;
  /** «ГГГГ-ММ-ДД» — тот же вид, что у `receipts.issued_on`. */
  issuedOn: string;
  lines: readonly ReceiptDocumentLineInput[];
  discountAmount: number;
  vatRate: number;
  vatAmount: number;
  /** Полученные деньги. */
  total: number;
}): ReceiptDocument {
  return {
    number: input.numberLabel,
    voidLabel: null,
    seller: {
      name: clean(input.seller.name) || "Продавец не указан",
      lines: compact([clean(input.seller.address)]),
    },
    issuedOn: formatReceiptDate(input.issuedOn),
    lines: input.lines.map((line) => ({
      name: line.name,
      qty: formatQty(line.qty, line.unit),
      unitPrice: formatInvoiceMoney(line.unitPrice, input.currency),
      sum: formatInvoiceMoney(line.sum, input.currency),
    })),
    linesTotal:
      input.lines.length > 0
        ? formatInvoiceMoney(
            round2(input.lines.reduce((sum, line) => sum + line.sum, 0)),
            input.currency,
          )
        : null,
    discount:
      input.discountAmount > 0
        ? {
            label: "Скидка",
            value: `−${formatInvoiceMoney(input.discountAmount, input.currency)}`,
          }
        : null,
    amount: formatInvoiceMoney(input.total, input.currency),
    vat:
      input.vatAmount > 0
        ? {
            label: `VAT${input.vatRate ? ` ${input.vatRate}%` : ""} в сумме`,
            value: formatInvoiceMoney(input.vatAmount, input.currency),
          }
        : null,
  };
}

export function buildReceiptDocument(
  receipt: Receipt,
  lineItems?: ReceiptLineItemsInput,
): ReceiptDocument {
  const seller = receipt.seller_snapshot as ReceiptSellerSnapshot | null;
  const dead = receipt.status === "void";
  const rawLines = lineItems?.lines ?? [];
  const lines: ReceiptDocumentLine[] = rawLines.map((line) => ({
    name: line.name,
    qty: formatQty(line.qty, line.unit),
    unitPrice: formatInvoiceMoney(line.unitPrice, receipt.currency),
    sum: formatInvoiceMoney(line.sum, receipt.currency),
  }));
  const discountAmount = lineItems?.discountAmount ?? 0;

  return {
    number: receipt.number,
    voidLabel: dead ? "Аннулирован" : null,
    seller: {
      name: clean(seller?.name) || "Продавец не указан",
      lines: sellerLines(seller),
    },
    issuedOn: formatReceiptDate(receipt.issued_on),
    lines,
    linesTotal:
      rawLines.length > 0
        ? formatInvoiceMoney(
            round2(rawLines.reduce((sum, line) => sum + line.sum, 0)),
            receipt.currency,
          )
        : null,
    discount:
      discountAmount > 0
        ? {
            label: "Скидка",
            value: `−${formatInvoiceMoney(discountAmount, receipt.currency)}`,
          }
        : null,
    amount: formatInvoiceMoney(receipt.amount, receipt.currency),
    vat: receipt.vat_amount
      ? {
          // «VAT 19% В СУММЕ» — И ЭТО НЕ ОГОВОРКА БУХГАЛТЕРА, А ЕДИНСТВЕННЫЙ
          // ЧЕСТНЫЙ ВАРИАНТ. Сервер считает налог ВСЕГДА изнутри полученных
          // денег (`fill_transaction_vat`: round(amount*rate/(100+rate))), и
          // голое «VAT 19%» рядом с «Получено €180» читается как налог сверху,
          // который забыли взять: по такой строке сумму не восстановить.
          // Владелец просил короче и без «в т.ч.» — здесь два слова вместо
          // четырёх, но убрать их нельзя: без них документ врёт.
          label: `VAT${receipt.vat_rate ? ` ${receipt.vat_rate}%` : ""} в сумме`,
          value: formatInvoiceMoney(receipt.vat_amount, receipt.currency),
        }
      : null,
  };
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

/** Дата чека — цифрами и полностью: «19.09.2026». НЕ `formatInvoiceDate` (тот
 *  печатает словом — «19 сентября 2026 г.» — для инвойса, и трогать его нельзя,
 *  им пользуется другой документ). `issued_on` приходит как «ГГГГ-ММ-ДД» —
 *  разбор покомпонентный, без `new Date(...)`, чтобы не зависеть от часового
 *  пояса устройства. */
function formatReceiptDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return `${dd}.${mm}.${year}`;
}

function clean(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function compact(values: string[]): string[] {
  return values.filter((value) => value.length > 0);
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
