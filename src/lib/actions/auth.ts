"use server";

import { createClient } from "@/lib/supabase/server";
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
      data: {
        full_name: fullName,
        company_name: companyName,
      },
    },
  });

  if (authError) {
    return { error: authError.message };
  }

  if (!authData.user) {
    return { error: "Failed to create user" };
  }

  // 2. Create tenant
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({ name: companyName, slug })
    .select("id")
    .single();

  if (tenantError) {
    return { error: tenantError.message };
  }

  // 3. Create profile with role=owner
  const { error: profileError } = await supabase.from("profiles").insert({
    id: authData.user.id,
    tenant_id: tenant.id,
    full_name: fullName,
    email,
    role: "owner",
  });

  if (profileError) {
    return { error: profileError.message };
  }

  // 4. Set tenant_id and role in app_metadata via admin
  // Note: This requires a database trigger or edge function to set app_metadata
  // after profile creation. For now, we store it in the profile and
  // the middleware will read it from there.

  redirect("/orders");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
