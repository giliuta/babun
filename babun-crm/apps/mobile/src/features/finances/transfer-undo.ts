// ПЕРЕВОД С ОТМЕНОЙ НА МЕСТЕ (ТЗ §5.2).
//
// Модального «вы уверены?» перед переводом НЕТ: проверяем результат, а не
// намерение. Вопрос до нажатия человек читает как формальность и жмёт «Да»
// не глядя; кнопка «Отменить» рядом с уже случившимся — единственное, что
// действительно спасает от промаха.
//
// Тот же приём, что у архива клиентов (`clients/archive-undo.ts`): хук общий
// на все двери в перевод, иначе четвёртая дверь однажды снова сработает молча.
// Отмена уносит ОБЕ ноги по `transfer_group_id` — половины перевода в журнале
// не бывает.

import { useCallback } from "react";
import { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";
import { useCreateTransfer, useDeleteTransfer } from "./accounts";
import { transferSuccessToast } from "./transfer-toast";

export interface TransferIntent {
  /** Привязан к НАМЕРЕНИЮ (моменту нажатия), а не к открытию листа: повтор
   *  после потерянного ответа обязан попасть в тот же серверный дедуп. */
  requestId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  notes: string | null;
  /** День перевода. `null` — сегодня: дату тогда ставит сервер по бизнес-времени
   *  тенанта, и она вернее вычисленной на телефоне. */
  occurredOn: string | null;
  /** Готовые подписи для тоста: «€120», «Наличные · Юра», «Revolut · Дима» —
   *  рядом с тостом контекста нет, и счёт назван полностью. */
  amountText: string;
  fromLabel: string;
  toLabel: string;
}

export function useTransferWithUndo(): (intent: TransferIntent) => Promise<void> {
  const transfer = useCreateTransfer();
  const undo = useDeleteTransfer();
  const toast = useToast();

  return useCallback(
    async (intent: TransferIntent) => {
      const { source } = await transfer.mutateAsync({
        request_id: intent.requestId,
        from_account_id: intent.fromAccountId,
        to_account_id: intent.toAccountId,
        amount: intent.amount,
        notes: intent.notes,
        // Дата уходит, только если её выбрали руками: пустое поле сервер
        // заполняет своей бизнес-датой (`coalesce(p_occurred_on, business_date)`).
        ...(intent.occurredOn ? { occurred_on: intent.occurredOn } : {}),
        // Команду сюда НЕ передаём: `record_account_transfer` такого
        // параметра не имеет и выводит принадлежность из самих счетов.
      });
      haptics.success();

      const { message, undoGroupId } = transferSuccessToast(
        intent,
        source.transfer_group_id ?? null,
      );
      toast(
        message,
        "success",
        undoGroupId
          ? {
              label: "Отменить",
              onPress: () => {
                undo.mutate(undoGroupId, {
                  onSuccess: () => {
                    haptics.success();
                    toast("Перевод отменён", "success");
                  },
                  onError: (e) => {
                    haptics.warning();
                    toast(
                      `Не удалось отменить перевод: ${e.message}`,
                      "error",
                    );
                  },
                });
              },
            }
          : undefined,
      );
    },
    [transfer, undo, toast],
  );
}
