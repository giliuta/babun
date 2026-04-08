"use client";

import { useState } from "react";
import {
  sendMessageAction,
  resolveConversationAction,
} from "@/lib/actions/inbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type Message = Database["public"]["Tables"]["messages"]["Row"];

interface MessageThreadProps {
  conversationId: string;
  messages: Message[];
  clientName: string;
  status: string;
}

export function MessageThread({
  conversationId,
  messages,
  clientName,
  status,
}: MessageThreadProps) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSend() {
    if (!text.trim()) return;
    setLoading(true);
    await sendMessageAction(conversationId, text.trim());
    setText("");
    setLoading(false);
  }

  async function handleResolve() {
    await resolveConversationAction(conversationId);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h3 className="font-medium">{clientName}</h3>
          <Badge variant="outline" className="text-xs">
            {status}
          </Badge>
        </div>
        {status !== "resolved" && (
          <Button size="sm" variant="outline" onClick={handleResolve}>
            <CheckCircle className="mr-2 h-4 w-4" />
            Закрыть
          </Button>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex",
                msg.direction === "outbound" ? "justify-end" : "justify-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[70%] rounded-lg px-3 py-2 text-sm",
                  msg.direction === "outbound"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted",
                )}
              >
                <p>{msg.content}</p>
                <p
                  className={cn(
                    "mt-1 text-xs",
                    msg.direction === "outbound"
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground",
                  )}
                >
                  {new Date(msg.created_at).toLocaleTimeString("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {msg.is_ai_generated && " · AI"}
                </p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="flex gap-2 border-t p-3">
        <Input
          placeholder="Сообщение..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
        />
        <Button
          size="icon"
          disabled={!text.trim() || loading}
          onClick={handleSend}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
