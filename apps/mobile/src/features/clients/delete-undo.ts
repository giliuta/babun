import { useCallback } from "react";
import type { Client } from "@babun/shared/local/clients";
import { useToast } from "@/components/ui/Toast";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import {
  useArchiveClients,
  useRestoreClient,
  type ArchiveClientsResult,
} from "@/features/clients/queries";
import { haptics } from "@/lib/haptics";

// УДАЛЕНИЕ С ОТМЕНОЙ НА МЕСТЕ.
//
// Владелец 2026-08-08: «заархивировал клиента — как мне его теперь найти,
// куда он попадает, я не понимаю». Тост с «Отменить» (5 секунд, остальной
// экран остаётся рабочим) — возврат РЯДОМ с действием, а не в настройках.
// Полка «Удалённые клиенты» — для «через неделю передумал», кнопка здесь —
// для «промахнулся».
//
// АРХИВА НЕТ (владелец 03.10: «понятия „в архив" не будет — удалить»).
// Удаление одно: клиент уходит в «Удалённые клиенты» со сроком стирания, а
// клиенту с записями, инвойсами или деньгами база срок снимает сама
// (`client_history_never_purges`) — он лежит там, пока его не вернут.
//
// Хук общий на все двери удаления (карточка, свайп и меню в списке,
// массовый режим): иначе следующая дверь однажды снова откроется молча.

/** Удаляет клиентов и показывает тост с «Отменить». Возвращает результат
 *  мутации: уходить ли с экрана и что сказать про неудачи — решает вызвавший,
 *  у каждой двери это своё. Мутация не проглатывает ошибку — она пробрасывается. */
export function useDeleteWithUndo() {
  const archive = useArchiveClients();
  const restore = useRestoreClient();
  const toast = useToast();

  return useCallback(
    async (clients: readonly Client[]): Promise<ArchiveClientsResult> => {
      const res = await archive.mutateAsync({
        ids: clients.map((c) => c.id),
        trash: true,
      });
      if (res.archived === 0) return res;

      // Восстанавливаем ровно тех, кто ДОШЁЛ до полки: при частичной
      // неудаче остальные и так остались в рабочем списке.
      const done = clients.filter((c) => res.archivedIds.includes(c.id));
      const one = done.length === 1;
      // Частичная неудача сообщается ЗДЕСЬ ЖЕ, а не вторым тостом от
      // вызывающего: второй перекрыл бы первый вместе с кнопкой отмены.
      toast(
        res.failed > 0
          ? `Удалено: ${done.length}, не удалось: ${res.failed}`
          : one
            ? "Клиент удалён"
            : `Удалено: ${done.length}`,
        res.failed > 0 ? "error" : "success",
        {
          label: "Отменить",
          onPress: () => {
            void (async () => {
              const settled = await Promise.allSettled(
                done.map((c) => restore.mutateAsync(c)),
              );
              const back = settled.filter((s) => s.status === "fulfilled").length;
              if (back === done.length) {
                haptics.success();
                toast(
                  one
                    ? "Клиент вернулся в список"
                    : `Вернулись в список: ${back}`,
                  "success",
                );
                return;
              }
              haptics.warning();
              const lost = done.length - back;
              toast(
                `Не удалось вернуть ${lost} ${countWordRu(lost, "клиента", "клиентов", "клиентов")} — они в удалённых, верните вручную`,
                "error",
              );
            })();
          },
        },
      );
      return res;
    },
    [archive, restore, toast],
  );
}
