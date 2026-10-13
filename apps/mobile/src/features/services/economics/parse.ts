// Lenient readers of stored tier JSON (current shape and legacy aliases).

import type { CostTierValue, DurationTierValue, PriceTierValue } from "./types";

type LooseRecord = Record<string, unknown>;

function asLooseArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function asRecord(value: unknown): LooseRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as LooseRecord)
    : null;
}

export function looseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function tierMinimum(record: LooseRecord): number | null {
  const value = looseNumber(
    record.min_qty ??
      record.min_quantity ??
      record.minimum_quantity ??
      record.threshold,
  );
  return value !== null && Number.isSafeInteger(value) && value >= 2 ? value : null;
}

/** Accepts current DB JSON and known legacy aliases. Invalid rows are ignored. */
export function parsePriceTiers(raw: unknown): PriceTierValue[] {
  const byMinimum = new Map<number, PriceTierValue>();
  for (const item of asLooseArray(raw)) {
    const record = asRecord(item);
    if (!record) continue;
    const minQuantity = tierMinimum(record);
    const price = looseNumber(
      record.price_per_unit ?? record.unit_price ?? record.price,
    );
    if (minQuantity === null || price === null || price < 0) continue;
    byMinimum.set(minQuantity, {
      min_qty: minQuantity,
      price_per_unit: price,
    });
  }
  return [...byMinimum.values()].sort((a, b) => a.min_qty - b.min_qty);
}

/** Accepts current DB JSON and known legacy aliases. Invalid rows are ignored. */
export function parseDurationTiers(raw: unknown): DurationTierValue[] {
  const byMinimum = new Map<number, DurationTierValue>();
  for (const item of asLooseArray(raw)) {
    const record = asRecord(item);
    if (!record) continue;
    const minQuantity = tierMinimum(record);
    const duration = looseNumber(
      record.duration_minutes ??
        record.total_duration_minutes ??
        record.total_duration,
    );
    if (
      minQuantity === null ||
      duration === null ||
      !Number.isSafeInteger(duration) ||
      duration < 0
    ) {
      continue;
    }
    byMinimum.set(minQuantity, {
      min_qty: minQuantity,
      duration_minutes: duration,
    });
  }
  return [...byMinimum.values()].sort((a, b) => a.min_qty - b.min_qty);
}

/** НОВАЯ СТРОКА НЕ ПОДСТАВЛЯЕТ ЦЕНУ (владелец 2026-08-21: «когда я добавляю
 *  новое, оно меняет цену всегда на 50 — мне это не нравится»). Цена от
 *  количества почти всегда НИЖЕ базовой, поэтому подставленная база — это не
 *  подсказка, а лишняя работа: её надо стереть и напечатать своё. Количество и
 *  время подставляются, потому что там угадывать нечего: следующее свободное
 *  число и та же работа, взятая столько раз. */
export function parseCostDrafts(raw: unknown): CostTierValue[] {
  const byMinimum = new Map<number, CostTierValue>();
  for (const item of asLooseArray(raw)) {
    const record = asRecord(item);
    if (!record) continue;
    const minimum = tierMinimum(record);
    const cost = looseNumber(record.cost_per_unit ?? record.cost);
    if (minimum === null || cost === null || cost < 0) continue;
    byMinimum.set(minimum, { min_qty: minimum, cost_per_unit: cost });
  }
  return [...byMinimum.values()].sort((a, b) => a.min_qty - b.min_qty);
}
