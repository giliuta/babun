// STORY-062 slice 2 — shared global sync-error surface.
//
// Port of apps/web/src/lib/sync/sync-error-bus.ts. One change vs the web
// original: telemetry is INJECTED rather than imported. The web version
// imports `@/lib/observability/telemetry` (a web-only façade); the shared
// version can't, so callers install their reporter via
// `setSyncErrorTelemetry()`. Default is a no-op — behaviour is identical
// to "no adapter installed" on web. The RN app can wire Sentry here; the
// web app keeps its own copy of this module (with the direct import) for
// now, so nothing web-side changes.
//
// The `"use client"` directive from the web original is dropped: it is a
// Next.js RSC marker with no meaning outside apps/web, and RN's bundler
// treats a bare string literal as a harmless no-op — but leaving it would
// be misleading in a shared package.

import { useSyncExternalStore } from "react";

export interface SyncErrorState {
  /** Latest unacknowledged error, or null when nothing's pending. */
  lastError: { message: string; at: number } | null;
}

// ─── Injectable telemetry ─────────────────────────────────────────────
// Matches the web telemetry façade's captureException signature so the
// web app can pass its real one straight through; RN can pass its Sentry
// wrapper. Default no-op = "no adapter installed" (the web default too).
type CaptureException = (
  error: unknown,
  extras?: Record<string, unknown>,
) => void;

let captureException: CaptureException = () => {};

/** Install a telemetry reporter. Called once at app bootstrap. */
export function setSyncErrorTelemetry(fn: CaptureException): void {
  captureException = fn;
}

let state: SyncErrorState = { lastError: null };
const subscribers = new Set<() => void>();

function emit(): void {
  for (const fn of subscribers) fn();
}

// Banner UX policy (unchanged from web v665):
//   • One isolated failure: silent. Counter goes 0 → 1, no pill.
//   • Two-or-more failures within a 30 s window: surface the pill.
//   • Any successful save: counter back to 0, pill cleared.
//   • No new errors for 30 s after the last one: counter back to 0,
//     pill auto-clears (we treat the lull as a successful idle).
const SURFACE_THRESHOLD = 2;
const AUTO_CLEAR_MS = 30_000;
let recentFailureCount = 0;
let autoClearTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutoClear(): void {
  if (autoClearTimer) clearTimeout(autoClearTimer);
  autoClearTimer = setTimeout(() => {
    autoClearTimer = null;
    recentFailureCount = 0;
    if (state.lastError !== null) {
      state = { lastError: null };
      emit();
    }
  }, AUTO_CLEAR_MS);
}

// Supabase / PostgREST reject with plain objects { code, details, hint,
// message }, not Error instances — so a naive `String(err)` renders
// «[object Object]». Pull the real message (prefixed with the PG error
// code when present) out instead.
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string" && o.message) {
      return typeof o.code === "string" && o.code
        ? `[${o.code}] ${o.message}`
        : o.message;
    }
    try {
      const json = JSON.stringify(err);
      if (json && json !== "{}") return json;
    } catch {
      /* circular reference — fall through to String() */
    }
  }
  return String(err);
}

export function reportSyncError(err: unknown): void {
  const message = extractErrorMessage(err);
  recentFailureCount += 1;
  if (recentFailureCount >= SURFACE_THRESHOLD) {
    state = { lastError: { message, at: Date.now() } };
    emit();
  }
  scheduleAutoClear();
  // Wrap non-Error values in a real Error so telemetry gets a stack from
  // this point; keep the original payload as extra context.
  const wrapped =
    err instanceof Error
      ? err
      : Object.assign(new Error(message), { name: "SyncError" });
  const extras: Record<string, unknown> = { subsystem: "sync" };
  if (!(err instanceof Error) && typeof err === "object" && err !== null) {
    extras.original = err;
  }
  captureException(wrapped, extras);
}

export function clearSyncError(): void {
  // A successful save resets BOTH the visible state and the back-off
  // counter — next single failure goes back to silent.
  recentFailureCount = 0;
  if (autoClearTimer) {
    clearTimeout(autoClearTimer);
    autoClearTimer = null;
  }
  if (state.lastError !== null) {
    state = { lastError: null };
    emit();
  }
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function getSnapshot(): SyncErrorState {
  return state;
}

function getServerSnapshot(): SyncErrorState {
  // SSR-safe — first paint never shows an error.
  return { lastError: null };
}

export function useSyncError(): SyncErrorState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
