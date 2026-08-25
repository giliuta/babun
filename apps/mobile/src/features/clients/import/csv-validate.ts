// CSV import — per-row validation.
//
// Mobile port of apps/web/src/components/clients/import/csv-validate.ts,
// but phone normalisation delegates to ./phone (libphonenumber-js) instead
// of the web's hand-rolled digit heuristic. This matters: the mobile dedup
// guard keys on `phone_e164 = tryToE164(phone)`, so validating with the SAME
// normaliser means the «битый телефон» flag and the eventual dedup key
// always agree. Divergent normalisation here would let a row pass validation
// then silently fail dedup (or vice-versa).

import type { CountryCode } from "libphonenumber-js";
import type { ParsedRow } from "./csv-parse";
import type { ImportableField } from "./csv-mapping";
import { tryToE164 } from "../phone";

export type RowReason =
  | "пустое имя"
  | "битый телефон"
  | "дубликат в файле"
  | "дубликат в базе";

export interface MappedRow {
  /** 1-based source row index in the original file (header = row 1). */
  source: number;
  full_name: string;
  /** Canonical E.164 when valid, else the raw string (kept for display). */
  phone: string;
  /** Raw phone as typed — shown in preview, used to distinguish
   *  «empty phone» (fine) from «typed but unparseable» (битый). */
  rawPhone: string;
  email: string;
  city: string;
  address: string;
  comment: string;
  /** Empty when no validation issues. */
  reasons: RowReason[];
}

export interface MapAndValidateOptions {
  rows: ParsedRow[];
  headers: string[];
  /** mapping[colIndex] = field; 'skip' means the column is ignored. */
  mapping: ImportableField[];
  defaultCountry: CountryCode;
  /** E.164 phones that already exist for this tenant. */
  existingPhones: Set<string>;
}

export interface MapAndValidateResult {
  mapped: MappedRow[];
  totalParsed: number;
  emptyName: number;
  badPhone: number;
  duplicateInFile: number;
  duplicateInDb: number;
}

/** Walk every parsed row, apply the column mapping, normalise phones to
 *  E.164, flag missing names / broken phones, and detect duplicates both
 *  within the CSV and against the existing-DB phone set. Rows keep their
 *  input order — no filtering here; selectImportable() decides what to drop
 *  based on the user's duplicate choice. */
export function mapAndValidate(opts: MapAndValidateOptions): MapAndValidateResult {
  const { rows, mapping, defaultCountry, existingPhones } = opts;
  const seenInFile = new Set<string>();
  const mapped: MappedRow[] = [];
  let emptyName = 0;
  let badPhone = 0;
  let duplicateInFile = 0;
  let duplicateInDb = 0;

  for (const row of rows) {
    let full_name = "";
    let rawPhone = "";
    let email = "";
    let city = "";
    let address = "";
    let comment = "";
    for (let col = 0; col < mapping.length; col++) {
      const field = mapping[col];
      const value = (row.cells[col] ?? "").toString().trim();
      if (field === "full_name") full_name = value;
      else if (field === "phone") rawPhone = value;
      else if (field === "email") email = value;
      else if (field === "city") city = value;
      else if (field === "address") address = value;
      else if (field === "comment") comment = value;
    }

    const e164 = tryToE164(rawPhone, defaultCountry);
    const reasons: RowReason[] = [];

    // A phone-only row is allowed (mirrors csv.ts): the phone becomes the
    // display name. Empty name is only a problem when there's no phone
    // to fall back on.
    if (!full_name && !e164) {
      reasons.push("пустое имя");
      emptyName++;
    }
    if (rawPhone && !e164) {
      reasons.push("битый телефон");
      badPhone++;
    }
    if (e164) {
      if (seenInFile.has(e164)) {
        reasons.push("дубликат в файле");
        duplicateInFile++;
      } else {
        seenInFile.add(e164);
      }
      if (existingPhones.has(e164)) {
        reasons.push("дубликат в базе");
        duplicateInDb++;
      }
    }

    mapped.push({
      source: row.source,
      // A phone-only row: fall back to the E.164 as the display name so the
      // created client is at least identifiable (same rule as the old csv.ts).
      full_name: full_name || (e164 ?? ""),
      phone: e164 ?? rawPhone,
      rawPhone,
      email,
      city,
      address,
      comment,
      reasons,
    });
  }

  return {
    mapped,
    totalParsed: rows.length,
    emptyName,
    badPhone,
    duplicateInFile,
    duplicateInDb,
  };
}

export type DuplicateAction = "skip" | "import_as_dup";

/** Decide which rows go to the INSERT batch given the user's duplicate
 *  choice. Always drops rows flagged «пустое имя», «битый телефон» or
 *  «дубликат в файле» (non-recoverable). DB duplicates: dropped on
 *  'skip', kept on 'import_as_dup'. */
export function selectImportable(
  mapped: MappedRow[],
  action: DuplicateAction,
): { keep: MappedRow[]; drop: MappedRow[] } {
  const keep: MappedRow[] = [];
  const drop: MappedRow[] = [];
  for (const row of mapped) {
    const r = row.reasons;
    if (
      r.includes("пустое имя") ||
      r.includes("битый телефон") ||
      r.includes("дубликат в файле")
    ) {
      drop.push(row);
      continue;
    }
    if (r.includes("дубликат в базе") && action === "skip") {
      drop.push(row);
      continue;
    }
    keep.push(row);
  }
  return { keep, drop };
}
