import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Segment = "new" | "active" | "sleeping" | "lost" | "vip";

function getSegment(
  totalOrders: number,
  lastServiceDate: string | null,
  isVip: boolean,
): Segment {
  if (isVip) return "vip";
  if (totalOrders === 0) return "new";

  if (!lastServiceDate) return "active";

  const monthsSince = Math.floor(
    (Date.now() - new Date(lastServiceDate).getTime()) /
      (30 * 24 * 60 * 60 * 1000),
  );

  if (monthsSince > 6) return "lost";
  if (monthsSince > 3) return "sleeping";
  return "active";
}

const segmentConfig: Record<Segment, { label: string; className: string }> = {
  new: {
    label: "Новый",
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  active: {
    label: "Активный",
    className: "bg-green-50 text-green-700 border-green-200",
  },
  sleeping: {
    label: "Спящий",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  lost: {
    label: "Потерян",
    className: "bg-red-50 text-red-700 border-red-200",
  },
  vip: {
    label: "VIP",
    className: "bg-purple-50 text-purple-700 border-purple-200",
  },
};

interface ClientSegmentProps {
  totalOrders: number;
  lastServiceDate: string | null;
  isVip: boolean;
  className?: string;
}

export function ClientSegment({
  totalOrders,
  lastServiceDate,
  isVip,
  className,
}: ClientSegmentProps) {
  const segment = getSegment(totalOrders, lastServiceDate, isVip);
  const config = segmentConfig[segment];

  return (
    <Badge
      variant="outline"
      className={cn("font-medium", config.className, className)}
    >
      {config.label}
    </Badge>
  );
}
