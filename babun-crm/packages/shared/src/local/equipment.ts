// Equipment / inventory — a lightweight per-tenant register of
// physical things the brigades carry or own. Shipped MVP v1 has:
//  · Name, category, optional serial, optional notes.
//  · Optional assignment to a brigade (assigned_team_id).
//  · sort_order for drag-reorder.
//
// Parked for later iterations:
//  · Per-master handoff (`assigned_master_id`).
//  · Amortisation / purchase-price on finances.
//  · Service / calibration reminders via `next_service_at`.
//  · Per-service required-equipment linkage (so calendar can
//    refuse to schedule a job if the required kit isn't at the
//    brigade).
//
// Storage is an offline read cache. Native callers pass tenantId so one
// account can never inherit another account's inventory on a shared device.
// The optional unscoped form is retained for the frozen web prototype and as
// a one-time legacy migration source.

import { generateId } from "./masters";
import { getStorage } from "../storage/provider";

export interface Equipment {
  id: string;
  name: string;
  /** Free text label — «Инструмент», «Машина», «Расходник»,
   *  «Измерительный прибор». No enum: every tenant defines their
   *  own vocabulary. */
  category?: string;
  /** Serial / inventory number. Optional. */
  serial?: string;
  /** Brigade this equipment is assigned to. null = «на полке»
   *  (not assigned). */
  assigned_team_id: string | null;
  /** Freeform notes. Optional. */
  notes?: string;
  /** UI tint — drawn on the list tile so a brigade can colour-
   *  code their fleet. */
  color?: string;
  is_active: boolean;
  created_at: string;
  /** Sort order within the inventory list (and within the brigade
   *  subroute). Records without a value sink to the end. */
  sort_order?: number;
}

const STORAGE_KEY = "babun-equipment";
const LEGACY_OWNER_KEY = `${STORAGE_KEY}:legacy-owner-tenant`;

function scopedStorageKey(tenantId: string, visibilityScope?: string): string {
  const base = `${STORAGE_KEY}:tenant:${tenantId}`;
  return visibilityScope ? `${base}:visibility:${visibilityScope}` : base;
}

function serverSyncKey(tenantId: string, visibilityScope?: string): string {
  return `${scopedStorageKey(tenantId, visibilityScope)}:server-synced`;
}

function normalizeEquipment(parsed: unknown): Equipment[] {
  if (!Array.isArray(parsed)) return [];
  return parsed.map((e: Partial<Equipment>) => ({
    id: e.id ?? generateId("eq"),
    name: e.name ?? "",
    category: e.category,
    serial: e.serial,
    assigned_team_id: e.assigned_team_id ?? null,
    notes: e.notes,
    color: e.color,
    is_active: e.is_active ?? true,
    created_at: e.created_at ?? new Date().toISOString(),
    sort_order: e.sort_order,
  })) as Equipment[];
}

export function loadEquipment(
  tenantId?: string | null,
  visibilityScope?: string,
): Equipment[] {
  const storage = getStorage();
  if (!tenantId) {
    return normalizeEquipment(storage.get<Partial<Equipment>[]>(STORAGE_KEY));
  }

  const scopedKey = scopedStorageKey(tenantId, visibilityScope);
  if (storage.getRaw(scopedKey) != null) {
    return normalizeEquipment(storage.get<Partial<Equipment>[]>(scopedKey));
  }

  // Restricted projections (for example a master's assigned teams) must
  // never claim the tenant-wide legacy/owner cache.
  if (visibilityScope) return [];

  // Pre-multitenant builds used one global key. Only the first active tenant
  // may claim it; a later account on the same phone always starts empty.
  const legacy = storage.get<Partial<Equipment>[]>(STORAGE_KEY);
  if (!Array.isArray(legacy)) return [];
  const owner = storage.getRaw(LEGACY_OWNER_KEY);
  if (owner && owner !== tenantId) return [];
  if (!owner) storage.setRaw(LEGACY_OWNER_KEY, tenantId);
  storage.set(scopedKey, legacy);
  return normalizeEquipment(legacy);
}

export function saveEquipment(
  list: Equipment[],
  tenantId?: string | null,
  visibilityScope?: string,
): void {
  getStorage().set(
    tenantId ? scopedStorageKey(tenantId, visibilityScope) : STORAGE_KEY,
    list,
  );
}

export function hasEquipmentCache(
  tenantId: string,
  visibilityScope?: string,
): boolean {
  const storage = getStorage();
  if (storage.getRaw(scopedStorageKey(tenantId, visibilityScope)) != null) {
    return true;
  }
  if (visibilityScope) return false;
  const legacy = storage.get<Partial<Equipment>[]>(STORAGE_KEY);
  if (!Array.isArray(legacy)) return false;
  const owner = storage.getRaw(LEGACY_OWNER_KEY);
  return !owner || owner === tenantId;
}

export function hasEquipmentServerSync(
  tenantId: string,
  visibilityScope?: string,
): boolean {
  return getStorage().getRaw(serverSyncKey(tenantId, visibilityScope)) === "1";
}

export function markEquipmentServerSynced(
  tenantId: string,
  visibilityScope?: string,
): void {
  getStorage().setRaw(serverSyncKey(tenantId, visibilityScope), "1");
}

export function createBlankEquipment(
  overrides: Partial<Equipment> = {},
): Equipment {
  return {
    id: generateId("eq"),
    name: "",
    category: undefined,
    serial: undefined,
    assigned_team_id: null,
    notes: undefined,
    color: undefined,
    is_active: true,
    created_at: new Date().toISOString(),
    sort_order: undefined,
    ...overrides,
  };
}
