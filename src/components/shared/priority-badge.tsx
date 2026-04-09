import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AlertTriangle, Minus, ArrowDown } from "lucide-react";

const priorities: Record<
  string,
  {
    label: string;
    className: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  urgent: {
    label: "Срочный",
    className: "bg-red-50 text-red-700 border-red-200",
    icon: AlertTriangle,
  },
  normal: {
    label: "Обычный",
    className: "bg-blue-50 text-blue-700 border-blue-200",
    icon: Minus,
  },
  low: {
    label: "Низкий",
    className: "bg-gray-50 text-gray-600 border-gray-200",
    icon: ArrowDown,
  },
};

export function PriorityBadge({ priority }: { priority: string }) {
  const config = priorities[priority] ?? priorities.normal;
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn("gap-1 font-medium", config.className)}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}
