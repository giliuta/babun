import type {
  FinanceTransaction,
  PaymentMethod,
} from "@babun/shared/local/finance/transaction";

// ПАТЧ ОПЕРАЦИИ — ТОЛЬКО ИЗМЕНИВШЕЕСЯ (аудит финансов 2026-09-24).
//
// Форма правки собирает полный черновик — те же поля, что и у новой операции,
// ради простоты расчётов (НДС, счёт, категория). Раньше этот черновик ехал на
// сервер целиком: правка одной заметки на телефоне перезаписывала счёт и
// команду тем, что стояло в форме, даже если их первым поменяло другое
// устройство. `updateTransaction` уже умеет отличать «поле не тронуто» —
// недостающий ключ в патче; этой функции остаётся вычесть из черновика то,
// что совпало со снимком, с которым форма открылась.
//
// `null` в СНИМКЕ и отсутствующее значение читаются как одно и то же «пусто»:
// форма превращает пустую заметку в `null`, база хранит её так же.

export interface OperationPatchBaseline {
  amount: number;
  category_id: string | null;
  master_id: string | null;
  client_id: string | null;
  team_id: string | null;
  account_id: string | null;
  payment_method: PaymentMethod | null;
  notes: string | null;
  occurred_on: string;
  occurred_time: string | null;
  receipt_url: string | null;
  vat_mode: "none" | "inclusive" | "exclusive" | null;
  debt_id: string | null;
}

/** Снимок операции В МОМЕНТ, когда форма открылась — против него и сверяется
 *  черновик. Берётся прямо из строки леджера, никакого пересчёта. */
export function operationPatchBaseline(
  tx: FinanceTransaction,
): OperationPatchBaseline {
  return {
    amount: tx.amount,
    category_id: tx.category_id,
    master_id: tx.master_id,
    client_id: tx.client_id,
    team_id: tx.team_id,
    account_id: tx.account_id,
    payment_method: tx.payment_method,
    notes: tx.notes,
    occurred_on: tx.occurred_on,
    occurred_time: tx.occurred_time,
    receipt_url: tx.receipt_url,
    // Режим — КАК ЕГО ПОКАЗАЛА ФОРМА, а не как лежит в колонке. У старых
    // строк колонка пуста («сервер решает сам»), а форма выводит режим из
    // суммы налога — ровно так же, как здесь. Сравнивай с сырой колонкой —
    // и сохранение БЕЗ правок молча вписывало бы в строку явный режим, а
    // явный режим сервер уважает сильнее настроек компании.
    vat_mode: tx.vat_mode ?? (tx.vat_amount ? "inclusive" : "none"),
    debt_id: tx.debt_id,
  };
}

/** Черновик формы — те же поля, что уходят на сервер при создании, плюс
 *  `business_today`: служебная подсказка проверке «не в будущем», своей
 *  колонки у операции она не занимает вовсе. Ключ, которого в черновике нет
 *  (условные `...(attachClient ? {client_id} : {})` и подобные), — это
 *  «форма его не спрашивала», а не «сотри значение». */
export type OperationFormDraft = Partial<OperationPatchBaseline> & {
  business_today?: string;
};

export type OperationPatch = Partial<OperationPatchBaseline> & {
  business_today?: string;
};

/**
 * Патч для `updateTransaction`: только поля, которые ДЕЙСТВИТЕЛЬНО изменились
 * против `baseline`. Форма, закрытая без единой правки, отдаёт пустой объект —
 * вызывающий обязан прочитать это как «сохранять нечего» и не ходить в сеть.
 */
export function operationTransactionPatch(
  draft: OperationFormDraft,
  baseline: OperationPatchBaseline,
): OperationPatch {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as (keyof OperationFormDraft)[]) {
    // business_today — не самостоятельное поле, а пара к occurred_on: см. ниже.
    if (key === "business_today") continue;
    const value = draft[key];
    // Ключа в черновике нет — форма его не спрашивала, значение не трогаем.
    if (value === undefined) continue;
    const base = baseline[key as keyof OperationPatchBaseline];
    if ((value ?? null) !== (base ?? null)) {
      patch[key] = value;
    }
  }
  // ДЕНЬ И «СЕГОДНЯ БИЗНЕСА» — ПАРА. У business_today нет своего снимка (это
  // не хранимая колонка), поэтому сравнивать её не с чем: она едет РОВНО
  // тогда, когда патч уже несёт новый occurred_on, — иначе сервер провёл бы
  // проверку «не в будущем» вхолостую.
  if ("occurred_on" in patch && draft.business_today !== undefined) {
    patch.business_today = draft.business_today;
  }
  return patch as OperationPatch;
}
