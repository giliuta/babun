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
// Delivery: RN has no file-system / expo-sharing in deps, so the CSV goes
// out as the Share sheet's `message` string. iOS lets the user drop it into
// Notes / Mail / AirDrop / copy; that covers the «выгрузи выбранных» intent
// without adding a frozen package. If the OS share sheet is unavailable the
// caller falls back to the clipboard-less alert (see BulkActionBar).

import { Share } from "react-native";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import { formatEUR } from "@babun/shared/common/utils/money";

const HEADER = ["Имя", "Телефон", "Город", "Баланс", "Теги"] as const;

// RFC-4180 quoting — wrap in double quotes when the value holds the
// delimiter, a quote or a newline; escape inner quotes by doubling. Kept
// byte-identical to the web csvCell so a mobile export reopens the same way.
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s === "") return "";
  if (/[";,\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Build the CSV body (with leading BOM) for `clients`. `tags` is the tag
 * dictionary so tag_ids render as human names, not UUIDs.
 */
export function clientsToCsv(
  clients: readonly Client[],
  tags: readonly ClientTag[],
): string {
  const tagName = (id: string) => tags.find((t) => t.id === id)?.name ?? id;
  const lines: string[] = [];
  lines.push(HEADER.map(cell).join(";"));
  for (const c of clients) {
    lines.push(
      [
        cell(c.full_name),
        cell(c.phone),
        cell(c.city),
        // Balance as a signed EUR string — the operator reads a spreadsheet,
        // not a machine; formatEUR keeps the sign for debtors (negative).
        cell(c.balance ? formatEUR(c.balance) : ""),
        cell((c.tag_ids ?? []).map(tagName).join(", ")),
      ].join(";"),
    );
  }
  // BOM prefix so Excel opens UTF-8 (matches web downloadCsv).
  return "﻿" + lines.join("\r\n");
}

/** YYYY-MM-DD stamp for the share subject. */
function todayStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Open the OS share sheet with the CSV as its message body. Resolves
 * `true` on a completed share, `false` if the user dismissed it. Throws
 * only on a genuine Share failure so the caller can alert.
 */
export async function shareClientsCsv(
  clients: readonly Client[],
  tags: readonly ClientTag[],
): Promise<boolean> {
  const csv = clientsToCsv(clients, tags);
  const res = await Share.share({
    message: csv,
    title: `Клиенты ${todayStamp()} (${clients.length})`,
  });
  return res.action === Share.sharedAction;
}
