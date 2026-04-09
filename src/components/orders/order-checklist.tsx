"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle } from "lucide-react";

const defaultChecklist = [
  { id: "filters", label: "Промыть фильтры" },
  { id: "coils", label: "Почистить теплообменник" },
  { id: "drain", label: "Прочистить дренаж" },
  { id: "check_freon", label: "Проверить уровень фреона" },
  { id: "test_modes", label: "Проверить режимы работы" },
  { id: "photo_before", label: "Фото ДО" },
  { id: "photo_after", label: "Фото ПОСЛЕ" },
  { id: "cleanup", label: "Убрать за собой" },
];

interface OrderChecklistProps {
  orderId: string;
  initialChecked?: string[];
}

export function OrderChecklist({ initialChecked = [] }: OrderChecklistProps) {
  const [checked, setChecked] = useState<Set<string>>(new Set(initialChecked));

  function toggle(id: string) {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  }

  const progress = (checked.size / defaultChecklist.length) * 100;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Чеклист работ</h4>
        <span className="text-xs text-muted-foreground">
          {checked.size}/{defaultChecklist.length}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-green-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="space-y-1">
        {defaultChecklist.map((item) => {
          const isDone = checked.has(item.id);
          return (
            <button
              key={item.id}
              onClick={() => toggle(item.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent",
                isDone && "text-muted-foreground line-through",
              )}
            >
              {isDone ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground" />
              )}
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
