import { draftDocument } from "./document/draft";
import { issuedDocument } from "./document/issued";
import type { DraftDocumentInput, InvoiceDocument, IssuedDocumentInput } from "./document/types";

// ОДИН ДОКУМЕНТ — ДВА РЕНДЕРА.
//
// Зеркало инвойса — чтобы сразу редактировать и смотреть. Зеркало и PDF обязаны показывать ОДНО И ТО ЖЕ —
// иначе клиент получит не то, что видел человек. Поэтому здесь собирается
// готовый к печати документ (уже отформатированные строки), а рисовать его
// умеют двое: HTML для PDF и экранная «бумага» на React Native.
//
// Почему не WebView: его нет в нативной сборке, а добавление требует пересборки
// приложения. Два рендера из одной модели — честная цена за живой предпросмотр
// сегодня; контрактный тест держит их в согласии.
//
// Public surface; the pieces live in `./document/`.

export type {
  DocumentLine,
  DocumentParty,
  DocumentPayment,
  DocumentTotal,
  DraftDocumentInput,
  InvoiceDocument,
  InvoiceDocumentDraft,
  InvoiceDraftSeller,
  IssuedDocumentInput,
} from "./document/types";
export {
  clientParty,
  clientSnapshotParty,
  hasExactAddress,
  objectAddressLines,
} from "./document/parties";
export { formatQty } from "./document/paper-text";

export function buildInvoiceDocument(
  input: IssuedDocumentInput | DraftDocumentInput,
): InvoiceDocument {
  return "draft" in input ? draftDocument(input) : issuedDocument(input);
}
