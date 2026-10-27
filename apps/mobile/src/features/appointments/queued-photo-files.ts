// ФОТО, КОТОРЫЕ ЖДУТ СЕТИ. Пикер отдаёт файл во временной папке, а её система
// чистит, когда захочет, — снимок, отложенный до подвала, мог бы исчезнуть до
// отправки. Поэтому до постановки в очередь файл копируется в документы
// приложения, и каждому выдаётся номер снимка: с ним повтор находит уже
// уехавшее и не задваивает фото (`uploadPhoto` в shared).

import { Directory, File, Paths } from "expo-file-system";
import { randomUuid } from "@babun/shared/sync";
import type { PickedAppointmentPhoto } from "./appointment-photos";

const FOLDER = "member-queue-photos";

function extensionOf(asset: PickedAppointmentPhoto): string {
  const source = `${asset.fileName ?? ""} ${asset.uri}`;
  return /\.([a-z0-9]{2,5})(\?|\s|$)/i.exec(source)?.[1]?.toLowerCase() ?? "jpg";
}

/** Копии в документы + номера снимков. Файл не скопировался (нет места) —
 *  остаётся прежний путь: отправка хотя бы попробует. */
export function keepPhotosForQueue(assets: readonly PickedAppointmentPhoto[]): PickedAppointmentPhoto[] {
  let folder: Directory | null = null;
  try {
    folder = new Directory(Paths.document, FOLDER);
    folder.create({ intermediates: true, idempotent: true });
  } catch {
    // папка недоступна — копирование ниже скажет само
  }
  return assets.map((asset) => {
    const photoId = asset.photoId ?? randomUuid();
    try {
      if (!folder) throw new Error("no folder");
      const kept = new File(folder, `${photoId}.${extensionOf(asset)}`);
      if (!kept.exists) new File(asset.uri).copy(kept);
      return { ...asset, uri: kept.uri, photoId };
    } catch {
      return { ...asset, photoId };
    }
  });
}

/** Снимки дошли — копии больше не нужны. */
export async function forgetQueuedPhotoFiles(assets: readonly PickedAppointmentPhoto[]): Promise<void> {
  for (const asset of assets) {
    if (!asset.uri.includes(FOLDER)) continue;
    try {
      const file = new File(asset.uri);
      if (file.exists) file.delete();
    } catch {
      // копия осталась — место она занимает, но ничего не ломает
    }
  }
}
