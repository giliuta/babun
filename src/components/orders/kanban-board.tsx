"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { kanbanStatuses } from "@/lib/validations/order";
import { changeOrderStatusAction } from "@/lib/actions/orders";
import { KanbanColumn } from "./kanban-column";
import { OrderCard } from "./order-card";

type OrderWithRelations = {
  id: string;
  order_number: number;
  status: string;
  city: string;
  scheduled_date: string | null;
  total: number;
  payment_status: string;
  client: { id: string; full_name: string; phone: string } | null;
  crew: { id: string; name: string; color: string | null } | null;
};

const statusLabels: Record<string, string> = {
  new: "Новые",
  confirmed: "Подтверждённые",
  scheduled: "Запланированные",
  in_progress: "В работе",
  completed: "Завершённые",
};

const statusColors: Record<string, string> = {
  new: "border-t-gray-400",
  confirmed: "border-t-blue-500",
  scheduled: "border-t-amber-500",
  in_progress: "border-t-purple-500",
  completed: "border-t-green-500",
};

export function KanbanBoard({ orders }: { orders: OrderWithRelations[] }) {
  const [items, setItems] = useState(orders);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const activeOrder = items.find((o) => o.id === activeId);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const orderId = active.id as string;
    const newStatus = over.id as string;
    const order = items.find((o) => o.id === orderId);
    if (!order || order.status === newStatus) return;

    setItems((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)),
    );
    await changeOrderStatusAction(orderId, newStatus);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {kanbanStatuses.map((status) => (
          <KanbanColumn
            key={status}
            id={status}
            title={statusLabels[status]}
            colorClass={statusColors[status]}
            orders={items.filter((o) => o.status === status)}
          />
        ))}
      </div>
      <DragOverlay>
        {activeOrder ? <OrderCard order={activeOrder} isDragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}
