// ЧИСТАЯ ЛОГИКА БЛОКА «ФАЙЛЫ» ЗАПИСИ (STORY-070): подписи и очередь без
// React Native — тестируется под node. Типы пикеров — только типами: под
// node их модули тянут react-native.

import type { PickedFile } from "@/features/clients/card-attachments";
import type { PickedAppointmentPhoto } from "./appointment-photos";

/** Имя файла на плитке: без хвоста расширения, если оно и так видно по значку. */
export function docTitle(filename: string): string {
  const trimmed = filename.trim();
  const dot = trimmed.lastIndexOf(".");
  return dot > 0 ? trimmed.slice(0, dot) : trimmed || "Документ";
}

/** Видео или фото — по расширению пути в бакете: таблица одна на оба. */
export function isVideoPath(path: string): boolean {
  return /\.(mp4|mov|m4v)$/i.test(path.trim());
}

export interface PendingFile {
  id: string;
  kind: "media" | "document";
  asset: PickedAppointmentPhoto & PickedFile;
  name: string;
  /** Локальный uri для превью картинки; у видео и документов — null. */
  previewUri: string | null;
  video: boolean;
}

export function pendingMedia(assets: PickedAppointmentPhoto[], makeId: () => string): PendingFile[] {
  return assets.map((asset) => {
    const video = asset.mediaType === "video" || isVideoPath(asset.fileName ?? asset.uri);
    return {
      id: makeId(),
      kind: "media",
      asset,
      name: asset.fileName ?? (video ? "video" : "photo"),
      previewUri: video ? null : asset.uri,
      video,
    };
  });
}

export function pendingDocs(files: PickedFile[], makeId: () => string): PendingFile[] {
  return files.map((file) => ({
    id: makeId(),
    kind: "document",
    asset: file,
    name: file.fileName ?? "Документ",
    previewUri: null,
    video: false,
  }));
}
