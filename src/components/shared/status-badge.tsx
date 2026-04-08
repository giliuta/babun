import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusConfig: Record<string, { label: string; className: string }> = {
  new: {
    label: "Новый",
    className: "bg-gray-100 text-gray-700 border-gray-200",
  },
  confirmed: {
    label: "Подтверждён",
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  scheduled: {
    label: "Запланирован",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  in_progress: {
    label: "В работе",
    className: "bg-purple-50 text-purple-700 border-purple-200",
  },
  completed: {
    label: "Завершён",
    className: "bg-green-50 text-green-700 border-green-200",
  },
  cancelled: {
    label: "Отменён",
    className: "bg-red-50 text-red-700 border-red-200",
  },
  no_show: {
    label: "Неявка",
    className: "bg-orange-50 text-orange-700 border-orange-200",
  },
  // Payment statuses
  unpaid: {
    label: "Не оплачен",
    className: "bg-gray-100 text-gray-600 border-gray-200",
  },
  partial: {
    label: "Частично",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  paid: {
    label: "Оплачен",
    className: "bg-green-50 text-green-700 border-green-200",
  },
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium",
        config?.className ?? "bg-gray-100 text-gray-600",
        className,
      )}
    >
      {config?.label ?? status}
    </Badge>
  );
}
