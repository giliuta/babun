import type { InvoiceLanguage } from "@/features/invoices/dictionary";

// ЯЗЫК ЧЕКА — ЯЗЫК ЕГО ИНВОЙСА (аудит инвойсов 03.10). Чек с 30.09 выписывают
// только на оплаченный инвойс, а новый инвойс по умолчанию английский:
// клиент получал «INVOICE … Total», а следом «Чек … Получено … VAT 19% в
// сумме». Слова бумаги чека — здесь, по образцу словаря инвойса
// (`invoices/dictionary.ts`); приложение при этом остаётся русским.
export interface ReceiptWords {
  /** Локаль Intl — денег и количеств. */
  locale: string;
  receipt: string;
  date: string;
  service: string;
  qty: string;
  price: string;
  sum: string;
  linesTotal: string;
  received: string;
  discount: string;
  /** «VAT 19% в сумме» / «incl. VAT 19%» — налог изнутри полученного. */
  vatIncluded: (rate: string) => string;
  regNumber: string;
  sellerMissing: string;
  /** Кто заплатил — ярлык клиента на чеке. «Получатель» из словаря
   *  инвойса читался на чеке как «кому выставлен счёт» (019, 04.10). */
  payer: string;
  voided: string;
  linesAria: string;
}

export const RECEIPT_WORDS: Record<InvoiceLanguage, ReceiptWords> = {
  ru: {
    locale: "ru-RU",
    receipt: "Чек",
    date: "Дата",
    service: "Услуга",
    qty: "Кол-во",
    price: "Цена",
    sum: "Сумма",
    linesTotal: "Итого работ",
    received: "Получено",
    discount: "Скидка",
    vatIncluded: (rate) => `VAT${rate ? ` ${rate}` : ""} в сумме`,
    regNumber: "Рег. №",
    sellerMissing: "Продавец не указан",
    payer: "Плательщик",
    voided: "Аннулирован",
    linesAria: "Перечень услуг",
  },
  en: {
    locale: "en-GB",
    receipt: "Receipt",
    date: "Date",
    service: "Description",
    qty: "Qty",
    price: "Price",
    sum: "Amount",
    linesTotal: "Work total",
    received: "Received",
    discount: "Discount",
    vatIncluded: (rate) => `incl. VAT${rate ? ` ${rate}` : ""}`,
    regNumber: "Reg. No",
    sellerMissing: "Seller not set",
    payer: "Received from",
    voided: "Voided",
    linesAria: "Services",
  },
  // ОСТАЛЬНЫЕ ЯЗЫКИ ПРИЛОЖЕНИЯ (2026-10-04): инвойс теперь выписывают на любом
  // из них, а чек говорит языком своего инвойса.
  bg: {
    locale: "bg-BG",
    receipt: "Разписка",
    date: "Дата",
    service: "Услуга",
    qty: "К-во",
    price: "Цена",
    sum: "Сума",
    linesTotal: "Общо за работата",
    received: "Получено",
    discount: "Отстъпка",
    vatIncluded: (rate) => `вкл. VAT${rate ? ` ${rate}` : ""}`,
    regNumber: "Рег. №",
    sellerMissing: "Доставчикът не е посочен",
    payer: "Платец",
    voided: "Анулирана",
    linesAria: "Списък с услуги",
  },
  el: {
    locale: "el-GR",
    receipt: "Απόδειξη",
    date: "Ημερομηνία",
    service: "Υπηρεσία",
    qty: "Ποσ.",
    price: "Τιμή",
    sum: "Αξία",
    linesTotal: "Σύνολο εργασιών",
    received: "Εισπράχθηκε",
    discount: "Έκπτωση",
    vatIncluded: (rate) => `συμπ. VAT${rate ? ` ${rate}` : ""}`,
    regNumber: "Αρ. Εγγραφής",
    sellerMissing: "Δεν έχει οριστεί εκδότης",
    payer: "Πληρωτής",
    voided: "Ακυρωμένη",
    linesAria: "Υπηρεσίες",
  },
  uk: {
    locale: "uk-UA",
    receipt: "Квитанція",
    date: "Дата",
    service: "Послуга",
    qty: "К-сть",
    price: "Ціна",
    sum: "Сума",
    linesTotal: "Разом за роботи",
    received: "Отримано",
    discount: "Знижка",
    vatIncluded: (rate) => `VAT${rate ? ` ${rate}` : ""} у сумі`,
    regNumber: "Реєстр. №",
    sellerMissing: "Продавця не вказано",
    payer: "Платник",
    voided: "Анульовано",
    linesAria: "Перелік послуг",
  },
  de: {
    locale: "de-DE",
    receipt: "Quittung",
    date: "Datum",
    service: "Leistung",
    qty: "Anz.",
    price: "Preis",
    sum: "Betrag",
    linesTotal: "Summe Leistungen",
    received: "Erhalten",
    discount: "Rabatt",
    vatIncluded: (rate) => `inkl. VAT${rate ? ` ${rate}` : ""}`,
    regNumber: "Reg.-Nr.",
    sellerMissing: "Aussteller fehlt",
    payer: "Erhalten von",
    voided: "Ungültig",
    linesAria: "Leistungen",
  },
  es: {
    locale: "es-ES",
    receipt: "Recibo",
    date: "Fecha",
    service: "Servicio",
    qty: "Cant.",
    price: "Precio",
    sum: "Importe",
    linesTotal: "Total de trabajos",
    received: "Recibido",
    discount: "Descuento",
    vatIncluded: (rate) => `VAT${rate ? ` ${rate}` : ""} incl.`,
    regNumber: "N.º reg.",
    sellerMissing: "Emisor no indicado",
    payer: "Recibido de",
    voided: "Anulado",
    linesAria: "Servicios",
  },
};
