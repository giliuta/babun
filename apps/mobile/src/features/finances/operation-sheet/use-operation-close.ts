import { useRef, useState } from "react";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { confirmAction } from "@/lib/confirm";
import { operationIsDirty, vatDirtyKey } from "../operation-dirty";
import type { OperationDraft } from "./use-operation-draft";

// Пока мутация в полёте, лист не закрывается ни скримом, ни свайпом:
// ошибка сохранения должна прилететь в открытую форму, а не поверх уже
// закрытой ленты, где набранное потеряно.
//
// НАБРАННОЕ НЕ ТЕРЯЕТСЯ МОЛЧА: свайп вниз и
// тап мимо закрывали форму с суммой и фото чека без слова. Есть что терять —
// форма уезжает (из открытого листа iOS вопрос не покажет, закон удаления
// выше), звучит «Закрыть без сохранения?»; «Отмена» возвращает форму со
// всем набранным.
export function useOperationClose({
  busy,
  onClose,
  onExited,
  draft,
  vatRate,
}: {
  busy: boolean;
  onClose: () => void;
  onExited: (() => void) | undefined;
  draft: Pick<
    OperationDraft,
    | "initialDraftKey"
    | "type"
    | "amount"
    | "categoryId"
    | "notes"
    | "receiptUrl"
    | "accountTouched"
    | "accountId"
    | "masterId"
    | "clientId"
    | "whenTouched"
    | "date"
    | "time"
    | "vatMode"
  >;
  /** Ставка, по которой считается сумма (`opVatRate`). */
  vatRate: number;
}) {
  /** Отложенное до полного ухода листа: см. `guardedClose` и `runAfterExit`. */
  const afterExit = useRef<(() => void) | null>(null);
  const [askingClose, setAskingClose] = useState(false);
  const dirty = operationIsDirty(draft.initialDraftKey.current, {
    type: draft.type,
    amount: draft.amount,
    categoryId: draft.categoryId,
    notes: draft.notes,
    receiptUrl: draft.receiptUrl,
    pickedAccountId: draft.accountTouched ? draft.accountId : null,
    masterId: draft.masterId,
    clientId: draft.clientId,
    when: draft.whenTouched ? `${draft.date} ${draft.time ?? ""}` : null,
    vat: vatDirtyKey(draft.vatMode, vatRate),
  });
  /** Закрыть — или уйти по строке «Ещё» (возврат, инвойс, клиент): набранное
   *  не пропадает молча ни тем, ни другим путём (иначе строки
   *  «Ещё» закрывали форму мимо вопроса, и правка суммы исчезала). */
  const guardedClose = (leave?: () => void) => {
    if (busy) return;
    if (!dirty) {
      (leave ?? onClose)();
      return;
    }
    afterExit.current = () => {
      void confirmAction("Закрыть без сохранения?", {
        message: "Набранное в операции не сохранится.",
        confirmLabel: "Закрыть",
        destructive: true,
      }).then((ok) => {
        if (!ok) {
          // Лист возвращается, когда уехал вопрос: окно поверх уезжающего
          // iOS не покажет, и форма осталась бы невидимой.
          setTimeout(() => setAskingClose(false), SHEET_EXIT_MS + 350);
          return;
        }
        setAskingClose(false);
        if (leave) {
          leave();
          return;
        }
        onClose();
        // Лист уже снят — хозяин ждёт `onExited` (шторка дня возвращается по
        // нему); зовём его сами, когда уехал вопрос.
        setTimeout(() => onExited?.(), SHEET_EXIT_MS + 350);
      });
    };
    setAskingClose(true);
  };

  /** Что сделать, когда окно листа СНЯТО. Вопрос «Закрыть без сохранения?»
   *  живёт здесь: см. `guardedClose` и закон `BottomSheet.onExited`. Возвращает `true`, если что-то
   *  выполнилось, — по нему решается, звать ли `onExited` вызывающего. */
  const runAfterExit = (): boolean => {
    const run = afterExit.current;
    afterExit.current = null;
    if (!run) return false;
    run();
    return true;
  };

  return { askingClose, guardedClose, runAfterExit, dirty };
}
