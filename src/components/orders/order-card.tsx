"use client";

import Link from "next/link";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { MapPin, Calendar } from "lucide-react";

interface OrderCardProps {
  order: {
    id: string;
    order_number: number;
    city: string;
    scheduled_date: string | null;
    total: number;
    payment_status: string;
    client: { id: string; full_name: string; phone: string } | null;
    crew: { id: string; name: string; color: string | null } | null;
  };
  isDragging?: boolean;
}

const cityLabels: Record<string, string> = {
  limassol: "Лимассол",
  paphos: "Пафос",
  larnaca: "Ларнака",
  nicosia: "Никосия",
};

const paymentLabels: Record<string, string> = {
  unpaid: "Не оплачен",
  partial: "Частично",
  paid: "Оплачен",
};

export function OrderCard({ order, isDragging }: OrderCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: order.id,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "rounded-md border bg-background p-3 shadow-sm transition-shadow hover:shadow-md",
        isDragging && "rotate-2 shadow-lg opacity-90",
      )}
    >
      <Link href={`/orders/${order.id}`} className="block space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs text-muted-foreground">
            #{order.order_number}
          </span>
          <span className="font-mono text-sm font-medium">
            €{Number(order.total).toFixed(0)}
          </span>
        </div>
        <p className="text-sm font-medium truncate">
          {order.client?.full_name ?? "—"}
        </p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {cityLabels[order.city] ?? order.city}
          </span>
          {order.scheduled_date && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {order.scheduled_date}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {order.crew && (
            <Badge
              variant="outline"
              className="text-xs"
              style={{
                borderColor: order.crew.color ?? undefined,
                color: order.crew.color ?? undefined,
              }}
            >
              {order.crew.name}
            </Badge>
          )}
          <Badge
            variant="outline"
            className={cn(
              "text-xs",
              order.payment_status === "paid" &&
                "border-green-500 text-green-700",
              order.payment_status === "partial" &&
                "border-amber-500 text-amber-700",
            )}
          >
            {paymentLabels[order.payment_status] ?? order.payment_status}
          </Badge>
        </div>
      </Link>
    </div>
  );
}
