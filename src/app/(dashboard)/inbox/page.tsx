import { getConversations, getMessages } from "@/lib/queries/inbox";
import { InboxShell } from "@/components/inbox/inbox-shell";

export default async function InboxPage() {
  const conversations = await getConversations();

  // Pre-fetch messages for all conversations
  const messagesEntries = await Promise.all(
    conversations.map(async (c) => {
      const msgs = await getMessages(c.id);
      return [c.id, msgs] as const;
    }),
  );
  const messagesMap = Object.fromEntries(messagesEntries);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Сообщения</h1>
        <p className="text-sm text-muted-foreground">Диалоги с клиентами</p>
      </div>
      <InboxShell conversations={conversations} messagesMap={messagesMap} />
    </div>
  );
}
