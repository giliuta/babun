// Export kinds and the row shapes the export hook reads.

import type { Database } from "@babun/shared/db/database.types";

type Row<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type ExportKind = "clients" | "appointments" | "finances";

// ─── Строки, которые читает хук (колонки — те же, что в его select) ─────────

export type ClientExportRow = Pick<
  Row<"clients">,
  | "id"
  | "full_name"
  | "phone"
  | "email"
  | "team_id"
  | "city"
  | "acquisition_source"
  | "birthday"
  | "comment"
  | "notes"
  | "created_at"
>;

export type AppointmentExportRow = Pick<
  Row<"appointments">,
  | "id"
  | "date"
  | "time_start"
  | "time_end"
  | "kind"
  | "team_id"
  | "client_id"
  | "status"
  | "services"
  | "total_amount"
  | "paid_amount"
  | "prepaid_amount"
  | "payment_status"
  | "payments"
  | "payment"
  | "address"
  | "comment"
  | "event_notes"
>;

export type TransactionExportRow = Pick<
  Row<"finance_transactions">,
  | "id"
  | "type"
  | "amount"
  | "occurred_on"
  | "occurred_time"
  | "category_id"
  | "account_id"
  | "team_id"
  | "client_id"
  | "notes"
  | "vat_amount"
  | "vat_mode"
  | "created_at"
>;

export type SourceRef = Pick<Row<"client_sources">, "id" | "name" | "key" | "team_id">;

/** Счёт с командой, на которую он записан: по нему находятся операции без
 *  команды (см. `financeTeamFilter`). */
export type AccountRef = Pick<Row<"accounts">, "id" | "name" | "brigade_id">;

export type Names = ReadonlyMap<string, string>;
