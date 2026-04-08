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

export async function sendMessageAction(
  conversationId: string,
  content: string,
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) return { error: "Unauthorized" };
  const supabase = await createClient();

  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    tenant_id: ctx.tenantId,
    direction: "outbound",
    sender_type: "manager",
    sender_id: ctx.userId,
    content,
  });
  if (error) return { error: error.message };

  // Update last_message_at
  await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);

  revalidatePath("/inbox");
  return {};
}

export async function resolveConversationAction(
  conversationId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("conversations")
    .update({ status: "resolved" })
    .eq("id", conversationId);
  if (error) return { error: error.message };

  revalidatePath("/inbox");
  return {};
}
