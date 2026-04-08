"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/actions/clients";

async function getAuthContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", user.id)
    .single();
  return profile
    ? { userId: user.id, tenantId: profile.tenant_id, role: profile.role }
    : null;
}

export async function updateProfileAction(
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) return { error: "Unauthorized" };
  const supabase = await createClient();

  const fullName = formData.get("full_name") as string;
  const phone = formData.get("phone") as string;

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, phone: phone || null })
    .eq("id", ctx.userId);

  if (error) return { error: error.message };

  revalidatePath("/settings");
  return {};
}

export async function updateTenantAction(
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx || ctx.role !== "owner") return { error: "Only owner can update" };
  const supabase = await createClient();

  const name = formData.get("name") as string;
  const { error } = await supabase
    .from("tenants")
    .update({ name })
    .eq("id", ctx.tenantId);

  if (error) return { error: error.message };

  revalidatePath("/settings");
  return {};
}

export async function inviteUserAction(): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx || !["owner", "manager"].includes(ctx.role))
    return { error: "No permission" };

  return {
    error:
      "Invite by email coming soon. Create users in Supabase Auth dashboard.",
  };
}
