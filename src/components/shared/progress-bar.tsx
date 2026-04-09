import { cn } from "@/lib/utils";

interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  showPercent?: boolean;
  className?: string;
  color?: "default" | "green" | "amber" | "red";
}

const colorClasses = {
  default: "bg-primary",
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

export function ProgressBar({
  value,
  max = 100,
  label,
  showPercent = true,
  className,
  color = "default",
}: ProgressBarProps) {
  const percent = Math.min(Math.round((value / max) * 100), 100);
  const barColor =
    color === "default"
      ? percent > 80
        ? "bg-red-500"
        : percent > 50
          ? "bg-amber-500"
          : "bg-green-500"
      : colorClasses[color];

  return (
    <div className={cn("space-y-1", className)}>
      {(label || showPercent) && (
        <div className="flex items-center justify-between text-xs">
          {label && <span className="text-muted-foreground">{label}</span>}
          {showPercent && <span className="font-medium">{percent}%</span>}
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            barColor,
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
