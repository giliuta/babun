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
    voided: "Voided",
    linesAria: "Services",
  },
};
