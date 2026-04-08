"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { loginSchema, signupSchema } from "@/lib/validations/auth";

export type AuthResult = {
  error?: string;
};

export async function login(formData: FormData): Promise<AuthResult> {
  const supabase = await createClient();

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: error.message };
  }

  redirect("/orders");
}

export async function signup(formData: FormData): Promise<AuthResult> {
  const supabase = await createClient();

  const parsed = signupSchema.safeParse({
    fullName: formData.get("fullName"),
    companyName: formData.get("companyName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { fullName, companyName, email, password } = parsed.data;

  // 1. Create auth user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, company_name: companyName },
    },
  });

  if (authError) return { error: authError.message };
  if (!authData.user) return { error: "Failed to create user" };

  // 2. Create tenant + profile via SECURITY DEFINER function
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const { data: rpcResult, error: signupError } = await supabase.rpc(
    "handle_signup",
    {
      p_user_id: authData.user.id,
      p_full_name: fullName,
      p_email: email,
      p_company_name: companyName,
      p_company_slug: slug,
    },
  );

  if (signupError) return { error: signupError.message };

  // 3. Use admin client to set app_metadata (ensures JWT gets tenant_id)
  try {
    const tenantId =
      typeof rpcResult === "object" && rpcResult !== null
        ? (rpcResult as { tenant_id: string }).tenant_id
        : null;

    if (tenantId) {
      const admin = createAdminClient();
      await admin.auth.admin.updateUserById(authData.user.id, {
        app_metadata: { tenant_id: tenantId, role: "owner" },
      });
    }
  } catch {
    // Admin client may not be available if service_role key isn't set
    // handle_signup already sets it via SQL, this is a backup
  }

  // 4. Sign in to get fresh JWT with tenant_id
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) return { error: signInError.message };

  redirect("/orders");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
