import type { InvoiceDocument } from "./document";

// РЕШЕНИЕ ХОТСПОТА — ЧИСТАЯ ФУНКЦИЯ, ОТДЕЛЬНО ОТ РАЗМЕТКИ.
//
// Первый заход зеркала-инвойса (владелец 2026-09-20): бумага в составителе
// становится нажимаемой, а пустые места зовут тапом словом-приглашением.
// Какая зона нажимается и что печатать, когда данных нет, — решает эта
// функция, а не JSX `InvoicePaper.tsx`. Причина: в продукте нет
// RN-компонентных тестов (см. `pdf.test.ts` — тестируют чистые функции), и
// вынесенное решение проверяется как обычная логика, без рендера дерева.
//
// Это же разделение — структурная гарантия, что слово-приглашение не попадёт
// в PDF: `pdf.ts` эту функцию не импортирует и не знает о ней вовсе, он рисует
// `InvoiceDocument` напрямую своим шаблоном.

export interface InvoicePaperZoneState {
  /** Зона отвечает на тап. Без обработчика бумага обязана быть просто
   *  бумагой — своей шторки у выставленного документа ещё нет. */
  interactive: boolean;
  /** Короткое слово-приглашение акцентным цветом. `null` — печатать
   *  настоящее значение как есть. */
  invite: string | null;
}

export interface InvoicePaperHandlerFlags {
  hasLogo: boolean;
  hasSeller: boolean;
  hasClient: boolean;
  /** Один коллбэк на обе даты — различаются полем в `onPressDate(field)`. */
  hasDate: boolean;
  hasNote: boolean;
}

export interface InvoicePaperZones {
  logo: InvoicePaperZoneState;
  /** Юр. имя/адрес/VAT/IBAN печатника — одна зона, одна дверь (реквизиты
   *  компании). */
  seller: InvoicePaperZoneState;
  client: InvoicePaperZoneState;
  issuedOn: InvoicePaperZoneState;
  dueOn: InvoicePaperZoneState;
  note: InvoicePaperZoneState;
}

type ZoneDoc = Pick<
  InvoiceDocument,
  "logoUrl" | "seller" | "client" | "issuedOn" | "dueOn" | "notes" | "draft" | "dict"
>;

/** Слова-приглашения — ровно те, что владелец выбрал 2026-09-20. Держим их
 *  константами: `invoice-paper-zones.test.ts` и `pdf.test.ts` сверяются с
 *  этими же строками, а не с копией текста. */
export const PAPER_INVITE = {
  logo: "Логотип",
  seller: "Юр. адрес",
  client: "Выбрать клиента",
  dueOn: "Срок оплаты",
  note: "Комментарий",
} as const;

export function invoicePaperZones(
  doc: ZoneDoc,
  handlers: InvoicePaperHandlerFlags,
): InvoicePaperZones {
  return {
    logo: {
      interactive: handlers.hasLogo,
      invite: handlers.hasLogo && !doc.logoUrl ? PAPER_INVITE.logo : null,
    },
    seller: {
      interactive: handlers.hasSeller,
      invite: handlers.hasSeller && doc.seller.lines.length === 0 ? PAPER_INVITE.seller : null,
    },
    client: {
      interactive: handlers.hasClient,
      invite:
        handlers.hasClient && doc.client.name === doc.dict.recipientMissing
          ? PAPER_INVITE.client
          : null,
    },
    // Дата выставления заморожена у выставленного документа (`!doc.draft`) —
    // как и в «Правке», где для него вместо строки-двери стоит голый текст.
    issuedOn: {
      interactive: handlers.hasDate && doc.draft,
      invite: null,
    },
    dueOn: {
      interactive: handlers.hasDate,
      invite: handlers.hasDate && doc.dueOn === doc.dict.notSet ? PAPER_INVITE.dueOn : null,
    },
    note: {
      interactive: handlers.hasNote,
      invite: handlers.hasNote && !doc.notes ? PAPER_INVITE.note : null,
    },
  };
}
