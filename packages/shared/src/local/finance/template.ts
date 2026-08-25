// A reusable shortcut for «one-tap +Расход / +Доход» — e.g. Аренда €1500,
// ЗП Юре €800, Чаевые €20. Tenants curate their own list at
// /dashboard/settings/finance/templates.

import type { PaymentMethod } from "./transaction";

export interface FinanceTemplate {
  id: string;
  tenant_id: string;
  name: string;
  kind: "income" | "expense";
  amount: number;
  account_id: string | null;
  category_id: string | null;
  brigade_id: string | null;
  master_id: string | null;
  payment_method: PaymentMethod | null;
  position: number;
  is_active: boolean;
}
