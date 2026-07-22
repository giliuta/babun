export type PriceTierValue = {
  min_qty: number;
  price_per_unit: number;
};

export type DurationTierValue = {
  min_qty: number;
  duration_minutes: number;
};

export interface ServiceTierDraft {
  id: string;
  minQuantity: string;
  pricePerUnit: string;
  totalDuration: string;
}

export interface ServiceEconomicsDraft {
  costPerUnit: string;
  isCountable: boolean;
  tiers: ServiceTierDraft[];
}

export interface ServiceTierErrors {
  minQuantity?: string;
  pricePerUnit?: string;
  totalDuration?: string;
  row?: string;
}

export interface ServiceEconomicsErrors {
  costPerUnit?: string;
  tiers: Record<string, ServiceTierErrors>;
}

export interface ServiceEconomicsValue {
  cost_per_unit: number;
  is_countable: boolean;
  price_tiers: PriceTierValue[] | null;
  duration_tiers: DurationTierValue[] | null;
  bulk_threshold: number;
  bulk_price: number;
}

interface ServiceEconomicsSource {
  cost_per_unit?: unknown;
  is_countable?: unknown;
  price_tiers?: unknown;
  duration_tiers?: unknown;
  bulk_threshold?: unknown;
  bulk_price?: unknown;
}

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

function looseNumber(value: unknown): number | null {
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

function displayNumber(value: unknown, fallback = "0"): string {
  const parsed = looseNumber(value);
  return parsed !== null && parsed >= 0 ? String(parsed) : fallback;
}

export function economicsDraftFromService(
  service?: ServiceEconomicsSource | null,
): ServiceEconomicsDraft {
  const prices = parsePriceTiers(service?.price_tiers);
  const durations = parseDurationTiers(service?.duration_tiers);

  if (prices.length === 0) {
    const legacyMinimum = looseNumber(service?.bulk_threshold);
    const legacyPrice = looseNumber(service?.bulk_price);
    if (
      legacyMinimum !== null &&
      Number.isSafeInteger(legacyMinimum) &&
      legacyMinimum >= 2 &&
      legacyPrice !== null &&
      legacyPrice > 0
    ) {
      prices.push({ min_qty: legacyMinimum, price_per_unit: legacyPrice });
    }
  }

  const priceByMinimum = new Map(prices.map((tier) => [tier.min_qty, tier]));
  const durationByMinimum = new Map(
    durations.map((tier) => [tier.min_qty, tier]),
  );
  const minimums = [...new Set([...priceByMinimum.keys(), ...durationByMinimum.keys()])]
    .sort((a, b) => a - b);

  return {
    costPerUnit: displayNumber(service?.cost_per_unit),
    isCountable: service?.is_countable !== false,
    tiers: minimums.map((minimum, index) => ({
      id: `stored-${minimum}-${index}`,
      minQuantity: String(minimum),
      pricePerUnit:
        priceByMinimum.get(minimum) === undefined
          ? ""
          : String(priceByMinimum.get(minimum)?.price_per_unit),
      totalDuration:
        durationByMinimum.get(minimum) === undefined
          ? ""
          : String(durationByMinimum.get(minimum)?.duration_minutes),
    })),
  };
}

export function createTierDraft(
  existing: ServiceTierDraft[],
  basePrice: number,
  baseDuration: number,
): ServiceTierDraft {
  const used = new Set(
    existing
      .map((tier) => looseNumber(tier.minQuantity))
      .filter((value): value is number => value !== null),
  );
  let minimum = 2;
  while (used.has(minimum)) minimum += 1;
  return {
    id: `new-${Date.now()}-${existing.length}`,
    minQuantity: String(minimum),
    pricePerUnit: String(Math.max(0, basePrice)),
    totalDuration: String(Math.max(0, Math.round(baseDuration * minimum))),
  };
}

function strictNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateServiceEconomics(
  draft: ServiceEconomicsDraft,
): { errors: ServiceEconomicsErrors; value: ServiceEconomicsValue | null } {
  const errors: ServiceEconomicsErrors = { tiers: {} };
  const cost = draft.costPerUnit.trim() === "" ? 0 : strictNumber(draft.costPerUnit);
  if (cost === null || cost < 0) {
    errors.costPerUnit = "Введите сумму 0 или больше";
  }

  const parsedRows: {
    draft: ServiceTierDraft;
    minimum: number | null;
    price: number | null;
    duration: number | null;
  }[] = [];

  for (const tier of draft.tiers) {
    const tierErrors: ServiceTierErrors = {};
    const minimum = strictNumber(tier.minQuantity);
    const price = strictNumber(tier.pricePerUnit);
    const duration = strictNumber(tier.totalDuration);

    if (minimum === null || !Number.isSafeInteger(minimum) || minimum < 2) {
      tierErrors.minQuantity = "Укажите целое число от 2";
    }
    if (tier.pricePerUnit.trim() !== "" && (price === null || price < 0)) {
      tierErrors.pricePerUnit = "Введите цену 0 или больше";
    }
    if (
      tier.totalDuration.trim() !== "" &&
      (duration === null || !Number.isSafeInteger(duration) || duration < 0)
    ) {
      tierErrors.totalDuration = "Введите целые минуты от 0";
    }
    if (tier.pricePerUnit.trim() === "" && tier.totalDuration.trim() === "") {
      tierErrors.row = "Укажите цену или общую длительность";
    }
    errors.tiers[tier.id] = tierErrors;
    parsedRows.push({ draft: tier, minimum, price, duration });
  }

  const minimumOwners = new Map<number, string[]>();
  for (const row of parsedRows) {
    if (row.minimum === null || !Number.isSafeInteger(row.minimum) || row.minimum < 2) {
      continue;
    }
    minimumOwners.set(row.minimum, [
      ...(minimumOwners.get(row.minimum) ?? []),
      row.draft.id,
    ]);
  }
  for (const owners of minimumOwners.values()) {
    if (owners.length < 2) continue;
    for (const id of owners) {
      errors.tiers[id] = {
        ...errors.tiers[id],
        minQuantity: "Такой порог уже есть",
      };
    }
  }

  const hasTierErrors = Object.values(errors.tiers).some(
    (tier) => Object.keys(tier).length > 0,
  );
  if (errors.costPerUnit || hasTierErrors || cost === null) {
    return { errors, value: null };
  }

  const sortedRows = [...parsedRows].sort(
    (a, b) => (a.minimum as number) - (b.minimum as number),
  );
  const priceTiers: PriceTierValue[] = [];
  const durationTiers: DurationTierValue[] = [];
  for (const row of sortedRows) {
    if (row.price !== null) {
      priceTiers.push({
        min_qty: row.minimum as number,
        price_per_unit: row.price,
      });
    }
    if (row.duration !== null) {
      durationTiers.push({
        min_qty: row.minimum as number,
        duration_minutes: row.duration,
      });
    }
  }

  const legacyTier = priceTiers[0];
  return {
    errors,
    value: {
      cost_per_unit: cost,
      is_countable: draft.isCountable,
      price_tiers: priceTiers.length > 0 ? priceTiers : null,
      duration_tiers: durationTiers.length > 0 ? durationTiers : null,
      bulk_threshold: legacyTier?.min_qty ?? 0,
      bulk_price: legacyTier?.price_per_unit ?? 0,
    },
  };
}
