"use client";

import { useState } from "react";
import { addOrderCommentAction } from "@/lib/actions/orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  ArrowRightLeft,
  CreditCard,
  Bot,
  Send,
} from "lucide-react";

type Comment = {
  id: string;
  type: string;
  content: string;
  created_at: string;
  author: { full_name: string } | null;
};

const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  comment: MessageSquare,
  status_change: ArrowRightLeft,
  payment: CreditCard,
  system: Bot,
};

export function ActivityLog({
  orderId,
  comments,
}: {
  orderId: string;
  comments: Comment[];
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSend() {
    if (!text.trim()) return;
    setLoading(true);
    await addOrderCommentAction(orderId, text.trim());
    setText("");
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">Активность</h3>
      <div className="space-y-3">
        {comments.map((c) => {
          const Icon = typeIcons[c.type] ?? MessageSquare;
          return (
            <div key={c.id} className="flex gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {c.author?.full_name ?? "Система"}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {c.type}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(c.created_at).toLocaleString("ru-RU")}
                  </span>
                </div>
                <p className="mt-0.5 text-sm">{c.content}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="Добавить комментарий..."
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
