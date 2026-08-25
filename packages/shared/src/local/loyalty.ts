// Beta #53 (CRM Core brief) — loyalty program settings.
//
// One simple model: a sorted list of tiers, each `(threshold_visits,
// discount_percent, label)`. A client with N completed visits gets
// the highest tier where `threshold_visits ≤ N`. Brief said «после
// N визитов получает скидку %» — this exactly does that, and the
// tiered shape covers «5 визитов = 5%, 15 = 10%, 30 = 15%».
//
// Storage: localStorage today, will move to Supabase under
// `tenant_loyalty_settings` once the brief's Beta items are
// promoted. The client-card readout + AppointmentSheet auto-apply
// nudge read the same shape regardless of source.

import { getStorage } from "../storage/provider";

export interface LoyaltyTier {
  /** Unique id within the tier list. */
  id: string;
  /** Number of completed visits required to enter this tier. */
  threshold: number;
  /** Discount percentage 0–100. */
  percent: number;
  /** Display label, e.g. «Серебро» / «Постоянный клиент». */
  label: string;
}

export interface LoyaltySettings {
  /** Master switch. False = no tier badges anywhere, no auto-apply. */
  enabled: boolean;
  tiers: LoyaltyTier[];
}

const STORAGE_KEY = "babun-loyalty-settings";

// Empty default — a fresh tenant doesn't pretend they have a
// loyalty program. The owner explicitly turns it on + names tiers.
export const DEFAULT_LOYALTY: LoyaltySettings = {
  enabled: false,
  tiers: [],
};

// Tutorial-friendly preset the «активировать» button on settings
// can drop in so a curious owner sees a working example immediately.
export const STARTER_LOYALTY_TIERS: LoyaltyTier[] = [
  { id: "loy-bronze", threshold: 3,  percent: 5,  label: "Бронза" },
  { id: "loy-silver", threshold: 10, percent: 10, label: "Серебро" },
  { id: "loy-gold",   threshold: 25, percent: 15, label: "Золото" },
];

export function loadLoyalty(): LoyaltySettings {
  const parsed = getStorage().get<{ enabled?: unknown; tiers?: unknown }>(
    STORAGE_KEY,
  );
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_LOYALTY;
  return {
    enabled: Boolean(parsed.enabled),
    tiers: Array.isArray(parsed.tiers)
      ? parsed.tiers
          .filter(
            (t: unknown): t is LoyaltyTier =>
              typeof t === "object" &&
              t !== null &&
              typeof (t as LoyaltyTier).threshold === "number" &&
              typeof (t as LoyaltyTier).percent === "number",
          )
          .sort((a: LoyaltyTier, b: LoyaltyTier) => a.threshold - b.threshold)
      : [],
  };
}

export function saveLoyalty(settings: LoyaltySettings): void {
  getStorage().set(STORAGE_KEY, settings);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("babun:loyalty-changed"));
  }
}

/** Returns the highest tier the client qualifies for, or null when
 *  loyalty is off / no tiers / no qualifying tier. */
export function tierForVisits(
  visits: number,
  settings: LoyaltySettings,
): LoyaltyTier | null {
  if (!settings.enabled || settings.tiers.length === 0) return null;
  // tiers are stored sorted ascending by threshold; scan from the
  // top down for the first matching one.
  const sorted = [...settings.tiers].sort((a, b) => b.threshold - a.threshold);
  for (const t of sorted) {
    if (visits >= t.threshold) return t;
  }
  return null;
}

export function generateLoyaltyTierId(): string {
  return `loy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}
