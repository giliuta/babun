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
import { clientSnapshotParty, formatQty } from "@/features/invoices/document";
import { invoiceDictionary } from "@/features/invoices/dictionary";
import { parseInvoiceClientSnapshot } from "@babun/shared/local/finance/invoice-ledger";
import type { InvoiceLanguage } from "@/features/invoices/dictionary";
import { RECEIPT_WORDS, type ReceiptWords } from "./receipt-words";

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
  /** Слова бумаги — на языке документа (`receipt-words.ts`). */
  words: ReceiptWords;
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
  /** ПОЛУЧАТЕЛЬ — КАК В ИНВОЙСЕ (владелец 04.10: «чек — как инвойс… выписать
   *  чек на принятие оплаты именно на этот объект»). Та же вёрстка, что у
   *  инвойса (`clientSnapshotParty`): имя или юрназвание, номера, юрадрес,
   *  адрес объекта. Подпись — словом инвойса на языке бумаги. */
  recipient: { label: string; name: string; lines: string[] } | null;
  /** «Инвойс INV-2026-005» — за какой документ эти деньги (владелец 04.10:
   *  «как понять, что это оплата именно за тот инвойс»). */
  basis: string | null;
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
export interface ReceiptSellerSnapshot {
  name?: string | null;
  address?: string | null;
  vat_number?: string | null;
  reg_number?: string | null;
  iban?: string | null;
  bank_name?: string | null;
}

/** Строки под именем продавца: адрес, налоговый номер, банк. Порядок тот же,
 *  что у инвойса, — два документа одной фирмы не имеют права представлять её
 *  по-разному. Пустые поля не оставляют пустых строк. */
function sellerLines(seller: ReceiptSellerSnapshot | null, words: ReceiptWords): string[] {
  const bank = compact([clean(seller?.bank_name), clean(seller?.iban)]).join(" · ");
  return compact([
    clean(seller?.address),
    clean(seller?.vat_number) ? `VAT ${clean(seller?.vat_number)}` : "",
    clean(seller?.reg_number) ? `${words.regNumber} ${clean(seller?.reg_number)}` : "",
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
  /** Выбранные реквизиты — те же поля, что положит снимок сервера: черновик
   *  не имеет права показывать продавца иначе, чем выписанный чек. */
  seller: ReceiptSellerSnapshot;
  /** Получатель черновика — тем же правилом, что у инвойса. */
  recipient?: { name: string; lines: string[] } | null;
  /** Номер инвойса, за который эти деньги. */
  invoiceNumber?: string | null;
  currency: string;
  /** «ГГГГ-ММ-ДД» — тот же вид, что у `receipts.issued_on`. */
  issuedOn: string;
  lines: readonly ReceiptDocumentLineInput[];
  discountAmount: number;
  vatRate: number;
  vatAmount: number;
  /** Полученные деньги. */
  total: number;
  /** Язык бумаги; по умолчанию русский. */
  language?: InvoiceLanguage;
}): ReceiptDocument {
  const words = RECEIPT_WORDS[input.language ?? "ru"];
  const dict = invoiceDictionary(input.language ?? "ru");
  const money = (value: number) => formatInvoiceMoney(value, input.currency, words.locale);
  return {
    words,
    recipient: input.recipient ? { label: dict.recipient, ...input.recipient } : null,
    basis: clean(input.invoiceNumber) ? dict.footer(clean(input.invoiceNumber), input.currency) : null,
    number: input.numberLabel,
    voidLabel: null,
    seller: {
      name: clean(input.seller.name) || words.sellerMissing,
      lines: sellerLines(input.seller, words),
    },
    issuedOn: formatReceiptDate(input.issuedOn),
    lines: input.lines.map((line) => ({
      name: line.name,
      qty: formatQty(line.qty, line.unit, words.locale),
      unitPrice: money(line.unitPrice),
      sum: money(line.sum),
    })),
    linesTotal:
      input.lines.length > 0
        ? money(round2(input.lines.reduce((sum, line) => sum + line.sum, 0)))
        : null,
    discount:
      input.discountAmount > 0
        ? { label: words.discount, value: `−${money(input.discountAmount)}` }
        : null,
    amount: money(input.total),
    vat:
      input.vatAmount > 0
        ? {
            label: words.vatIncluded(input.vatRate ? `${input.vatRate}%` : ""),
            value: money(input.vatAmount),
          }
        : null,
  };
}

export function buildReceiptDocument(
  receipt: Receipt,
  lineItems?: ReceiptLineItemsInput,
  /** Язык бумаги — язык инвойса, на который выписан чек; нет — русский. */
  language: InvoiceLanguage = "ru",
  /** Номер инвойса, за который эти деньги (его читает лист чека). */
  invoiceNumber?: string | null,
): ReceiptDocument {
  const words = RECEIPT_WORDS[language];
  const dict = invoiceDictionary(language);
  // Снимок получателя: у чеков с 04.10 — как у инвойса; у старых только имя
  // (`name`), их бумага печатает его одно.
  const buyer = receipt.client_snapshot
    ? parseInvoiceClientSnapshot(receipt.client_snapshot)
    : null;
  const buyerName = clean(buyer?.full_name) || clean(receipt.client_snapshot?.name as string | undefined);
  const recipient = buyer && (buyerName || clean(buyer.legal_name))
    ? { label: dict.recipient, ...clientSnapshotParty({ ...buyer, full_name: buyerName }, dict) }
    : null;
  const money = (value: number) => formatInvoiceMoney(value, receipt.currency, words.locale);
  const seller = receipt.seller_snapshot as ReceiptSellerSnapshot | null;
  const dead = receipt.status === "void";
  const rawLines = lineItems?.lines ?? [];
  const lines: ReceiptDocumentLine[] = rawLines.map((line) => ({
    name: line.name,
    qty: formatQty(line.qty, line.unit, words.locale),
    unitPrice: money(line.unitPrice),
    sum: money(line.sum),
  }));
  const discountAmount = lineItems?.discountAmount ?? 0;

  return {
    words,
    recipient,
    basis: clean(invoiceNumber) ? dict.footer(clean(invoiceNumber), receipt.currency) : null,
    number: receipt.number,
    voidLabel: dead ? words.voided : null,
    seller: {
      name: clean(seller?.name) || words.sellerMissing,
      lines: sellerLines(seller, words),
    },
    issuedOn: formatReceiptDate(receipt.issued_on),
    lines,
    linesTotal:
      rawLines.length > 0
        ? money(round2(rawLines.reduce((sum, line) => sum + line.sum, 0)))
        : null,
    discount:
      discountAmount > 0
        ? { label: words.discount, value: `−${money(discountAmount)}` }
        : null,
    amount: money(receipt.amount),
    vat: receipt.vat_amount
      ? {
          // «VAT 19% В СУММЕ» — И ЭТО НЕ ОГОВОРКА БУХГАЛТЕРА, А ЕДИНСТВЕННЫЙ
          // ЧЕСТНЫЙ ВАРИАНТ. Сервер считает налог ВСЕГДА изнутри полученных
          // денег (`fill_transaction_vat`: round(amount*rate/(100+rate))), и
          // голое «VAT 19%» рядом с «Получено €180» читается как налог сверху,
          // который забыли взять: по такой строке сумму не восстановить.
          // Владелец просил короче и без «в т.ч.» — здесь два слова вместо
          // четырёх, но убрать их нельзя: без них документ врёт.
          label: words.vatIncluded(receipt.vat_rate ? `${receipt.vat_rate}%` : ""),
          value: money(receipt.vat_amount),
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
