// ФАЙЛЫ КЛИЕНТА — ЧТО ПОКАЗЫВАЕТ БЛОК «ФАЙЛЫ» НА ЕГО СТРАНИЦЕ (владелец
// 22.09: «уберём полностью блок документации и просто туда вставим, как у нас
// файлы, как везде хранятся файлы»).
//
// Четыре источника: вложения клиента (туда же ложатся документы записей с
// меткой записи), фото с выездов, инвойсы и чеки. Блок раскладывает их так
// же, как блок файлов записи: снимки — квадратами, всё прочее — плашками.
// Здесь только правило отбора и порядка — чистое, без сети и вёрстки.
//
// Порядок — свежие сверху. Много файлов — показываем первые, остальное за
// строкой «Все файлы»: блок стоит посреди страницы и не должен съедать экран.

/** Две строки квадратов: плитка 64 + зазор 8, в карточку телефона входит 4. */
export const CLIENT_FILES_MAX_MEDIA = 8;
/** Плашек документов под квадратами. */
export const CLIENT_FILES_MAX_PAPERS = 3;

interface AttachmentLike {
  id: string;
  mime_type: string;
  created_at: string;
}
interface VisitPhotoLike {
  id: string;
  created_at: string;
}
interface InvoiceLike {
  id: string;
  status: string;
  kind?: string | null;
  issued_on: string;
  created_at?: string | null;
}
interface ReceiptLike {
  id: string;
  status: string;
  issued_on: string;
  created_at?: string | null;
}

export interface ClientFileSources<A extends AttachmentLike, V extends VisitPhotoLike, I extends InvoiceLike, R extends ReceiptLike> {
  attachments: readonly A[];
  visitPhotos: readonly V[];
  invoices: readonly I[];
  receipts: readonly R[];
}

export type ClientMediaEntry<A, V> =
  | { type: "attachment"; item: A; at: string }
  | { type: "visit"; item: V; at: string };

export type ClientPaperEntry<A, I, R> =
  | { type: "file"; item: A; at: string }
  | { type: "invoice"; item: I; at: string }
  | { type: "receipt"; item: R; at: string };

export interface ClientFilesLayout<A, V, I, R> {
  media: ClientMediaEntry<A, V>[];
  papers: ClientPaperEntry<A, I, R>[];
  /** Файлов на странице «Все файлы» — вложения и фото визитов. Бумаги
   *  (инвойсы и чеки) эта страница НЕ показывает, поэтому и в её числе их нет:
   *  иначе строка обещала бы больше, чем за ней лежит. */
  total: number;
  /** Сколько файлов этой страницы не поместилось; 0 — строки «Все файлы» нет. */
  hidden: number;
  /** Сколько инвойсов и чеков не поместилось в плашки; 0 — строки «Счета и
   *  чеки» нет. Они живут на своей странице (`/documents?clientId=`). */
  hiddenPapers: number;
}

const isImageMime = (mime: string) => mime.startsWith("image/");

/** Живой инвойс — как у блока файлов записи: аннулированные, отменённые и
 *  кредит-ноты в файлы не попадают (`liveAppointmentInvoices`). */
function isLiveInvoice(inv: InvoiceLike): boolean {
  return inv.status !== "void" && inv.status !== "cancelled" && inv.kind !== "credit_note";
}

const newestFirst = <T extends { at: string }>(a: T, b: T) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);

export function layoutClientFiles<A extends AttachmentLike, V extends VisitPhotoLike, I extends InvoiceLike, R extends ReceiptLike>(
  src: ClientFileSources<A, V, I, R>,
  limits: { media: number; papers: number } = {
    media: CLIENT_FILES_MAX_MEDIA,
    papers: CLIENT_FILES_MAX_PAPERS,
  },
): ClientFilesLayout<A, V, I, R> {
  const media: ClientMediaEntry<A, V>[] = [];
  const papers: ClientPaperEntry<A, I, R>[] = [];
  for (const a of src.attachments) {
    if (isImageMime(a.mime_type)) media.push({ type: "attachment", item: a, at: a.created_at });
    else papers.push({ type: "file", item: a, at: a.created_at });
  }
  for (const p of src.visitPhotos) media.push({ type: "visit", item: p, at: p.created_at });
  for (const inv of src.invoices) {
    if (isLiveInvoice(inv)) papers.push({ type: "invoice", item: inv, at: inv.created_at ?? inv.issued_on });
  }
  for (const r of src.receipts) {
    if (r.status !== "void") papers.push({ type: "receipt", item: r, at: r.created_at ?? r.issued_on });
  }
  media.sort(newestFirst);
  papers.sort(newestFirst);
  const shownMedia = media.slice(0, limits.media);
  const shownPapers = papers.slice(0, limits.papers);
  const isFile = (e: ClientPaperEntry<A, I, R>) => e.type === "file";
  const allFiles = media.length + papers.filter(isFile).length;
  const shownFiles = shownMedia.length + shownPapers.filter(isFile).length;
  const allDocs = papers.length - papers.filter(isFile).length;
  const shownDocs = shownPapers.length - shownPapers.filter(isFile).length;
  return {
    media: shownMedia,
    papers: shownPapers,
    total: allFiles,
    hidden: allFiles - shownFiles,
    hiddenPapers: allDocs - shownDocs,
  };
}
