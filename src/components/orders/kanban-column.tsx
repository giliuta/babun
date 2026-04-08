"use client";

import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { OrderCard } from "./order-card";

interface KanbanColumnProps {
  id: string;
  title: string;
  colorClass: string;
  orders: {
    id: string;
    order_number: number;
    status: string;
    city: string;
    scheduled_date: string | null;
    total: number;
    payment_status: string;
    client: { id: string; full_name: string; phone: string } | null;
    crew: { id: string; name: string; color: string | null } | null;
  }[];
}

export function KanbanColumn({
  id,
  title,
  colorClass,
  orders,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-lg border border-t-4 bg-muted/30",
        colorClass,
        isOver && "bg-muted/60",
      )}
    >
      <div className="flex items-center justify-between p-3">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
          {orders.length}
        </span>
      </div>
      <div className="flex flex-col gap-2 p-2">
        {orders.map((order) => (
          <OrderCard key={order.id} order={order} />
        ))}
      </div>
    </div>
  );
}
