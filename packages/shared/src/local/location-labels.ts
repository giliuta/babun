// Location labels reference book — object types the business creates itself.
// Persisted in the shared KV seam. Used for the preset chips in
// LocationsBlock when creating/editing a client's object.

import { getStorage } from "../storage/provider";

export interface LocationLabel {
  id: string;
  name: string;
  /** ВИД ТИПА ОБЪЕКТА — цвет и значок из общих наборов (владелец 2026-09-10:
   *  «нету у нас это в дом, нету в квартиру… давай лучше везде это делать»).
   *  Пусто — «не красить» и «глиф вида»: у справочника, заведённого до этой
   *  правки, вида нет, и подставлять его за пользователя нельзя. */
  color?: string | null;
  icon?: string | null;
  /** Команда типа (владелец 30.09: «типы объектов закреплены за командой»).
   *  Пусто — только у строк до миграции 30.09. */
  teamId?: string | null;
}

const STORAGE_KEY = "babun2:settings:location-labels";
const LEGACY_OWNER_KEY = `${STORAGE_KEY}:legacy-owner-tenant`;

function scopedStorageKey(tenantId: string): string {
  return `${STORAGE_KEY}:tenant:${tenantId}`;
}

function serverSyncKey(tenantId: string): string {
  return `${scopedStorageKey(tenantId)}:server-synced`;
}

// ГОТОВОГО НАБОРА ТИПОВ НЕТ (владелец 03.10: «типов не должно быть
// изначально — каждый человек сам создаёт свой тип объекта»). Пресет
// «Дом / Квартира / Офис / Вилла» снят вместе с кнопкой «Добавить
// стандартные»: справочник пуст, пока человек не заведёт свой тип.

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
