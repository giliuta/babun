// Location labels reference book (Дом / Квартира / Офис / Вилла / ...).
// Persisted in the shared KV seam. Used for the preset chips in
// LocationsBlock when creating/editing a client's object.

import { getStorage } from "../storage/provider";

export interface LocationLabel {
  id: string;
  name: string;
}

const STORAGE_KEY = "babun2:settings:location-labels";
const LEGACY_OWNER_KEY = `${STORAGE_KEY}:legacy-owner-tenant`;

function scopedStorageKey(tenantId: string): string {
  return `${STORAGE_KEY}:tenant:${tenantId}`;
}

function serverSyncKey(tenantId: string): string {
  return `${scopedStorageKey(tenantId)}:server-synced`;
}

// STORY-078 leak fix — labels Дом / Квартира / Офис / Вилла are
// HVAC/cleaning-flavoured. Beauty / auto-service tenants don't need
// them. Default empty; preset kept exposed for the vertical-driven
// onboarding seed (future story).
export const SEED_LOCATION_LABELS: LocationLabel[] = [];

export const HOME_SERVICE_LABELS_PRESET: LocationLabel[] = [
  { id: "loclbl-house",    name: "Дом" },
  { id: "loclbl-flat",     name: "Квартира" },
  { id: "loclbl-office",   name: "Офис" },
  { id: "loclbl-villa",    name: "Вилла" },
];

export function loadLocationLabels(tenantId?: string | null): LocationLabel[] {
  const storage = getStorage();
  if (!tenantId) {
    const parsed = storage.get<LocationLabel[]>(STORAGE_KEY);
    return Array.isArray(parsed) ? parsed : [];
  }

  const scopedKey = scopedStorageKey(tenantId);
  const scoped = storage.get<LocationLabel[]>(scopedKey);
  if (Array.isArray(scoped)) return scoped;

  // One-time ownership claim for the pre-multitenant key. It is impossible to
  // infer which account produced old device data, so the first active tenant
  // may claim it and every other tenant is explicitly denied. This preserves
  // an existing installation without ever displaying one account's labels in
  // a later account session.
  const legacy = storage.get<LocationLabel[]>(STORAGE_KEY);
  if (!Array.isArray(legacy) || legacy.length === 0) return [];
  const legacyOwner = storage.getRaw(LEGACY_OWNER_KEY);
  if (legacyOwner && legacyOwner !== tenantId) return [];
  if (!legacyOwner) storage.setRaw(LEGACY_OWNER_KEY, tenantId);
  storage.set(scopedKey, legacy);
  return legacy;
}

export function saveLocationLabels(
  labels: LocationLabel[],
  tenantId?: string | null,
): void {
  getStorage().set(
    tenantId ? scopedStorageKey(tenantId) : STORAGE_KEY,
    labels,
  );
}

export function hasLocationLabelsServerSync(tenantId: string): boolean {
  return getStorage().getRaw(serverSyncKey(tenantId)) === "1";
}

export function markLocationLabelsServerSynced(tenantId: string): void {
  getStorage().setRaw(serverSyncKey(tenantId), "1");
}

export function generateLocationLabelId(): string {
  return `loclbl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
