"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  createExpenseSchema,
  createSalarySchema,
} from "@/lib/validations/finance";
import type { ActionResult } from "@/lib/actions/clients";

async function getAuthContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();
  return profile ? { userId: user.id, tenantId: profile.tenant_id } : null;
}

export async function createExpenseAction(
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) return { error: "Unauthorized" };
  const supabase = await createClient();

  const raw = Object.fromEntries(formData);
  const parsed = createExpenseSchema.safeParse({
    ...raw,
    amount: parseFloat(raw.amount as string),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { error } = await supabase.from("expenses").insert({
    ...parsed.data,
    tenant_id: ctx.tenantId,
    created_by: ctx.userId,
  });
  if (error) return { error: error.message };

  revalidatePath("/finance");
  return {};
}

export async function createSalaryAction(
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) return { error: "Unauthorized" };
  const supabase = await createClient();

  const raw = Object.fromEntries(formData);
  const baseAmount = parseFloat(raw.base_amount as string) || 0;
  const bonusAmount = parseFloat(raw.bonus_amount as string) || 0;
  const deductions = parseFloat(raw.deductions as string) || 0;

  const parsed = createSalarySchema.safeParse({
    ...raw,
    base_amount: baseAmount,
    bonus_amount: bonusAmount,
    deductions,
    total: baseAmount + bonusAmount - deductions,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { error } = await supabase.from("salary_records").insert({
    ...parsed.data,
    tenant_id: ctx.tenantId,
  });
  if (error) return { error: error.message };

  revalidatePath("/finance");
  return {};
}
