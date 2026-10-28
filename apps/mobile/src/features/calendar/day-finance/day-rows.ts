// Rows of the day sheet in the «Финансы» feed model.

import type { Appointment } from "@babun/shared/local/appointments";
import type { DayExtra } from "@babun/shared/local/day-extras";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import {
  recordRows,
  type RecordRow,
  type RecordRowRefs,
  type RowAccount,
} from "@/features/finances/record-rows";

// ОДНА ОПЕРАЦИЯ — ОДНА СТРОКА В ДНЕ И В ЛЕНТЕ. Своя сборка дня называла оплату
// услугами, а клиента ставила в подпись («Наличные · 10:00»), лента — клиентом
// с подписью «10:00 · Наличные · A/C Чистка». Строку дня строит тот же
// `recordRows`, что ленту, по одной проводке (как ящик удалённых операций):
// склейка визита дню не нужна — каждая строка открывается и удаляется сама.

/** Строка ленты для одной операции дня. Запись берётся отдельно: у
 *  предоплаты за завтра её нет среди записей дня. */
export function dayTxRow(
  tx: FinanceTransaction,
  refs: RecordRowRefs,
  appointment: Appointment | undefined,
): RecordRow | null {
  const [row] = recordRows([tx], { ...refs, appointments: appointment ? [appointment] : [] });
  return row ?? null;
}

/** Тон строки — по виду денег, как в ленте: возврат стоит в доходе с минусом. */
export function dayTxTone(tx: FinanceTransaction): "income" | "expense" {
  return tx.type === "expense" ? "expense" : "income";
}

/** Старая ручная операция дня (`day_extras`) — строкой той же формы. */
export function dayExtraRow(e: DayExtra, ymd: string): RecordRow {
  return {
    key: e.id,
    appointmentId: null,
    title: e.name,
    services: [],
    subtitle: "Ручная операция",
    amount: e.kind === "expense" ? -Math.abs(e.amount) : Math.abs(e.amount),
    date: ymd,
    time: null,
    count: 1,
  };
}

/** Счета оплат записи — для подписи «время · счёт · услуги». Строки оплат в
 *  плане дня не встают (их несёт сама запись), поэтому счёт берётся из них;
 *  место счёта — его место среди плиток, как в ленте. */
export function recordAccountTags(
  appointmentId: string,
  payments: readonly Pick<FinanceTransaction, "appointment_id" | "account_id">[],
  accounts: readonly { id: string; name: string }[],
): RowAccount[] | undefined {
  const tags: RowAccount[] = [];
  for (const tx of payments) {
    if (tx.appointment_id !== appointmentId || !tx.account_id) continue;
    const rank = accounts.findIndex((acc) => acc.id === tx.account_id);
    if (rank >= 0) tags.push({ name: accounts[rank]!.name, rank });
  }
  return tags.length > 0 ? tags : undefined;
}
