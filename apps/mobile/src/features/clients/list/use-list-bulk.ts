import { useMemo, type Dispatch, type SetStateAction } from "react";
import type { ClientTag } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { TRASH_DAYS } from "@babun/shared/db/repositories/clients";
import type { useToast } from "@/components/ui/Toast";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { writeErrorWords } from "@/lib/connection-words";
import type { useDeleteWithUndo } from "@/features/clients/delete-undo";
import { shareClientsCsv } from "@/features/clients/bulk-export";
import type { ClientsScope } from "@/features/clients/clients-company";
import type { ClientFilterResult } from "@/features/clients/useClientFilters";

/** Bulk mode: what is picked among the visible own rows, and the actions
 *  over that set (CSV, SMS, delete). */
export function useListBulk({
  result,
  guestOf,
  selectedIds,
  setSelectedIds,
  setSelecting,
  tags,
  allStatsMap,
  toast,
  deleteWithUndo,
}: {
  result: ClientFilterResult;
  guestOf: Map<string, ClientsScope>;
  selectedIds: Set<string>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  setSelecting: Dispatch<SetStateAction<boolean>>;
  tags: ClientTag[];
  allStatsMap: Map<string, ClientStats>;
  toast: ReturnType<typeof useToast>;
  deleteWithUndo: ReturnType<typeof useDeleteWithUndo>;
}) {
  // ── Bulk-mode helpers ─────────────────────────────────────────────
  // «Выбрать всё» = всё СВОЁ, что сейчас в списке: клиенты партнёра в общем
  // списке видны, но в выгрузку, рассылку и архив не попадают никогда.
  const visible = useMemo(
    () => result.filtered.filter((c) => !guestOf.has(c.id)),
    [result.filtered, guestOf],
  );
  // Считаем ВИДИМЫХ выбранных: массовое действие работает по ним же,
  // а selectedIds может помнить исчезнувших из выдачи.
  const pickedCount = visible.reduce(
    (n, c) => (selectedIds.has(c.id) ? n + 1 : n),
    0,
  );
  const allSelected =
    visible.length > 0 && visible.every((c) => selectedIds.has(c.id));

  const enterSelection = (seedId?: string) => {
    setSelecting(true);
    setSelectedIds(seedId ? new Set([seedId]) : new Set());
  };
  const exitSelection = () => {
    setSelecting(false);
    setSelectedIds(new Set());
  };
  const toggleId = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(visible.map((c) => c.id)));

  // Массовые действия — строго по ВИДИМОМУ списку: если фильтр изменился
  // после выбора, «Удалить 12» не должно задеть невидимых.
  const selectedClients = useMemo(
    () => visible.filter((c) => selectedIds.has(c.id)),
    [visible, selectedIds],
  );

  const onExport = async () => {
    if (selectedClients.length === 0) return;
    try {
      const shared = await shareClientsCsv(selectedClients, tags, allStatsMap);
      if (shared) {
        toast(`CSV выгружен (${selectedClients.length})`, "success");
        exitSelection();
      }
    } catch (e) {
      notify("Не удалось выгрузить", (e as Error).message);
    }
  };

  const onBulkDelete = () => {
    const n = selectedClients.length;
    if (n === 0) return;
    const word = countWordRu(n, "клиента", "клиента", "клиентов");
    confirmThen(
      `Удалить ${n} ${word}?`,
      {
        message: `Клиенты уйдут в «Удалённые клиенты». Кто без записей и денег — сотрётся через ${TRASH_DAYS} дней, у остальных история останется в отчётах. Вернуть можно сразу кнопкой «Отменить», а позже — в шестерёнке.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      async () => {
        try {
          // Итог (в т.ч. частичный) и кнопка отмены — в одном тосте;
          // здесь остаётся только случай «не удалился никто».
          const { archived, failed } = await deleteWithUndo(selectedClients);
          if (archived === 0) {
            notify(
              "Не удалось удалить",
              `Ни один из ${failed} клиентов не удалён. Проверьте соединение и попробуйте ещё раз.`,
            );
            return;
          }
          exitSelection();
        } catch (e) {
          const words = writeErrorWords(e, {
            failed: "Не удалось удалить",
            notDone: "Клиенты не удалены",
          });
          notify(words.title, words.subtitle);
        }
      },
    );
  };

  return {
    pickedCount,
    allSelected,
    enterSelection,
    exitSelection,
    toggleId,
    toggleAll,
    selectedClients,
    onExport,
    onBulkDelete,
  };
}
