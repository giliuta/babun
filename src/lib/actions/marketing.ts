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
    .select("tenant_id")
    .eq("id", user.id)
    .single();
  return profile ? { userId: user.id, tenantId: profile.tenant_id } : null;
}

export async function sendReEngagementAction(
  clientIds: string[],
  templateId: string,
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) return { error: "Unauthorized" };
  const supabase = await createClient();

  // Get template
  const { data: template } = await supabase
    .from("notification_templates")
    .select("*")
    .eq("id", templateId)
    .single();

  if (!template) return { error: "Template not found" };

  // Get clients
  const { data: clients } = await supabase
    .from("clients")
    .select("id, full_name, phone, language")
    .in("id", clientIds);

  if (!clients || clients.length === 0) return { error: "No clients found" };

  // Log notifications
  const logs = clients.map((client) => {
    const content =
      client.language === "en"
        ? (template.template_en ?? template.template_ru)
        : template.template_ru;

    return {
      tenant_id: ctx.tenantId,
      template_id: template.id,
      client_id: client.id,
      channel: template.channel,
      content: content.replace("{client_name}", client.full_name),
      status: "sent" as const,
    };
  });

  const { error } = await supabase.from("notification_log").insert(logs);
  if (error) return { error: error.message };

  revalidatePath("/settings");
  return { data: { sent: logs.length } };
}

export async function createNotificationTemplateAction(
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) return { error: "Unauthorized" };
  const supabase = await createClient();

  const raw = Object.fromEntries(formData);
  const { error } = await supabase.from("notification_templates").insert({
    tenant_id: ctx.tenantId,
    name: raw.name as string,
    trigger_event: raw.trigger_event as string,
    channel: raw.channel as string,
    template_ru: raw.template_ru as string,
    template_en: (raw.template_en as string) || null,
    variables: ((raw.variables as string) || "").split(",").filter(Boolean),
    is_active: true,
  });

  if (error) return { error: error.message };

  revalidatePath("/settings");
  return {};
}

export async function setNextServiceDateAction(
  clientId: string,
  date: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("clients")
    .update({ next_service_date: date })
    .eq("id", clientId);
  if (error) return { error: error.message };

  revalidatePath("/settings");
  return {};
}
