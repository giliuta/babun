// STORY-034 — Block configuration for the redesigned client card.
//
// This module is intentionally tiny.  v1: hardcoded order + default
// open/closed flags.  A future story (post-STORY-034) will add a
// settings UI that lets the tenant reorder blocks and toggle
// visibility per role.  Until then `loadBlockConfig()` just returns
// `DEFAULT_BLOCK_ORDER`.
//
// The ClientCardPage maps over the array to render blocks; switch on
// `kind` decides which component to mount.  Open-state for each
// block lives in localStorage under `babun-block-open:{kind}` —
// global per-kind to avoid 6300+ keys at 900-client scale.

export type BlockKind =
  | "objects"
  | "visits"
  | "finance"
  | "notes"
  | "attachments"
  | "contacts"
  | "personal"
  | "meta";

export interface BlockConfig {
  kind: BlockKind;
  /** Russian title shown in the collapsible header. */
  title: string;
  /** First-time open state.  Persists once the user toggles. */
  defaultOpen: boolean;
  /** TODO(roles): when the role gate ships, listed roles will see the
   *  block hidden entirely. */
  hiddenForRoles?: ReadonlyArray<"crew">;
}

export const DEFAULT_BLOCK_ORDER: ReadonlyArray<BlockConfig> = [
  // "Объекты" stays closed by default; ObjectsBlock auto-opens itself
  // when the client has more than one location with real data.
  { kind: "objects", title: "Объекты", defaultOpen: false },
  // History expands on first visit so dispatchers see context fast.
  { kind: "visits", title: "История визитов", defaultOpen: true },
  {
    kind: "finance",
    title: "Финансы",
    defaultOpen: false,
    hiddenForRoles: ["crew"],
  },
  { kind: "notes", title: "Заметки", defaultOpen: false },
  // clients-99 F3.10 — attachments (photos before/after, scans, contracts).
  { kind: "attachments", title: "Вложения", defaultOpen: false },
  { kind: "contacts", title: "Контакты", defaultOpen: false },
  { kind: "personal", title: "Личное", defaultOpen: false },
  {
    kind: "meta",
    title: "Метаданные",
    defaultOpen: false,
    hiddenForRoles: ["crew"],
  },
];

/**
 * v1 — return the hardcoded order.  Future settings UI will merge a
 * tenant override here.  Caller treats the array as immutable.
 */
export function loadBlockConfig(): ReadonlyArray<BlockConfig> {
  return DEFAULT_BLOCK_ORDER;
}

// ─── Open-state persistence ────────────────────────────────────────

const OPEN_KEY = (kind: BlockKind) => `babun-block-open:${kind}`;

/** Reads the persisted open-state for a block kind. */
export function getBlockOpen(kind: BlockKind, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(OPEN_KEY(kind));
  if (raw === "1") return true;
  if (raw === "0") return false;
  return fallback;
}

/** Writes the open-state for a block kind. */
export function setBlockOpen(kind: BlockKind, open: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(OPEN_KEY(kind), open ? "1" : "0");
}
