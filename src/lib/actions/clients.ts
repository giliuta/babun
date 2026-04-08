"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  createClientSchema,
  updateClientSchema,
  createEquipmentSchema,
  updateEquipmentSchema,
} from "@/lib/validations/client";

export type ActionResult = {
  error?: string;
  data?: unknown;
};

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

export async function createClientAction(
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) return { error: "Unauthorized" };

  const raw = Object.fromEntries(formData);
  const parsed = createClientSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { data, error } = await supabase
    .from("clients")
    .insert({ ...parsed.data, tenant_id: tenantId })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/clients");
  return { data };
}

export async function updateClientAction(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient();

  const raw = Object.fromEntries(formData);
  const parsed = updateClientSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Remove empty strings
  const cleaned = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== ""),
  );

  const { error } = await supabase.from("clients").update(cleaned).eq("id", id);

  if (error) return { error: error.message };

  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
  return {};
}

export async function deleteClientAction(id: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("clients").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/clients");
  return {};
}

// Equipment actions
export async function createEquipmentAction(
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) return { error: "Unauthorized" };

  const raw = Object.fromEntries(formData);
  const parsed = createEquipmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { data, error } = await supabase
    .from("client_equipment")
    .insert({ ...parsed.data, tenant_id: tenantId })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath(`/clients/${parsed.data.client_id}`);
  return { data };
}

export async function updateEquipmentAction(
  id: string,
  clientId: string,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient();

  const raw = Object.fromEntries(formData);
  const parsed = updateEquipmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { error } = await supabase
    .from("client_equipment")
    .update(parsed.data)
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath(`/clients/${clientId}`);
  return {};
}

export async function deleteEquipmentAction(
  id: string,
  clientId: string,
): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("client_equipment")
    .delete()
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath(`/clients/${clientId}`);
  return {};
}
