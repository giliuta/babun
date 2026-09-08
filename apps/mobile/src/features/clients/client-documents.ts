// ДОКУМЕНТАЦИЯ КЛИЕНТА — РАЗБИВКА ПО ЗАПИСЯМ (владелец 2026-09-07: «это всё
// документация, и чеки тоже; документ присваивается записи, а не клиенту:
// будет следующая запись — заполнится туда, и будет разбивка по датам»).
//
// Файлы записей, фото с выездов, инвойсы и чеки лежат в четырёх таблицах;
// человек спрашивает одно: «что у нас по этому клиенту за какой визит». Здесь
// только правило группировки и подписи — чистое, без сети и вёрстки.

export interface DocumentedAppointment {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  time_start?: string | null;
  team_id?: string | null;
  /** Название работы для подписи группы. */
  serviceName?: string | null;
}

export interface DocumentSourcesForClient {
  appointments: readonly DocumentedAppointment[];
  /** Файлы клиента: `appointment_id` null — приложены к самому клиенту. */
  attachments: readonly { id: string; appointment_id: string | null; mime_type: string; created_at: string }[];
  visitPhotos: readonly { id: string; appointment_id: string; created_at: string }[];
  invoices: readonly { id: string; appointment_id: string | null; issued_on: string }[];
  receipts: readonly { id: string; appointment_id: string | null; issued_on: string }[];
}

export interface DocumentGroup {
  /** id записи или "client" для документов без записи. */
  key: string;
  appointment: DocumentedAppointment | null;
  /** YYYY-MM-DD — дата записи, у документов без записи — дата свежайшего. */
  date: string;
  photos: number;
  files: number;
  invoices: number;
  receipts: number;
  total: number;
}

const isImageMime = (mime: string) => mime.startsWith("image/");

/** Группы по записям, новые сверху; документы без записи — одной группой в
 *  хвосте. Пустых групп нет: запись без единого документа строки не даёт. */
export function groupClientDocuments(src: DocumentSourcesForClient): DocumentGroup[] {
  const byId = new Map(src.appointments.map((a) => [a.id, a]));
  const groups = new Map<string, DocumentGroup>();
  const touch = (appointmentId: string | null, fallbackDate: string): DocumentGroup => {
    const appointment = appointmentId ? byId.get(appointmentId) ?? null : null;
    const key = appointment ? appointment.id : "client";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        appointment,
        date: appointment?.date ?? fallbackDate,
        photos: 0,
        files: 0,
        invoices: 0,
        receipts: 0,
        total: 0,
      };
      groups.set(key, group);
    } else if (!appointment && fallbackDate > group.date) {
      group.date = fallbackDate;
    }
    group.total += 1;
    return group;
  };
  for (const a of src.attachments) {
    const g = touch(a.appointment_id, a.created_at.slice(0, 10));
    if (isImageMime(a.mime_type)) g.photos += 1;
    else g.files += 1;
  }
  for (const p of src.visitPhotos) touch(p.appointment_id, p.created_at.slice(0, 10)).photos += 1;
  for (const i of src.invoices) touch(i.appointment_id, i.issued_on).invoices += 1;
  for (const r of src.receipts) touch(r.appointment_id, r.issued_on).receipts += 1;

  const list = [...groups.values()];
  list.sort((a, b) => {
    // «Без записи» — всегда последней.
    if (!a.appointment !== !b.appointment) return a.appointment ? -1 : 1;
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.appointment?.time_start ?? "").localeCompare(a.appointment?.time_start ?? "");
  });
  return list;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** «чек · счёт · 3 фото · файл» — что лежит в группе, в порядке важности для
 *  бухгалтера: сначала бумаги, потом снимки. */
export function documentGroupSummary(g: DocumentGroup): string {
  const parts: string[] = [];
  if (g.receipts > 0) parts.push(g.receipts === 1 ? "чек" : `${g.receipts} ${plural(g.receipts, "чек", "чека", "чеков")}`);
  if (g.invoices > 0) parts.push(g.invoices === 1 ? "счёт" : `${g.invoices} ${plural(g.invoices, "счёт", "счёта", "счетов")}`);
  if (g.photos > 0) parts.push(`${g.photos} фото`);
  if (g.files > 0) parts.push(g.files === 1 ? "файл" : `${g.files} ${plural(g.files, "файл", "файла", "файлов")}`);
  return parts.join(" · ");
}

/** «11 документов» для строки «Все». */
export function documentsCountLabel(n: number): string {
  return `${n} ${plural(n, "документ", "документа", "документов")}`;
}
