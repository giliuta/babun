// STORY-058 Sprint D — recent places for the personal-event address
// input. Each save pushes the trimmed address to the front of a small
// MRU list. Surfaces as native HTML <datalist> autocomplete in the
// address input + as a tap-to-pick dropdown inside the sheet.
//
// Storage is per-device localStorage today; will move to Supabase
// when masters/teams do (STORY-057) so a user sees the same recents
// on iPhone and desktop.

import { getStorage } from "../storage";

const STORAGE_KEY = "babun2:event-recent-places";
const MAX_PLACES = 5;

export function loadRecentPlaces(): string[] {
  const raw = getStorage().getRaw(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .slice(0, MAX_PLACES);
  } catch {
    return [];
  }
}

export function pushRecentPlace(address: string): void {
  const trimmed = address.trim();
  if (!trimmed) return;
  const current = loadRecentPlaces();
  // De-dupe case-insensitive — «Limassol Steakhouse» and «limassol
  // steakhouse» should collapse into the user's most-recent casing.
  const lower = trimmed.toLowerCase();
  const filtered = current.filter((p) => p.toLowerCase() !== lower);
  const next = [trimmed, ...filtered].slice(0, MAX_PLACES);
  getStorage().setRaw(STORAGE_KEY, JSON.stringify(next));
}

export function clearRecentPlaces(): void {
  getStorage().remove(STORAGE_KEY);
}
