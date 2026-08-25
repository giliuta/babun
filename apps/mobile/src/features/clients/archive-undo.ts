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

// АРХИВ С ОТМЕНОЙ НА МЕСТЕ.
//
// Владелец 2026-08-08: «заархивировал клиента — как мне его теперь найти,
// куда он попадает, я не понимаю». И был прав: с карточки архивация просто
// закрывала экран БЕЗ СЛОВА, а из списка показывала тост «Клиент перемещён
// в архив», после которого единственная дорога назад — Клиенты › шестерёнка
// › «Архив клиентов». Три тапа в настройках сразу после того, как экран с
// клиентом исчез, — это не отмена, это поиск пропажи.
//
// Тост уже умеет кнопку (5 секунд, остальной экран остаётся рабочим), так
// что правильный ответ канонический: возврат живёт РЯДОМ с действием, а не
// в настройках. Архив при этом никуда не девается — он для «через неделю
// передумал», а кнопка здесь для «промахнулся».
//
// Хук общий на все три двери в архив (карточка, свайп в списке, массовый
// режим): иначе четвёртая дверь однажды снова откроется молча.

/** Архивирует клиентов и показывает тост с «Отменить». Возвращает результат
 *  мутации: уходить ли с экрана и что сказать про неудачи — решает вызвавший,
 *  у каждой двери это своё. Мутация не проглатывает ошибку — она пробрасывается. */
export function useArchiveWithUndo() {
  const archive = useArchiveClients();
  const restore = useRestoreClient();
  const toast = useToast();

  return useCallback(
    async (
      clients: readonly Client[],
      /** true — в «Недавно удалённые» на 30 дней, иначе в архив. */
      trash = false,
    ): Promise<ArchiveClientsResult> => {
      const res = await archive.mutateAsync({
        ids: clients.map((c) => c.id),
        trash,
      });
      if (res.archived === 0) return res;

      // Восстанавливаем ровно тех, кто ДОШЁЛ до архива: при частичной
      // неудаче остальные и так остались в рабочем списке.
      const done = clients.filter((c) => res.archivedIds.includes(c.id));
      const one = done.length === 1;
      // Частичная неудача сообщается ЗДЕСЬ ЖЕ, а не вторым тостом от
      // вызывающего: второй перекрыл бы первый вместе с кнопкой отмены.
      const where = trash ? "в удалённых" : "в архиве";
      toast(
        res.failed > 0
          ? `${trash ? "Удалено" : "В архиве"}: ${done.length}, не удалось: ${res.failed}`
          : one
            ? `Клиент ${where}`
            : `${trash ? "Удалено" : "В архиве"}: ${done.length}`,
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
                `Не удалось вернуть ${lost} ${countWordRu(lost, "клиента", "клиентов", "клиентов")} — они ${where}, восстановите вручную`,
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
