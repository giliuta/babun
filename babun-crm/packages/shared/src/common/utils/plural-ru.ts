// v686 / Audit-2026-05-21 P1-6 + P1-2 — Russian pluralization.
//
// Audit findings called out several places where number+noun was
// rendered without proper morphology:
//   - «1 услуг в 1 категориях» (should be «1 услуга в 1 категории»)
//   - «4 записей в этом устройстве»  (should be «4 записи»)
//   - «5 клиент» (should be «5 клиентов»)
//   - «999%» growth indicator when previous period was 0 (should be «—»)
//
// Russian numerals use three plural forms:
//   - ONE   — 1, 21, 31, 101, ...  («1 услуга»,  «21 услуга»)
//   - FEW   — 2-4, 22-24, ...      («2 услуги», «23 услуги»)
//   - MANY  — 0, 5-20, 25-30, ...  («5 услуг»,  «100 услуг»)
//
// Exception: numbers 11-14 always use MANY regardless of last digit.
// This module centralizes the rule so we don't re-implement it per
// caller (8+ existing places had ad-hoc copies, some incorrect).
//
// Usage:
//   pluralRu(1, ["услуга", "услуги", "услуг"])  → "услуга"
//   pluralRu(2, ["услуга", "услуги", "услуг"])  → "услуги"
//   pluralRu(5, ["услуга", "услуги", "услуг"])  → "услуг"
//   formatCountRu(4, ["запись", "записи", "записей"]) → "4 записи"
//
// To extend with a new noun, just pass the 3 forms; no enum.

export type PluralFormsRu = readonly [
  /** ONE form — 1, 21, 31, …  */ string,
  /** FEW form — 2-4, 22-24, … */ string,
  /** MANY form — 0, 5-20, …   */ string,
];

/**
 * Return the correct plural form for an integer count.
 * Negative counts use the absolute value (rare but harmless).
 */
export function pluralRu(count: number, forms: PluralFormsRu): string {
  const n = Math.abs(Math.floor(count));
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

/**
 * Common pattern: render «N noun» with correct pluralization.
 * Returns "4 записи", "1 услуга", "0 клиентов", etc.
 */
export function formatCountRu(count: number, forms: PluralFormsRu): string {
  return `${count} ${pluralRu(count, forms)}`;
}

// ─── Preset form sets for the nouns audit found in production ───────

export const FORMS_ZAPIS: PluralFormsRu = ["запись", "записи", "записей"];
export const FORMS_USLUGA: PluralFormsRu = ["услуга", "услуги", "услуг"];
export const FORMS_KATEGORIYA: PluralFormsRu = ["категория", "категории", "категорий"];
export const FORMS_KLIENT: PluralFormsRu = ["клиент", "клиента", "клиентов"];
export const FORMS_VIZIT: PluralFormsRu = ["визит", "визита", "визитов"];
export const FORMS_DEN: PluralFormsRu = ["день", "дня", "дней"];
export const FORMS_MIN: PluralFormsRu = ["минута", "минуты", "минут"];
export const FORMS_CHAS: PluralFormsRu = ["час", "часа", "часов"];
export const FORMS_RAZ: PluralFormsRu = ["раз", "раза", "раз"];
export const FORMS_MASTER: PluralFormsRu = ["мастер", "мастера", "мастеров"];

/**
 * Format a growth percentage with a guard for «divided by zero» and
 * «no change vs previous». Used by /insights stat cards which used to
 * render «↗ 999%» whenever the previous period was 0 — meaningless
 * for the user.
 *
 *   formatGrowth(150, 0)       → "—"
 *   formatGrowth(150, 100)     → "↑50%"
 *   formatGrowth(50, 100)      → "−50%"
 *   formatGrowth(100, 100)     → "0%"
 *   formatGrowth(null, 100)    → "—"
 */
export function formatGrowth(
  current: number | null | undefined,
  previous: number | null | undefined,
): string {
  if (current == null || previous == null) return "—";
  if (previous === 0) return "—";
  const pct = ((current - previous) / previous) * 100;
  if (!Number.isFinite(pct)) return "—";
  const rounded = Math.round(pct);
  if (rounded === 0) return "0%";
  return `${rounded > 0 ? "↑" : "−"}${Math.abs(rounded)}%`;
}
