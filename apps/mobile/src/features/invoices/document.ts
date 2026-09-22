import type { Client, Location } from "@babun/shared/local/clients";
import {
  invoiceDisplayStatus,
  invoiceLineTotal,
  type InvoiceLedgerWithLines,
  type InvoiceObjectAddressParts,
  type InvoicePaymentLedger,
  type InvoiceSettlement,
} from "@babun/shared/local/finance/invoice-ledger";
import type { Tenant } from "@/features/settings/tenant";
import {
  formatInvoiceDate,
  invoiceVatMode,
} from "./format";
import {
  invoiceDictionary,
  type InvoiceDictionary,
  type InvoiceLanguage,
} from "./dictionary";

// ОДИН ДОКУМЕНТ — ДВА РЕНДЕРА.
//
// Владелец 2026-08-10: «должно быть зеркало инвойса, чтобы можно было сразу
// редактировать и смотреть». Зеркало и PDF обязаны показывать ОДНО И ТО ЖЕ —
// иначе клиент получит не то, что видел человек. Поэтому здесь собирается
// готовый к печати документ (уже отформатированные строки), а рисовать его
// умеют двое: HTML для PDF и экранная «бумага» на React Native.
//
// Почему не WebView: его нет в нативной сборке, а добавление требует пересборки
// приложения. Два рендера из одной модели — честная цена за живой предпросмотр
// сегодня; контрактный тест держит их в согласии.

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
}

export interface DraftDocumentInput extends BaseInput {
  draft: InvoiceDocumentDraft;
  /** ЧЕМ ЧЕРНОВИК ПОДПИШЕТСЯ. Без него превью печатало реквизиты арендатора,
   *  а сервер подписывал выбранным набором (`resolve_company_id`): человек
   *  подтверждал кнопкой одну бумагу, клиент получал другую. */
  company?: InvoiceDraftSeller | null;
  /** Объект, под который выписан счёт: его ТОЧНЫЙ адрес — единственный адрес
   *  получателя на бумаге (владелец 2026-09-22). */
  location?: Location | null;
}

export function buildInvoiceDocument(
  input: IssuedDocumentInput | DraftDocumentInput,
): InvoiceDocument {
  return "draft" in input ? draftDocument(input) : issuedDocument(input);
}

function issuedDocument({
  invoice,
  tenant,
  client,
  settlement,
  payments,
  accountNames,
  businessToday,
  language,
  sellerPreview,
}: IssuedDocumentInput): InvoiceDocument {
  const dict = invoiceDictionary(language);
  const displayStatus = invoiceDisplayStatus(invoice, businessToday, settlement);
  // Превью несохранённой правки сильнее снимка — но только когда его передали
  // (см. `sellerPreview`).
  const seller = sellerPreview
    ? {
        legal_name: sellerPreview.legal_name,
        name: sellerPreview.name,
        display_name: sellerPreview.name,
        address: sellerPreview.business_address,
        business_address: sellerPreview.business_address,
        vat_number: sellerPreview.vat_number,
        reg_number: sellerPreview.reg_number,
        contact_email: sellerPreview.contact_email,
        contact_phone: sellerPreview.contact_phone,
        iban: sellerPreview.iban,
        bank_name: sellerPreview.bank_name,
        logo_url: sellerPreview.logo_url,
      }
    : invoice.seller_snapshot;
  const recipient = invoice.client_snapshot;
  // Снимок — это ВЕСЬ юридический источник, включая поля, намеренно пустые на
  // момент выставления. Дополнять его живым профилем нельзя: переименовали
  // компанию — и старый документ бесшумно переписался бы.
  const sellerName = seller
    ? firstNonEmpty(seller.legal_name, seller.name, seller.display_name)
      || dict.sellerMissing
    : firstNonEmpty(tenant?.legal_name, tenant?.name) || dict.sellerMissing;
  const vatMode = invoiceVatMode(invoice);

  return {
    number: invoice.number,
    draft: false,
    dict,
    // Статус — часть бумаги, значит тоже на её языке. Общий словарь
    // `INVOICE_STATUS_LABELS` остаётся для СПИСКОВ приложения: там русский
    // всегда, потому что списки читает владелец, а не клиент.
    statusLabel: dict[`status_${displayStatus}`],
    // Старый снимок логотипа не знает — печатаем текущий: в тот день его
    // просто не записывали, и это честнее пустой шапки.
    logoUrl: clean(seller?.logo_url) || clean(tenant?.logo_url) || null,
    seller: {
      name: sellerName,
      // ПОРЯДОК — КАК В ШАПКЕ AIRFIX #103 (владелец 2026-09-22): номера, связь,
      // и адрес ПОСЛЕДНИМ, строками — так, как его набрали в реквизитах.
      // РЕГ. НОМЕР ПЕЧАТАЕТ И ЧЕК (`receipt-document.ts`): два документа
      // одной фирмы не имеют права представлять её по-разному.
      lines: compact([
        prefixed(dict.vatNo, seller ? clean(seller.vat_number) : clean(tenant?.vat_number)),
        prefixed(dict.regNumber, seller ? clean(seller.reg_number) : ""),
        seller ? clean(seller.contact_phone) : clean(tenant?.contact_phone),
        seller ? clean(seller.contact_email) : clean(tenant?.contact_email),
        ...addressLines(
          seller
            ? firstNonEmpty(seller.address, seller.business_address)
            : firstNonEmpty(tenant?.business_address, joinParts(tenant?.address, tenant?.city)),
        ),
      ]),
    },
    // ПОЛУЧАТЕЛЬ (владелец 2026-09-22): юрназвание и реквизиты — из карточки
    // клиента, телефона на бумаге нет, адрес — только точный адрес ОБЪЕКТА
    // счёта. Снимок старше объектов (`object` нет вовсе) печатает свой адрес
    // как раньше: выставленный документ не переписывается задним числом.
    client: recipient
      ? {
          name: firstNonEmpty(recipient.legal_name, recipient.full_name)
            || dict.recipientMissing,
          lines: compact([
            prefixed(dict.vatNo, clean(recipient.vat_number)),
            prefixed(dict.regNumber, clean(recipient.reg_number)),
            clean(recipient.email),
            ...(recipient.object === undefined
              ? addressLines(firstNonEmpty(recipient.primary_address, recipient.address))
              : objectAddressLines(recipient.object?.address_parts, dict)),
          ]),
        }
      : clientParty(
          client,
          client?.locations.find((loc) => loc.id === invoice.location_id) ?? null,
          dict,
        ),
    issuedOn: formatInvoiceDate(invoice.issued_on, dict.locale, dict.notSet),
    dueOn: formatInvoiceDate(invoice.due_on, dict.locale, dict.notSet),
    dueOnKnown: !!invoice.due_on,
    issuedShort: shortDate(invoice.issued_on, dict.locale),
    dueShort: invoice.due_on ? shortDate(invoice.due_on, dict.locale) : null,
    currency: invoice.currency,
    // СКИДКА — НЕ УСЛУГА (владелец 2026-09-22: «дискаунт вынести, а не как
    // услугу»). На сервере она строка с отрицательной ценой; на бумаге её
    // строки в таблице нет — она стоит в итогах под «Subtotal».
    lines: invoice.lines.filter((line) => line.unit_price >= 0).map((line) => ({
      title: line.title,
      description: line.description?.trim() || null,
      qty: formatQty(line.qty, line.unit, dict.locale),
      unitPrice: paperMoney(line.unit_price, invoice.currency, dict.locale),
      total: paperMoney(line.total, invoice.currency, dict.locale),
    })),
    totals: totalRows({
      dict,
      currency: invoice.currency,
      subtotalNet: invoice.subtotal_net,
      vatAmount: invoice.vat_amount,
      vatPercent: invoice.vat_percent,
      vatMode,
      total: invoice.total,
      discount: splitDiscount(invoice.lines.map((line) => line.total)),
    }),
    payTo: compact([
      prefixed("IBAN", seller ? clean(seller.iban) : clean(tenant?.iban)),
      prefixed(dict.bank, seller ? clean(seller.bank_name) : clean(tenant?.bank_name)),
    ]),
    settlement: [
      {
        label: dict.paid,
        value: paperMoney(settlement.paid, invoice.currency, dict.locale),
      },
      {
        label: dict.remaining,
        value: paperMoney(settlement.remaining, invoice.currency, dict.locale),
      },
    ],
    payments: payments.map((payment) => {
      const account = payment.account_id ? accountNames?.get(payment.account_id) : undefined;
      const method = methodLabel(dict, payment.payment_method);
      const refund = payment.type === "refund";
      return {
        // ИСТОРИЯ ПЛАТЕЖЕЙ — НА ЯЗЫКЕ БУМАГИ, А НЕ ПРИЛОЖЕНИЯ. Без локали
        // английский счёт печатал «21 июля 2026 г.», «€1 234,50» и «Банк»
        // посреди `Payment` и `Outstanding`.
        date: formatInvoiceDate(payment.occurred_on, dict.locale, dict.notSet),
        title: refund ? dict.refundRow : dict.paymentRow,
        details: [account, method].filter(Boolean).join(" · "),
        amount: `${refund ? "−" : ""}${paperMoney(Math.abs(payment.amount), invoice.currency, dict.locale)}`,
        refund,
      };
    }),
    notes: clean(invoice.notes),
    footer: dict.footer(invoice.number, invoice.currency),
  };
}

/** Способ платежа НА ЯЗЫКЕ БУМАГИ. Общий `paymentMethodLabel` остаётся для
 *  экранов приложения: их читает владелец, и там всегда русский. */
function methodLabel(dict: InvoiceDictionary, method: string | null): string {
  switch (method) {
    case "cash":
      return dict.method_cash;
    case "card":
      return dict.method_card;
    // КЛЮЧ СПОСОБА — `transfer`, А НЕ «bank». Слово глоссария «Банк» стоит на
    // коде `transfer` (`PAYMENT_METHOD_LABEL`), и свой ключ здесь молча
    // превратил бы банковский платёж в «Другое».
    case "transfer":
      return dict.method_bank;
    case null:
    case undefined:
      return "";
    default:
      return dict.method_other;
  }
}

function draftDocument({
  draft,
  tenant,
  client,
  company,
  location,
  language,
}: DraftDocumentInput): InvoiceDocument {
  const dict = invoiceDictionary(language);
  return {
    // НОМЕРА У ЧЕРНОВИКА МОЖЕТ НЕ БЫТЬ ВОВСЕ (предпросмотр ещё грузится или
    // сети нет). Говорим об этом НА ЯЗЫКЕ БУМАГИ: раньше сюда зашивали
    // русскую фразу, и она вставала в английский документ 18-м кеглем.
    number: draft.number || dict.numberPending,
    draft: true,
    dict,
    statusLabel: dict.draft,
    // ПОРЯДОК ТОТ ЖЕ, ЧТО У СЕРВЕРА (`build_seller_snapshot`): логотип и
    // реквизиты берутся у ВЫБРАННОГО набора, арендатор — только запасной.
    // Иначе превью и выставленный документ говорят разное.
    logoUrl: clean(company?.logo_url) || clean(tenant?.logo_url) || null,
    seller: {
      name:
        (company ? firstNonEmpty(company.legal_name, company.name) : "")
        || firstNonEmpty(tenant?.legal_name, tenant?.name)
        || dict.sellerMissing,
      // Порядок — тот же, что у выставленного (см. `issuedDocument`).
      lines: company
        ? compact([
            prefixed(dict.vatNo, clean(company.vat_number)),
            prefixed(dict.regNumber, clean(company.reg_number)),
            firstNonEmpty(company.contact_phone, tenant?.contact_phone),
            firstNonEmpty(company.contact_email, tenant?.contact_email),
            ...addressLines(
              firstNonEmpty(company.business_address, joinParts(tenant?.address, tenant?.city)),
            ),
          ])
        : compact([
            prefixed(dict.vatNo, clean(tenant?.vat_number)),
            clean(tenant?.contact_phone),
            clean(tenant?.contact_email),
            ...addressLines(
              firstNonEmpty(tenant?.business_address, joinParts(tenant?.address, tenant?.city)),
            ),
          ]),
    },
    client: clientParty(client, location ?? null, dict),
    issuedOn: formatInvoiceDate(draft.issuedOn, dict.locale, dict.notSet),
    dueOn: formatInvoiceDate(draft.dueOn, dict.locale, dict.notSet),
    dueOnKnown: !!draft.dueOn,
    issuedShort: shortDate(draft.issuedOn, dict.locale),
    dueShort: draft.dueOn ? shortDate(draft.dueOn, dict.locale) : null,
    currency: draft.currency,
    lines: draft.lines.filter((line) => line.unitPrice >= 0).map((line) => ({
      title: line.title,
      description: line.description?.trim() || null,
      qty: formatQty(line.qty, line.unit, dict.locale),
      unitPrice: paperMoney(line.unitPrice, draft.currency, dict.locale),
      // ОДИН СЧЁТ НА ВЕСЬ ПРОДУКТ: своё `round2(qty * price)` в double
      // печатало в строке 3,01 там, где итог документа (и сервер) говорят
      // 3,02 — на одном экране два разных числа за одну и ту же позицию.
      total: paperMoney(
        invoiceLineTotal(line.qty, line.unitPrice),
        draft.currency,
        dict.locale,
      ),
    })),
    totals: totalRows({
      dict,
      currency: draft.currency,
      subtotalNet: draft.subtotalNet,
      vatAmount: draft.vatAmount,
      vatPercent: draft.vatPercent,
      vatMode: draft.vatMode,
      total: draft.total,
      discount: splitDiscount(
        draft.lines.map((line) => invoiceLineTotal(line.qty, line.unitPrice)),
      ),
    }),
    payTo: compact([
      prefixed("IBAN", company ? clean(company.iban) : clean(tenant?.iban)),
      prefixed(dict.bank, company ? clean(company.bank_name) : clean(tenant?.bank_name)),
    ]),
    // У черновика платить ещё нечего — блок оплаты не печатаем вовсе.
    settlement: [],
    payments: [],
    notes: clean(draft.notes),
    // ПРЕВЬЮ = БУМАГА, КАКОЙ ОНА ВЫЙДЕТ (владелец 2026-09-22 не понял
    // «Draft. Number … will be assigned…»): подвал тот же, что у выставленной.
    footer: draft.number ? dict.footer(draft.number, draft.currency) : dict.numberPending,
  };
}

/** Сумма услуг и скидка документа: скидка — строки с минусом. */
function splitDiscount(lineTotals: readonly number[]): { services: number; amount: number } | null {
  const discount = lineTotals.filter((total) => total < 0).reduce((sum, total) => sum - total, 0);
  if (discount <= 0) return null;
  const services = lineTotals.filter((total) => total >= 0).reduce((sum, total) => sum + total, 0);
  return { services: Math.round(services * 100) / 100, amount: Math.round(discount * 100) / 100 };
}

function totalRows(input: {
  dict: InvoiceDictionary;
  currency: string;
  subtotalNet: number;
  vatAmount: number;
  vatPercent: number;
  vatMode: "off" | "inclusive" | "exclusive";
  total: number;
  discount?: { services: number; amount: number } | null;
}): DocumentTotal[] {
  // СО СКИДКОЙ: «Subtotal» — сумма услуг, «Discount» — минусом, дальше
  // налог и итог, как в «Итого» записи (скидка, потом VAT). Четыре строки,
  // не пять: база налога «сверху» — в строке налога («VAT 19% on €110.00»),
  // владелец 2026-09-22: «очень много разных сумм, человек запутается».
  if (input.discount) {
    const { dict, discount } = input;
    const money = (value: number) => paperMoney(value, input.currency, dict.locale);
    const hasVat = input.vatMode !== "off" && input.vatAmount > 0;
    const vatLabel =
      input.vatMode === "inclusive" ? dict.vatInclusive : dict.vatExclusive;
    return [
      { label: dict.subtotal, value: money(discount.services) },
      { label: dict.discount, value: money(-discount.amount) },
      ...(hasVat
        ? [
            {
              label:
                `${vatLabel} ${formatPercent(input.vatPercent, dict.locale)}` +
                (input.vatMode === "exclusive"
                  ? ` ${dict.vatOn(money(input.subtotalNet))}`
                  : ""),
              value: money(input.vatAmount),
            },
          ]
        : []),
      { label: dict.grandTotal, value: money(input.total), grand: true },
    ];
  }
  // Документ БЕЗ НАЛОГА не должен говорить о налоге дважды («Без НДС» и снова
  // «Без НДС · €0») — это выглядело как ошибка счёта. Строка налога появляется
  // только там, где налог есть.
  if (input.vatMode === "off" || input.vatAmount <= 0) {
    const { dict } = input;
    return [
      {
        label: dict.subtotal,
        value: paperMoney(input.subtotalNet, input.currency, dict.locale),
      },
      {
        label: dict.grandTotal,
        value: paperMoney(input.total, input.currency, dict.locale),
        grand: true,
      },
    ];
  }
  const { dict } = input;
  const vatLabel =
    input.vatMode === "inclusive" ? dict.vatInclusive : dict.vatExclusive;
  return [
    {
      label: dict.netAmount,
      value: paperMoney(input.subtotalNet, input.currency, dict.locale),
    },
    {
      label: `${vatLabel} ${formatPercent(input.vatPercent, dict.locale)}`,
      value: paperMoney(input.vatAmount, input.currency, dict.locale),
    },
    {
      label: dict.grandTotal,
      value: paperMoney(input.total, input.currency, dict.locale),
      grand: true,
    },
  ];
}

/** Получатель черновика — те же правила, что у снимка сервера
 *  (`build_invoice_client_snapshot_with_object`). */
function clientParty(
  client: Client | undefined,
  location: Location | null,
  dict: InvoiceDictionary,
): DocumentParty {
  // Реквизиты клиента заводит карточка клиента (сессия 012); читаем их
  // структурно, чтобы бумага не зависела от того, когда поля лягут в тип.
  const requisites = client as
    | (Client & { legal_name?: string | null; vat_number?: string | null; reg_number?: string | null })
    | undefined;
  return {
    name: firstNonEmpty(requisites?.legal_name, client?.full_name) || dict.recipientMissing,
    lines: compact([
      prefixed(dict.vatNo, clean(requisites?.vat_number)),
      prefixed(dict.regNumber, clean(requisites?.reg_number)),
      clean(client?.email),
      ...objectAddressLines(location?.addressParts ?? null, dict),
    ]),
  };
}

/** ТОЧНЫЙ АДРЕС ОБЪЕКТА строками бумаги: «Makariou 12, Sunny Court» /
 *  «Floor 3, Apt 5» / «Limassol 4000». Без «где» (улицы, комплекса или
 *  города) адреса нет вовсе — как у сервера: «эт. 3, кв. 5» никуда не ведёт. */
export function objectAddressLines(
  parts: InvoiceObjectAddressParts | null | undefined,
  dict: InvoiceDictionary,
): string[] {
  const part = (key: keyof InvoiceObjectAddressParts) => clean(parts?.[key]);
  if (!part("street") && !part("complex") && !part("city")) return [];
  return compact([
    [part("street"), part("complex")].filter(Boolean).join(", "),
    [
      part("entrance") ? dict.addrEntrance(part("entrance")) : "",
      part("floor") ? dict.addrFloor(part("floor")) : "",
      part("apartment") ? dict.addrApartment(part("apartment")) : "",
    ].filter(Boolean).join(", "),
    [part("city"), part("zip")].filter(Boolean).join(" "),
  ]);
}

/** Адрес так, как его набрали: перенос строки в реквизитах — перенос на
 *  бумаге (лист реквизитов это обещает подписью под полем). */
function addressLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** ДЕНЬГИ НА БУМАГЕ — ВСЕГДА С КОПЕЙКАМИ: «€50.00», как на инвойсе AirFix
 *  #103. Экраны приложения печатают «€50» (`formatInvoiceMoney`) — там это
 *  стиль продукта, а в документе клиенту круглая сумма без копеек читается
 *  как незаполненная колонка. */
function paperMoney(value: number, currency = "EUR", locale = "ru-RU"): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** «18/09/2026» для en-GB, «18.09.2026» для ru-RU — как в шапке #103. */
function shortDate(ymd: string | null, locale: string): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function prefixed(label: string, value: string): string {
  return value ? `${label}: ${value}` : "";
}

function compact(values: string[]): string[] {
  return values.filter((value) => value.length > 0);
}

function firstNonEmpty(...values: (string | null | undefined)[]): string {
  for (const value of values) {
    const normalized = clean(value);
    if (normalized) return normalized;
  }
  return "";
}

function joinParts(...values: (string | null | undefined)[]): string {
  return values.map(clean).filter(Boolean).join(", ");
}

function clean(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** «4 м» вместо голого «4» (2026-08-25). Колонка «Кол-во» печатала число без
 *  подписи, и на проде это уже вышло боком: человек вписал метры в НАЗВАНИЕ
 *  позиции — «Трасса, 4 м», — потому что сказать их было больше негде.
 *  Единица берётся из СТРОКИ СЧЁТА, а не из прайса: выставленный документ
 *  заморожен, и смена единицы у услуги через месяц не переписывает бумагу,
 *  которую клиент уже получил. */
export function formatQty(
  value: number,
  unit?: string | null,
  locale = "ru-RU",
): string {
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 3,
  }).format(value);
  const suffix = unit?.trim();
  return suffix ? `${number} ${suffix}` : number;
}

function formatPercent(value: number, locale = "ru-RU"): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)}%`;
}
