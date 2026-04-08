import { createClient } from "@/lib/supabase/server";

export type ConversationWithClient = {
  id: string;
  channel: string;
  status: string;
  last_message_at: string | null;
  unread_count: number;
  created_at: string;
  client: { id: string; full_name: string; phone: string } | null;
  assigned_to_name: string | null;
};

export async function getConversations(): Promise<ConversationWithClient[]> {
  const supabase = await createClient();
  const { data: convos, error } = await supabase
    .from("conversations")
    .select("*")
    .order("last_message_at", { ascending: false });
  if (error) throw error;
  if (!convos || convos.length === 0) return [];

  const clientIds = Array.from(
    new Set(convos.map((c) => c.client_id).filter(Boolean) as string[]),
  );
  const assignedIds = Array.from(
    new Set(convos.map((c) => c.assigned_to).filter(Boolean) as string[]),
  );

  const [{ data: clients }, { data: profiles }] = await Promise.all([
    clientIds.length > 0
      ? supabase
          .from("clients")
          .select("id, full_name, phone")
          .in("id", clientIds)
      : Promise.resolve({
          data: [] as { id: string; full_name: string; phone: string }[],
        }),
    assignedIds.length > 0
      ? supabase.from("profiles").select("id, full_name").in("id", assignedIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const clientMap = new Map((clients ?? []).map((c) => [c.id, c]));
  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return convos.map((c) => ({
    id: c.id,
    channel: c.channel,
    status: c.status,
    last_message_at: c.last_message_at,
    unread_count: c.unread_count,
    created_at: c.created_at,
    client: c.client_id ? (clientMap.get(c.client_id) ?? null) : null,
    assigned_to_name: c.assigned_to
      ? (profileMap.get(c.assigned_to) ?? null)
      : null,
  }));
}

export async function getMessages(conversationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
