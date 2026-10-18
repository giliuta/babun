import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  eraseDeletedAppointment,
  listDeletedAppointments,
  restoreDeletedAppointment,
  type DeletedAppointment,
} from "@babun/shared/db/repositories/deleted-appointments";
import { removePhotoBlobs } from "@babun/shared/db/repositories/appointment-photos";
import { deletedAppointmentsQueryKey } from "@/lib/company-query-keys";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { NEVER_PAUSE } from "@/features/finances/accounts";

// «УДАЛЁННЫЕ ЗАПИСИ» — ящик живёт на сервере, офлайн его не прочитать
// и не тронуть: все записи — `NEVER_PAUSE`, ошибка сразу. Удаление в ящик —
// `useTrashAppointment` (mutations.ts), рядом с остальными правками записи.

/** Ящик всей компании; страница и дверь режут его по календарю сами — кэш
 *  один. */
export function useDeletedAppointments() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: deletedAppointmentsQueryKey(tenantId),
    enabled: !!tenantId,
    // Компанию задаёт сессия запроса; `tenantId` держит ключ кэша.
    queryFn: () => listDeletedAppointments(supabase),
  });
}

/** Строка уходит из ящика, как только сервер ответил, — не ждёт перечитки. */
function dropFromTrash(qc: ReturnType<typeof useQueryClient>, tenantId: string | null, id: string) {
  qc.setQueryData<DeletedAppointment[]>(deletedAppointmentsQueryKey(tenantId), (rows) =>
    rows?.filter((row) => row.id !== id),
  );
}

function refreshCalendar(qc: ReturnType<typeof useQueryClient>, tenantId: string | null) {
  void qc.invalidateQueries({ queryKey: ["appointments"] });
  void qc.invalidateQueries({ queryKey: ["clients"] });
  void qc.invalidateQueries({ queryKey: deletedAppointmentsQueryKey(tenantId) });
}

/** «Вернуть» — запись снова в календаре с фото и связями. */
export function useRestoreAppointment() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (id: string) => restoreDeletedAppointment(supabase, id),
    onSuccess: (_data, id) => dropFromTrash(qc, tenantId, id),
    onSettled: () => refreshCalendar(qc, tenantId),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

/** «Удалить насовсем» — раньше ночной очистки. Файлы фото стираются следом,
 *  best effort: ночная очистка их не стирает (SQL не удаляет файлы
 *  хранилища), так что это единственная дорога, где они уходят сразу. */
export function useEraseDeletedAppointment() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async (item: Pick<DeletedAppointment, "id" | "photoPaths">) => {
      await eraseDeletedAppointment(supabase, item.id);
      if (item.photoPaths.length > 0) void removePhotoBlobs(supabase, item.photoPaths);
    },
    onSuccess: (_data, item) => dropFromTrash(qc, tenantId, item.id),
    onSettled: () => void qc.invalidateQueries({ queryKey: deletedAppointmentsQueryKey(tenantId) }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
