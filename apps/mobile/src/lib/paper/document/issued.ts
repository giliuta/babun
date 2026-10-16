// An issued invoice or credit note: printed from its frozen snapshots.

import { invoiceDisplayStatus } from "@babun/shared/local/finance/invoice-ledger";
import { invoiceDictionary, type InvoiceDictionary } from "../dictionary";
import { formatInvoiceDate, invoiceVatMode } from "../format";
import { clientParty, clientSnapshotParty } from "./parties";
import {
  addressLines,
  clean,
  compact,
  firstNonEmpty,
  formatQty,
  joinParts,
  paperMoney,
  prefixed,
  shortDate,
} from "./paper-text";
import { splitDiscount, totalRows } from "./totals";
import type { InvoiceDocument, IssuedDocumentInput } from "./types";

export function issuedDocument({
  invoice,
  tenant,
  client,
  settlement,
  payments,
  accountNames,
  businessToday,
  language,
  sellerPreview,
  creditNote,
}: IssuedDocumentInput): InvoiceDocument {
  const dict = invoiceDictionary(language);
  const original = creditNote ? creditNote.originalNumber?.trim() || null : null;
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
    title: creditNote ? dict.creditNote : dict.invoice,
    eyebrow: creditNote ? dict.creditNoteEyebrow : dict.invoiceEyebrow,
    reference: original
      ? creditNote?.ofReceipt
        ? dict.creditNoteForReceipt(original)
        : dict.creditNoteFor(original)
      : null,
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
      // ПОРЯДОК — КАК В ШАПКЕ AIRFIX #103: номера, связь,
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
    // ПОЛУЧАТЕЛЬ: юрназвание и реквизиты — из карточки
    // клиента, телефона на бумаге нет. Адресов два и оба необязательны
    // (юрадрес — на компанию, а объектов у неё много):
    // юридический адрес реквизитов под юрназванием, ниже — точный адрес
    // ОБЪЕКТА счёта. Снимок старше объектов (`object` нет вовсе) печатает
    // свой адрес как раньше: выставленный документ не переписывается
    // задним числом.
    client: recipient
      ? clientSnapshotParty(recipient, dict)
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
    // СКИДКА — НЕ УСЛУГА.
    // На сервере она строка с отрицательной ценой; на бумаге её
    // строки в таблице нет — она стоит в итогах под «Subtotal».
    //
    // У КРЕДИТ-НОТЫ ПОЗИЦИЙ НЕТ: сервер (`_issue_credit_note`) пишет только
    // суммы с минусом. Таблица говорит одной строкой, что отменено и на
    // сколько, — а не «No lines yet» над итогом −€100.
    lines:
      creditNote && invoice.lines.length === 0
        ? [
            {
              // Частичная нота инвойс не отменяет — он остаётся в силе.
              title: creditNote.ofReceipt
                ? dict.creditNoteReceiptLine(original)
                : invoice.credit_partial
                  ? dict.creditNotePartialLine(original)
                  : dict.creditNoteLine(original),
              description: null,
              qty: formatQty(1, null, dict.locale),
              unitPrice: paperMoney(invoice.subtotal_net, invoice.currency, dict.locale),
              total: paperMoney(invoice.subtotal_net, invoice.currency, dict.locale),
            },
          ]
        : // ПОЛНАЯ НОТА НЕСЁТ ПОЗИЦИИ ИНВОЙСА С МИНУСОМ: цена каждой —
          // отрицательная, а скидка инвойса стала строкой с плюсом. Фильтр
          // «скидка — не услуга» выкидывал все позиции ноты: таблица пустела, а
          // итоги печатали «Subtotal €0.00 / Discount −€100.00». У ноты строки
          // печатаются как есть — их сумма и есть её итог.
          (creditNote ? invoice.lines : invoice.lines.filter((line) => line.unit_price >= 0)).map((line) => ({
            title: line.title,
            description: line.description?.trim() || null,
            qty: formatQty(line.qty, line.unit, dict.locale),
            unitPrice: paperMoney(line.unit_price, invoice.currency, dict.locale),
            total: paperMoney(line.total, invoice.currency, dict.locale),
          })),
    totals: totalRows({
      // У кредит-ноты итог — «Итого», не «К оплате»: платить по ней нечего.
      dict: creditNote ? { ...dict, grandTotal: dict.creditNoteTotal } : dict,
      currency: invoice.currency,
      subtotalNet: invoice.subtotal_net,
      vatAmount: invoice.vat_amount,
      vatPercent: invoice.vat_percent,
      vatMode,
      total: invoice.total,
      discount: creditNote ? null : splitDiscount(invoice.lines.map((line) => line.total)),
    }),
    // Кредит-ноту не оплачивают: реквизиты для оплаты на ней — приглашение
    // перевести деньги по документу, который их возвращает.
    payTo: creditNote
      ? []
      : compact([
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
    // Причина по умолчанию сервер пишет по-русски («Отмена инвойса INV-…»,
    // у частичной — «Частичная отмена инвойса INV-…», у возврата по чеку —
    // «Возврат по чеку RC-…») —
    // на бумаге её уже говорят шапка и строка таблицы на языке документа.
    // Своя причина, набранная человеком, печатается как есть.
    notes:
      creditNote &&
      /^(Отмена инвойса|Частичная отмена инвойса|Возврат по чеку) \S+$/.test(clean(invoice.notes))
        ? ""
        : clean(invoice.notes),
    footer: creditNote
      ? dict.creditNoteFooter(invoice.number)
      : dict.footer(invoice.number, invoice.currency),
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
