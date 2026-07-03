// CSV import — resume-on-interrupt support.
//
// Mobile port of apps/web/.../csv-resume.ts. Persists the in-flight batch
// offset (via the shared KVStorage seam — MMKV on device) so a killed app /
// dropped connection can continue a half-imported file WITHOUT re-inserting
// the rows already written. NOT auto-resume: the wizard's upload step
// surfaces a «продолжить / начать заново» prompt and the user picks.
//
// The fileHash guard ensures we only offer to resume the SAME file — pick a
// different CSV and the stale state is ignored (and pruned).

import { getStorage } from "@babun/shared/storage";

// Same `babun-…` key convention the mobile app uses elsewhere.
const KEY = "babun-clients-import-resume";
const TTL_MS = 60 * 60 * 1000; // 1 hour

export interface ImportResumeState {
  fileHash: string;
  fileName: string;
  totalRows: number;
  importedRows: number;
  /** Number of CHUNK-sized batches this run was sliced into. */
  totalBatches: number;
  /** Next batch index to process (0-based). A completed run clears state. */
  nextBatchIndex: number;
  /** Unix epoch ms. */
  timestamp: number;
}

export function loadResumeState(): ImportResumeState | null {
  try {
    const parsed = getStorage().get<ImportResumeState>(KEY);
    if (!parsed) return null;
    if (typeof parsed.fileHash !== "string") return null;
    if (typeof parsed.timestamp !== "number") return null;
    if (Date.now() - parsed.timestamp > TTL_MS) {
      // Auto-prune stale entries on read so the prompt never fires for a
      // forgotten import older than the TTL.
      clearResumeState();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveResumeState(state: ImportResumeState): void {
  try {
    getStorage().set(KEY, state);
  } catch {
    // Resume is a nice-to-have — never fail the import on a quota blip.
  }
}

export function clearResumeState(): void {
  try {
    getStorage().remove(KEY);
  } catch {
    // ignore
  }
}
