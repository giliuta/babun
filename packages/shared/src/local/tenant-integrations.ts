// Brief 3 #13 — Tenant messenger-channel integrations.
//
// MVP storage layer: per-tenant connected channels live in localStorage
// keyed by tenant id. Real Supabase table comes with STORY-094-channels
// (server-side message dispatch + webhook receiver). Until then the
// settings UI persists the token locally so the page reflects a
// «connected» state across reloads and the user can copy / clear it.

import { generateId } from "./masters";

export type ChannelKind = "telegram" | "whatsapp" | "instagram";

export interface ChannelIntegration {
  id: string;
  kind: ChannelKind;
  token: string;
  /** Human label the user can set ("Основной бот", "Тест") — optional. */
  name?: string;
  connected_at: string; // ISO
  status: "active" | "paused";
}

const STORAGE_KEY = "babun:tenant-integrations";

function tenantKey(tenantId: string): string {
  return `${STORAGE_KEY}:${tenantId}`;
}

export function loadChannelIntegrations(
  tenantId: string,
): ChannelIntegration[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(tenantKey(tenantId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is ChannelIntegration =>
        typeof x?.id === "string" &&
        typeof x?.kind === "string" &&
        typeof x?.token === "string",
    );
  } catch {
    return [];
  }
}

export function saveChannelIntegrations(
  tenantId: string,
  list: ChannelIntegration[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(tenantKey(tenantId), JSON.stringify(list));
  } catch {
    // private mode / quota — silently drop; the page will re-prompt.
  }
}

export function upsertChannelIntegration(
  tenantId: string,
  patch: Omit<ChannelIntegration, "id" | "connected_at" | "status"> & {
    id?: string;
  },
): ChannelIntegration {
  const list = loadChannelIntegrations(tenantId);
  const id = patch.id ?? generateId("ch");
  const next: ChannelIntegration = {
    id,
    kind: patch.kind,
    token: patch.token,
    name: patch.name,
    connected_at: new Date().toISOString(),
    status: "active",
  };
  const dedup = list.filter((x) => x.id !== id);
  saveChannelIntegrations(tenantId, [...dedup, next]);
  return next;
}

export function removeChannelIntegration(
  tenantId: string,
  id: string,
): void {
  const list = loadChannelIntegrations(tenantId);
  saveChannelIntegrations(
    tenantId,
    list.filter((x) => x.id !== id),
  );
}

/** Light validation of a Telegram bot token shape: NNNN:abc… */
export function isTelegramTokenShape(token: string): boolean {
  return /^\d{6,12}:[A-Za-z0-9_-]{20,}$/.test(token.trim());
}

/** Mask the secret part of a token for display: «12345678:AAH****…tQ». */
export function maskToken(token: string): string {
  const [id, secret] = token.split(":");
  if (!secret) return token.slice(0, 6) + "…";
  const head = secret.slice(0, 4);
  const tail = secret.slice(-2);
  return `${id}:${head}…${tail}`;
}
