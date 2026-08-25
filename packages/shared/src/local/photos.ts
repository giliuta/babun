// Photo helpers for the AppointmentPhoto flow.
// - compressImageToBlob: downscale + JPEG quality cascade. Returns a
//   Blob ready for Supabase Storage upload (STORY-049 A8). Targets
//   500 KB at quality 0.7, falls through to 0.5 / 0.35 if oversized.
//   Hard cap is the 5 MB Storage bucket limit.
// - generateCaption: "До · 14:35 · Спальня" built from kind + time +
//   optional object label.
// - validatePhotoFile: client-side MIME + size check before upload.

import type { PhotoKind } from "./appointments";

const MAX_DIMENSION = 1600;
const DEFAULT_BUDGET_KB = 500;
const HARD_CAP_BYTES = 5 * 1024 * 1024; // 5 MB — matches bucket limit

export async function compressImageToBlob(
  file: File,
  budgetKb = DEFAULT_BUDGET_KB,
): Promise<Blob> {
  const img = await fileToImage(file);
  const { width, height } = fit(img.width, img.height, MAX_DIMENSION);

  const qualities = [0.7, 0.5, 0.35];
  const budgetBytes = budgetKb * 1024;

  let lastBlob: Blob | null = null;
  for (const q of qualities) {
    const blob = await canvasToBlob(img, width, height, q);
    lastBlob = blob;
    if (blob.size < budgetBytes) return blob;
  }
  if (!lastBlob) throw new Error("Не удалось сжать изображение");
  if (lastBlob.size > HARD_CAP_BYTES) {
    throw new Error("Файл больше 5 МБ — выбери меньше или попробуй другой кадр");
  }
  return lastBlob;
}

async function canvasToBlob(
  img: HTMLImageElement,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("toBlob returned null"));
      },
      "image/jpeg",
      quality,
    );
  });
}

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

export interface PhotoFileValidation {
  ok: boolean;
  reason?: string;
}

export function validatePhotoFile(file: File): PhotoFileValidation {
  if (!ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])) {
    return { ok: false, reason: "Только JPG / PNG / WebP" };
  }
  if (file.size > HARD_CAP_BYTES) {
    return { ok: false, reason: "Файл больше 5 МБ" };
  }
  return { ok: true };
}

export function generateCaption(
  kind: PhotoKind,
  locationLabel?: string,
  date: Date = new Date()
): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const parts: string[] = [kindLabel(kind), `${hh}:${mm}`];
  if (locationLabel && locationLabel.trim()) parts.push(locationLabel.trim());
  return parts.join(" · ");
}

export function kindLabel(kind: PhotoKind): string {
  if (kind === "before") return "До";
  if (kind === "after") return "После";
  return "Прочее";
}

// validatePhotoSize was used by the legacy data_url flow. Replaced by
// validatePhotoFile (above) for the Storage-based upload path.

function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Не удалось открыть изображение"));
      img.onload = () => resolve(img);
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function fit(
  w: number,
  h: number,
  max: number
): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  const ratio = w > h ? max / w : max / h;
  return {
    width: Math.round(w * ratio),
    height: Math.round(h * ratio),
  };
}
