/**
 * ЯЗЫК ДОКУМЕНТА — НЕ ЯЗЫК ПРИЛОЖЕНИЯ.
 *
 * Владелец 2026-08-25: «мне нужен инвойс на английском». Кипр — это местные
 * клиенты и иностранные вперемешку, и счёт первым же выездом уходит тому и
 * другому. Приложение при этом остаётся русским: переключается ТОЛЬКО бумага,
 * которую видит клиент.
 *
 * Один словарь на оба рендера. Подписи документа лежали в трёх местах —
 * `document.ts` считал итоги со словами внутри, `InvoicePaper.tsx` рисовал
 * свои заголовки, `pdf.ts` печатал третьи, — и перевести это, не собрав в
 * одно место, значило бы получить счёт, где половина слов по-английски.
 *
 * Валюту и числа Intl форматирует сам по локали: «80,00 €» против «€80.00».
 */
export type InvoiceLanguage = "ru" | "en";

export interface InvoiceDictionary {
  /** Локаль для Intl — дат и денег. */
  locale: string;
  invoice: string;
  draft: string;
  seller: string;
  recipient: string;
  sellerMissing: string;
  recipientMissing: string;
  issuedOn: string;
  dueOn: string;
  notSet: string;
  lineTitle: string;
  qty: string;
  price: string;
  amount: string;
  untitled: string;
  subtotal: string;
  vatInclusive: string;
  vatExclusive: string;
  netAmount: string;
  vatOf: (percent: string) => string;
  grandTotal: string;
  payTo: string;
  bank: string;
  payment: string;
  status: string;
  paid: string;
  remaining: string;
  paymentRow: string;
  refundRow: string;
  notes: string;
  draftFooter: (number: string) => string;
  /** Только в PDF: шапка-эйбрау, заголовки таблицы платежей и пустое её
   *  состояние. На экранной бумаге этого блока нет. */
  invoiceEyebrow: string;
  paymentsDate: string;
  paymentsOperation: string;
  paymentsEmpty: string;
  linesTableLabel: string;
  paymentsTableLabel: string;
  linesEmpty: string;
  /** Статус выставленного документа — на бумаге он тоже на её языке. */
  status_issued: string;
  status_partial: string;
  status_overdue: string;
  status_paid: string;
  status_void: string;
  status_cancelled: string;
}

const RU: InvoiceDictionary = {
  locale: "ru-RU",
  invoice: "ИНВОЙС",
  draft: "Черновик",
  seller: "Продавец",
  recipient: "Получатель",
  sellerMissing: "Продавец не указан",
  recipientMissing: "Получатель не указан",
  issuedOn: "Дата выставления",
  dueOn: "Оплатить до",
  notSet: "Не указан",
  lineTitle: "Название",
  qty: "Кол-во",
  price: "Цена",
  amount: "Сумма",
  untitled: "Без названия",
  subtotal: "Сумма",
  vatInclusive: "НДС включён в цены",
  vatExclusive: "НДС начислен сверху",
  netAmount: "Без НДС",
  vatOf: (percent) => `НДС · ${percent}`,
  grandTotal: "К оплате",
  payTo: "Реквизиты для оплаты",
  bank: "Банк",
  payment: "Оплата",
  status: "Статус",
  paid: "Оплачено",
  remaining: "Остаток",
  paymentRow: "Платёж",
  refundRow: "Возврат",
  notes: "Комментарий",
  draftFooter: (number) =>
    `Черновик. Номер ${number} закрепится за документом при выставлении.`,
  invoiceEyebrow: "Инвойс",
  paymentsDate: "Дата",
  paymentsOperation: "Операция",
  paymentsEmpty: "Подтверждённых операций оплаты пока нет.",
  linesTableLabel: "Позиции инвойса",
  paymentsTableLabel: "История платежей",
  linesEmpty: "Позиции пока не заполнены.",
  status_issued: "Выставлен",
  status_partial: "Частично оплачен",
  status_overdue: "Просрочен",
  status_paid: "Оплачен",
  status_void: "Аннулирован",
  status_cancelled: "Отменён",
};

const EN: InvoiceDictionary = {
  // en-GB, а не en-US: дата «25 August 2026» и день перед месяцем — то, что
  // читают на Кипре и в ЕС. Американский «August 25, 2026» здесь выглядит
  // чужим документом.
  locale: "en-GB",
  invoice: "INVOICE",
  draft: "Draft",
  seller: "From",
  recipient: "Bill to",
  sellerMissing: "Seller not set",
  recipientMissing: "Recipient not set",
  issuedOn: "Issue date",
  dueOn: "Due date",
  notSet: "Not set",
  lineTitle: "Description",
  qty: "Qty",
  price: "Price",
  amount: "Amount",
  untitled: "Untitled",
  subtotal: "Subtotal",
  vatInclusive: "VAT included in prices",
  vatExclusive: "VAT added on top",
  netAmount: "Net amount",
  vatOf: (percent) => `VAT · ${percent}`,
  grandTotal: "Total due",
  payTo: "Payment details",
  bank: "Bank",
  payment: "Payment",
  status: "Status",
  paid: "Paid",
  remaining: "Outstanding",
  paymentRow: "Payment",
  refundRow: "Refund",
  notes: "Notes",
  draftFooter: (number) =>
    `Draft. Number ${number} will be assigned when the invoice is issued.`,
  invoiceEyebrow: "Invoice",
  paymentsDate: "Date",
  paymentsOperation: "Operation",
  paymentsEmpty: "No confirmed payments yet.",
  linesTableLabel: "Invoice lines",
  paymentsTableLabel: "Payment history",
  linesEmpty: "No lines yet.",
  status_issued: "Issued",
  status_partial: "Partially paid",
  status_overdue: "Overdue",
  status_paid: "Paid",
  status_void: "Voided",
  status_cancelled: "Cancelled",
};

export function invoiceDictionary(
  language: InvoiceLanguage | string | null | undefined,
): InvoiceDictionary {
  return language === "en" ? EN : RU;
}

/** «Русский» / «English» — как язык называют в переключателе на документе. */
export const INVOICE_LANGUAGE_LABEL: Record<InvoiceLanguage, string> = {
  ru: "Русский",
  en: "English",
};
