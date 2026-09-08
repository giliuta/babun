import type { Appointment } from "@babun/shared/local/appointments";
import {
  appointmentMaterialCostLines,
  type MaterialCatalogService,
} from "@babun/shared/local/finance/appointment-calc";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";

// МАТЕРИАЛЫ ЗАПИСЕЙ — СТРОКАМИ В «РАСХОДЕ» (владелец 2026-09-07: «если это
// минус записи — затраченное на услуги считается как минус; оно заходит,
// открывается»). Себестоимость материалов у записи — расчётная величина по
// каталогу услуг, своей проводки в леджере у неё нет и не будет (плитка
// «Расход» давно считает её в сумме). Раньше список показывал только ручные
// расходы, а разницу с плиткой объяснял сноской. Теперь каждая запись с
// материалами стоит в разрезе «Расход» своей строкой; тап открывает запись.
//
// Строка виртуальная: id с префиксом, source «auto», счёта нет. В ленте всех
// операций её нет — там история денег, а не расчёт.

export const MATERIAL_TX_PREFIX = "material:";

export function isMaterialExpenseRow(tx: Pick<FinanceTransaction, "id">): boolean {
  return tx.id.startsWith(MATERIAL_TX_PREFIX);
}

export function materialExpenseRows(
  appointments: readonly Appointment[],
  services: readonly MaterialCatalogService[],
  window: { from: string; to: string; teamId: string | null },
): FinanceTransaction[] {
  const rows: FinanceTransaction[] = [];
  for (const a of appointments) {
    if (a.status !== "completed" && a.status !== "in_progress") continue;
    if (a.date < window.from || a.date > window.to) continue;
    if (window.teamId && a.team_id !== window.teamId) continue;
    const lines = appointmentMaterialCostLines(a, services);
    const amount = lines.reduce((sum, line) => sum + line.totalCost, 0);
    if (amount <= 0) continue;
    const names = lines
      .map((line) => line.serviceName)
      .filter(Boolean)
      .join(", ");
    const stamp = `${a.date}T${(a.time_start || "00:00").slice(0, 5)}:00`;
    rows.push({
      id: `${MATERIAL_TX_PREFIX}${a.id}`,
      // У записи в модели нет tenant_id; строка виртуальная и в базу не едет.
      tenant_id: "",
      reversal_kind: null,
      type: "expense",
      amount: Math.round(amount * 100) / 100,
      currency: "EUR",
      category_id: null,
      account_id: null,
      appointment_id: a.id,
      appointment_payment_kind: null,
      client_id: a.client_id ?? null,
      team_id: a.team_id ?? null,
      master_id: a.master_id ?? null,
      payment_method: null,
      notes: names ? `Материалы · ${names}` : "Материалы",
      vat_mode: null,
      vat_rate: null,
      vat_amount: null,
      occurred_on: a.date,
      occurred_time: a.time_start ? a.time_start.slice(0, 5) : null,
      receipt_url: null,
      transfer_group_id: null,
      invoice_id: null,
      refund_of_id: null,
      source: "auto",
      created_at: stamp,
      updated_at: stamp,
      created_by: null,
    });
  }
  return rows;
}
