// Pure rules of the CSV import wizard: upload guardrails, the column map,
// the preview's reason line and the progress bar.

import type { RowReason } from "../csv-validate";
import type { ImportableField } from "../csv-mapping";
import type { ImportProgress } from "../useImportRows";

// Upload guardrails — web parity (UploadStep.tsx).
export const MAX_BYTES = 10 * 1024 * 1024; // 10 МБ
export const MAX_ROWS = 5000;
const ALLOWED_EXT = [".csv", ".txt"];

export type WizardStep = "upload" | "mapping" | "preview" | "result";

export const STEP_SUB: Record<WizardStep, string> = {
  upload: "Шаг 1 из 4 — выберите файл",
  mapping: "Шаг 2 из 4 — сопоставьте колонки",
  preview: "Шаг 3 из 4 — проверьте перед импортом",
  result: "Шаг 4 из 4 — результат",
};

export const REASON_TONE: Record<RowReason, "danger" | "warning"> = {
  "пустое имя": "danger",
  "битый телефон": "danger",
  "дубликат в файле": "warning",
  "дубликат в базе": "warning",
};

/** Guardrails — web parity (UploadStep.tsx): ≤10 МБ, .csv/.txt. Те же
 *  RU-тексты ошибок. `null` — файл можно читать. */
export function fileProblem(name: string, size: number | undefined): string | null {
  if ((size ?? 0) > MAX_BYTES) {
    return "Файл больше 10 МБ — пересохрани как CSV без лишних колонок.";
  }
  const lower = name.toLowerCase();
  if (!ALLOWED_EXT.some((ext) => lower.endsWith(ext))) {
    return "Только .csv или .txt файлы.";
  }
  return null;
}

/** Непустой файл, ≤5000 строк. `null` — строк в меру. */
export function rowsProblem(rows: number): string | null {
  if (rows === 0) {
    return "Файл пустой или нет строк данных (только заголовок).";
  }
  if (rows > MAX_ROWS) {
    return `Слишком много строк (${rows}). Максимум ${MAX_ROWS} за раз — раздели файл на части.`;
  }
  return null;
}

/** Column `idx` gets `field`. Keep each non-skip field on at most one
 *  column (mirror web / auto-map). */
export function withColumn(
  mapping: ImportableField[],
  idx: number,
  field: ImportableField,
): ImportableField[] {
  const next = [...mapping];
  next[idx] = field;
  if (field !== "skip") {
    for (let i = 0; i < next.length; i++) {
      if (i !== idx && next[i] === field) next[i] = "skip";
    }
  }
  return next;
}

/** «2 пустое имя · 1 битый телефон · …» under the preview counters. */
export function previewReasonParts(v: {
  emptyName: number;
  badPhone: number;
  duplicateInFile: number;
  duplicateInDb: number;
}): string[] {
  const parts: string[] = [];
  if (v.emptyName > 0) parts.push(`${v.emptyName} пустое имя`);
  if (v.badPhone > 0) parts.push(`${v.badPhone} битый телефон`);
  if (v.duplicateInFile > 0)
    parts.push(`${v.duplicateInFile} дубл. в файле`);
  if (v.duplicateInDb > 0)
    parts.push(`${v.duplicateInDb} уже в базе`);
  return parts;
}

/** Filled share of the progress bar, whole percent. */
export function progressPct(progress: ImportProgress | null): number {
  return progress && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;
}
