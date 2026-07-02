import type { Client } from "@babun/shared/local/clients";

// Map common RU/EN header names → Client fields. Lower-cased, trimmed.
const FIELD_MAP: Record<string, keyof Client> = {
  name: "full_name",
  "full name": "full_name",
  full_name: "full_name",
  "имя": "full_name",
  "фио": "full_name",
  "имя клиента": "full_name",
  "клиент": "full_name",
  "название": "full_name",
  phone: "phone",
  "phone number": "phone",
  mobile: "phone",
  tel: "phone",
  "телефон": "phone",
  "тел": "phone",
  "номер": "phone",
  "номер телефона": "phone",
  email: "email",
  "e-mail": "email",
  mail: "email",
  "почта": "email",
  "емейл": "email",
  city: "city",
  "город": "city",
  address: "address",
  "адрес": "address",
  comment: "comment",
  comments: "comment",
  note: "comment",
  notes: "comment",
  "заметка": "comment",
  "заметки": "comment",
  "комментарий": "comment",
  "примечание": "comment",
};

// Character-scan the WHOLE text into records so newlines inside quoted
// fields ("Заметка\nв две строки" — valid CSV, Excel/Numbers export it)
// stay part of the field instead of spawning garbage rows. Blank records
// are dropped. Handles "" escapes and \r\n / \n / \r line endings.
function parseCsvRecords(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;

  const endRow = () => {
    row.push(cur.trim());
    cur = "";
    if (row.some((c) => c.length > 0)) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === delim) {
      row.push(cur.trim());
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      cur += ch;
    }
  }
  endRow();
  return rows;
}

export interface ParsedClientsCsv {
  drafts: Partial<Client>[];
  mappedFields: string[]; // distinct Client fields recognized in the header
  total: number; // data rows seen
  skipped: number; // rows dropped (no name AND no phone)
}

/**
 * Parse a clients CSV (RU/EN headers, `,` or `;` delimiter, quoted fields
 * incl. embedded newlines, BOM-tolerant). Rows need at least a name or a
 * phone; a phone-only row uses the phone as the display name.
 */
export function parseClientsCsv(input: string): ParsedClientsCsv {
  const text = input.replace(/^﻿/, "");
  // Delimiter heuristic runs on the header (first physical line) — a
  // quoted newline inside a HEADER cell is not a real-world case.
  const nl = text.search(/\r\n|\n|\r/);
  const header = nl === -1 ? text : text.slice(0, nl);
  const delim =
    header.split(";").length > header.split(",").length ? ";" : ",";

  const rows = parseCsvRecords(text, delim);
  if (rows.length === 0) {
    return { drafts: [], mappedFields: [], total: 0, skipped: 0 };
  }

  const cols = rows[0].map((h) => FIELD_MAP[h.toLowerCase()] ?? null);
  const mappedFields = [...new Set(cols.filter(Boolean) as string[])];

  const drafts: Partial<Client>[] = [];
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const draft: Partial<Client> = {};
    cols.forEach((field, i) => {
      if (!field) return;
      const v = (cells[i] ?? "").trim();
      if (v) (draft as Record<string, unknown>)[field] = v;
    });
    if (!draft.full_name && !draft.phone) {
      skipped++;
      continue;
    }
    if (!draft.full_name) draft.full_name = draft.phone as string;
    drafts.push(draft);
  }

  return { drafts, mappedFields, total: rows.length - 1, skipped };
}
