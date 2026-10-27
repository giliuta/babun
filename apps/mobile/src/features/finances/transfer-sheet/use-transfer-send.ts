import { useEffect, useRef } from "react";
import { money } from "@babun/shared/common/utils/money";
import { isOnline, randomUuid } from "@babun/shared/sync";
import { tDynamic } from "@babun/shared/i18n/runtime";
import { haptics } from "@/lib/haptics";
import type { AccountWithBalance } from "../accounts";
import { createTransferRequestIds } from "../transfer-intent";
import { rememberTransferTarget } from "../transfer-memory";
import type { useTransferWithUndo } from "../transfer-undo";
import { OFFLINE_MID_FLIGHT, OFFLINE_REASON } from "./transfer-rules";

/** Sending the transfer: an idempotent request id per intent, the undo
 *  toast, and a failure line instead of a closed sheet. */
export function useTransferSend(s: {
  visible: boolean;
  from: AccountWithBalance | null;
  to: AccountWithBalance | null;
  amountCents: number | null;
  amountNum: number;
  occurredOn: string;
  note: string;
  businessToday: string;
  currency: string | undefined;
  label: (account: AccountWithBalance) => string;
  runTransfer: ReturnType<typeof useTransferWithUndo>;
  setSending: (sending: boolean) => void;
  setFailure: (failure: string | null) => void;
  onClose: () => void;
  /** Деньги ушли — до `onClose`: вызывающий решает, что показать после. */
  onSent?: () => void;
}): () => Promise<void> {
  /** `request_id` привязан к НАМЕРЕНИЮ, а не к открытию листа: та же пара,
   *  сумма, день и комментарий — тот же ключ и серверный дедуп после
   *  потерянного ответа; правка ЛЮБОГО из полей — уже другое намерение и
   *  другой ключ (почему в ключе даже день — см. transfer-intent.ts). */
  const intent = useRef(createTransferRequestIds(randomUuid)).current;
  // Лист смонтирован и между открытиями: намерение, оставшееся от прошлого
  // открытия с неудачей, иначе склеило бы новый такой же перевод со старым —
  // «Перевод выполнен», а денег ушло один раз.
  useEffect(() => {
    if (s.visible) intent.done();
  }, [s.visible, intent]);

  return async () => {
    const { from, to, amountCents, amountNum, occurredOn, note } = s;
    if (!from || !to || amountCents == null) return;
    // Сеть проверяется В МОМЕНТ нажатия, а не только реактивным `online`:
    // между последним кадром и тапом связь могла пропасть, и мутация ушла бы
    // в paused — кнопка крутилась бы вечно, а свёрнутое приложение унесло бы
    // намерение молча.
    if (!isOnline()) {
      s.setFailure(OFFLINE_REASON);
      return;
    }
    const requestId = intent.idFor({
      fromAccountId: from.id,
      toAccountId: to.id,
      amountCents,
      occurredOn,
      note,
    });
    s.setSending(true);
    s.setFailure(null);
    try {
      await s.runTransfer({
        requestId,
        fromAccountId: from.id,
        toAccountId: to.id,
        amount: amountNum,
        notes: note.trim() || null,
        // Сегодняшний день не передаём вовсе: сервер сам поставит бизнес-дату
        // тенанта, и она правильнее любой, вычисленной на телефоне.
        occurredOn: occurredOn === s.businessToday ? null : occurredOn,
        amountText: money(amountNum, s.currency),
        fromLabel: s.label(from),
        toLabel: s.label(to),
      });
      rememberTransferTarget(from.id, to.id);
      intent.done();
      // Деньги ушли — телефон отвечает тем же тактильным «готово», что и
      // отмена перевода: один продукт подтверждает успех
      // одинаково, чем бы человек ни занимался.
      haptics.success();
      s.onSent?.();
      s.onClose();
    } catch (e) {
      // Лист остаётся открытым — набранное не теряется, а повтор попадёт в
      // тот же серверный дедуп по неизменившемуся `request_id`.
      const message = e instanceof Error ? e.message : "";
      s.setFailure(
        // Обрыв связи говорит по-человечески: сырое «Network request failed»
        // не отвечает на единственный вопрос — ушли деньги или нет.
        isOnline()
          ? tDynamic(message) || "Не удалось сохранить"
          : OFFLINE_MID_FLIGHT,
      );
    } finally {
      s.setSending(false);
    }
  };
}
