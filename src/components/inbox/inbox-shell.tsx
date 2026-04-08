"use client";

import { useState } from "react";
import { ConversationList } from "./conversation-list";
import { MessageThread } from "./message-thread";
import { MessageSquare } from "lucide-react";
import type { ConversationWithClient } from "@/lib/queries/inbox";
import type { Database } from "@/types/database";

type Message = Database["public"]["Tables"]["messages"]["Row"];

interface InboxShellProps {
  conversations: ConversationWithClient[];
  messagesMap: Record<string, Message[]>;
}

export function InboxShell({ conversations, messagesMap }: InboxShellProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    conversations[0]?.id ?? null,
  );

  const selected = conversations.find((c) => c.id === selectedId);
  const messages = selectedId ? (messagesMap[selectedId] ?? []) : [];

  return (
    <div className="flex h-[calc(100vh-10rem)] overflow-hidden rounded-lg border">
      {/* Sidebar */}
      <div className="w-80 shrink-0 overflow-y-auto border-r">
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>

      {/* Main */}
      <div className="flex-1">
        {selected ? (
          <MessageThread
            conversationId={selected.id}
            messages={messages}
            clientName={selected.client?.full_name ?? "Unknown"}
            status={selected.status}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="mx-auto mb-2 h-8 w-8" />
              <p className="text-sm">Выберите диалог</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
