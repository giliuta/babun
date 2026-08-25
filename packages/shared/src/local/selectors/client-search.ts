// Client search helpers. Single-place definition so ClientPickerSheet,
// /dashboard/clients, and any future search surface all match clients
// exactly the same way.
//
// Requirements:
//   * Case-insensitive, punctuation-insensitive.
//   * Greek / Cyrillic / Latin names that sound the same must match
//     across scripts ("Иван" / "Ivan" / "Iван" all hit each other).
//     AirFix clientele includes locals, Russian expats, and Cypriot
//     Greek names; one search bar has to find them all.
//   * Address matches too — dispatcher often remembers the street,
//     not the name.
//   * Phone search ignores spaces, dashes, parentheses.

import type { Client } from "../clients";

const RU_TO_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sh",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

const GR_TO_LAT: Record<string, string> = {
  α: "a", β: "b", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th",
  ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r",
  σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "h", ψ: "ps", ω: "o",
};

function transliterate(input: string): string {
  let out = "";
  for (const ch of input) {
    out += RU_TO_LAT[ch] ?? GR_TO_LAT[ch] ?? ch;
  }
  return out;
}

function normalizeDigits(input: string): string {
  return input.replace(/\D/g, "");
}

export function normalizeSearchable(input: string): string {
  // Lower-case + strip everything that isn't a letter or digit; also
  // transliterate Cyrillic/Greek so "Ivan" and "Иван" hit the same
  // normalised form.
  const lower = input.toLowerCase();
  const translit = transliterate(lower);
  return translit.replace(/[^a-z0-9]/g, "");
}

function clientHaystacks(client: Client): {
  normalized: string[];
  digits: string[];
} {
  const normalized: string[] = [];
  const digits: string[] = [];
  const push = (s: string | null | undefined) => {
    if (!s) return;
    normalized.push(normalizeSearchable(s));
    const d = normalizeDigits(s);
    if (d.length >= 4) digits.push(d);
  };
  push(client.full_name);
  push(client.phone);
  push(client.email);
  push(client.sms_name);
  push(client.whatsapp_phone);
  push(client.telegram_username);
  push(client.instagram_username);
  push(client.comment);
  push(client.address);
  push(client.city);
  for (const note of client.notes ?? []) push(note.text);
  for (const p of client.phones ?? []) {
    push(p.number);
    push(p.name);
    push(p.label);
  }
  for (const unit of client.equipment ?? []) {
    push(unit.room);
    push(unit.brand);
    push(unit.model);
  }
  for (const loc of client.locations ?? []) {
    push(loc.address);
    push(loc.label);
    push(loc.note);
    for (const unit of loc.equipment ?? []) {
      push(unit.room);
      push(unit.brand);
      push(unit.model);
    }
  }
  return { normalized, digits };
}

export function matchesClient(client: Client, rawQuery: string): boolean {
  const q = rawQuery.trim();
  if (!q) return true;
  const qNorm = normalizeSearchable(q);
  const qDigits = normalizeDigits(q);

  // Cache-worthy per call: we stringify the client haystacks once per
  // invocation. The caller loops through `clients` so keeping this here
  // is fine — it's not a hot path compared to a proper index yet.
  const hay = clientHaystacks(client);

  if (qDigits.length >= 4) {
    for (const d of hay.digits) {
      if (d.includes(qDigits)) return true;
    }
  }
  if (qNorm.length === 0) return false;
  for (const s of hay.normalized) {
    if (s.includes(qNorm)) return true;
  }
  return false;
}

/**
 * Returns candidates that could be duplicates of the given new-client
 * draft. Used in the picker "Новый клиент" flow to ask "Это тот же
 * человек?" before creating a second record. Match logic:
 *
 *   * Exact-digits phone match (5+ digits) → strong candidate.
 *   * Normalised full-name match → medium candidate.
 *
 * Returns at most the top 5 to keep the UI readable.
 */
export function findDuplicateCandidates(
  clients: Client[],
  draft: { full_name: string; phone?: string }
): Client[] {
  const phoneDigits = draft.phone ? normalizeDigits(draft.phone) : "";
  const nameNorm = normalizeSearchable(draft.full_name);
  if (!phoneDigits && !nameNorm) return [];
  const hits: Client[] = [];
  for (const c of clients) {
    const { digits } = clientHaystacks(c);
    let hit = false;
    if (phoneDigits && phoneDigits.length >= 5) {
      for (const d of digits) {
        if (d === phoneDigits || d.endsWith(phoneDigits) || phoneDigits.endsWith(d)) {
          hit = true;
          break;
        }
      }
    }
    if (!hit && nameNorm.length >= 3) {
      // A name match must compare against the name only. Searching every
      // haystack here used to treat a draft named «Лимассол» as a duplicate
      // of any client whose CITY happened to be Лимассол.
      hit = normalizeSearchable(c.full_name) === nameNorm;
    }
    if (hit) hits.push(c);
    if (hits.length >= 5) break;
  }
  return hits;
}
