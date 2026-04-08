"use client";

import { useState } from "react";
import { changeOrderStatusAction } from "@/lib/actions/orders";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Play, Calendar, ThumbsUp } from "lucide-react";

interface OrderActionsBarProps {
  orderId: string;
  status: string;
}

const transitions: Record<
  string,
  {
    label: string;
    next: string;
    icon: React.ComponentType<{ className?: string }>;
  }[]
> = {
  new: [
    { label: "Подтвердить", next: "confirmed", icon: ThumbsUp },
    { label: "Отменить", next: "cancelled", icon: XCircle },
  ],
  confirmed: [
    { label: "Запланировать", next: "scheduled", icon: Calendar },
    { label: "Отменить", next: "cancelled", icon: XCircle },
  ],
  scheduled: [
    { label: "Начать", next: "in_progress", icon: Play },
    { label: "Отменить", next: "cancelled", icon: XCircle },
  ],
  in_progress: [
    { label: "Завершить", next: "completed", icon: CheckCircle },
    { label: "Отменить", next: "cancelled", icon: XCircle },
  ],
};

export function OrderActionsBar({ orderId, status }: OrderActionsBarProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const actions = transitions[status] ?? [];

  async function handleAction(nextStatus: string) {
    setLoading(nextStatus);
    await changeOrderStatusAction(orderId, nextStatus);
    setLoading(null);
  }

  if (actions.length === 0) return null;

  return (
    <div className="flex gap-2">
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <Button
            key={a.next}
            size="sm"
            variant={a.next === "cancelled" ? "outline" : "default"}
            disabled={loading !== null}
            onClick={() => handleAction(a.next)}
            className={a.next === "cancelled" ? "text-destructive" : ""}
          >
            <Icon className="mr-2 h-4 w-4" />
            {loading === a.next ? "..." : a.label}
          </Button>
        );
      })}
    </div>
  );
}
