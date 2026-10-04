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
//
// С 2026-10-04 БУМАГА ГОВОРИТ НА ЛЮБОМ ЯЗЫКЕ ПРИЛОЖЕНИЯ (владелец: «выбор языка
// в инвойсе… я могу выбирать язык соответственно тому, что я выберу»). Список
// языков один на продукт — `UI_LOCALES`; русский и английский словари здесь,
// остальные — в `paper-languages.ts`.
import type { UiLocale } from "@babun/shared/i18n/locales";
import { BG, DE, EL, ES, UK } from "./paper-languages";

export type InvoiceLanguage = UiLocale;

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
  /** Скидка — строкой итогов, а не услугой в таблице (владелец 2026-09-22). */
  discount: string;
  /** База налога прямо в его строке: «VAT 19% on €110.00» — отдельная
   *  строка «сумма после скидки» делала итоги лестницей из пяти сумм. */
  vatOn: (amount: string) => string;
  vatOf: (percent: string) => string;
  grandTotal: string;
  /** Регистрационный номер юрлица в строках продавца — как у чека. */
  regNumber: string;
  /** Подпись VAT-номера в строках сторон («VAT No.: 60184450X»). */
  vatNo: string;
  /** Части точного адреса объекта на бумаге: «Floor 3» / «эт. 3». */
  addrEntrance: (value: string) => string;
  addrFloor: (value: string) => string;
  addrApartment: (value: string) => string;
  /** Даты под номером в шапке, коротко — как у AirFix #103: «Issued 18/09/2026». */
  issuedShort: (date: string) => string;
  dueShort: (date: string) => string;
  /** Шапка блока внизу бумаги (владелец 03.10: «просто слово „Примечание“»). */
  notesTitle: string;
  /** Номер черновику ещё не выдан: настоящий рождается на сервере в момент
   *  выставления, и показать угаданный значит однажды показать не тот. */
  numberPending: string;
  /** Подпись под реквизитами для оплаты. Жила зашитой по-русски В ДВУХ
   *  рендерах сразу, и английский счёт просил «указать в назначении
   *  платежа» русскими словами. */
  paymentPurpose: (number: string) => string;
  /** Способ платежа в истории оплат: он приходит кодом, а печатается на
   *  языке документа. До этого печатался словарём приложения — в английском
   *  счёте стояло «Банк». */
  method_cash: string;
  method_card: string;
  method_bank: string;
  method_other: string;
  /** Подвал выставленного документа. Был зашит по-русски и печатался
   *  последней строкой английского счёта. */
  footer: (number: string, currency: string) => string;
  payTo: string;
  bank: string;
  payment: string;
  status: string;
  paid: string;
  remaining: string;
  paymentRow: string;
  refundRow: string;
  notes: string;
  /** Только в PDF: шапка-эйбрау, заголовки таблицы платежей и пустое её
   *  состояние. На экранной бумаге этого блока нет. */
  invoiceEyebrow: string;
  /** КРЕДИТ-НОТА — СВОЙ ДОКУМЕНТ (аудит 03.10): печаталась «INVOICE» с
   *  «No lines yet» и без ссылки на отменённый инвойс. */
  creditNote: string;
  creditNoteEyebrow: string;
  /** Под номером: какой инвойс она отменяет. */
  creditNoteFor: (number: string) => string;
  /** Строка таблицы: сервер позиций сторно не пишет, сумма — одна строка. */
  creditNoteLine: (number: string | null) => string;
  creditNoteFooter: (number: string) => string;
  /** Итог кредит-ноты: платить по ней нечего, «К оплате» на ней лжёт
   *  (019, 04.10). Нейтральное «Итого» — верно и для оплаченного счёта
   *  (деньги вернут), и для неоплаченного (долг снят). */
  creditNoteTotal: string;
  /** Кредит-нота к ЧЕКУ — возврат по чеку без инвойса (019, 04.10,
   *  `refund_receipt`): шапка «К чеку RC-…» и строка таблицы. */
  creditNoteForReceipt: (number: string) => string;
  creditNoteReceiptLine: (number: string | null) => string;
  /** Частичная кредит-нота (`invoices.credit_partial`, 019, 04.10): инвойс
   *  остаётся в силе, «Отмена инвойса» на ней — неправда. */
  creditNotePartialLine: (number: string | null) => string;
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
  // VAT, А НЕ «НДС» (владелец 2026-09-20: «пиши VAT»). Слово отменяет его же
  // закон от 09.08 и меняется ВЕЗДЕ, где его читает человек: бумага, шторка
  // «Итого», форма операции. Один документ, говорящий на двух языках про один
  // налог, читается как два разных налога.
  // КОРОТКО, КАК НА БУМАГЕ AIRFIX #103 («Tax 19%»), а не фразой: итоги —
  // столбик цифр, и длинная подпись выдавливала сумму (владелец 22.09).
  vatInclusive: "в т.ч. VAT",
  vatExclusive: "VAT",
  netAmount: "Сумма без VAT",
  discount: "Скидка",
  vatOn: (amount) => `с ${amount}`,
  vatOf: (percent) => `VAT · ${percent}`,
  grandTotal: "К оплате",
  regNumber: "Рег. №",
  vatNo: "VAT №",
  addrEntrance: (value) => `подъезд ${value}`,
  addrFloor: (value) => `эт. ${value}`,
  addrApartment: (value) => `кв. ${value}`,
  issuedShort: (date) => `Выставлен ${date}`,
  dueShort: (date) => `Оплатить до ${date}`,
  notesTitle: "Примечание",
  numberPending: "Номер присвоится при выставлении",
  paymentPurpose: (number) => `В назначении платежа укажите номер ${number}.`,
  method_cash: "Наличные",
  method_card: "Карта",
  method_bank: "Банк",
  method_other: "Другое",
  footer: (number) => `Инвойс ${number}`,
  payTo: "Реквизиты для оплаты",
  bank: "Банк",
  payment: "Оплата",
  status: "Статус",
  paid: "Оплачено",
  remaining: "Остаток",
  paymentRow: "Платёж",
  refundRow: "Возврат",
  notes: "Комментарий",
  invoiceEyebrow: "Инвойс",
  creditNote: "КРЕДИТ-НОТА",
  creditNoteEyebrow: "Кредит-нота",
  creditNoteFor: (number) => `К инвойсу ${number}`,
  creditNoteLine: (number) => (number ? `Отмена инвойса ${number}` : "Отмена инвойса"),
  creditNoteFooter: (number) => `Кредит-нота ${number}`,
  creditNoteTotal: "Итого",
  creditNoteForReceipt: (number) => `К чеку ${number}`,
  creditNoteReceiptLine: (number) => (number ? `Возврат по чеку ${number}` : "Возврат по чеку"),
  creditNotePartialLine: (number) =>
    number ? `Частичная отмена инвойса ${number}` : "Частичная отмена инвойса",
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
  vatInclusive: "incl. VAT",
  vatExclusive: "VAT",
  netAmount: "Subtotal",
  discount: "Discount",
  vatOn: (amount) => `on ${amount}`,
  vatOf: (percent) => `VAT · ${percent}`,
  grandTotal: "Total",
  regNumber: "Reg. No",
  vatNo: "VAT No.",
  addrEntrance: (value) => `Entrance ${value}`,
  addrFloor: (value) => `Floor ${value}`,
  addrApartment: (value) => `Apt ${value}`,
  issuedShort: (date) => `Issued ${date}`,
  dueShort: (date) => `Due ${date}`,
  notesTitle: "Notes",
  numberPending: "Number will be assigned on issue",
  paymentPurpose: (number) => `Please quote invoice ${number} as the payment reference.`,
  method_cash: "Cash",
  method_card: "Card",
  method_bank: "Bank transfer",
  method_other: "Other",
  footer: (number) => `Inv. ${number}`,
  payTo: "Payment details",
  bank: "Bank",
  payment: "Payment",
  status: "Status",
  paid: "Paid",
  remaining: "Outstanding",
  paymentRow: "Payment",
  refundRow: "Refund",
  notes: "Notes",
  invoiceEyebrow: "Invoice",
  creditNote: "CREDIT NOTE",
  creditNoteEyebrow: "Credit note",
  creditNoteFor: (number) => `Credits invoice ${number}`,
  creditNoteLine: (number) =>
    number ? `Cancellation of invoice ${number}` : "Cancellation of invoice",
  creditNoteFooter: (number) => `Credit note ${number}`,
  creditNoteTotal: "Total",
  creditNoteForReceipt: (number) => `Credits receipt ${number}`,
  creditNoteReceiptLine: (number) => (number ? `Refund for receipt ${number}` : "Refund for receipt"),
  creditNotePartialLine: (number) =>
    number ? `Partial credit for invoice ${number}` : "Partial credit for invoice",
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

const PAPER: Record<InvoiceLanguage, InvoiceDictionary> = {
  ru: RU,
  en: EN,
  bg: BG,
  el: EL,
  uk: UK,
  de: DE,
  es: ES,
};

/** Словарь бумаги по языку документа. Неизвестный код (строка старше этого
 *  списка) печатается по-русски — как печатался до выбора языка. */
export function invoiceDictionary(
  language: InvoiceLanguage | string | null | undefined,
): InvoiceDictionary {
  return (language && PAPER[language as InvoiceLanguage]) || RU;
}
