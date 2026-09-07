import type { QueryClient } from "@tanstack/react-query";
import { uploadAttachment } from "@/features/clients/card-attachments";
import { uploadAppointmentAssets } from "./appointment-photos";
import type { PendingFile } from "./appointment-files";

export { pendingDocs, pendingMedia, type PendingFile } from "./appointment-files";

// ФАЙЛЫ НОВОЙ ЗАПИСИ ЖДУТ ЕЁ ID — как ждёт оплата (владелец 2026-09-06: «тут
// нет блока файлы» у новой записи). Пока записи нет, выбранное лежит в
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
    try {
      await uploadAppointmentAssets({
        tenantId: args.tenantId,
        appointmentId: args.appointmentId,
        input: { assets: media.map((f) => f.asset), kind: "other", locationId: args.locationId },
      });
    } catch {
      failed.push(...media.map((f) => f.name));
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
  void args.queryClient.invalidateQueries({ queryKey: ["client-attachments"] });
  return failed;
}
