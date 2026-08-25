// bulk-export — CSV export of the selected clients (mobile bulk-mode).
//
// Mirrors the web exporter (apps/web/src/lib/csv/csv-export.ts): same
// RFC-4180 cell quoting, `;` delimiter (Excel's CY/RU regional default),
// CRLF line endings and a leading BOM so Excel auto-detects UTF-8 and
// Cyrillic names don't mangle. The COLUMN SET is the bulk-brief subset the
// task asks for — имя · телефон · город · баланс · теги — not the full
// 15-column web dump; bulk export is «дай мне выбранных в таблицу», the
// gear→Экспорт path (future) can carry the wide sheet.
//
import type { Client, ClientTag } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { clientDebt } from "@/features/clients/filter";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  csvCell,
  csvDocument,
  csvTextCell,
  shareCsvFile,
} from "@/lib/share-csv";

// «Долг», а не «Баланс»: колонка `balance` — мёртвое поле, оставшееся от
// старой модели, и печаталась она всегда пустой либо неверной. Долг
// считается ТОЙ ЖЕ формулой, что в списке и на карточке, — иначе выгрузка
// станет четвёртым мнением о том, сколько человек должен.
const HEADER = ["Имя", "Телефон", "Город", "Долг", "Теги"] as const;

/**
 * Build the CSV body (with leading BOM) for `clients`. `tags` is the tag
 * dictionary so tag_ids render as human names, not UUIDs.
 */
export function clientsToCsv(
  clients: readonly Client[],
  tags: readonly ClientTag[],
  /** Сводка по клиенту — из неё берётся долг. Без неё колонка пустая:
   *  выдумывать долг из мёртвого поля хуже, чем не печатать его вовсе. */
  stats?: ReadonlyMap<string, ClientStats>,
): string {
  const tagName = (id: string) => tags.find((t) => t.id === id)?.name ?? id;
  const rows: string[][] = [HEADER.map(csvCell)];
  for (const c of clients) {
    rows.push([
        csvTextCell(c.full_name),
        csvTextCell(c.phone),
        csvTextCell(c.city),
        // Сумма читается человеком в таблице, поэтому строкой с валютой.
        csvCell(
          (() => {
            const debt = clientDebt(c, stats?.get(c.id));
            return debt > 0 ? formatEUR(debt) : "";
          })(),
        ),
        csvTextCell((c.tag_ids ?? []).map(tagName).join(", ")),
      ]);
  }
  return csvDocument(rows);
}

/** YYYY-MM-DD stamp for the share subject. */
function todayStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Write a real UTF-8 `.csv` file and open the native file share sheet.
 * `expo-sharing` does not distinguish a completed share from a dismissed
 * sheet, so `true` means that the sheet was presented successfully.
 */
export async function shareClientsCsv(
  clients: readonly Client[],
  tags: readonly ClientTag[],
  stats?: ReadonlyMap<string, ClientStats>,
): Promise<boolean> {
  const csv = clientsToCsv(clients, tags, stats);
  const stamp = todayStamp();
  await shareCsvFile({
    contents: csv,
    filename: `babun-clients-${stamp}.csv`,
    dialogTitle: `Клиенты ${stamp} (${clients.length})`,
  });
  return true;
}
