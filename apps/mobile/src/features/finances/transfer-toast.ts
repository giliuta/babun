// ТОСТ ПОСЛЕ ПЕРЕВОДА — чистое решение «что сказать и обещать ли Отменить».
//
// Вынесено из `useTransferWithUndo` ради теста: сам хук тянет за собой
// react-native и supabase уже на импорте, а правило «без `transfer_group_id`
// тост не обещает кнопку, которой нечего отменять» — поведение денег, и
// держаться оно должно не только на чтении кода.

/** Готовые подписи для тоста: рядом с ним контекста нет, счёт назван полностью
 *  («Наличные · Юра»), сумма — с валютой. */
export interface TransferToastLabels {
  amountText: string;
  fromLabel: string;
  toLabel: string;
}

export function transferSuccessToast(
  labels: TransferToastLabels,
  transferGroupId: string | null,
): { message: string; undoGroupId: string | null } {
  return {
    // ОДНО СОБЫТИЕ — ОДНО СЛОВО. «Сдано» означало сдачу выручки на счёт
    // компании; общего счёта в продукте нет (владелец 2026-08-15).
    message: `Переведено ${labels.amountText}: ${labels.fromLabel} → ${labels.toLabel}`,
    // Без группы отменять нечего — тост просто сообщает результат.
    undoGroupId: transferGroupId,
  };
}
