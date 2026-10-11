// Строки `list_my_accounts` — лист без зависимостей: его читают хук и тест.

export type AccountKind = "personal" | "company";

export interface MyAccount {
  tenantId: string;
  name: string;
  kind: AccountKind;
  role: string;
  joinedAt: string;
}

export interface MyAccountRow {
  tenant_id: string;
  name: string;
  kind: string;
  role: string;
  joined_at: string;
}

export function toMyAccounts(rows: readonly MyAccountRow[]): MyAccount[] {
  return rows.map((row) => ({
    tenantId: row.tenant_id,
    name: row.name,
    kind: row.kind === "personal" ? "personal" : "company",
    role: row.role,
    joinedAt: row.joined_at,
  }));
}
