"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { createCrewSchema, updateCrewSchema } from "@/lib/validations/crew";
import type { ActionResult } from "@/lib/actions/clients";

async function getTenantId(): Promise<string | null> {
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
  return profile?.tenant_id ?? null;
}

export async function createCrewAction(
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) return { error: "Unauthorized" };

  const raw = Object.fromEntries(formData);
  const parsed = createCrewSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { error } = await supabase
    .from("crews")
    .insert({ ...parsed.data, tenant_id: tenantId });
  if (error) return { error: error.message };

  revalidatePath("/crews");
  return {};
}

export async function updateCrewAction(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient();
  const raw = Object.fromEntries(formData);
  const parsed = updateCrewSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { error } = await supabase
    .from("crews")
    .update(parsed.data)
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/crews");
  return {};
}

export async function deleteCrewAction(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("crews")
    .update({ is_active: false })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/crews");
  return {};
}
