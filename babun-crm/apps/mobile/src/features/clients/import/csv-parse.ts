// CSV import — parsing into header + positional rows.
//
// Mobile counterpart of apps/web/.../csv-parse.ts. React Native has no
// PapaParse / TextDecoder-encoding-fallback, so we reuse the battle-tested
// character-scanner from ../csv.ts (quoted fields with embedded newlines,
// "" escapes, \r\n/\n/\r endings, `,` or `;` delimiter, BOM-tolerant) and
// expose the raw grid the wizard needs for user-driven column mapping.
//
// Encoding: the DocumentPicker asset is read as UTF-8 text (fetch().text()).
// Windows-1251 re-decode isn't attempted on-device (no byte-level TextDecoder
// for legacy codepages in Hermes); modern exports are UTF-8 and that's what
// we document to the user.

export interface ParsedRow {
  /** 1-based source row index in the original file (header = row 1). */
  source: number;
  /** Cell values keyed by column index. */
  cells: Record<number, string>;
}

export interface ParsedCsv {
  headers: string[];
  rows: ParsedRow[];
  /** Cheap content fingerprint for the resume guard (djb2 of head slice). */
  fileHash: string;
}

/** Character-scan the whole text into records. Newlines inside quoted
 *  fields stay part of the field. Blank records are dropped. */
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

/** djb2 hash over the first 4 KiB — enough to answer «is this the same
 *  file we left half-imported?» without WebCrypto (absent in Hermes). */
function quickHash(text: string): string {
  const head = text.slice(0, 4096);
  let h = 5381;
  for (let i = 0; i < head.length; i++) {
    h = ((h << 5) + h + head.charCodeAt(i)) | 0;
  }
  // Fold length in so two files sharing a 4 KiB head still differ.
  return (h >>> 0).toString(16) + "-" + text.length.toString(16);
}

/** Parse a clients CSV into headers + positional rows. Throws when the
 *  file is empty or has no data rows (only a header). */
export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^﻿/, "");
  const fileHash = quickHash(text);

  // Delimiter heuristic: trial-parse the header record with BOTH candidates
  // and pick whichever yields more columns. Splitting the raw header string
  // (header.split(';') vs .split(',')) miscounts when a quoted header cell
  // contains the other delimiter — e.g. `"a;b;c",Phone,City` would look like
  // more «;» than «,» and collapse the whole file to one column. Running the
  // real quote-aware scanner on just the header sidesteps that. A quoted
  // newline inside a HEADER cell is not a real-world case, so slicing to the
  // first physical line for this probe is safe.
  const nl = text.search(/\r\n|\n|\r/);
  const header = nl === -1 ? text : text.slice(0, nl);
  const semiCols = (parseCsvRecords(header, ";")[0] ?? []).length;
  const commaCols = (parseCsvRecords(header, ",")[0] ?? []).length;
  const delim = semiCols > commaCols ? ";" : ",";

  const records = parseCsvRecords(text, delim);
  if (records.length === 0) {
    throw new Error("Файл пустой");
  }
  const headers = (records[0] ?? []).map((h) => h.trim());
  const rows: ParsedRow[] = [];
  for (let r = 1; r < records.length; r++) {
    const cells: Record<number, string> = {};
    const rec = records[r];
    for (let i = 0; i < rec.length; i++) cells[i] = rec[i] ?? "";
    rows.push({ source: r + 1, cells }); // +1: header is row 1, data starts at 2
  }
  if (rows.length === 0) {
    throw new Error("В файле нет строк данных — только заголовок.");
  }
  return { headers, rows, fileHash };
}
