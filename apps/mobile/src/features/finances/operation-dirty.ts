// ЕСТЬ ЛИ В ФОРМЕ ОПЕРАЦИИ ЧТО ТЕРЯТЬ (прогон финансов 2026-09-24).
//
// Свайп вниз и тап мимо закрывали форму молча: набранные сумма, заметка и
// фото чека пропадали без следа. Спрашивать «закрыть без сохранения?» надо
// только когда правда есть что терять — иначе вопрос на каждом случайном
// открытии читается как навязчивость.
//
// Снимок берётся в момент гидрации (открытие формы); подстановки, которые
// форма делает сама (счёт по умолчанию, время «сейчас»), в снимок не входят —
// в сравнении участвует только то, что человек набирает руками. Счёт — только
// если его выбрали руками (`accountTouched`).

export interface OperationDraftFields {
  type: "income" | "expense";
  amount: string;
  categoryId: string | null;
  notes: string;
  receiptUrl: string | null;
  /** Счёт, если его выбрали руками; иначе `null`. */
  pickedAccountId: string | null;
  /** Получатель выплаты зарплаты (`category-asks.ts`). */
  masterId?: string | null;
  /** Клиент — у категории, которая его прикрепляет. */
  clientId?: string | null;
  /** День и время, если их меняли руками (`WhenSheet`); иначе `null` — время
   *  «сейчас», подставленное формой, правкой не считается. */
  when?: string | null;
}

export function operationDraftKey(f: OperationDraftFields): string {
  return JSON.stringify([
    f.type,
    f.amount.trim(),
    f.categoryId,
    f.notes.trim(),
    f.receiptUrl,
    f.pickedAccountId,
    f.masterId ?? null,
    f.clientId ?? null,
    f.when ?? null,
  ]);
}

export function operationIsDirty(
  initialKey: string | null,
  current: OperationDraftFields,
): boolean {
  if (initialKey === null) return false;
  return operationDraftKey(current) !== initialKey;
}
