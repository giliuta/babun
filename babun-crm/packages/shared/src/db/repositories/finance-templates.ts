// finance_templates repository — one-tap shortcuts for recurring
// expenses/income (Аренда €1500, ЗП Юре €800). Surfaced as a chip-row
// on top of the +Расход / +Доход form.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import type { FinanceTemplate } from "../../local/finance/template";
import type { PaymentMethod } from "../../local/finance/transaction";

export type { FinanceTemplate };

type DbSupabase = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["finance_templates"]["Row"];

function rowToTemplate(r: Row): FinanceTemplate {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    name: r.name,
    kind: r.kind as "income" | "expense",
    amount: Number(r.amount ?? 0),
    account_id: r.account_id,
    category_id: r.category_id,
    brigade_id: r.brigade_id,
    master_id: r.master_id,
    payment_method: (r.payment_method ?? null) as PaymentMethod | null,
    position: r.position,
    is_active: r.is_active,
  };
}

export async function listFinanceTemplates(
  supabase: DbSupabase,
  tenantId: string,
): Promise<FinanceTemplate[]> {
  const { data, error } = await supabase
    .from("finance_templates")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("position", { ascending: true });
  if (error) throw new Error(`listFinanceTemplates: ${error.message}`);
  return ((data ?? []) as Row[]).map(rowToTemplate);
}

export interface TemplateDraft {
  name: string;
  kind: "income" | "expense";
  amount: number;
  account_id?: string | null;
  category_id?: string | null;
  brigade_id?: string | null;
  master_id?: string | null;
  payment_method?: PaymentMethod | null;
  position?: number;
}

export async function insertFinanceTemplate(
  supabase: DbSupabase,
  tenantId: string,
  draft: TemplateDraft,
): Promise<FinanceTemplate> {
  const { data, error } = await supabase
    .from("finance_templates")
    .insert({
      tenant_id: tenantId,
      name: draft.name,
      kind: draft.kind,
      amount: draft.amount,
      account_id: draft.account_id ?? null,
      category_id: draft.category_id ?? null,
      brigade_id: draft.brigade_id ?? null,
      master_id: draft.master_id ?? null,
      payment_method: draft.payment_method ?? null,
      position: draft.position ?? 0,
      is_active: true,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`insertFinanceTemplate: ${error?.message}`);
  return rowToTemplate(data as Row);
}

export async function updateFinanceTemplate(
  supabase: DbSupabase,
  id: string,
  patch: Partial<TemplateDraft>,
): Promise<void> {
  const update: Partial<Database["public"]["Tables"]["finance_templates"]["Update"]> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.kind !== undefined) update.kind = patch.kind;
  if (patch.amount !== undefined) update.amount = patch.amount;
  if (patch.account_id !== undefined) update.account_id = patch.account_id;
  if (patch.category_id !== undefined) update.category_id = patch.category_id;
  if (patch.brigade_id !== undefined) update.brigade_id = patch.brigade_id;
  if (patch.master_id !== undefined) update.master_id = patch.master_id;
  if (patch.payment_method !== undefined) update.payment_method = patch.payment_method;
  if (patch.position !== undefined) update.position = patch.position;
  const { error } = await supabase.from("finance_templates").update(update).eq("id", id);
  if (error) throw new Error(`updateFinanceTemplate: ${error.message}`);
}

export async function deleteFinanceTemplate(
  supabase: DbSupabase,
  id: string,
): Promise<void> {
  const { error } = await supabase.from("finance_templates").delete().eq("id", id);
  if (error) throw new Error(`deleteFinanceTemplate: ${error.message}`);
}
