// A money bucket. Lives in the `accounts` table.
//
// scope = 'team'    — exactly one brigade (brigade_id), the classic case:
//                     «Наличка», «Карта Юры».
// scope = 'company' — one physical account (e.g. a business Revolut card)
//                     shared by the teams listed in `team_ids`
//                     (the `account_teams` join table). brigade_id is NULL.

export type AccountKind = "cash" | "card" | "bank" | "other";
export type AccountScope = "team" | "company";

export interface Account {
  id: string;
  tenant_id: string;
  scope: AccountScope;
  /** NULL ⇔ scope === "company". */
  brigade_id: string | null;
  /** Teams attached to a company account; always [] for scope === "team". */
  team_ids: string[];
  name: string;
  kind: AccountKind;
  owner_master_id: string | null;
  opening_balance: number;
  icon: string | null;
  color: string | null;
  position: number;
  /** The "eye": balance masked on every surface, synced across devices. */
  balance_hidden: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function accountDisplayName(a: Account, brigadeName?: string): string {
  if (brigadeName) return `${a.name} · ${brigadeName}`;
  return a.name;
}
