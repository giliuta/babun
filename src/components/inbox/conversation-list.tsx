"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { MessageSquare } from "lucide-react";
import type { ConversationWithClient } from "@/lib/queries/inbox";

const channelIcons: Record<string, string> = {
  telegram: "TG",
  whatsapp: "WA",
  sms: "SMS",
  email: "📧",
};

interface ConversationListProps {
  conversations: ConversationWithClient[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
}: ConversationListProps) {
  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
        <MessageSquare className="mb-2 h-8 w-8" />
        <p className="text-sm">Нет диалогов</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {conversations.map((c) => (
        <button
          key={c.id}
          onClick={() => onSelect(c.id)}
          className={cn(
            "flex items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-accent",
            selectedId === c.id && "bg-accent",
          )}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {channelIcons[c.channel] ?? c.channel}
          </div>
          <div className="flex-1 overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium truncate">
                {c.client?.full_name ?? "Unknown"}
              </span>
              {c.unread_count > 0 && (
                <Badge className="ml-2 h-5 w-5 rounded-full p-0 text-xs">
                  {c.unread_count}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-xs">
                {c.status}
              </Badge>
              {c.last_message_at && (
                <span>
                  {new Date(c.last_message_at).toLocaleDateString("ru-RU")}
                </span>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
