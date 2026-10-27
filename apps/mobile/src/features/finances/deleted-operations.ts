import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  eraseDeletedOperation,
  listDeletedOperations,
  restoreDeletedOperation,
  type DeletedOperation,
} from "@babun/shared/db/repositories/deleted-operations";
import { deletedOperationsQueryKey } from "@/lib/company-query-keys";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { NEVER_PAUSE } from "./accounts";
import { checkBudgetsAfterWrite } from "./budget-notify";
import { invalidateLedger } from "./queries";

// «УДАЛЁННЫЕ ОПЕРАЦИИ» — ящик живёт на сервере, офлайн его
// не прочитать и не тронуть: все записи — `NEVER_PAUSE`, ошибка сразу.

/** Ящик всей компании; страница и дверь режут его по команде сами — кэш один. */
export function useDeletedOperations() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: deletedOperationsQueryKey(tenantId),
    enabled: !!tenantId,
    queryFn: () => listDeletedOperations(supabase, tenantId as string),
  });
}

/** Строка уходит из ящика, как только сервер ответил «готово»: без
 *  этого она висела 2–3 секунды — пока перечитывается весь журнал. */
function dropFromTrash(qc: ReturnType<typeof useQueryClient>, tenantId: string | null, id: string) {
  qc.setQueryData<DeletedOperation[]>(deletedOperationsQueryKey(tenantId), (rows) =>
    rows?.filter((row) => row.id !== id),
  );
}

/** «Вернуть» — операция снова в ленте и в остатках. */
export function useRestoreOperation() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (id: string) => restoreDeletedOperation(supabase, id),
    onSuccess: (_data, id) => {
      // День операции — из снимка в ящике, пока строка ещё там.
      const restored = qc
        .getQueryData<DeletedOperation[]>(deletedOperationsQueryKey(tenantId))
        ?.find((row) => row.id === id);
      dropFromTrash(qc, tenantId, id);
      // Вернувшийся расход — снова в месяце категории: бюджет пересчитывается,
      // как после любой записи расхода (вставка и правка делают то же).
      if (restored?.transaction.type === "expense") {
        checkBudgetsAfterWrite(qc, tenantId, restored.transaction.occurred_on);
      }
    },
    onSettled: () => invalidateLedger(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

/** «Удалить насовсем» — раньше ночной очистки. */
export function useEraseDeletedOperation() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (id: string) => eraseDeletedOperation(supabase, id),
    onSuccess: (_data, id) => dropFromTrash(qc, tenantId, id),
    onSettled: () => invalidateLedger(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
