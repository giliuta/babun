// A draft invoice: the preview of the paper as it will be issued.

import { invoiceLineTotal } from "@babun/shared/local/finance/invoice-ledger";
import { invoiceDictionary } from "../dictionary";
import { formatInvoiceDate } from "../format";
import { clientParty } from "./parties";
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
import type { DraftDocumentInput, InvoiceDocument } from "./types";

export function draftDocument({
  draft,
  tenant,
  client,
  company,
  location,
  language,
}: DraftDocumentInput): InvoiceDocument {
  const dict = invoiceDictionary(language);
  return {
    title: dict.invoice,
    eyebrow: dict.invoiceEyebrow,
    reference: null,
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
