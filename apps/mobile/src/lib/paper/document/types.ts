// The printable document model and the inputs it is built from.

import type { Client, Location } from "@babun/shared/local/clients";
import type {
  InvoiceLedgerWithLines,
  InvoicePaymentLedger,
  InvoiceSettlement,
} from "@babun/shared/local/finance/invoice-ledger";
import type { Tenant } from "@/session/tenant";
import type { InvoiceDictionary, InvoiceLanguage } from "../dictionary";

export interface DocumentParty {
  name: string;
  lines: string[];
}

export interface DocumentLine {
  title: string;
  /** Что входит в работу — печатается второй строкой под названием. */
  description: string | null;
  qty: string;
  unitPrice: string;
  total: string;
}

export interface DocumentTotal {
  label: string;
  value: string;
  grand?: boolean;
}

export interface DocumentPayment {
  date: string;
  title: string;
  details: string;
  amount: string;
  refund: boolean;
}

export interface InvoiceDocument {
  /** Заголовок бумаги: «INVOICE» или «CREDIT NOTE». */
  title: string;
  /** То же словом для текста сообщения: «Invoice» / «Credit note». */
  eyebrow: string;
  /** Под номером: какой инвойс отменяет кредит-нота; у инвойса — нет. */
  reference: string | null;
  /** Номер документа. У черновика — тот, что получит при выставлении. */
  number: string;
  /** Черновик ещё не выставлен: печатаем это словом, а не выдуманным статусом. */
  draft: boolean;
  statusLabel: string;
  logoUrl: string | null;
  seller: DocumentParty;
  client: DocumentParty;
  issuedOn: string;
  dueOn: string;
  /** ЕСТЬ ЛИ СРОК ВООБЩЕ. `dueOn` строкой пустым НЕ БЫВАЕТ: когда срока нет,
   *  там стоит слово «Не указан» — и проверка `doc.dueOn ? …` в сообщении
   *  клиенту была мертва, поэтому в WhatsApp всегда уходило «Оплатить до:
   *  Не указан». Флаг отвечает на вопрос, на который строка ответить не
   *  может. */
  dueOnKnown: boolean;
  /** Коротко под номером: «18/09/2026» (en-GB) или «18.09.2026». */
  issuedShort: string;
  dueShort: string | null;
  /** Валюта — в шапке колонок таблицы: «Price, EUR», как у AirFix #103. */
  currency: string;
  lines: DocumentLine[];
  totals: DocumentTotal[];
  /** Реквизиты для оплаты — печатаются отдельным блоком под итогом. */
  payTo: string[];
  settlement: { label: string; value: string }[];
  payments: DocumentPayment[];
  notes: string;
  footer: string;
  /** Словарь, которым набран этот документ. Рендеры (экранная бумага и PDF)
   *  берут ВСЕ свои заголовки отсюда: иначе половина счёта осталась бы
   *  по-русски там, где её зашили в разметку. */
  dict: InvoiceDictionary;
}

export interface InvoiceDocumentDraft {
  number: string;
  issuedOn: string;
  dueOn: string | null;
  clientId: string | null;
  lines: readonly {
    title: string;
    qty: number;
    unitPrice: number;
    description?: string | null;
    /** Единица количества: «4 м». `null`/пусто — печатается голое число. */
    unit?: string | null;
  }[];
  vatMode: "off" | "inclusive" | "exclusive";
  vatPercent: number;
  subtotalNet: number;
  vatAmount: number;
  total: number;
  currency: string;
  notes: string;
}

/** Набор реквизитов, которым ПОДПИШЕТСЯ документ. Ровно те поля, что кладёт
 *  в снимок серверная `build_seller_snapshot`, — чтобы черновик показывал то
 *  же, что напечатает выставленный. */
export interface InvoiceDraftSeller {
  name: string;
  legal_name: string | null;
  business_address: string | null;
  vat_number: string | null;
  reg_number: string | null;
  iban: string | null;
  bank_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  logo_url: string | null;
}

interface BaseInput {
  tenant?: Tenant;
  client?: Client;
  /** Язык БУМАГИ, не приложения. Русский по умолчанию. */
  language?: InvoiceLanguage;
}

export interface IssuedDocumentInput extends BaseInput {
  invoice: InvoiceLedgerWithLines;
  settlement: InvoiceSettlement;
  payments: readonly InvoicePaymentLedger[];
  accountNames?: ReadonlyMap<string, string>;
  businessToday?: string;
  /** ТОЛЬКО ПРЕВЬЮ НЕСОХРАНЁННОЙ ПРАВКИ, и больше ничего.
   *
   *  Выставленный документ печатает СВОЙ снимок продавца — он заморожен, и
   *  это главный закон бумаги. Но пока черновик правят, человек может
   *  выбрать другой набор реквизитов: сервер пересоберёт снимок при
   *  сохранении, а зеркало обязано показать то, что получится. Передаёт это
   *  ТОЛЬКО форма правки; витрина `/invoices/[id]` не передаёт ничего и
   *  печатает снимок как есть. */
  sellerPreview?: InvoiceDraftSeller | null;
  /** Документ — КРЕДИТ-НОТА: номер документа, который она отменяет (`null` —
   *  номер ещё не известен). Не передан — это инвойс. `ofReceipt` —
   *  кредит-нота к ЧЕКУ (возврат по чеку без инвойса): номер — чека, шапка
   *  и строка таблицы говорят о чеке, а не об инвойсе. */
  creditNote?: { originalNumber: string | null; ofReceipt?: boolean } | null;
}

export interface DraftDocumentInput extends BaseInput {
  draft: InvoiceDocumentDraft;
  /** ЧЕМ ЧЕРНОВИК ПОДПИШЕТСЯ. Без него превью печатало реквизиты арендатора,
   *  а сервер подписывал выбранным набором (`resolve_company_id`): человек
   *  подтверждал кнопкой одну бумагу, клиент получал другую. */
  company?: InvoiceDraftSeller | null;
  /** Объект, под который выписан счёт: его ТОЧНЫЙ адрес — единственный адрес
   *  получателя на бумаге. */
  location?: Location | null;
}
