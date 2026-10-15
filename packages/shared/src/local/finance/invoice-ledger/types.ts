// Row shapes of the server-issued invoice ledger (public.invoices).

/** `cancelled` — сторнирован кредит-нотой; `void` остаётся
 *  легаси-статусом «внутренне аннулирован» и не переиспользуется:
 *  «удалили по ошибке» и «сторнировали документом» — разные события. */
export type InvoiceStatus = "issued" | "paid" | "void" | "cancelled";
export type InvoiceDisplayStatus = InvoiceStatus | "partial" | "overdue";
export type InvoiceVatMode = "off" | "inclusive" | "exclusive";
/** Бумага бывает двух видов: сам счёт и сторно к нему. Кредит-нота живёт в той
 *  же таблице и несёт заявку и клиента своего инвойса — поэтому витрины обязаны
 *  различать их по виду, а не по сумме. */
export type InvoiceKind = "invoice" | "credit_note";

export interface InvoiceLineDraft {
  title: string;
  qty: number;
  unit_price: number;
  /** Что входит в работу — печатается второй строкой под названием позиции.
   *  Приезжает из описания услуги и дальше живёт СВОЕЙ жизнью: правка в счёте
   *  прайс не трогает, а документ помнит свою формулировку. */
  description?: string | null;
  /** Единица количества на бумаге: «4 м». Приезжает из услуги и дальше живёт
   *  СВОЕЙ жизнью — как и описание: правка в счёте прайс не трогает. */
  unit?: string | null;
  /** СКИДКА ДОКУМЕНТА — одна строка: количество 1, цена меньше нуля
   *  (скидка, как в записи). Сервер
   *  принимает отрицательную цену только с этим флагом. */
  discount?: boolean;
}

export interface InvoiceTotals {
  subtotal_net: number;
  vat_amount: number;
  total: number;
}

export interface InvoicePaymentLedger {
  id: string;
  invoice_id: string;
  type: "income" | "refund";
  amount: number;
  account_id: string | null;
  payment_method: string | null;
  occurred_on: string;
  refund_of_id: string | null;
  notes: string | null;
  created_at: string;
  source?: string;
  appointment_payment_kind?: string | null;
}

export type InvoicePaymentRefundDestination = "invoice" | "appointment" | null;

export interface InvoiceSettlement {
  /** К оплате по инвойсу: сумма минус уже сторнированное частичными
   *  кредит-нотами. Без нот — сама сумма. Необязательное в типе:
   *  собранные руками расчёты (тесты бумаги) его не несут. */
  due?: number;
  income: number;
  refunded: number;
  paid: number;
  remaining: number;
  overpaid: number;
  isPartial: boolean;
  isPaid: boolean;
}

/** Immutable legal party copied by the database when the invoice is issued. */
export interface InvoiceSellerSnapshot {
  schema_version: number;
  tenant_id: string | null;
  name: string | null;
  display_name: string | null;
  legal_name: string | null;
  vat_number: string | null;
  /** Регистрационный номер юрлица. Его печатают и чек, и инвойс: два документа одной фирмы не имеют права представлять
   *  её по-разному. `null` у документов, выписанных до справочника
   *  реквизитов — тогда его просто не записывали. */
  reg_number?: string | null;
  business_address: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  iban: string | null;
  bank_name: string | null;
  /** Логотип на момент выставления. null у документов, выписанных до того,
   *  как логотип начали печатать. */
  logo_url?: string | null;
  currency: string | null;
}

/** Immutable recipient copied by the database, including archive state then. */
export interface InvoiceClientSnapshot {
  schema_version: number;
  client_id: string | null;
  full_name: string | null;
  phone: string | null;
  phone_e164: string | null;
  whatsapp_phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  primary_address: string | null;
  /** Реквизиты клиента — из его карточки («Информация о клиенте»).
   *  Необязательные: фикстуры, написанные до их разбора, их не знают. */
  legal_name?: string | null;
  vat_number?: string | null;
  reg_number?: string | null;
  /** Юридический адрес выбранного набора реквизитов — печатается под
   *  юрназванием; адрес объекта идёт отдельно, ниже. */
  billing_address?: string | null;
  /** ОБЪЕКТ СЧЁТА (миграция 20260922060000). `undefined` — снимок старше
   *  объектов; `null` — объект не выбран; адрес на бумагу — только
   *  `address_parts` (точный адрес), иначе адреса нет вовсе. */
  object?: InvoiceObjectSnapshot | null;
  archived: boolean;
  deleted_at: string | null;
}

/** Точный адрес объекта: части, из которых бумага собирает строку. */
export interface InvoiceObjectAddressParts {
  street?: string;
  complex?: string;
  entrance?: string;
  floor?: string;
  apartment?: string;
  city?: string;
  zip?: string;
}

export interface InvoiceObjectSnapshot {
  id: string | null;
  label: string | null;
  address_parts: InvoiceObjectAddressParts | null;
}

export interface InvoiceLedger {
  id: string;
  tenant_id: string;
  number: string; // e.g. "INV-2026-001"
  year: number;
  seq: number;
  issued_on: string; // YYYY-MM-DD
  due_on: string | null;
  client_id: string | null;
  appointment_id: string | null;
  brigade_id: string | null;
  /** Реквизиты, которыми подписан документ (ссылка на `companies`, миграция
   *  20260921000000). Печать всё равно берёт замороженный `seller_snapshot` —
   *  это поле лишь метка «чем подписали»; у счетов до неё стоит `null`.
   *  Необязательное — как `kind` и `vat_mode` выше — по той же причине:
   *  написанные до миграции фикстуры и тесты его не знают. */
  company_id?: string | null;
  /** Счёт, куда клиенту предложено заплатить (ссылка на `accounts`) —
   *  подсказка платежу, а не сам платёж: фактическую оплату несёт
   *  `payment_id`, который проставляет `record_invoice_payment`.
   *  Необязательное по той же причине, что и `company_id` выше. */
  account_id?: string | null;
  /** Объект клиента, под который выписан счёт (миграция 20260922060000). */
  location_id?: string | null;
  /** Набор реквизитов клиента (`'none'` — на имя). Правка счёта поднимает
   *  его в форму, чтобы не сбросить на основной. */
  client_requisites_id?: string | null;
  subtotal_net: number;
  vat_percent: number;
  vat_amount: number;
  total: number;
  currency: string;
  /** Язык БУМАГИ этого счёта: «ru» | «en». Живёт у документа, а не у
   *  компании: один клиент получает счёт по-английски, следующий по-русски,
   *  и вчерашняя бумага не переписывается от сегодняшней настройки. */
  language: string;
  status: InvoiceStatus;
  /** Вид документа. Необязательное поле: офлайн-фикстуры, написанные до того,
   *  как колонку начали маппить, его не знают, и отсутствие значит «инвойс». */
  kind?: InvoiceKind;
  /** Инвойс, который сторнирует эта кредит-нота. */
  credit_note_of_id?: string | null;
  /** Чек, который сторнирует эта кредит-нота (возврат по чеку без инвойса,
   *  миграция 20261004091731). */
  credit_note_of_receipt_id?: string | null;
  /** Сколько инвойса уже сторнировано частичными кредит-нотами. */
  credited_amount?: number;
  /** Кредит-нота — частичная: инвойс остаётся в силе. */
  credit_partial?: boolean;
  /** Режим НДС, КОТОРЫМ ДОКУМЕНТ ПОСЧИТАН (колонка с 20260915120000): сервер
   *  пишет ровно то, чем считал. У выписанных раньше пусто — их режим
   *  восстанавливают по суммам, а не выдумывают (`invoiceVatMode`). */
  vat_mode?: InvoiceVatMode | null;
  pdf_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  /** Optional in the domain shape so pre-migration offline fixtures still read. */
  seller_snapshot?: InvoiceSellerSnapshot | null;
  client_snapshot?: InvoiceClientSnapshot | null;
}

export interface InvoiceLineLedger {
  id: string;
  invoice_id: string;
  position: number;
  title: string;
  description: string | null;
  qty: number;
  /** Единица количества НА БУМАГЕ: «4 м» вместо «4». Хранится у строки, а не
   *  берётся из прайса, — выставленный документ заморожен, и смена единицы у
   *  услуги не переписывает уже отправленный клиенту счёт. */
  unit: string | null;
  unit_price: number;
  total: number;
}

export interface InvoiceLedgerWithLines extends InvoiceLedger {
  lines: InvoiceLineLedger[];
}
