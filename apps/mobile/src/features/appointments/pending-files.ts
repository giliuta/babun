import type { QueryClient } from "@tanstack/react-query";
import { uploadAttachment } from "@/features/clients/card-attachments";
import {
  RetryableAppointmentPhotoUploadError,
  uploadAppointmentAssets,
  uploadOrQueueMemberPhotos,
} from "./appointment-photos";
import { isMemberQueueRunning } from "@/lib/member-queue/runtime";
import type { PendingFile } from "./appointment-files";
import { clientKeys } from "@/lib/client-query-keys";

export { pendingDocs, pendingMedia, type PendingFile } from "./appointment-files";

// ФАЙЛЫ НОВОЙ ЗАПИСИ ЖДУТ ЕЁ ID — как ждёт оплата. Пока записи нет, выбранное лежит в
// очереди страницы и рисуется плитками; после «Создать запись» очередь
// уезжает тем же путём, что тап по «Добавить» у сохранённой.

/** Выгрузка очереди после создания. Возвращает имена того, что не уехало:
 *  страница скажет об этом одной плашкой, запись при этом уже создана. */
export async function uploadPendingFiles(args: {
  tenantId: string;
  appointmentId: string;
  clientId: string | null;
  locationId: string | null;
  files: PendingFile[];
  queryClient: QueryClient;
}): Promise<string[]> {
  const failed: string[] = [];
  const media = args.files.filter((f) => f.kind === "media");
  const docs = args.files.filter((f) => f.kind === "document");
  if (media.length > 0) {
    const upload = {
      tenantId: args.tenantId,
      appointmentId: args.appointmentId,
      input: { assets: media.map((f) => f.asset), kind: "other" as const, locationId: args.locationId },
    };
    try {
      // У сотрудника фото без сети ждут в очереди телефона — за самой
      // записью, если и она ещё не дошла (`lib/member-queue`).
      await (isMemberQueueRunning() ? uploadOrQueueMemberPhotos(upload) : uploadAppointmentAssets(upload));
    } catch (error) {
      // Не уехало — только то, что повтор отдал назад: уже выгруженные
      // файлы лежат на записи, и назвать их «не загружены» значило бы
      // позвать добавить их второй раз.
      const left =
        error instanceof RetryableAppointmentPhotoUploadError
          ? new Set(error.retryInput.assets)
          : null;
      failed.push(...media.filter((f) => !left || left.has(f.asset)).map((f) => f.name));
    }
  }
  for (const doc of docs) {
    if (!args.clientId) {
      failed.push(doc.name);
      continue;
    }
    try {
      await uploadAttachment({
        tenantId: args.tenantId,
        clientId: args.clientId,
        file: doc.asset,
        appointmentId: args.appointmentId,
      });
    } catch {
      failed.push(doc.name);
    }
  }
  void args.queryClient.invalidateQueries({ queryKey: ["appointment-photos"] });
  void args.queryClient.invalidateQueries({ queryKey: clientKeys.attachmentAll() });
  return failed;
}
