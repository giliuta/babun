// ФАЙЛЫ КЛИЕНТА — ОДНОЙ ЛЕНТОЙ ПО ДНЯМ, КАК «ИСТОРИЯ» (владелец 03.10:
// «файлы — как история, по датам: файлы, фото, чеки, инвойсы — полноценные
// красивые блоки, чтобы можно было сразу открывать»).
//
// Четыре источника: вложения клиента (туда же ложатся документы записей),
// фото с выездов, инвойсы и чеки. Раньше блок раскладывал их квадратами и
// плашками, а инвойсы и чеки на странице всех файлов прятались за строкой
// «Инвойсы и чеки» — до чека было три тапа. Теперь это одна лента: день
// заголовком, под ним плашки, свежие сверху; карточка показывает последнюю.
// Здесь только правило отбора и порядка — чистое, без сети и вёрстки.

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

/** Запись ленты: `day` — заголовок дня (YYYY-MM-DD), `at` — порядок внутри
 *  дня и время в подписи. */
export type ClientFileEntry<A, V, I, R> =
  | { type: "photo"; item: A; day: string; at: string }
  | { type: "file"; item: A; day: string; at: string }
  | { type: "visit"; item: V; day: string; at: string }
  | { type: "invoice"; item: I; day: string; at: string }
  | { type: "receipt"; item: R; day: string; at: string };

const pad = (n: number) => String(n).padStart(2, "0");

/** День по местному времени: у вложения и фото — из метки времени, у
 *  документа — его дата (`issued_on`) как есть. */
export function fileDay(at: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at.slice(0, 10);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** «13:30» — время из метки; у голой даты времени нет. */
export function fileTime(at: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const isImageMime = (mime: string) => mime.startsWith("image/");

/** Инвойс в «Файлах» — любой, кроме кредит-ноты: нота — часть своего
 *  инвойса, а отменённый инвойс стоит серым (владелец 2026-10-04: «по сути
 *  один файл, инвойс становится серым»). Правило одно с файлами записи
 *  (`appointmentInvoiceFiles`). */
function isInvoiceFile(inv: InvoiceLike): boolean {
  return inv.kind !== "credit_note";
}

/** Все файлы клиента одной лентой: свежий день сверху, внутри дня — свежее
 *  сверху. */
export function clientFileTimeline<A extends AttachmentLike, V extends VisitPhotoLike, I extends InvoiceLike, R extends ReceiptLike>(
  src: ClientFileSources<A, V, I, R>,
): ClientFileEntry<A, V, I, R>[] {
  const out: ClientFileEntry<A, V, I, R>[] = [];
  for (const a of src.attachments) {
    const entry = { item: a, day: fileDay(a.created_at), at: a.created_at };
    out.push(isImageMime(a.mime_type) ? { type: "photo", ...entry } : { type: "file", ...entry });
  }
  for (const p of src.visitPhotos) {
    out.push({ type: "visit", item: p, day: fileDay(p.created_at), at: p.created_at });
  }
  for (const inv of src.invoices) {
    if (!isInvoiceFile(inv)) continue;
    out.push({ type: "invoice", item: inv, day: inv.issued_on, at: inv.created_at ?? inv.issued_on });
  }
  for (const r of src.receipts) {
    if (r.status === "void") continue;
    out.push({ type: "receipt", item: r, day: r.issued_on, at: r.created_at ?? r.issued_on });
  }
  return out.sort((a, b) =>
    a.day !== b.day ? (a.day < b.day ? 1 : -1) : a.at < b.at ? 1 : a.at > b.at ? -1 : 0,
  );
}

/** Лента по дням — в её же порядке. */
export function groupFilesByDay<E extends { day: string }>(entries: readonly E[]): { day: string; items: E[] }[] {
  const out: { day: string; items: E[] }[] = [];
  for (const entry of entries) {
    const last = out[out.length - 1];
    if (last && last.day === entry.day) last.items.push(entry);
    else out.push({ day: entry.day, items: [entry] });
  }
  return out;
}
